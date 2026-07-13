import * as THREE from 'three'
import { createViewer, previewMaterial } from '../core/viewer.js'
import { downloadSTL } from '../core/stl.js'
import {
  getToolLayout, group, slider, select, textInput, checkbox, button,
  makeStatus, debounce, nextFrame,
} from '../core/ui.js'
import { roundedRectShape, circleShape, extrudeShapes, mergeGeoms } from '../core/geometry.js'
import { loadFont, fontOptions, textToShapes } from '../core/text.js'

const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)
const viewer = createViewer(viewerEl)

let mesh = null

const regenDebounced = debounce(regen, 300)

// ── Panel ───────────────────────────────────────────────────────────
const gText = group(controls, 'Tekst')
const cText = textInput(gText, {
  label: 'Tekst stempla',
  value: 'ANIA',
  placeholder: 'np. ANIA\n(może być kilka linii)',
  multiline: true,
  onChange: regenDebounced,
})
const cFont = select(gText, { label: 'Krój pisma', options: fontOptions(), value: 'montserrat', onChange: regenDebounced })
const cTextH = slider(gText, { label: 'Wysokość tekstu', min: 6, max: 40, step: 1, value: 12, onChange: regenDebounced })
const cRelief = slider(gText, { label: 'Głębokość reliefu', min: 0.8, max: 3, step: 0.1, value: 1.5, onChange: regenDebounced })
const cMirror = checkbox(gText, { label: 'Lustrzane odbicie', value: true, onChange: regenDebounced })
const mirrorHint = document.createElement('p')
mirrorHint.className = 'hint'
mirrorHint.textContent = 'Stempel musi być odbity lustrzanie, żeby odcisk był czytelny.'
gText.appendChild(mirrorHint)

const gPlate = group(controls, 'Płytka')
const cShape = select(gPlate, {
  label: 'Kształt',
  options: [
    { value: 'rect', label: 'Prostokąt' },
    { value: 'circle', label: 'Koło' },
  ],
  value: 'rect',
  onChange: regenDebounced,
})
const cMargin = slider(gPlate, { label: 'Margines', min: 2, max: 10, step: 0.5, value: 4, onChange: regenDebounced })
const cPlateT = slider(gPlate, { label: 'Grubość płytki', min: 2, max: 8, step: 0.5, value: 4, onChange: regenDebounced })
const cRound = slider(gPlate, { label: 'Zaokrąglenie rogów', min: 0, max: 10, step: 0.5, value: 3, onChange: regenDebounced })

const gHandle = group(controls, 'Uchwyt')
const cHandle = checkbox(gHandle, { label: 'Dodaj uchwyt', value: true, onChange: regenDebounced })
const cHandleH = slider(gHandle, { label: 'Wysokość uchwytu', min: 10, max: 40, step: 1, value: 22, onChange: regenDebounced })

const gOut = group(controls, 'Eksport')
const btn = button(gOut, {
  label: 'Pobierz STL',
  kind: 'primary',
  onClick: () => {
    if (!mesh) return
    downloadSTL(mesh, 'stempel.stl')
    status('Zapisano stempel.stl', 'ok')
  },
})
btn.disabled = true
const hint = document.createElement('p')
hint.className = 'hint'
hint.textContent = 'Model stoi literami do dołu — pierwsza warstwa wydruku to powierzchnia stempla, dzięki czemu odcisk jest idealnie ostry.'
gOut.appendChild(hint)

regen()

// ── Generowanie ─────────────────────────────────────────────────────
async function regen() {
  status('Generuję stempel…', 'busy')
  await nextFrame()
  try {
    const geom = await buildStamp()
    mesh = new THREE.Mesh(geom, previewMaterial())
    viewer.setContent(mesh)
    viewer.fit()
    btn.disabled = false
    const tris = geom.getIndex() ? geom.getIndex().count / 3 : geom.getAttribute('position').count / 3
    status(`Gotowe — ${Math.round(tris / 1000)}k trójkątów. Drukuj tak jak stoi — literami na stole.`, 'ok')
  } catch (e) {
    console.error(e)
    btn.disabled = true
    status('Błąd generowania: ' + e.message, 'error')
  }
}

/**
 * Buduje stempel (Z-w-górę, mm), drukowany literami do dołu:
 *  - relief (litery) z = 0 … r,
 *  - płytka z = r−0.1 … r−0.1+t (lekki zakład, żeby bryły się przenikały),
 *  - opcjonalny uchwyt: stożek od z = r+t−0.2 w górę + kulka na szczycie.
 */
async function buildStamp() {
  const text = cText.value
  if (!text.trim()) throw new Error('Wpisz tekst stempla.')

  const font = await loadFont(cFont.value)
  const r = cRelief.value
  const t = cPlateT.value
  const margin = cMargin.value

  const { shapes, width, height } = textToShapes(font, text, cTextH.value, { align: 'center' })
  if (!shapes.length || width <= 0 || height <= 0) {
    throw new Error('Nie udało się zbudować liter — zmień tekst lub krój pisma.')
  }

  // Relief liter: z = 0 … r
  const textGeom = extrudeShapes(shapes, r, { curveSegments: 12 })
  if (cMirror.value) {
    // Lustro bez psucia normalnych: obrót o 180° wokół Y (zachowuje orientację
    // trójkątów) daje odbicie w X, a z = 0…r wraca po translacji o +r.
    textGeom.rotateY(Math.PI)
    textGeom.translate(0, 0, r)
  }
  const parts = [textGeom]

  // Płytka: z = r−0.1 … r−0.1+t
  let plateShape
  let plateW
  let plateH
  if (cShape.value === 'circle') {
    const rad = Math.hypot(width, height) / 2 + margin // średnica = przekątna tekstu + 2·margines
    plateShape = circleShape(rad)
    plateW = rad * 2
    plateH = rad * 2
  } else {
    plateW = width + 2 * margin
    plateH = height + 2 * margin
    plateShape = roundedRectShape(plateW, plateH, cRound.value)
  }
  const plate = extrudeShapes(plateShape, t, { curveSegments: 48 })
  plate.translate(0, 0, r - 0.1)
  parts.push(plate)

  // Uchwyt: stożek (wąski koniec u góry) + kulka zanurzona 1 mm w stożek
  if (cHandle.value) {
    const hh = cHandleH.value
    const base = r + t - 0.2
    const halfMin = Math.min(plateW, plateH) / 2
    const rBottom = Math.max(4.5, Math.min(8, halfMin - 0.5)) // nie szerszy niż płytka
    const cone = new THREE.CylinderGeometry(4.5, rBottom, hh, 48)
    // CylinderGeometry ma oś Y; po rotateX(π/2) koniec radiusTop trafia na +Z,
    // więc wąski koniec (4.5) jest u góry, a szeroki (8) przy płytce.
    cone.rotateX(Math.PI / 2)
    cone.translate(0, 0, base + hh / 2)
    const ball = new THREE.SphereGeometry(7, 32, 24)
    ball.translate(0, 0, base + hh - 1 + 7) // spód kulki 1 mm poniżej szczytu stożka
    parts.push(cone, ball)
  }

  const geom = mergeGeoms(parts)
  // Wyśrodkuj tylko w XY — relief musi zaczynać się dokładnie na z = 0.
  geom.computeBoundingBox()
  const bb = geom.boundingBox
  geom.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, 0)
  return geom
}
