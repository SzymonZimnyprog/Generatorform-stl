// Testy modułów core w Node (bez DOM). Uruchom: npm run test:core
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import opentype from 'opentype.js'
import { textToShapes } from '../src/core/text.js'
import { contoursToShapes, extrudeShapes, mergeGeoms, roundedRectShape, placeOnGround, sizeOf } from '../src/core/geometry.js'
import { luminanceMask, traceContours, simplifyLoop, smoothLoop, cleanPolygons, offsetPolygons, diffPolygons, polygonsToShapes, keepLargest } from '../src/core/trace.js'
import { subtract, union, intersect, meshAt } from '../src/core/csg.js'
import { exportSTL } from '../src/core/stl.js'

let failures = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✔ ${name}`)
  else { console.error(`  ✘ ${name} ${extra}`); failures++ }
}
function triCount(geom) {
  return geom.getIndex() ? geom.getIndex().count / 3 : geom.getAttribute('position').count / 3
}

// ── 1. Tekst → kształty → bryła ─────────────────────────────────────
console.log('text.js')
{
  const buf = readFileSync('public/fonts/Montserrat-ExtraBold.ttf')
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const { shapes, width, height } = textToShapes(font, 'Ała 3D', 20)
  check('kształty istnieją', shapes.length >= 5, `(${shapes.length})`)
  const holes = shapes.reduce((n, s) => n + s.holes.length, 0)
  check('litery mają dziury (a, D)', holes >= 2, `(${holes})`)
  check('szerokość sensowna', width > 30 && width < 200, `(${width.toFixed(1)})`)
  check('wysokość sensowna', height > 10 && height < 40, `(${height.toFixed(1)})`)
  const geom = extrudeShapes(shapes, 5)
  check('bryła tekstu ma trójkąty', triCount(geom) > 100, `(${triCount(geom)})`)
  const size = sizeOf(geom)
  check('grubość wyciągnięcia = 5', Math.abs(size.z - 5) < 0.01, `(${size.z})`)

  // wielolinijkowy + polskie znaki
  const two = textToShapes(font, 'Żółć\nGęś', 15)
  check('dwie linie działają', two.height > 25, `(${two.height.toFixed(1)})`)
}

// ── 2. Wektoryzacja: maska → kontury → offset → kształty ────────────
console.log('trace.js')
{
  // syntetyczny obrazek 60×60: czarny pierścień (koło z dziurą)
  const W = 60
  const H = 60
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - 30, y - 30)
      const ink = d < 24 && d > 10
      const k = (y * W + x) * 4
      data[k] = data[k + 1] = data[k + 2] = ink ? 0 : 255
      data[k + 3] = 255
    }
  }
  const imageData = { data, width: W, height: H }
  const mask = luminanceMask(imageData, { threshold: 128 })
  check('maska ma piksele', mask.reduce((a, b) => a + b, 0) > 500)
  const loops = traceContours(mask, W, H)
  check('są 2 kontury (zewnętrzny + dziura)', loops.length === 2, `(${loops.length})`)
  const smooth = loops.map((l) => simplifyLoop(smoothLoop(l, 1), 0.6))
  const polys = cleanPolygons(smooth)
  check('clipper czyści poprawnie', polys.length === 2, `(${polys.length})`)
  const grown = offsetPolygons(polys, 2)
  check('offset dodatni działa', grown.length >= 2, `(${grown.length})`)
  const ring = diffPolygons(grown, polys)
  check('różnica wielokątów działa', ring.length >= 2, `(${ring.length})`)
  const shapes = polygonsToShapes(polys)
  check('kształt z dziurą', shapes.length === 1 && shapes[0].holes.length === 1,
    `(shapes=${shapes.length}, holes=${shapes[0]?.holes.length})`)
  const geom = extrudeShapes(shapes, 10, { curveSegments: 4 })
  check('bryła z konturu', triCount(geom) > 50, `(${triCount(geom)})`)
  const largest = keepLargest(polys)
  check('keepLargest zostawia dziurę', largest.length === 2, `(${largest.length})`)
}

// ── 3. CSG ──────────────────────────────────────────────────────────
console.log('csg.js')
{
  const box = new THREE.BoxGeometry(20, 20, 10)
  const cyl = new THREE.CylinderGeometry(5, 5, 40, 32)
  const cylMesh = meshAt(cyl, { rx: Math.PI / 2 }) // oś wzdłuż Z
  const g1 = subtract(box, cylMesh)
  check('subtract daje geometrię', triCount(g1) > 20, `(${triCount(g1)})`)
  const s1 = sizeOf(g1)
  check('subtract zachowuje wymiary', Math.abs(s1.x - 20) < 0.1 && Math.abs(s1.z - 10) < 0.1)

  const g2 = union(box, meshAt(new THREE.BoxGeometry(20, 20, 10), { z: 10 }))
  const s2 = sizeOf(g2)
  check('union łączy w pionie', Math.abs(s2.z - 20) < 0.1, `(${s2.z})`)

  const g3 = intersect(box, meshAt(new THREE.BoxGeometry(20, 20, 10), { x: 10 }))
  const s3 = sizeOf(g3)
  check('intersect przycina', Math.abs(s3.x - 10) < 0.1, `(${s3.x})`)

  // typowy przypadek: forma = pudełko − model (kula)
  const mold = subtract(
    new THREE.BoxGeometry(40, 40, 40),
    new THREE.SphereGeometry(15, 32, 24),
  )
  check('forma pudełko−kula', triCount(mold) > 500, `(${triCount(mold)})`)
}

// ── 4. Eksport STL ──────────────────────────────────────────────────
console.log('stl.js')
{
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 20, 30))
  mesh.position.set(5, 0, 0)
  const buf = exportSTL(mesh)
  const view = new DataView(buf)
  const n = view.getUint32(80, true)
  check('12 trójkątów sześcianu', n === 12, `(${n})`)
  check('rozmiar pliku zgodny', buf.byteLength === 84 + n * 50)
  // bounding box z wierzchołków
  let minX = Infinity
  let maxX = -Infinity
  for (let i = 0; i < n; i++) {
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(84 + i * 50 + 12 + v * 12, true)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
    }
  }
  check('transformacja uwzględniona', Math.abs(minX - 0) < 1e-4 && Math.abs(maxX - 10) < 1e-4,
    `(${minX}, ${maxX})`)
}

// ── 5. geometry.js dodatki ──────────────────────────────────────────
console.log('geometry.js')
{
  const g = extrudeShapes(roundedRectShape(30, 20, 5), 4)
  placeOnGround(g)
  g.computeBoundingBox()
  check('roundedRect + placeOnGround', Math.abs(g.boundingBox.min.z) < 1e-6)
  const merged = mergeGeoms([
    new THREE.BoxGeometry(10, 10, 10),
    new THREE.SphereGeometry(5, 8, 6),
  ])
  check('mergeGeoms działa', triCount(merged) > 20)
  // zagnieżdżenie: kwadrat w kwadracie w kwadracie (wyspa w dziurze)
  const sq = (r) => [{ x: -r, y: -r }, { x: r, y: -r }, { x: r, y: r }, { x: -r, y: r }]
  const shapes = contoursToShapes([sq(30), sq(20), sq(10)])
  check('zagnieżdżone kontury → 2 kształty', shapes.length === 2, `(${shapes.length})`)
  check('największy ma dziurę', shapes.some((s) => s.holes.length === 1))
}

console.log(failures ? `\n${failures} TESTÓW NIE PRZESZŁO` : '\nWszystkie testy core przeszły ✔')
process.exit(failures ? 1 : 0)
