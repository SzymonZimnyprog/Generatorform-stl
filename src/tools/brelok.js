import * as THREE from 'three'
import { createViewer, previewMaterial } from '../core/viewer.js'
import { downloadSTL } from '../core/stl.js'
import {
  getToolLayout, group, slider, select, textInput, button,
  makeStatus, debounce, nextFrame,
} from '../core/ui.js'
import { loadFont, fontOptions, textToShapes } from '../core/text.js'
import {
  roundedRectShape, circleShape, extrudeShapes, mergeGeoms, placeOnGround, sizeOf,
  contoursToShapes,
} from '../core/geometry.js'
import { cleanPolygons, diffPolygons, offsetPolygons, clipperToPoints } from '../core/trace.js'

const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)
const viewer = createViewer(viewerEl)

let mesh = null

const regenDebounced = debounce(regen, 300)

// ── Panel ───────────────────────────────────────────────────────────
const gText = group(controls, 'Tekst')
const cText = textInput(gText, {
  label: 'Treść',
  value: 'Kuba',
  placeholder: 'np. imię',
  onChange: regenDebounced,
})
const cFont = select(gText, {
  label: 'Krój pisma',
  options: fontOptions(),
  value: 'montserrat',
  onChange: regenDebounced,
})
const cSize = slider(gText, { label: 'Wysokość tekstu', min: 6, max: 30, step: 0.5, value: 12, onChange: regenDebounced })
const cStyle = select(gText, {
  label: 'Styl tekstu',
  options: [
    { value: 'raised', label: 'Wypukły (relief)' },
    { value: 'engraved', label: 'Grawerowany' },
  ],
  value: 'raised',
  onChange: regenDebounced,
})
const cRelief = slider(gText, { label: 'Wysokość reliefu / głębokość graweru', min: 0.6, max: 3, step: 0.1, value: 1.2, onChange: regenDebounced })

const gPlate = group(controls, 'Podkładka')
const cShape = select(gPlate, {
  label: 'Kształt podkładki',
  options: [
    { value: 'pill', label: 'Pastylka (zaokrąglone końce)' },
    { value: 'rect', label: 'Prostokąt' },
    { value: 'ellipse', label: 'Elipsa' },
  ],
  value: 'pill',
  onChange: () => { updateVisibility(); regenDebounced() },
})
const cMargin = slider(gPlate, { label: 'Margines wokół tekstu', min: 2, max: 10, step: 0.5, value: 4, onChange: regenDebounced })
const cThick = slider(gPlate, { label: 'Grubość podkładki', min: 2, max: 8, step: 0.5, value: 3.5, onChange: regenDebounced })
const cRound = slider(gPlate, { label: 'Zaokrąglenie rogów', min: 0, max: 8, step: 0.5, value: 3, onChange: regenDebounced })

const gHole = group(controls, 'Otwór')
const cHoleD = slider(gHole, { label: 'Średnica otworu', min: 3, max: 8, step: 0.5, value: 4.5, onChange: regenDebounced })
const cHoleSide = select(gHole, {
  label: 'Pozycja otworu',
  options: [
    { value: 'left', label: 'Po lewej' },
    { value: 'right', label: 'Po prawej' },
  ],
  value: 'left',
  onChange: regenDebounced,
})

const gOut = group(controls, 'Eksport')
const btn = button(gOut, {
  label: 'Pobierz STL',
  kind: 'primary',
  onClick: () => {
    if (!mesh) return
    downloadSTL(mesh, 'brelok.stl')
    status('Zapisano brelok.stl', 'ok')
  },
})
btn.disabled = true
const hint = document.createElement('p')
hint.className = 'hint'
hint.textContent = 'Druk na płasko (tekstem do góry), bez podpór. Przy zmianie koloru filamentu po warstwie, na której zaczyna się relief, napis będzie dwukolorowy.'
gOut.appendChild(hint)

function updateVisibility() {
  cRound.el.style.display = cShape.value === 'rect' ? '' : 'none'
}
updateVisibility()
regen()

// ── Generowanie ─────────────────────────────────────────────────────
async function regen() {
  if (!cText.value.trim()) {
    btn.disabled = true
    status('Wpisz tekst, aby wygenerować brelok.', 'info')
    return
  }
  status('Generuję brelok…', 'busy')
  await nextFrame()
  try {
    const font = await loadFont(cFont.value)
    const { geom, textW, textH, notes } = buildModel(font)
    mesh = new THREE.Mesh(geom, previewMaterial())
    viewer.setContent(mesh)
    viewer.fit()
    btn.disabled = false
    const s = sizeOf(geom)
    const tris = Math.round((geom.getIndex() ? geom.getIndex().count : geom.getAttribute('position').count) / 3)
    let msg = `Gotowe — ${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm ` +
      `(tekst ${textW.toFixed(1)} × ${textH.toFixed(1)} mm), ${tris.toLocaleString('pl-PL')} trójkątów.`
    for (const n of notes) msg += ' ' + n
    status(msg, 'ok')
  } catch (e) {
    console.error(e)
    status('Błąd generowania: ' + e.message, 'error')
  }
}

// Cała płaska geometria (podkładka+ucho, otwór, litery) liczona jest w 2D
// Clipperem i dopiero potem wyciągana — dzięki temu STL jest szczelny
// (openEdges = 0). CSG na bryłach (three-bvh-csg) zostawia przy cięciach
// T-wierzchołki, więc otwór też wycinamy w 2D, przed ekstruzją.
// Współrzędne do Clippera skalujemy ×10, bo cleanPolygons czyści z tolerancją
// 0,15 jednostki (dobraną do pikseli) — po przeskalowaniu to 0,015 mm.
const CLIP_MM = 10
const scaleLoop = (pts, dx = 0) => pts.map((p) => ({ x: (p.x + dx) * CLIP_MM, y: p.y * CLIP_MM }))
const polysToShapesMm = (polys) => contoursToShapes(
  clipperToPoints(polys).map((l) => l.map((p) => ({ x: p.x / CLIP_MM, y: p.y / CLIP_MM }))),
)

/**
 * Buduje brelok (Z-w-górę, mm): podkładka wg rozmiaru tekstu + „ucho"
 * (okrąg scalony z podkładką w 2D), otwór wycięty z konturu, a na wierzchu
 * tekst wypukły albo wgłębiony (grawer = dolna płyta + górna płyta z
 * literami odjętymi w 2D). Całość wyśrodkowana w XY i postawiona na z=0.
 */
function buildModel(font) {
  const notes = []
  const style = cStyle.value
  const margin = cMargin.value
  const thick = cThick.value
  const holeD = cHoleD.value
  const side = cHoleSide.value === 'right' ? 1 : -1 // strona ucha (znak osi X)

  const { shapes: textShapes, width: textW, height: textH } =
    textToShapes(font, cText.value.trim(), cSize.value, { align: 'center' })
  if (!textShapes.length || textW <= 0) throw new Error('tekst nie zawiera drukowalnych znaków')

  // ── podkładka 2D (środek w 0,0) ──
  let plateShape
  let plateW
  let plateH
  if (cShape.value === 'ellipse') {
    // elipsa opisana na prostokącie tekstu, powiększona o margines
    const rx = textW / Math.SQRT2 + margin
    const ry = textH / Math.SQRT2 + margin
    plateW = rx * 2
    plateH = ry * 2
    plateShape = new THREE.Shape()
    plateShape.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0)
  } else {
    plateW = textW + 2 * margin
    plateH = textH + 2 * margin
    const r = cShape.value === 'pill' ? plateH / 2 - 0.01 : cRound.value
    plateShape = roundedRectShape(plateW, plateH, r)
  }

  // ── ucho: okrąg ⌀ = otwór + 5 mm, nachodzi ~40% średnicy na podkładkę ──
  const earR = (holeD + 5) / 2
  const earCX = side * (plateW / 2 + earR * 0.2) // 0,8·R w środku, 1,2·R wystaje

  // podkładka ∪ ucho, minus otwór → „ring" (jeden spójny kontur z dziurą)
  const plateLoop = scaleLoop(plateShape.getPoints(cShape.value === 'ellipse' ? 96 : 24))
  const earLoop = scaleLoop(circleShape(earR).getPoints(72), earCX)
  const holeLoop = scaleLoop(circleShape(holeD / 2).getPoints(64), earCX)
  const outlinePolys = cleanPolygons([plateLoop, earLoop])
  const ringPolys = diffPolygons(outlinePolys, cleanPolygons([holeLoop]))
  const ringShapes = polysToShapesMm(ringPolys)
  if (!ringShapes.length) throw new Error('nie udało się scalić podkładki z uchem')

  // ── litery w 2D: wyśrodkowane na podkładce, lekko odsunięte od ucha ──
  const textShift = -side * Math.min(margin * 0.4, earR * 0.4)
  const textLoops = []
  for (const s of textShapes) {
    textLoops.push(scaleLoop(s.getPoints(16), textShift))
    for (const h of s.holes) textLoops.push(scaleLoop(h.getPoints(16), textShift))
  }
  const textPolys = cleanPolygons(textLoops)
  if (!textPolys.length) throw new Error('tekst nie zawiera drukowalnych znaków')

  let solid
  if (style === 'raised') {
    // litery przycięte do obrysu (nie wystają poza podkładkę ani nad otwór),
    // zagłębione 0,1 mm w podkładkę — pewne połączenie brył
    const letterPolys = diffPolygons(textPolys, diffPolygons(textPolys, ringPolys))
    const plate = extrudeShapes(ringShapes, thick, { curveSegments: 4 })
    const letters = extrudeShapes(polysToShapesMm(letterPolys), cRelief.value + 0.1, { curveSegments: 4 })
    letters.translate(0, 0, thick - 0.1)
    solid = mergeGeoms([plate, letters])
  } else {
    let depth = cRelief.value
    if (depth > thick - 0.6) {
      depth = thick - 0.6
      notes.push(`Grawer spłycony do ${depth.toFixed(1)} mm (za cienka podkładka).`)
    }
    // dolna pełna płyta + górna płyta z literami odjętymi w 2D;
    // litery poszerzone o 0,01 mm — usuwa zdegenerowane styki po Clipperze
    const grown = offsetPolygons(textPolys, 0.01 * CLIP_MM)
    const bottom = extrudeShapes(ringShapes, thick - depth, { curveSegments: 4 })
    const top = extrudeShapes(polysToShapesMm(diffPolygons(ringPolys, grown)), depth, { curveSegments: 4 })
    top.translate(0, 0, thick - depth)
    solid = mergeGeoms([bottom, top])
  }

  return { geom: placeOnGround(solid), textW, textH, notes }
}
