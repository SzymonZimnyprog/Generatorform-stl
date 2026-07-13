import * as THREE from 'three'
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

const evaluator = new Evaluator()
evaluator.attributes = ['position', 'normal']
evaluator.useGroups = false

/**
 * Usuwa trójkąty o zerowym polu — psują klasyfikację wnętrza w CSG
 * (częste w STL-ach z internetu, np. zdegenerowane wachlarze na biegunach).
 */
function dropDegenerateTriangles(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  const pos = g.getAttribute('position')
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const cr = new THREE.Vector3()
  const keep = []
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i)
    b.fromBufferAttribute(pos, i + 1)
    c.fromBufferAttribute(pos, i + 2)
    ab.subVectors(b, a)
    ac.subVectors(c, a)
    cr.crossVectors(ab, ac)
    if (cr.lengthSq() > 1e-12) keep.push(i)
  }
  if (keep.length * 3 === pos.count) return g
  const out = new Float32Array(keep.length * 9)
  let o = 0
  for (const i of keep) {
    for (let v = 0; v < 3; v++) {
      out[o++] = pos.getX(i + v)
      out[o++] = pos.getY(i + v)
      out[o++] = pos.getZ(i + v)
    }
  }
  const clean = new THREE.BufferGeometry()
  clean.setAttribute('position', new THREE.BufferAttribute(out, 3))
  return clean
}

function toBrush(input) {
  let geometry
  if (input.isMesh) {
    input.updateMatrixWorld(true)
    geometry = input.geometry.clone().applyMatrix4(input.matrixWorld)
  } else if (input.isBufferGeometry) {
    geometry = input.clone()
  } else {
    throw new Error('CSG: oczekiwano Mesh lub BufferGeometry')
  }
  geometry = dropDegenerateTriangles(geometry)
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name)
  }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
  const brush = new Brush(geometry)
  brush.updateMatrixWorld()
  return brush
}

function run(a, op, b) {
  const result = evaluator.evaluate(toBrush(a), toBrush(b), op)
  // sprzątanie po CSG: spawanie wierzchołków (1 µm) usuwa mikro-paski
  // z retriangulacji szwów, potem wyrzucamy trójkąty o zerowym polu
  let geometry = result.geometry
  geometry.deleteAttribute('normal')
  geometry = mergeVertices(geometry, 1e-3)
  geometry = dropDegenerateTriangles(geometry.toNonIndexed())
  geometry.computeVertexNormals()
  return geometry
}

/** a − b → BufferGeometry (współrzędne światowe wejść są „wypiekane"). */
export function subtract(a, b) { return run(a, SUBTRACTION, b) }
/** a ∪ b → BufferGeometry */
export function union(a, b) { return run(a, ADDITION, b) }
/** a ∩ b → BufferGeometry */
export function intersect(a, b) { return run(a, INTERSECTION, b) }

/** Kolejne odejmowanie wielu brył: base − b1 − b2 − … */
export function subtractAll(base, subtrahends) {
  let g = base
  for (const s of subtrahends) g = subtract(g, s)
  return g
}

/** Kolejna suma wielu brył. */
export function unionAll(geoms) {
  let g = geoms[0]
  for (let i = 1; i < geoms.length; i++) g = union(g, geoms[i])
  return g
}

/** Pomocniczo: Mesh z geometrii + macierzy (do składania scen CSG). */
export function meshAt(geometry, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const m = new THREE.Mesh(geometry)
  m.position.set(x, y, z)
  m.rotation.set(rx, ry, rz)
  m.scale.set(sx, sy, sz)
  m.updateMatrixWorld(true)
  return m
}
