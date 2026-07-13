import * as THREE from 'three'
import { createViewer, previewMaterial, previewMaterialAlt } from '../core/viewer.js'
import { downloadSTL, loadSTLFile } from '../core/stl.js'
import {
  getToolLayout, group, slider, checkbox, button, fileDrop,
  makeStatus, debounce, nextFrame,
} from '../core/ui.js'
import { placeOnGround, sizeOf } from '../core/geometry.js'
import { subtract, intersect, unionAll, subtractAll, meshAt } from '../core/csg.js'

const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)
const viewer = createViewer(viewerEl)

let srcGeom = null   // oryginalna geometria wczytanego STL (postawiona na z=0)
let origSize = null  // wymiary oryginału (Vector3)
let meshA = null     // połówka A (bursztynowa)
let meshB = null     // połówka B (niebieska)

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
      origSize = s.clone()
      cTarget.value = Math.min(150, Math.max(10, Math.round(longest)))
      status(`Model wczytany — oryginalne wymiary: ${fmt(s)} mm.`, 'info')
      regen()
    } catch (e) {
      console.error(e)
      srcGeom = null
      status('Nie udało się wczytać pliku STL: ' + e.message, 'error')
    }
  },
})
const cTarget = slider(gModel, {
  label: 'Docelowy najdłuższy wymiar', min: 10, max: 150, step: 1, value: 60,
  onChange: regenDebounced,
})

const gMold = group(controls, 'Forma')
const cWall = slider(gMold, { label: 'Ścianki boczne', min: 5, max: 20, step: 0.5, value: 8, onChange: regenDebounced })
const cTopBot = slider(gMold, { label: 'Dno i góra', min: 5, max: 20, step: 0.5, value: 8, onChange: regenDebounced })

const gSprue = group(controls, 'Wlew i zamki')
const cSprueBottom = slider(gSprue, { label: 'Średnica wlewu przy modelu', min: 3, max: 12, step: 0.5, value: 6, onChange: regenDebounced })
const cSprueTop = slider(gSprue, { label: 'Średnica wlewu u góry', min: 6, max: 20, step: 0.5, value: 12, onChange: regenDebounced })
const cLocks = checkbox(gSprue, { label: 'Zamki pozycjonujące (kulki)', value: true, onChange: regenDebounced })
const cLockR = slider(gSprue, { label: 'Promień zamka', min: 2, max: 5, step: 0.25, value: 3, onChange: regenDebounced })
const cClearance = slider(gSprue, { label: 'Luz pasowania', min: 0.1, max: 0.6, step: 0.05, value: 0.3, onChange: regenDebounced })

const gOut = group(controls, 'Eksport')
const btnBoth = button(gOut, {
  label: 'Pobierz STL',
  kind: 'primary',
  onClick: () => {
    if (!meshA || !meshB) return
    downloadSTL([meshA, meshB], 'forma.stl')
    status('Zapisano forma.stl (obie połówki).', 'ok')
  },
})
const btnA = button(gOut, {
  label: 'Pobierz połówkę A',
  kind: 'ghost',
  onClick: () => {
    if (!meshA) return
    downloadSTL(meshA, 'forma-polowka-A.stl')
    status('Zapisano forma-polowka-A.stl', 'ok')
  },
})
const btnB = button(gOut, {
  label: 'Pobierz połówkę B',
  kind: 'ghost',
  onClick: () => {
    if (!meshB) return
    downloadSTL(meshB, 'forma-polowka-B.stl')
    status('Zapisano forma-polowka-B.stl', 'ok')
  },
})
btnBoth.disabled = btnA.disabled = btnB.disabled = true

const hint = document.createElement('p')
hint.className = 'hint'
hint.textContent = 'Wydrukuj obie połówki, zepnij je (zamki pozycjonują), wlej silikon, wosk, mydło lub żywicę przez lejek na górze. Płaszczyzna podziału leży na stole — wnęki do góry.'
gOut.appendChild(hint)

status('Wgraj plik STL, aby wygenerować dwuczęściową formę odlewniczą.', 'info')

function fmt(v) {
  return `${v.x.toFixed(1)} × ${v.y.toFixed(1)} × ${v.z.toFixed(1)}`
}

// ── Generowanie ─────────────────────────────────────────────────────
async function regen() {
  if (!srcGeom) return
  status('Generuję formę… Operacje CSG na dużych modelach mogą potrwać dłuższą chwilę.', 'busy')
  await nextFrame()
  try {
    const { halfA, halfB, moldSize } = buildMold()
    meshA = new THREE.Mesh(halfA, previewMaterial())
    meshB = new THREE.Mesh(halfB, previewMaterialAlt())
    viewer.setContent([meshA, meshB])
    viewer.fit()
    btnBoth.disabled = btnA.disabled = btnB.disabled = false
    const tris = (countTris(halfA) + countTris(halfB)) / 1000
    status(
      `Gotowe — forma ${fmt(moldSize)} mm (oryginał modelu: ${fmt(origSize)} mm), ` +
      `${tris < 10 ? tris.toFixed(1) : Math.round(tris)}k trójkątów. Możesz pobrać STL.`,
      'ok',
    )
  } catch (e) {
    console.error(e)
    status('Błąd generowania: ' + e.message, 'error')
  }
}

function countTris(geom) {
  return geom.getIndex() ? geom.getIndex().count / 3 : geom.getAttribute('position').count / 3
}

/**
 * Buduje dwie połówki formy (Z-w-górę, mm):
 * 1. model skalowany jednorodnie do docelowego najdłuższego wymiaru, na z=0,
 * 2. pudełko (model + ścianki) minus model minus stożkowy wlew,
 * 3. przecięcie płaszczyzną y=0 na połówki A (y<0) i B (y>0),
 * 4. zamki: kulki na płaszczyźnie podziału — wypustki w A, wgłębienia (+luz) w B,
 * 5. prezentacja: obie połówki płaszczyzną podziału do góry, obok siebie na stole.
 */
function buildMold() {
  const wall = cWall.value
  const tb = cTopBot.value

  // model: skala jednorodna do celu, na stół, wyśrodkowany XY
  const model = srcGeom.clone()
  const s0 = sizeOf(model)
  const k = cTarget.value / Math.max(s0.x, s0.y, s0.z)
  model.scale(k, k, k)
  placeOnGround(model)
  const ms = sizeOf(model)
  const W = ms.x
  const D = ms.y
  const Hm = ms.z

  // pudełko formy: od z=0, wyśrodkowane XY; model uniesiony o grubość dna
  const boxW = W + 2 * wall
  const boxD = D + 2 * wall
  const boxH = Hm + 2 * tb
  model.translate(0, 0, tb)
  const box = meshAt(new THREE.BoxGeometry(boxW, boxD, boxH), { z: boxH / 2 })

  // wlew: stożek rozszerzający się ku górze, w osi (0,0), przenika model i wierzch pudełka
  const rBottom = cSprueBottom.value / 2
  const rTop = Math.max(cSprueTop.value / 2, rBottom)
  const hSprue = tb + 4
  const zSprueBottom = tb + Hm - 2 // 2 mm w głąb modelu
  const sprue = meshAt(
    new THREE.CylinderGeometry(rTop, rBottom, hSprue, 32),
    { rx: Math.PI / 2, z: zSprueBottom + hSprue / 2 }, // po rotacji koniec radiusTop u góry
  )

  const mold = subtract(subtract(box, model), sprue)

  // połówki: cięcie dokładnie w y=0
  const cutBoxG = new THREE.BoxGeometry(boxW + 2, boxD / 2 + 1, boxH + 2)
  const boxA = meshAt(cutBoxG, { y: -(boxD / 2 + 1) / 2, z: boxH / 2 }) // zajmuje y<0
  const boxB = meshAt(cutBoxG, { y: +(boxD / 2 + 1) / 2, z: boxH / 2 }) // zajmuje y>0
  let halfA = intersect(mold, boxA)
  let halfB = intersect(mold, boxB)

  // zamki pozycjonujące: 4 kulki o środkach na płaszczyźnie podziału
  if (cLocks.value) {
    const r = Math.min(cLockR.value, wall / 2 - 0.5)
    if (r >= 0.5) {
      const xs = [-(W / 2 + wall / 2), W / 2 + wall / 2]
      const zs = [tb + Hm * 0.25, tb + Hm * 0.75]
      const bumpG = new THREE.SphereGeometry(r, 24, 16)
      const dimpleG = new THREE.SphereGeometry(r + cClearance.value, 24, 16)
      const bumps = []
      const dimples = []
      for (const x of xs) {
        for (const z of zs) {
          bumps.push(meshAt(bumpG, { x, y: 0, z }))
          dimples.push(meshAt(dimpleG, { x, y: 0, z }))
        }
      }
      halfA = unionAll([halfA, ...bumps])       // wypustki
      halfB = subtractAll(halfB, dimples)        // wgłębienia z luzem
    }
  }

  // sprzątanie po CSG: usuń mikroskopijne (zdegenerowane) trójkąty
  halfA = stripDegenerateTris(halfA)
  halfB = stripDegenerateTris(halfB)

  // prezentacja: płaszczyzna podziału do góry, połówki obok siebie na stole
  halfA.rotateX(Math.PI / 2)
  halfB.rotateX(-Math.PI / 2)
  placeOnGround(halfA)
  placeOnGround(halfB)
  const gap = boxW / 2 + 8
  halfA.translate(-gap, 0, 0)
  halfB.translate(gap, 0, 0)

  return { halfA, halfB, moldSize: new THREE.Vector3(boxW, boxD, boxH) }
}

/**
 * Usuwa trójkąty, których wierzchołki leżą bliżej siebie niż `eps` mm
 * (śmieciowe ścinki po CSG — psują statystyki STL i przeszkadzają slicerom).
 */
function stripDegenerateTris(geom, eps = 2e-3) {
  const g = geom.getIndex() ? geom.toNonIndexed() : geom
  const pos = g.getAttribute('position')
  const e2 = eps * eps
  const d2 = (i, j) => {
    const dx = pos.getX(i) - pos.getX(j)
    const dy = pos.getY(i) - pos.getY(j)
    const dz = pos.getZ(i) - pos.getZ(j)
    return dx * dx + dy * dy + dz * dz
  }
  const out = []
  for (let i = 0; i < pos.count; i += 3) {
    if (d2(i, i + 1) < e2 || d2(i + 1, i + 2) < e2 || d2(i, i + 2) < e2) continue
    for (let j = 0; j < 3; j++) out.push(pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j))
  }
  const res = new THREE.BufferGeometry()
  res.setAttribute('position', new THREE.Float32BufferAttribute(out, 3))
  res.computeVertexNormals()
  return res
}
