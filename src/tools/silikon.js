import * as THREE from 'three'
import { createViewer, previewMaterial, previewMaterialAlt } from '../core/viewer.js'
import { downloadSTL, loadSTLFile } from '../core/stl.js'
import { subtract, meshAt } from '../core/csg.js'
import { mergeGeoms, placeOnGround, sizeOf } from '../core/geometry.js'
import {
  getToolLayout, group, slider, checkbox, button, fileDrop,
  makeStatus, debounce, nextFrame,
} from '../core/ui.js'

const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)
const viewer = createViewer(viewerEl)

let sourceGeom = null
let exportObjects = null

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

const gVat = group(controls, 'Wanna')
const cGap = slider(gVat, { label: 'Zapas silikonu z boków', min: 5, max: 25, step: 1, value: 10, onChange: regenDebounced })
const cGapTop = slider(gVat, { label: 'Zapas silikonu nad modelem', min: 5, max: 25, step: 1, value: 10, onChange: regenDebounced })
const cWall = slider(gVat, { label: 'Grubość ścianki', min: 1.6, max: 5, step: 0.4, value: 2.4, onChange: regenDebounced })
const cFloor = slider(gVat, { label: 'Grubość dna', min: 2, max: 8, step: 0.5, value: 3, onChange: regenDebounced })
const cGlue = checkbox(gVat, { label: 'Wydrukuj model razem z wanną (na dnie)', value: true, onChange: regenDebounced })
const hintGlue = document.createElement('p')
hintGlue.className = 'hint'
hintGlue.textContent = 'Model zespolony z dnem: drukujesz całość, zalewasz silikonem, po utwardzeniu rozcinasz silikon i wyjmujesz. Bez modelu dostajesz samą wannę (model przyklej samodzielnie).'
gVat.appendChild(hintGlue)

const gOut = group(controls, 'Eksport')
const btn = button(gOut, {
  label: 'Pobierz STL',
  kind: 'primary',
  onClick: () => {
    if (!exportObjects) return
    downloadSTL(exportObjects, 'wanna-silikon.stl')
    status('Zapisano wanna-silikon.stl', 'ok')
  },
})
btn.disabled = true
const hint = document.createElement('p')
hint.className = 'hint'
hint.textContent = 'Silikon odlewniczy (np. addycyjny 20–30 ShA) mieszaj wg instrukcji i lej cienkim strumieniem w najniższy punkt — mniej pęcherzy.'
gOut.appendChild(hint)

status('Wgraj model STL, aby zacząć.', 'info')

// ── Generowanie ─────────────────────────────────────────────────────
async function regen() {
  if (!sourceGeom) return
  status('Generuję wannę…', 'busy')
  await nextFrame()
  try {
    const { vat, model } = buildVat()
    const meshes = [new THREE.Mesh(vat, previewMaterial())]
    if (model) meshes.push(new THREE.Mesh(model, previewMaterialAlt()))
    exportObjects = meshes
    viewer.setContent(meshes)
    viewer.fit()
    btn.disabled = false
    const tris = meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0)
    status(`Gotowe — ${Math.round(tris / 1000)}k trójkątów. Możesz pobrać STL.`, 'ok')
  } catch (e) {
    console.error(e)
    status('Błąd generowania: ' + e.message, 'error')
  }
}

/**
 * Wanna (Z-up): otwarty od góry pojemnik dopasowany do modelu
 * + opcjonalnie model zespolony z dnem (zatopiony 0.2 mm).
 */
function buildVat() {
  const src = sourceGeom.clone()
  const s0 = sizeOf(src)
  const k = cTarget.value / Math.max(s0.x, s0.y, s0.z)
  src.scale(k, k, k)
  placeOnGround(src)
  const size = sizeOf(src)

  const gap = cGap.value
  const wall = cWall.value
  const floor = cFloor.value
  const innerW = size.x + 2 * gap
  const innerD = size.y + 2 * gap
  const H = floor + size.z + cGapTop.value

  const outer = meshAt(
    new THREE.BoxGeometry(innerW + 2 * wall, innerD + 2 * wall, H),
    { z: H / 2 },
  )
  const inner = meshAt(
    new THREE.BoxGeometry(innerW, innerD, H), // sięga 'floor' nad górę — otwarty wierzch
    { z: floor + H / 2 },
  )
  const vat = subtract(outer, inner)

  let model = null
  if (cGlue.value) {
    src.translate(0, 0, floor - 0.2) // zatopienie w dno — jedna zespolona bryła po pocięciu
    model = mergeGeoms([src])
  }
  return { vat, model }
}
