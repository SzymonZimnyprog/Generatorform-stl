import * as THREE from 'three'
import { createViewer, previewMaterial, previewMaterialAlt } from '../core/viewer.js'
import { downloadSTL, loadSTLFile } from '../core/stl.js'
import { subtract, intersect, meshAt } from '../core/csg.js'
import { placeOnGround, sizeOf, mergeGeoms } from '../core/geometry.js'
import {
  getToolLayout, group, slider, select, checkbox, button, fileDrop,
  makeStatus, debounce, nextFrame,
} from '../core/ui.js'

const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)
const viewer = createViewer(viewerEl)

let srcGeom = null   // wczytany STL (postawiony na z=0)
let meshA = null     // część A — „przed" płaszczyzną cięcia (bursztynowa)
let meshB = null     // część B — „za" płaszczyzną (niebieska)
let meshPins = null  // dyble (osobne cylindry) lub null

const regenDebounced = debounce(regen, 300)

// ── Panel ───────────────────────────────────────────────────────────
const gModel = group(controls, 'Model')
fileDrop(gModel, {
  label: 'Wgraj model STL',
  accept: '.stl',
  hint: 'plik .stl — nic nie jest wysyłane',
  onFile: async (file) => {
    try {
      status('Wczytuję model…', 'busy')
      await nextFrame()
      const geom = await loadSTLFile(file)
      placeOnGround(geom)
      const s = sizeOf(geom)
      const longest = Math.max(s.x, s.y, s.z)
      if (!(longest > 0)) throw new Error('model ma zerowe wymiary')
      srcGeom = geom
      cTarget.value = Math.min(300, Math.max(10, Math.round(longest)))
      status(`Wczytano model: ${fmt(s)} mm.`, 'info')
      regen()
    } catch (e) {
      console.error(e)
      srcGeom = null
      status('Nie udało się wczytać pliku STL: ' + e.message, 'error')
    }
  },
})
const cTarget = slider(gModel, {
  label: 'Docelowy najdłuższy wymiar', min: 10, max: 300, step: 1, value: 100,
  onChange: regenDebounced,
})

const gCut = group(controls, 'Cięcie')
const cAxis = select(gCut, {
  label: 'Oś',
  options: [
    { value: 'x', label: 'X (szerokość)' },
    { value: 'y', label: 'Y (głębokość)' },
    { value: 'z', label: 'Z (wysokość)' },
  ],
  value: 'z',
  onChange: regenDebounced,
})
const cPos = slider(gCut, { label: 'Pozycja cięcia', min: 10, max: 90, step: 1, value: 50, unit: '%', onChange: regenDebounced })

const gDowel = group(controls, 'Kołki')
const cDowels = checkbox(gDowel, { label: 'Kołki pasujące (dyble)', value: true, onChange: regenDebounced })
const cDia = slider(gDowel, { label: 'Średnica', min: 3, max: 8, step: 0.5, value: 4, onChange: regenDebounced })
const cLen = slider(gDowel, { label: 'Długość', min: 6, max: 16, step: 1, value: 10, onChange: regenDebounced })
const cClear = slider(gDowel, { label: 'Luz', min: 0.1, max: 0.5, step: 0.05, value: 0.25, onChange: regenDebounced })
const hintDowel = document.createElement('p')
hintDowel.className = 'hint'
hintDowel.textContent = 'W obu częściach powstają gniazda (⌀ + 2×luz), a obok leżą gotowe do druku dyble. Pozycje dobierane są automatycznie na przekroju.'
gDowel.appendChild(hintDowel)

const gOut = group(controls, 'Eksport')
const btnAll = button(gOut, {
  label: 'Pobierz STL',
  kind: 'primary',
  onClick: () => {
    if (!meshA || !meshB) return
    downloadSTL(meshPins ? [meshA, meshB, meshPins] : [meshA, meshB], 'podzial.stl')
    status('Zapisano podzial.stl (obie części' + (meshPins ? ' + dyble' : '') + ').', 'ok')
  },
})
const btnA = button(gOut, {
  label: 'Pobierz część A',
  kind: 'ghost',
  onClick: () => {
    if (!meshA) return
    downloadSTL(meshA, 'podzial-czesc-A.stl')
    status('Zapisano podzial-czesc-A.stl', 'ok')
  },
})
const btnB = button(gOut, {
  label: 'Pobierz część B',
  kind: 'ghost',
  onClick: () => {
    if (!meshB) return
    downloadSTL(meshB, 'podzial-czesc-B.stl')
    status('Zapisano podzial-czesc-B.stl', 'ok')
  },
})
btnAll.disabled = btnA.disabled = btnB.disabled = true

const hint = document.createElement('p')
hint.className = 'hint'
hint.textContent = 'Obie części leżą płaszczyzną cięcia na stole — drukuj bez podpór w miejscu łączenia. Po druku wklej dyble w jedną część i sklej połówki.'
gOut.appendChild(hint)

status('Wgraj plik STL, aby podzielić model za duży na stół na dwie części.', 'info')

function fmt(v) {
  return `${v.x.toFixed(1)} × ${v.y.toFixed(1)} × ${v.z.toFixed(1)}`
}

// ── Pomocnicze: osie ────────────────────────────────────────────────
const AXIS_INDEX = { x: 0, y: 1, z: 2 }
const IN_PLANE = { x: [1, 2], y: [0, 2], z: [0, 1] } // indeksy osi leżących w płaszczyźnie cięcia

/** Punkt 3D z pozycji na osi cięcia + współrzędnych w płaszczyźnie cięcia. */
function point3(axis, aPos, u, v) {
  const p = [0, 0, 0]
  const [ui, vi] = IN_PLANE[axis]
  p[AXIS_INDEX[axis]] = aPos
  p[ui] = u
  p[vi] = v
  return new THREE.Vector3(p[0], p[1], p[2])
}

// ── Generowanie ─────────────────────────────────────────────────────
async function regen() {
  if (!srcGeom) return
  status('Dzielę model… Operacje CSG na dużych modelach mogą chwilę potrwać.', 'busy')
  await nextFrame()
  try {
    const r = buildParts()
    meshA = new THREE.Mesh(r.partA, previewMaterial())
    meshB = new THREE.Mesh(r.partB, previewMaterialAlt())
    meshPins = r.pins ? new THREE.Mesh(r.pins, previewMaterial()) : null
    viewer.setContent(meshPins ? [meshA, meshB, meshPins] : [meshA, meshB])
    viewer.fit()
    btnAll.disabled = btnA.disabled = btnB.disabled = false
    let msg = `Gotowe — część A ${fmt(r.sA)} mm, część B ${fmt(r.sB)} mm.`
    if (r.wantDowels) {
      if (r.pinsTooThin) {
        msg += ' Uwaga: część przy płaszczyźnie cięcia jest za cienka na kołki — pominąłem je.'
      } else if (r.spots.length === 0) {
        msg += ' Uwaga: nie znalazłem bezpiecznej pozycji kołków na przekroju — pominąłem je.'
      } else if (r.spots.length === 1) {
        msg += ' Uwaga: na przekroju zmieściła się tylko 1 bezpieczna pozycja kołka (1 dybel).'
      } else {
        msg += ` Kołki: ${r.spots.length} — dyble leżą przed częściami.`
      }
      if (!r.pinsTooThin && r.spots.length && r.pinLen < cLen.value - 0.01) {
        msg += ` (kołki skrócone do ${r.pinLen.toFixed(1)} mm, żeby nie przebić ścianki)`
      }
    }
    status(msg + ' Możesz pobrać STL.', 'ok')
  } catch (e) {
    console.error(e)
    status('Błąd generowania: ' + e.message, 'error')
  }
}

/**
 * Dzieli model (Z-w-górę, mm) płaszczyzną prostopadłą do wybranej osi:
 * 1. model skalowany jednorodnie do docelowego wymiaru, na z=0, środek XY,
 * 2. gniazda kołków: odejmowane z całego modelu PRZED podziałem (cylindry
 *    wzdłuż osi cięcia, wystające po długość/2+luz w obie strony płaszczyzny),
 * 3. połówki przez przecięcie (intersect) z dwoma pudełkami,
 * 4. prezentacja do druku: obie części płaszczyzną cięcia do dołu — część A
 *    („przed" płaszczyzną) obrócona o 180° wokół osi leżącej w płaszczyźnie
 *    cięcia (rotacja, nie odbicie), obok siebie z odstępem 10 mm,
 * 5. dyble: osobne cylindry leżące na stole przed częściami.
 */
function buildParts() {
  // model: skala jednorodna, na stół, środek XY
  const model = srcGeom.clone()
  const s0 = sizeOf(model)
  const k = cTarget.value / Math.max(s0.x, s0.y, s0.z)
  model.scale(k, k, k)
  placeOnGround(model)
  const size = sizeOf(model)

  const axis = cAxis.value
  const ai = AXIS_INDEX[axis]
  const axLen = size.getComponent(ai)
  const axMin = axis === 'z' ? 0 : -axLen / 2
  const cutPos = axMin + (cPos.value / 100) * axLen

  // kołki: pozycje na przekroju + gniazda (przed obracaniem/rozsuwaniem!)
  const wantDowels = cDowels.value
  let spots = []
  let cut = model
  let pinLen = cLen.value
  let pinsTooThin = false
  if (wantDowels) {
    spots = findDowelSpots(model, axis, cutPos)
    // gniazdo nie może przebić cieńszej części — zostaw ≥1.2 mm materiału
    const halfDepth = Math.min(
      cLen.value / 2 + cClear.value,
      (cutPos - axMin) - 1.2,
      (axMin + axLen - cutPos) - 1.2,
    )
    if (halfDepth < 2.5) {
      spots = []
      pinsTooThin = true
    } else {
      pinLen = 2 * (halfDepth - cClear.value)
    }
    if (spots.length) {
      const rSock = cDia.value / 2 + cClear.value
      const hSock = pinLen + 2 * cClear.value
      const sockets = spots.map(([u, v]) => {
        const g = new THREE.CylinderGeometry(rSock, rSock, hSock, 32)
        if (axis === 'z') g.rotateX(Math.PI / 2)       // oś Y → Z
        else if (axis === 'x') g.rotateZ(Math.PI / 2)  // oś Y → X
        const c = point3(axis, cutPos, u, v)
        g.translate(c.x, c.y, c.z)
        return g
      })
      cut = subtract(model, mergeGeoms(sockets))
    }
  }

  // połówki: przecięcie z pudełkami po obu stronach płaszczyzny
  const M = 2 // margines pudełek poza bbox
  const dims = [size.x + 2 * M, size.y + 2 * M, size.z + 2 * M]
  const center = [0, 0, size.z / 2]
  const mkBox = (from, to) => {
    const d = dims.slice()
    const c = center.slice()
    d[ai] = to - from
    c[ai] = (from + to) / 2
    return meshAt(new THREE.BoxGeometry(d[0], d[1], d[2]), { x: c[0], y: c[1], z: c[2] })
  }
  const partA = intersect(cut, mkBox(axMin - M, cutPos))          // strona „przed" płaszczyzną
  const partB = intersect(cut, mkBox(cutPos, axMin + axLen + M))  // strona „za" płaszczyzną
  if (!triCount(partA) || !triCount(partB)) throw new Error('cięcie dało pustą część — przesuń pozycję cięcia')

  // prezentacja do druku: płaszczyzną cięcia do dołu
  orientForPrint(partA, axis, true)
  orientForPrint(partB, axis, false)
  const sA = sizeOf(partA)
  const sB = sizeOf(partB)
  const gap = 10
  partA.translate(-(sA.x / 2 + gap / 2), 0, 0)
  partB.translate(+(sB.x / 2 + gap / 2), 0, 0)

  // dyble: cylindry ⌀ nominalna, leżące (oś pozioma wzdłuż Y) przed częściami
  let pins = null
  if (wantDowels && spots.length) {
    const r = cDia.value / 2
    const len = pinLen
    const yPin = -(Math.max(sA.y, sB.y) / 2 + 5 + len / 2)
    pins = mergeGeoms(spots.map((_, i) => {
      const g = new THREE.CylinderGeometry(r, r, len, 32) // oś wzdłuż Y — leży poziomo
      g.translate((i - (spots.length - 1) / 2) * (cDia.value + 6), yPin, r)
      return g
    }))
  }

  return { partA, partB, pins, spots, wantDowels, sA, sB, pinLen, pinsTooThin }
}

function triCount(geom) {
  const pos = geom.getAttribute('position')
  return pos ? (geom.getIndex() ? geom.getIndex().count : pos.count) / 3 : 0
}

/**
 * Obraca część tak, by płaszczyzna cięcia leżała na stole (do dołu).
 * Najpierw oś cięcia staje się pionem (rotacja całości), potem część „przed"
 * płaszczyzną dostaje dodatkowe 180° wokół osi X — osi leżącej w (już
 * poziomej) płaszczyźnie cięcia. Wszystko to właściwe rotacje, nie odbicia.
 */
function orientForPrint(geom, axis, isBefore) {
  if (axis === 'x') geom.rotateY(-Math.PI / 2)      // +X → +Z
  else if (axis === 'y') geom.rotateX(Math.PI / 2)  // +Y → +Z
  if (isBefore) geom.rotateX(Math.PI)               // ściana cięcia z góry na dół
  placeOnGround(geom)
  return geom
}

/**
 * Szuka do 2 bezpiecznych pozycji kołków na przekroju modelu płaszczyzną
 * cięcia. Kandydaci leżą wzdłuż dłuższej osi bboxa przekroju (w połowie
 * drugiej osi), od 25% i 75% rozpiętości ku środkowi. Pozycja jest bezpieczna,
 * gdy jej środek i 4 punkty wokół (promień kołka + 2 mm) leżą wewnątrz modelu
 * (test parzystości przecięć promienia wzdłuż ±osi cięcia).
 * Zwraca tablicę pozycji [u, v] w osiach płaszczyzny cięcia.
 */
function findDowelSpots(model, axis, cutPos) {
  const bb = sectionBBox(model, axis, cutPos)
  if (!bb) return []
  const spanU = bb.uMax - bb.uMin
  const spanV = bb.vMax - bb.vMin
  const alongU = spanU >= spanV
  const lo = alongU ? bb.uMin : bb.vMin
  const span = alongU ? spanU : spanV
  const mid = alongU ? (bb.vMin + bb.vMax) / 2 : (bb.uMin + bb.uMax) / 2
  const ringR = cDia.value / 2 + 2

  const rayMesh = new THREE.Mesh(model, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  rayMesh.updateMatrixWorld(true)

  const safe = (m) => {
    const probes = [[m, mid], [m + ringR, mid], [m - ringR, mid], [m, mid + ringR], [m, mid - ringR]]
    return probes.every(([a, b]) => {
      const u = alongU ? a : b
      const v = alongU ? b : a
      return insideAt(rayMesh, axis, cutPos, u, v)
    })
  }

  const spots = []
  for (const fracs of [[0.25, 0.3, 0.35, 0.4, 0.45], [0.75, 0.7, 0.65, 0.6, 0.55]]) {
    for (const f of fracs) {
      const m = lo + f * span
      if (safe(m)) { spots.push(m); break }
    }
  }
  // dwie pozycje zbyt blisko siebie → gniazda by się przecięły; zostaw jedną
  if (spots.length === 2 && Math.abs(spots[1] - spots[0]) < cDia.value + 2 * cClear.value + 2) {
    spots.pop()
  }
  return spots.map((m) => (alongU ? [m, mid] : [mid, m]))
}

/** bbox przekroju modelu płaszczyzną cięcia — w osiach [u, v] tej płaszczyzny. */
function sectionBBox(geom, axis, cutPos) {
  const ai = AXIS_INDEX[axis]
  const [ui, vi] = IN_PLANE[axis]
  const pos = geom.getAttribute('position')
  const idx = geom.getIndex()
  const count = idx ? idx.count : pos.count
  const vert = (k) => (idx ? idx.getX(k) : k)
  const comp = (i, c) => (c === 0 ? pos.getX(i) : c === 1 ? pos.getY(i) : pos.getZ(i))
  let uMin = Infinity
  let uMax = -Infinity
  let vMin = Infinity
  let vMax = -Infinity
  let found = false
  const acc = (u, v) => {
    found = true
    if (u < uMin) uMin = u
    if (u > uMax) uMax = u
    if (v < vMin) vMin = v
    if (v > vMax) vMax = v
  }
  for (let t = 0; t < count; t += 3) {
    for (let e = 0; e < 3; e++) {
      const i1 = vert(t + e)
      const i2 = vert(t + ((e + 1) % 3))
      const d1 = comp(i1, ai) - cutPos
      const d2 = comp(i2, ai) - cutPos
      if (d1 === 0) acc(comp(i1, ui), comp(i1, vi))
      if ((d1 < 0 && d2 > 0) || (d1 > 0 && d2 < 0)) {
        const s = d1 / (d1 - d2)
        acc(
          comp(i1, ui) + s * (comp(i2, ui) - comp(i1, ui)),
          comp(i1, vi) + s * (comp(i2, vi) - comp(i1, vi)),
        )
      }
    }
  }
  return found ? { uMin, uMax, vMin, vMax } : null
}

const raycaster = new THREE.Raycaster()
raycaster.near = 1e-5
raycaster.far = Infinity

/**
 * Czy punkt (u,v) na płaszczyźnie cięcia leży wewnątrz modelu?
 * Promienie wzdłuż +osi i −osi cięcia — nieparzysta liczba przecięć w obu
 * kierunkach = wewnątrz. Drobny jitter omija trafienia dokładnie w krawędzie.
 */
function insideAt(mesh, axis, cutPos, u, v) {
  const origin = point3(axis, cutPos, u + 0.0137, v + 0.0091)
  const dir = new THREE.Vector3()
  dir.setComponent(AXIS_INDEX[axis], 1)
  return crossings(mesh, origin, dir) % 2 === 1 &&
    crossings(mesh, origin, dir.clone().negate()) % 2 === 1
}

function crossings(mesh, origin, dir) {
  raycaster.set(origin, dir)
  const hits = raycaster.intersectObject(mesh, false)
  let n = 0
  let last = -Infinity
  for (const h of hits) {
    if (h.distance - last > 5e-4) { // trafienia we wspólną krawędź licz raz
      n++
      last = h.distance
    }
  }
  return n
}
