import * as THREE from 'three'
import qrcode from 'qrcode-generator'
import { createViewer, previewMaterial } from '../core/viewer.js'
import { downloadSTL } from '../core/stl.js'
import { subtract } from '../core/csg.js'
import {
  roundedRectShape, circleShape, contoursToShapes, extrudeShapes,
  mergeGeoms, placeOnGround, sizeOf,
} from '../core/geometry.js'
import { cleanPolygons, diffPolygons, clipperToPoints } from '../core/trace.js'
import {
  getToolLayout, group, slider, select, textInput, checkbox, button,
  makeStatus, debounce, nextFrame,
} from '../core/ui.js'

// biblioteka domyślnie obcina znaki do 1 bajta — kodujemy treść jako UTF-8,
// żeby polskie znaki i emoji w URL-ach dawały poprawny, skanowalny kod
qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s))

const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)
const viewer = createViewer(viewerEl)

let mesh = null

const regenDebounced = debounce(regen, 300)

const hintP = (parent, text) => {
  const p = document.createElement('p')
  p.className = 'hint'
  p.textContent = text
  parent.appendChild(p)
}

// ── Panel ───────────────────────────────────────────────────────────
const gText = group(controls, 'Treść')
const cText = textInput(gText, {
  label: 'Treść',
  value: 'https://github.com',
  placeholder: 'https://…',
  onChange: regenDebounced,
})
const cEc = select(gText, {
  label: 'Korekcja błędów',
  options: [
    { value: 'L', label: 'L — niska (7%)' },
    { value: 'M', label: 'M — średnia (15%)' },
    { value: 'Q', label: 'Q — wysoka (25%)' },
    { value: 'H', label: 'H — najwyższa (30%)' },
  ],
  value: 'M',
  onChange: regenDebounced,
})
hintP(gText, 'Wyższa korekcja = kod gęstszy, ale odporniejszy na uszkodzenia wydruku.')

const gPlate = group(controls, 'Płytka')
const cSize = slider(gPlate, { label: 'Rozmiar (bok)', min: 30, max: 120, step: 1, value: 60, onChange: regenDebounced })
const cThick = slider(gPlate, { label: 'Grubość podstawy', min: 1.2, max: 5, step: 0.1, value: 2.4, onChange: regenDebounced })
const cRound = slider(gPlate, { label: 'Zaokrąglenie rogów', min: 0, max: 10, step: 0.5, value: 4, onChange: regenDebounced })
const cEar = checkbox(gPlate, { label: 'Ucho do zawieszenia', value: false, onChange: regenDebounced })

const gCode = group(controls, 'Kod')
const cRelief = slider(gCode, { label: 'Wysokość modułów', min: 0.6, max: 3, step: 0.1, value: 1.2, onChange: regenDebounced })
const cStyle = select(gCode, {
  label: 'Styl',
  options: [
    { value: 'raised', label: 'Wypukły (relief)' },
    { value: 'engraved', label: 'Grawerowany (wgłębiony)' },
  ],
  value: 'raised',
  onChange: regenDebounced,
})
const cMargin = slider(gCode, { label: 'Margines (strefa ciszy)', min: 2, max: 6, step: 1, value: 4, unit: 'mod.', onChange: regenDebounced })
hintP(gCode, 'Biały margines wokół kodu (strefa ciszy) jest wymagany, żeby czytniki go rozpoznały.')

const gOut = group(controls, 'Eksport')
const btn = button(gOut, {
  label: 'Pobierz STL',
  kind: 'primary',
  onClick: () => {
    if (!mesh) return
    downloadSTL(mesh, 'tabliczka-qr.stl')
    status('Zapisano tabliczka-qr.stl', 'ok')
  },
})
btn.disabled = true
hintP(gOut, 'Druk na płasko (kodem do góry), bez podpór. Najlepszy kontrast: ciemne moduły na jasnym tle — przy stylu wypukłym zmień filament na warstwie kończącej podstawę.')

regen()

// ── Generowanie ─────────────────────────────────────────────────────
async function regen() {
  if (!cText.value.trim()) {
    btn.disabled = true
    status('Wpisz treść (np. adres strony), aby wygenerować tabliczkę.', 'info')
    return
  }
  status('Generuję tabliczkę…', 'busy')
  await nextFrame()
  try {
    const { geom, moduleCount, moduleSize, notes } = buildModel()
    mesh = new THREE.Mesh(geom, previewMaterial())
    viewer.setContent(mesh)
    viewer.fit()
    btn.disabled = false
    const s = sizeOf(geom)
    const tris = Math.round((geom.getIndex() ? geom.getIndex().count : geom.getAttribute('position').count) / 3)
    let msg = `Gotowe — ${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm, ` +
      `kod ${moduleCount}×${moduleCount} (moduł ${moduleSize.toFixed(2)} mm), ` +
      `${tris.toLocaleString('pl-PL')} trójkątów.`
    if (cStyle.value === 'raised') {
      msg += ` Druk dwukolorowy: zmień filament na wysokości podstawy (${cThick.value.toFixed(1)} mm).`
    }
    for (const n of notes) msg += ' ' + n
    status(msg, 'ok')
  } catch (e) {
    console.error(e)
    const m = e && e.message ? e.message : String(e)
    status('Błąd generowania: ' + m, 'error')
  }
}

/** Buduje macierz QR; przy przepełnieniu rzuca czytelny błąd po polsku. */
function makeQR(text, ecLevel) {
  try {
    const qr = qrcode(0, ecLevel) // 0 = automatyczny dobór wersji (rozmiaru)
    qr.addData(text)
    qr.make()
    return qr
  } catch {
    throw new Error('treść nie mieści się w kodzie QR — skróć treść albo obniż poziom korekcji błędów')
  }
}

/** Obrys płytki w 2D (środek w 0,0); przy zerowym zaokrągleniu zwykły prostokąt. */
function plateShape2D(size, round) {
  if (round >= 0.3) return roundedRectShape(size, size, round)
  const s = new THREE.Shape()
  s.moveTo(-size / 2, -size / 2)
  s.lineTo(size / 2, -size / 2)
  s.lineTo(size / 2, size / 2)
  s.lineTo(-size / 2, size / 2)
  s.closePath()
  return s
}

// Współrzędne do Clippera skalujemy ×10 (tolerancja czyszczenia 0,15 jedn.
// odpowiada wtedy 0,015 mm) — jak w breloku.
const CLIP_MM = 10

/**
 * Buduje tabliczkę z kodem QR (Z-w-górę, mm).
 * Płytka: zaokrąglony kwadrat (opcjonalnie z uchem ⌀4 scalonym w 2D) → extrude.
 * Kod: pole = rozmiar − 2·margines·moduł; ciemne moduły łączone poziomo
 * (greedy po wierszach) w prostopadłościany. Wiersze QR rosną „w dół",
 * więc oś Y odwracamy — inaczej kod byłby lustrzany i nie do zeskanowania.
 * Wypukły: klocki zanurzone 0,1 mm w płytkę + mergeGeoms (szczelny STL).
 * Grawerowany: klocki wystają 0,1 mm nad płytkę, zagłębione na relief → subtract.
 */
function buildModel() {
  const notes = []
  const text = cText.value.trim()
  const size = cSize.value
  const baseThick = cThick.value
  const relief = cRelief.value
  const marginMod = Math.round(cMargin.value)
  const style = cStyle.value

  const qr = makeQR(text, cEc.value)
  const N = qr.getModuleCount()
  const ms = size / (N + 2 * marginMod) // rozmiar pojedynczego modułu
  const field = N * ms                  // bok pola z modułami
  if (ms < 1) {
    notes.push(`Uwaga: moduły mają tylko ${ms.toFixed(2)} mm — powiększ płytkę, skróć treść lub obniż korekcję, żeby kod skanował się pewnie.`)
  }

  // ── płytka ──
  let plateGeom
  if (cEar.value) {
    // ucho: okrąg z otworem ⌀4, scalony z obrysem w 2D (Clipper) → szczelna bryła
    const earR = 4.5 // (⌀4 + 5 mm materiału) / 2
    const holeR = 2
    const earCY = size / 2 + earR * 0.2 // 0,8·R zachodzi na płytkę, 1,2·R wystaje
    const loop = (pts, dy = 0) => pts.map((p) => ({ x: p.x * CLIP_MM, y: (p.y + dy) * CLIP_MM }))
    const outline = cleanPolygons([
      loop(plateShape2D(size, cRound.value).getPoints(24)),
      loop(circleShape(earR).getPoints(72), earCY),
    ])
    const ring = diffPolygons(outline, cleanPolygons([loop(circleShape(holeR).getPoints(48), earCY)]))
    const shapes = contoursToShapes(
      clipperToPoints(ring).map((l) => l.map((p) => ({ x: p.x / CLIP_MM, y: p.y / CLIP_MM }))),
    )
    if (!shapes.length) throw new Error('nie udało się dołączyć ucha do płytki')
    plateGeom = extrudeShapes(shapes, baseThick, { curveSegments: 4 })
  } else {
    plateGeom = extrudeShapes([plateShape2D(size, cRound.value)], baseThick, { curveSegments: 24 })
  }

  // ── moduły: poziome ciągi ciemnych pól → jeden klocek na ciąg ──
  const runs = []
  for (let row = 0; row < N; row++) {
    let col = 0
    while (col < N) {
      if (!qr.isDark(row, col)) { col++; continue }
      let end = col
      while (end + 1 < N && qr.isDark(row, end + 1)) end++
      runs.push([row, col, end])
      col = end + 1
    }
  }

  let engrave = relief
  if (style === 'engraved' && engrave > baseThick - 0.6) {
    engrave = baseThick - 0.6
    notes.push(`Grawer spłycony do ${engrave.toFixed(1)} mm (za cienka podstawa).`)
  }
  const boxH = style === 'raised' ? relief + 0.1 : engrave + 0.1
  const boxZ0 = style === 'raised' ? baseThick - 0.1 : baseThick - engrave

  const boxes = runs.map(([row, c0, c1]) => {
    const len = c1 - c0 + 1
    const g = new THREE.BoxGeometry(len * ms, ms, boxH)
    g.translate(
      -field / 2 + (c0 + len / 2) * ms,     // kolumny → +X
      field / 2 - (row + 0.5) * ms,         // wiersze rosną w dół → −Y (bez lustra!)
      boxZ0 + boxH / 2,
    )
    return g
  })
  const modulesGeom = mergeGeoms(boxes)

  const solid = style === 'raised'
    ? mergeGeoms([plateGeom, modulesGeom])
    : subtract(plateGeom, modulesGeom)

  placeOnGround(solid)
  return { geom: solid, moduleCount: N, moduleSize: ms, notes }
}
