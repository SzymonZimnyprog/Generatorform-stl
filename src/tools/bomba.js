import * as THREE from 'three'
import { createViewer, previewMaterial, previewMaterialAlt } from '../core/viewer.js'
import { downloadSTL } from '../core/stl.js'
import { subtract, meshAt } from '../core/csg.js'
import { extrudeShapes, mergeGeoms, circleShape } from '../core/geometry.js'
import {
  getToolLayout, group, slider, checkbox, button,
  makeStatus, debounce, nextFrame,
} from '../core/ui.js'

const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)
const viewer = createViewer(viewerEl)

let exportObjects = null

const regenDebounced = debounce(regen, 300)

// ── Panel ───────────────────────────────────────────────────────────
const gBall = group(controls, 'Kula')
const cDia = slider(gBall, { label: 'Średnica bomby', min: 30, max: 80, step: 1, value: 55, onChange: regenDebounced })
const cWall = slider(gBall, { label: 'Grubość ścianki', min: 1.2, max: 4, step: 0.2, value: 2, onChange: regenDebounced })

const gFlange = group(controls, 'Kołnierz i uchwyt')
const cFlange = slider(gFlange, { label: 'Szerokość kołnierza', min: 5, max: 20, step: 1, value: 10, onChange: regenDebounced })
const cFlangeT = slider(gFlange, { label: 'Grubość kołnierza', min: 2, max: 6, step: 0.5, value: 3, onChange: regenDebounced })
const cVent = checkbox(gFlange, { label: 'Otwór odpowietrzający na szczycie (⌀6)', value: false, onChange: regenDebounced })
const hintVent = document.createElement('p')
hintVent.className = 'hint'
hintVent.textContent = 'Otwór ułatwia wypchnięcie sprasowanej bomby i odprowadza powietrze przy prasowaniu.'
gFlange.appendChild(hintVent)

const gOut = group(controls, 'Eksport')
const btn = button(gOut, {
  label: 'Pobierz STL',
  kind: 'primary',
  onClick: () => {
    if (!exportObjects) return
    downloadSTL(exportObjects, 'forma-bomba.stl')
    status('Zapisano forma-bomba.stl', 'ok')
  },
})
const hint = document.createElement('p')
hint.className = 'hint'
hint.textContent = 'Drukuj tak jak stoi (kołnierzem na stole, kopułą do góry). Do użycia: napełnij obie połówki masą z górką, dociśnij i przekręć.'
gOut.appendChild(hint)

// ── Generowanie ─────────────────────────────────────────────────────
async function regen() {
  status('Generuję formę…', 'busy')
  await nextFrame()
  try {
    const half = buildHalf()
    const spacing = sizeOfX(half) / 2 + 6
    const a = new THREE.Mesh(half, previewMaterial())
    a.position.x = -spacing
    const b = new THREE.Mesh(half.clone(), previewMaterialAlt())
    b.position.x = spacing
    exportObjects = [a, b]
    viewer.setContent(exportObjects)
    viewer.fit()
    const tris = half.getAttribute('position').count / 3
    status(`Gotowe — 2 × ${Math.round(tris / 1000)}k trójkątów. Możesz pobrać STL.`, 'ok')
  } catch (e) {
    console.error(e)
    status('Błąd generowania: ' + e.message, 'error')
  }
}

function sizeOfX(geom) {
  geom.computeBoundingBox()
  return geom.boundingBox.max.x - geom.boundingBox.min.x
}

/**
 * Połówka formy (Z-up, do druku bez podpór): kopuła (czasza kulista)
 * otwarta od dołu + płaski kołnierz przy podstawie. Wnęka = wewnętrzna
 * półkula o zadanej średnicy bomby.
 */
function buildHalf() {
  const r = cDia.value / 2
  const t = cWall.value
  const ro = r + t
  const f = cFlange.value
  const fT = cFlangeT.value

  // czasza: (kula zewn. − kula wewn.) ∩ górna półprzestrzeń
  let shell = subtract(
    new THREE.SphereGeometry(ro, 48, 32),
    new THREE.SphereGeometry(r, 48, 32),
  )
  shell = subtract(shell, meshAt(new THREE.BoxGeometry(3 * ro, 3 * ro, 2 * ro), { z: -ro }))

  // kołnierz: pierścień od promienia wnęki do ro+f (dziura = otwarcie wnęki)
  const ring = circleShape(ro + f)
  const hole = new THREE.Path()
  hole.absarc(0, 0, r, 0, Math.PI * 2, true)
  ring.holes.push(hole)
  const flange = extrudeShapes(ring, fT, { curveSegments: 48 })

  let half = mergeGeoms([shell, flange])
  if (cVent.value) {
    half = subtract(half, meshAt(
      new THREE.CylinderGeometry(3, 3, t + 10, 24),
      { z: ro - (t + 10) / 2 + 5, rx: Math.PI / 2 },
    ))
  }
  return half
}

regen()
