import * as THREE from 'three'
import { createViewer, previewMaterial } from '../core/viewer.js'
import { downloadSTL } from '../core/stl.js'
import { subtract } from '../core/csg.js'
import { roundedRectShape, extrudeShapes, mergeGeoms, placeOnGround } from '../core/geometry.js'
import {
  getToolLayout, group, slider, select, button,
  makeStatus, debounce, nextFrame,
} from '../core/ui.js'

const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)
const viewer = createViewer(viewerEl)

let mesh = null

const regenDebounced = debounce(regen, 300)

// ── Panel ───────────────────────────────────────────────────────────
const gGrid = group(controls, 'Siatka')
const cRows = slider(gGrid, { label: 'Rzędy', min: 1, max: 6, step: 1, value: 2, unit: '', onChange: regenDebounced })
const cCols = slider(gGrid, { label: 'Kolumny', min: 1, max: 8, step: 1, value: 4, unit: '', onChange: regenDebounced })

const gCav = group(controls, 'Wgłębienia')
const cShape = select(gCav, {
  label: 'Kształt',
  options: [
    { value: 'hemi', label: 'Półkula' },
    { value: 'cube', label: 'Kostka' },
    { value: 'cyl', label: 'Walec' },
    { value: 'heart', label: 'Serce' },
    { value: 'star', label: 'Gwiazda' },
  ],
  value: 'hemi',
  onChange: regenDebounced,
})
const cSize = slider(gCav, { label: 'Rozmiar (średnica / bok)', min: 10, max: 50, step: 1, value: 24, onChange: regenDebounced })
const cDepth = slider(gCav, { label: 'Głębokość', min: 5, max: 40, step: 1, value: 16, onChange: regenDebounced })
const cCubeR = slider(gCav, { label: 'Zaokrąglenie kostki', min: 0, max: 8, step: 0.5, value: 3, onChange: regenDebounced })
const hintHemi = document.createElement('p')
hintHemi.className = 'hint'
hintHemi.textContent = 'Dla półkuli głębokość nie może przekroczyć połowy rozmiaru (promienia).'
gCav.appendChild(hintHemi)

const gTray = group(controls, 'Tacka')
const cGap = slider(gTray, { label: 'Odstęp między wgłębieniami', min: 3, max: 15, step: 1, value: 6, onChange: regenDebounced })
const cEdge = slider(gTray, { label: 'Brzeg', min: 4, max: 15, step: 1, value: 8, onChange: regenDebounced })
const cFloor = slider(gTray, { label: 'Dno pod wgłębieniem', min: 2, max: 8, step: 0.5, value: 3, onChange: regenDebounced })
const cTrayR = slider(gTray, { label: 'Zaokrąglenie narożników tacki', min: 0, max: 15, step: 1, value: 6, onChange: regenDebounced })

const gOut = group(controls, 'Eksport')
const btn = button(gOut, {
  label: 'Pobierz STL',
  kind: 'primary',
  onClick: () => {
    if (!mesh) return
    downloadSTL(mesh, 'tacka.stl')
    status('Zapisano tacka.stl', 'ok')
  },
})
const hint = document.createElement('p')
hint.className = 'hint'
hint.textContent = 'Do żywności drukuj z PETG i traktuj jak formę na silikon spożywczy — wydruk FDM ma pory.'
gOut.appendChild(hint)

// ── Generowanie ─────────────────────────────────────────────────────
async function regen() {
  status('Generuję tackę…', 'busy')
  await nextFrame()
  try {
    const geom = buildTray()
    mesh = new THREE.Mesh(geom, previewMaterial())
    viewer.setContent(mesh)
    viewer.fit()
    const tris = geom.getAttribute('position').count / 3
    status(`Gotowe — ${Math.round(tris / 1000)}k trójkątów. Możesz pobrać STL.`, 'ok')
  } catch (e) {
    console.error(e)
    status('Błąd generowania: ' + e.message, 'error')
  }
}

/** Kształt serca wpisany w kwadrat size×size, środek (0,0). */
function heartShape(size) {
  const s = size / 30 // krzywa projektowana w układzie 30×30
  const sh = new THREE.Shape()
  sh.moveTo(0, -15 * s)
  sh.bezierCurveTo(-16 * s, -2 * s, -13 * s, 15 * s, 0 * s, 6 * s)
  // odbicie lustrzane drugiej połowy
  sh.bezierCurveTo(13 * s, 15 * s, 16 * s, -2 * s, 0, -15 * s)
  return sh
}

/** Gwiazda 5-ramienna o promieniu r, środek (0,0). */
function starShape(r) {
  const sh = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2
    const x = Math.cos(a) * rad
    const y = Math.sin(a) * rad
    if (i === 0) sh.moveTo(x, y)
    else sh.lineTo(x, y)
  }
  sh.closePath()
  return sh
}

/** Parametryczna tacka (Z-up): płyta z zaokrąglonymi rogami minus siatka wgłębień. */
function buildTray() {
  const rows = cRows.value
  const cols = cCols.value
  const size = cSize.value
  const shape = cShape.value
  const depth = shape === 'hemi' ? Math.min(cDepth.value, size / 2) : cDepth.value
  const gap = cGap.value
  const edge = cEdge.value
  const floor = cFloor.value

  const W = cols * size + (cols - 1) * gap + 2 * edge
  const D = rows * size + (rows - 1) * gap + 2 * edge
  const H = depth + floor

  const slab = extrudeShapes(roundedRectShape(W, D, cTrayR.value), H)

  // jedna wnęka (górą na z = H + 1, wystaje 1 mm ponad płytę)
  let cavity
  if (shape === 'hemi') {
    const r = size / 2
    cavity = new THREE.SphereGeometry(r, 32, 24)
    // +0.01: równik nie może leżeć dokładnie w płaszczyźnie górnej ściany
    // (współpłaszczyznowe szwy CSG produkują paski zdegenerowanych trójkątów)
    cavity.translate(0, 0, H + (r - depth) + 0.01)
  } else if (shape === 'cube') {
    cavity = extrudeShapes(roundedRectShape(size, size, Math.min(cCubeR.value, size / 2 - 0.5)), depth + 1)
    cavity.translate(0, 0, H - depth)
  } else if (shape === 'cyl') {
    // lekko zwężony ku dołowi — łatwiej wyjmować
    cavity = new THREE.CylinderGeometry(size / 2, size / 2 * 0.85, depth + 1, 48)
    cavity.rotateX(Math.PI / 2)
    cavity.translate(0, 0, H - depth + (depth + 1) / 2)
  } else if (shape === 'heart') {
    cavity = extrudeShapes(heartShape(size), depth + 1, { curveSegments: 16 })
    cavity.translate(0, 0, H - depth)
  } else {
    cavity = extrudeShapes(starShape(size / 2), depth + 1)
    cavity.translate(0, 0, H - depth)
  }

  // rozmieszczenie w siatce i JEDNO odejmowanie scalonych wnęk
  const cavities = []
  const x0 = -W / 2 + edge + size / 2
  const y0 = -D / 2 + edge + size / 2
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const g = cavity.clone()
      g.translate(x0 + c * (size + gap), y0 + r * (size + gap), 0)
      cavities.push(g)
    }
  }
  const geom = subtract(slab, mergeGeoms(cavities))
  placeOnGround(geom)
  return geom
}

regen()
