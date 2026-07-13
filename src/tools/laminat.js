import * as THREE from 'three'
import { createViewer, previewMaterial } from '../core/viewer.js'
import { downloadSTL, loadSTLFile } from '../core/stl.js'
import { subtract, union, meshAt } from '../core/csg.js'
import { placeOnGround, sizeOf } from '../core/geometry.js'
import {
  getToolLayout, group, slider, select, button, fileDrop,
  makeStatus, debounce, nextFrame,
} from '../core/ui.js'

const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)
const viewer = createViewer(viewerEl)

let sourceGeom = null
let mesh = null

const regenDebounced = debounce(regen, 300)

// ── Panel ───────────────────────────────────────────────────────────
const gFile = group(controls, 'Model')
fileDrop(gFile, {
  label: 'Wgraj model STL',
  accept: '.stl',
  hint: 'plik zostaje na Twoim komputerze',
  onFile: async (file) => {
    try {
      const geom = await loadSTLFile(file)
      placeOnGround(geom)
      const s = sizeOf(geom)
      if (s.z <= 0.01) throw new Error('model ma zerową wysokość')
      sourceGeom = geom
      cTarget.value = Math.min(150, Math.max(10, Math.round(Math.max(s.x, s.y, s.z))))
      status(`Wczytano: ${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm`, 'info')
      regen()
    } catch (e) {
      status('Nie udało się wczytać STL: ' + e.message, 'error')
    }
  },
})
const cTarget = slider(gFile, { label: 'Docelowy najdłuższy wymiar', min: 10, max: 150, step: 1, value: 60, onChange: regenDebounced })

const gMold = group(controls, 'Forma')
const cMode = select(gMold, {
  label: 'Tryb',
  options: [
    { value: 'negatyw', label: 'Negatyw — wnęka do laminowania' },
    { value: 'pozytyw', label: 'Pozytyw — kopyto na płycie' },
  ],
  value: 'negatyw',
  onChange: regenDebounced,
})
const cDepth = slider(gMold, { label: 'Głębokość odwzorowania', min: 10, max: 100, step: 5, value: 50, unit: '%', onChange: regenDebounced })
const cFlange = slider(gMold, { label: 'Kołnierz wokół modelu', min: 5, max: 30, step: 1, value: 10, onChange: regenDebounced })
const cBase = slider(gMold, { label: 'Dno / płyta', min: 3, max: 15, step: 0.5, value: 5, onChange: regenDebounced })
const hintMode = document.createElement('p')
hintMode.className = 'hint'
hintMode.textContent = 'Negatyw odwzorowuje górną powierzchnię modelu (otwarcie u góry). Głębokość < 100% pozwala uniknąć podcięć — np. dla kuli użyj 50%. Pozytyw to model na płycie z kołnierzem, do laminowania po wierzchu.'
gMold.appendChild(hintMode)

const gOut = group(controls, 'Eksport')
const btn = button(gOut, {
  label: 'Pobierz STL',
  kind: 'primary',
  onClick: () => {
    if (!mesh) return
    downloadSTL(mesh, 'forma-laminat.stl')
    status('Zapisano forma-laminat.stl', 'ok')
  },
})
btn.disabled = true
const hint = document.createElement('p')
hint.className = 'hint'
hint.textContent = 'Przed laminowaniem przeszlifuj i nawoskuj powierzchnię (albo użyj folii rozdzielającej) — wydruk FDM ma widoczne warstwy.'
gOut.appendChild(hint)

status('Wgraj model STL, aby zacząć.', 'info')

// ── Generowanie ─────────────────────────────────────────────────────
async function regen() {
  if (!sourceGeom) return
  status('Generuję formę… (duże modele liczą się dłużej)', 'busy')
  await nextFrame()
  try {
    const geom = cMode.value === 'negatyw' ? buildNegative() : buildPositive()
    mesh = new THREE.Mesh(geom, previewMaterial())
    viewer.setContent(mesh)
    viewer.fit()
    btn.disabled = false
    const tris = geom.getAttribute('position').count / 3
    status(`Gotowe — ${Math.round(tris / 1000)}k trójkątów. Możesz pobrać STL.`, 'ok')
  } catch (e) {
    console.error(e)
    status('Błąd generowania: ' + e.message, 'error')
  }
}

function scaledModel() {
  const src = sourceGeom.clone()
  const s0 = sizeOf(src)
  const k = cTarget.value / Math.max(s0.x, s0.y, s0.z)
  src.scale(k, k, k)
  placeOnGround(src)
  return src
}

/**
 * Negatyw (Z-up): blok z wnęką będącą odbiciem GÓRNEJ powierzchni modelu.
 * Model jest obracany do góry nogami i zatapiany od góry w blok na
 * `głębokość%` swojej wysokości — otwarcie formy wypada w płaszczyźnie
 * górnej ściany bloku.
 */
function buildNegative() {
  const src = scaledModel()
  const size = sizeOf(src)
  const flange = cFlange.value
  const base = cBase.value
  const depth = (cDepth.value / 100) * size.z

  const boxW = size.x + 2 * flange
  const boxD = size.y + 2 * flange
  const boxH = base + depth
  const box = meshAt(new THREE.BoxGeometry(boxW, boxD, boxH), { z: boxH / 2 })

  // model do góry nogami, zatopiony od góry na `depth`
  const flipped = src.clone()
  flipped.rotateX(Math.PI) // rotacja — nie psuje orientacji trójkątów
  placeOnGround(flipped)
  flipped.translate(0, 0, boxH - depth + 0.01) // +0.01: bez współpłaszczyznowego styku dna wnęki

  return subtract(box, flipped)
}

/** Pozytyw (Z-up): płyta z kołnierzem + model zespolony na wierzchu. */
function buildPositive() {
  const src = scaledModel()
  const size = sizeOf(src)
  const flange = cFlange.value
  const base = cBase.value

  const plate = meshAt(
    new THREE.BoxGeometry(size.x + 2 * flange, size.y + 2 * flange, base),
    { z: base / 2 },
  )
  src.translate(0, 0, base - 0.05) // lekkie zagłębienie w płytę
  return union(plate, src)
}
