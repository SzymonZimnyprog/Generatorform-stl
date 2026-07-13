import * as THREE from 'three'
import { createViewer, previewMaterial } from '../core/viewer.js'
import { downloadSTL, loadSTLFile } from '../core/stl.js'
import { subtract, subtractAll, meshAt } from '../core/csg.js'
import { placeOnGround, sizeOf } from '../core/geometry.js'
import {
  getToolLayout, group, slider, select, button, fileDrop,
  makeStatus, debounce, nextFrame,
} from '../core/ui.js'

const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)
const viewer = createViewer(viewerEl)

let sourceGeom = null // oryginalna geometria wczytanego STL
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
      status(`Wczytano: ${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm`, 'info')
      regen()
    } catch (e) {
      status('Nie udało się wczytać STL: ' + e.message, 'error')
    }
  },
})
const cHeight = slider(gFile, { label: 'Docelowa wysokość', min: 20, max: 200, step: 1, value: 100, onChange: regenDebounced })

const gPot = group(controls, 'Doniczka')
const cWall = slider(gPot, { label: 'Grubość ścianki (przybliżona)', min: 1.5, max: 6, step: 0.5, value: 3, onChange: regenDebounced })
const cFloor = slider(gPot, { label: 'Grubość dna', min: 2, max: 10, step: 0.5, value: 4, onChange: regenDebounced })
const cRim = slider(gPot, { label: 'Ścięcie góry', min: 80, max: 100, step: 1, value: 95, unit: '%', onChange: regenDebounced })
const hintWall = document.createElement('p')
hintWall.className = 'hint'
hintWall.textContent = 'Wnętrze powstaje przez skalowanie modelu — przy nieregularnych kształtach grubość ścianki może się lokalnie różnić.'
gPot.appendChild(hintWall)

const gDrain = group(controls, 'Odpływ')
const cDrainN = select(gDrain, {
  label: 'Liczba otworów',
  options: [
    { value: '0', label: 'Bez otworów' },
    { value: '1', label: '1 (na środku)' },
    { value: '3', label: '3 (w trójkącie)' },
  ],
  value: '1',
  onChange: regenDebounced,
})
const cDrainD = slider(gDrain, { label: 'Średnica otworu', min: 4, max: 14, step: 1, value: 8, onChange: regenDebounced })

const gOut = group(controls, 'Eksport')
const btn = button(gOut, {
  label: 'Pobierz STL',
  kind: 'primary',
  onClick: () => {
    if (!mesh) return
    downloadSTL(mesh, 'doniczka.stl')
    status('Zapisano doniczka.stl', 'ok')
  },
})
btn.disabled = true

status('Wgraj model STL, aby zacząć.', 'info')

// ── Generowanie ─────────────────────────────────────────────────────
async function regen() {
  if (!sourceGeom) return
  status('Drążę doniczkę… (duże modele liczą się dłużej)', 'busy')
  await nextFrame()
  try {
    const geom = buildPlanter()
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

/**
 * Model → doniczka (Z-up): skalowanie do wysokości, płaskie ścięcie
 * góry, wydrążenie przez odjęcie przeskalowanej kopii, otwory odpływowe.
 */
function buildPlanter() {
  const targetH = cHeight.value
  const t = cWall.value
  const tFloor = cFloor.value
  const rimPct = cRim.value / 100
  const drainN = parseInt(cDrainN.value, 10)
  const drainR = cDrainD.value / 2

  // skalowanie jednorodne do docelowej wysokości
  const src = sourceGeom.clone()
  const s0 = sizeOf(src)
  const k = targetH / s0.z
  src.scale(k, k, k)
  placeOnGround(src)
  const size = sizeOf(src)
  const H = size.z

  // 1) płaskie ścięcie góry → rant
  const rimZ = H * rimPct
  const cutBox = meshAt(
    new THREE.BoxGeometry(size.x + 10, size.y + 10, H - rimZ + 20),
    { z: rimZ + (H - rimZ + 20) / 2 },
  )
  let pot = subtract(src, cutBox)

  // 2) wnętrze: kopia przeskalowana TYLKO w XY (bez przesuwania — uniesiona
  //    kopia zwężających się modeli robi się szersza od zewnętrza i zjada rant);
  //    dno formuje odcięcie wnętrza poniżej zadanej grubości
  const kx = Math.max(0.1, (size.x - 2 * t) / size.x)
  const ky = Math.max(0.1, (size.y - 2 * t) / size.y)
  let inner = src.clone()
  inner.scale(kx, ky, 1) // XY wokół osi — model jest wycentrowany w XY
  const floorBox = meshAt(
    new THREE.BoxGeometry(size.x + 10, size.y + 10, tFloor + 10),
    { z: (tFloor + 10) / 2 - 10 }, // od z=−10 do z=tFloor
  )
  inner = subtract(inner, floorBox)
  pot = subtract(pot, inner)

  // 3) otwory odpływowe przez dno
  if (drainN > 0) {
    const holes = []
    const positions = drainN === 1
      ? [[0, 0]]
      : [0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2 + Math.PI / 2
          const r = 0.2 * Math.min(size.x, size.y)
          return [Math.cos(a) * r, Math.sin(a) * r]
        })
    for (const [hx, hy] of positions) {
      holes.push(meshAt(
        new THREE.CylinderGeometry(drainR, drainR, tFloor + 4, 32),
        { x: hx, y: hy, z: (tFloor + 4) / 2 - 1, rx: Math.PI / 2 },
      ))
    }
    pot = subtractAll(pot, holes)
  }
  return pot
}
