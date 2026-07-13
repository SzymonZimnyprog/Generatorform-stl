import * as THREE from 'three'
import { createViewer, previewMaterial, previewMaterialAlt } from '../core/viewer.js'
import { downloadSTL, loadSTLFile } from '../core/stl.js'
import { subtract, union, meshAt } from '../core/csg.js'
import { placeOnGround, sizeOf } from '../core/geometry.js'
import {
  getToolLayout, group, slider, button, fileDrop,
  makeStatus, debounce, nextFrame,
} from '../core/ui.js'

const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)
const viewer = createViewer(viewerEl)

let sourceGeom = null // oryginalna geometria wczytanego STL
let moldGeom = null   // forma zewnętrzna (wycentrowana, stoi na stole)
let coreGeom = null   // zespół płyta+rdzeń (obrócony płytą do dołu, na stole)
let halfGap = 0       // odsunięcie części od środka w podglądzie/eksporcie

const regenDebounced = debounce(regen, 300)

// ── Panel ───────────────────────────────────────────────────────────
const gFile = group(controls, 'Model')
fileDrop(gFile, {
  label: 'Wgraj model naczynia (STL)',
  accept: '.stl',
  hint: 'pełna bryła wazonu / doniczki — plik zostaje na Twoim komputerze',
  onFile: async (file) => {
    try {
      const geom = await loadSTLFile(file)
      placeOnGround(geom)
      const s = sizeOf(geom)
      if (s.z <= 0.01) throw new Error('model ma zerową wysokość')
      sourceGeom = geom
      cTarget.value = Math.min(200, Math.max(20, Math.round(Math.max(s.x, s.y, s.z))))
      status(`Wczytano: ${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm`, 'info')
      regen()
    } catch (e) {
      status('Nie udało się wczytać STL: ' + e.message, 'error')
    }
  },
})
const cTarget = slider(gFile, { label: 'Docelowy najdłuższy wymiar', min: 20, max: 200, step: 1, value: 100, onChange: regenDebounced })

const gCast = group(controls, 'Odlew')
const cCastWall = slider(gCast, { label: 'Grubość ścianki odlewu', min: 3, max: 12, step: 0.5, value: 5, onChange: regenDebounced })
const cCastFloor = slider(gCast, { label: 'Grubość dna odlewu', min: 4, max: 15, step: 0.5, value: 6, onChange: regenDebounced })
const hintCast = document.createElement('p')
hintCast.className = 'hint'
hintCast.textContent = 'Wnętrze odlewu powstaje przez skalowanie modelu w XY — grubość ścianki jest przybliżona i przy nieregularnych kształtach może się lokalnie różnić.'
gCast.appendChild(hintCast)

const gMold = group(controls, 'Forma')
const cMoldWall = slider(gMold, { label: 'Ścianki formy wokół modelu', min: 5, max: 20, step: 0.5, value: 8, onChange: regenDebounced })
const cMoldBase = slider(gMold, { label: 'Dno formy', min: 4, max: 15, step: 0.5, value: 6, onChange: regenDebounced })
const cPlate = slider(gMold, { label: 'Grubość płyty rdzenia', min: 3, max: 8, step: 0.5, value: 4, onChange: regenDebounced })

const gOut = group(controls, 'Eksport')
const btnBoth = button(gOut, {
  label: 'Pobierz STL',
  kind: 'primary',
  onClick: () => {
    if (!moldGeom || !coreGeom) return
    downloadSTL(sideBySide(), 'forma-wazon.stl')
    status('Zapisano forma-wazon.stl (forma + rdzeń obok siebie)', 'ok')
  },
})
const btnMold = button(gOut, {
  label: 'Pobierz formę',
  onClick: () => {
    if (!moldGeom) return
    downloadSTL(new THREE.Mesh(moldGeom), 'forma-wazon-forma.stl')
    status('Zapisano forma-wazon-forma.stl', 'ok')
  },
})
const btnCore = button(gOut, {
  label: 'Pobierz rdzeń',
  onClick: () => {
    if (!coreGeom) return
    downloadSTL(new THREE.Mesh(coreGeom), 'forma-wazon-rdzen.stl')
    status('Zapisano forma-wazon-rdzen.stl', 'ok')
  },
})
btnBoth.disabled = btnMold.disabled = btnCore.disabled = true
const hint = document.createElement('p')
hint.className = 'hint'
hint.textContent = 'Wlej odlew do formy (ok. 2/3), wciśnij rdzeń do oporu — płyta oprze się o brzeg formy, nadmiar wypłynie. Nawoskuj obie części przed odlewem.'
gOut.appendChild(hint)

status('Wgraj model STL naczynia, aby zacząć.', 'info')

/** Forma i zespół rdzenia obok siebie (odstęp 10 mm) — do podglądu i eksportu. */
function sideBySide(materials = false) {
  const mMold = new THREE.Mesh(moldGeom, materials ? previewMaterial() : undefined)
  mMold.position.x = -halfGap
  const mCore = new THREE.Mesh(coreGeom, materials ? previewMaterialAlt() : undefined)
  mCore.position.x = halfGap
  return [mMold, mCore]
}

// ── Generowanie ─────────────────────────────────────────────────────
async function regen() {
  if (!sourceGeom) return
  status('Generuję formę i rdzeń… (duże modele liczą się dłużej)', 'busy')
  await nextFrame()
  try {
    const built = buildMold()
    moldGeom = built.mold
    coreGeom = built.core
    halfGap = built.halfGap
    viewer.setContent(sideBySide(true))
    viewer.fit()
    btnBoth.disabled = btnMold.disabled = btnCore.disabled = false
    const tris = (moldGeom.getAttribute('position').count + coreGeom.getAttribute('position').count) / 3
    status(`Gotowe — ${Math.round(tris / 1000)}k trójkątów. Forma (pomarańczowa) i rdzeń na płycie (niebieski).`, 'ok')
  } catch (e) {
    console.error(e)
    status('Błąd generowania: ' + e.message, 'error')
  }
}

/**
 * Bryła naczynia → sztywna forma do odlewania pustych naczyń (Z-up):
 * 1) forma zewnętrzna — blok z wnęką-negatywem modelu, otwarcie u góry
 *    (góra bloku dokładnie na szczycie modelu = górny przekrój naczynia),
 * 2) rdzeń formujący wnętrze — model przeskalowany w XY o grubość ścianki,
 *    z odciętym dołem (grubość dna odlewu), zawieszony pod płytą, która
 *    po nałożeniu opiera się o brzeg formy; szczelina = grubość odlewu,
 * 3) do druku zespół płyta+rdzeń jest obrócony płytą do dołu.
 */
function buildMold() {
  const wallCast = cCastWall.value
  const floorCast = cCastFloor.value
  const wallMold = cMoldWall.value
  const baseMold = cMoldBase.value
  const plateT = cPlate.value

  // model przeskalowany jednorodnie do docelowego wymiaru, na stole
  const src = sourceGeom.clone()
  const s0 = sizeOf(src)
  const k = cTarget.value / Math.max(s0.x, s0.y, s0.z)
  src.scale(k, k, k)
  placeOnGround(src)
  const size = sizeOf(src)
  const H = size.z
  if (H <= floorCast + 0.5) {
    throw new Error('model jest za niski względem grubości dna odlewu — zwiększ rozmiar lub zmniejsz dno')
  }

  const boxW = size.x + 2 * wallMold
  const boxD = size.y + 2 * wallMold
  const moldH = baseMold + H

  // 1) FORMA ZEWNĘTRZNA: góra bloku dokładnie na szczycie modelu;
  //    model uniesiony o +0.01 przebija górę (czyste otwarcie, bez styku współpłaszczyznowego)
  const block = meshAt(new THREE.BoxGeometry(boxW, boxD, moldH), { z: moldH / 2 })
  const inMold = src.clone()
  inMold.translate(0, 0, baseMold + 0.01)
  const mold = subtract(block, inMold)
  placeOnGround(mold)

  // 2) RDZEŃ NA PŁYCIE: kopia modelu skalowana w XY (model wycentrowany w XY,
  //    więc skala działa wokół osi), bez przesuwania w pionie
  const kx = Math.max(0.1, (size.x - 2 * wallCast) / size.x)
  const ky = Math.max(0.1, (size.y - 2 * wallCast) / size.y)
  let core = src.clone()
  core.scale(kx, ky, 1)
  // odcięcie dołu rdzenia poniżej grubości dna odlewu (pudełko od z=−10 do z=floorCast)
  const floorBox = meshAt(
    new THREE.BoxGeometry(size.x + 10, size.y + 10, floorCast + 10),
    { z: (floorCast + 10) / 2 - 10 },
  )
  core = subtract(core, floorBox)
  core.translate(0, 0, baseMold) // ten sam układ co model w formie

  // płyta = zewnętrzny obrys formy, leży na górze formy (z = moldH);
  // 0.05 zajścia w dół, żeby union z rdzeniem nie stykał się współpłaszczyznowo
  const plate = meshAt(
    new THREE.BoxGeometry(boxW, boxD, plateT + 0.05),
    { z: moldH - 0.05 + (plateT + 0.05) / 2 },
  )
  const assembly = union(plate, core)

  // 3) do druku: obrót o 180° wokół X — płyta do dołu, rdzeń do góry
  assembly.rotateX(Math.PI)
  placeOnGround(assembly)

  return { mold, core: assembly, halfGap: (boxW + 10) / 2 }
}
