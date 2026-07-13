import * as THREE from 'three'
import { createViewer, previewMaterial } from '../core/viewer.js'
import { downloadSTL } from '../core/stl.js'
import {
  getToolLayout, group, slider, checkbox, button, fileDrop,
  makeStatus, debounce, nextFrame,
} from '../core/ui.js'
import { extrudeShapes, mergeGeoms, placeOnGround } from '../core/geometry.js'
import {
  fileToImageData, luminanceMask, traceContours, smoothLoop, simplifyLoop,
  cleanPolygons, offsetPolygons, diffPolygons, polygonsToShapes,
  keepLargest, clipperToPoints,
} from '../core/trace.js'

const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)
const viewer = createViewer(viewerEl)

let imageData = null // ImageData wgranego obrazka
let mesh = null

const regenDebounced = debounce(regen, 300)

// ── Panel ───────────────────────────────────────────────────────────
const gImg = group(controls, 'Obrazek')
fileDrop(gImg, {
  label: 'Wgraj obrazek',
  accept: 'image/*',
  hint: 'sylwetka lub logo — ciemny kształt na jasnym tle',
  onFile: async (file) => {
    try {
      imageData = await fileToImageData(file, 480)
      regen()
    } catch {
      status('Nie udało się odczytać tego pliku graficznego.', 'error')
    }
  },
})

const gCont = group(controls, 'Kontur')
const cThreshold = slider(gCont, { label: 'Próg jasności', min: 0, max: 255, step: 1, value: 128, unit: '', onChange: regenDebounced })
const cInvert = checkbox(gCont, { label: 'Odwróć (jasne zamiast ciemnych)', value: false, onChange: regenDebounced })
const cSmooth = slider(gCont, { label: 'Wygładzenie', min: 0, max: 3, step: 1, value: 1, unit: '', onChange: regenDebounced })
const cSimplify = slider(gCont, { label: 'Uproszczenie', min: 0, max: 3, step: 0.1, value: 0.8, unit: 'px', onChange: regenDebounced })
const cHoles = checkbox(gCont, { label: 'Tnij też wewnętrzne otwory', value: true, onChange: regenDebounced })

const gCut = group(controls, 'Wykrawacz')
const cWidth = slider(gCut, { label: 'Szerokość (dłuższy bok)', min: 30, max: 150, step: 1, value: 80, onChange: regenDebounced })
const cHeight = slider(gCut, { label: 'Wysokość całkowita', min: 8, max: 30, step: 0.5, value: 16, onChange: regenDebounced })
const cBlade = slider(gCut, { label: 'Grubość ostrza', min: 0.4, max: 1.6, step: 0.1, value: 0.8, onChange: regenDebounced })
const cWall = slider(gCut, { label: 'Grubość ścianki', min: 0.8, max: 3, step: 0.1, value: 1.6, onChange: regenDebounced })
const cWallH = slider(gCut, { label: 'Wysokość ścianki', min: 2, max: 15, step: 0.5, value: 6, onChange: regenDebounced })
const cFlange = slider(gCut, { label: 'Szerokość kołnierza', min: 2, max: 8, step: 0.5, value: 4, onChange: regenDebounced })
const cFlangeT = slider(gCut, { label: 'Grubość kołnierza', min: 0.8, max: 3, step: 0.1, value: 1.5, onChange: regenDebounced })

const gOut = group(controls, 'Eksport')
const btn = button(gOut, {
  label: 'Pobierz STL',
  kind: 'primary',
  onClick: () => {
    if (!mesh) return
    downloadSTL(mesh, 'wykrawacz.stl')
    status('Zapisano wykrawacz.stl', 'ok')
  },
})
btn.disabled = true
const hint = document.createElement('p')
hint.className = 'hint'
hint.textContent = 'Model generowany jest kołnierzem na stole, a krawędzią tnącą u góry — drukuj tak, jak stoi, a po wydruku odwróć foremkę. Do kontaktu z żywnością użyj PLA/PETG.'
gOut.appendChild(hint)

status('Wgraj obrazek, aby zacząć.', 'info')

// ── Generowanie ─────────────────────────────────────────────────────
async function regen() {
  if (!imageData) return
  status('Generuję wykrawacz…', 'busy')
  await nextFrame()
  try {
    const geom = buildCutter()
    if (!geom) {
      mesh = null
      btn.disabled = true
      status('Nie znaleziono konturu — spróbuj zmienić próg jasności albo zaznaczyć „Odwróć”.', 'error')
      return
    }
    mesh = new THREE.Mesh(geom, previewMaterial())
    viewer.setContent(mesh)
    viewer.fit()
    btn.disabled = false
    const idx = geom.getIndex()
    const tris = idx ? idx.count / 3 : geom.getAttribute('position').count / 3
    const trisTxt = tris >= 1000 ? `${Math.round(tris / 1000)}k` : `${Math.round(tris)}`
    status(`Gotowe — ${trisTxt} trójkątów. Krawędź tnąca u góry — po wydruku odwróć foremkę.`, 'ok')
  } catch (e) {
    console.error(e)
    mesh = null
    btn.disabled = true
    status('Błąd generowania: ' + e.message, 'error')
  }
}

/**
 * Buduje foremkę (Z-w-górę, mm): trzy współśrodkowe pierścienie wokół
 * konturu K z obrazka — ostrze (pełna wysokość), ścianka usztywniająca
 * i kołnierz na stole. Dodatni offset wokół dziur konturu rośnie do
 * środka dziury, więc otwory też dostają nóż.
 * Zwraca BufferGeometry albo null, gdy nie znaleziono konturu.
 */
function buildCutter() {
  const widthMm = cWidth.value
  const totalH = cHeight.value
  const tBlade = cBlade.value
  const tWall = cWall.value
  const wallH = Math.min(cWallH.value, totalH)
  const wFlange = cFlange.value
  const flangeT = Math.min(cFlangeT.value, totalH)

  // 1. obraz → maska → kontury (w pikselach)
  const mask = luminanceMask(imageData, { threshold: cThreshold.value, invert: cInvert.value })
  let loops = traceContours(mask, imageData.width, imageData.height)
  const smoothIters = Math.round(cSmooth.value)
  const eps = cSimplify.value
  loops = loops.map((l) => simplifyLoop(smoothLoop(l, smoothIters), eps))
  let polys = cleanPolygons(loops)
  polys = keepLargest(polys, { withHoles: cHoles.value })
  if (!polys.length) return null

  // 2. przeliczenie px → mm: dłuższy bok konturu = zadana szerokość
  const pts = clipperToPoints(polys)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const path of pts) {
    for (const p of path) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }
  const spanPx = Math.max(maxX - minX, maxY - minY)
  if (!(spanPx > 0)) return null
  const k = widthMm / spanPx
  const scaled = pts.map((path) => path.map((p) => ({ x: p.x * k, y: p.y * k })))
  const K = cleanPolygons(scaled) // kontur w mm (z ew. dziurami)
  if (!K.length) return null

  // 3. trzy pierścienie (offsety w mm od konturu K)
  const ringBlade = diffPolygons(offsetPolygons(K, tBlade), K)
  const ringWall = diffPolygons(offsetPolygons(K, tBlade + tWall), K)
  const ringFlange = diffPolygons(offsetPolygons(K, tBlade + tWall + wFlange), K)

  const geoms = []
  if (ringBlade.length) geoms.push(extrudeShapes(polygonsToShapes(ringBlade), totalH))
  if (ringWall.length) geoms.push(extrudeShapes(polygonsToShapes(ringWall), wallH))
  if (ringFlange.length) geoms.push(extrudeShapes(polygonsToShapes(ringFlange), flangeT))
  if (!geoms.length) return null

  const geom = mergeGeoms(geoms)
  placeOnGround(geom) // wyśrodkowanie XY (min Z i tak jest na 0)
  return geom
}
