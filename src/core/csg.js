import * as THREE from 'three'
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg'

const evaluator = new Evaluator()
evaluator.attributes = ['position', 'normal']
evaluator.useGroups = false

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
  const geometry = result.geometry
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
