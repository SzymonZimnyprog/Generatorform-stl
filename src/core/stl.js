import * as THREE from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Eksport binarnego STL. Przyjmuje Mesh/Group lub tablicę obiektów;
 * transformacje (position/rotation/scale) obiektów są uwzględniane.
 * Geometria powinna być w milimetrach, Z-w-górę.
 */
export function exportSTL(objects) {
  const arr = Array.isArray(objects) ? objects : [objects]
  const root = new THREE.Group()
  for (const o of arr) if (o) root.add(o.clone(true))
  root.updateMatrixWorld(true)

  const triangles = []
  root.traverse((node) => {
    if (!node.isMesh || !node.geometry) return
    const geom = node.geometry.index
      ? node.geometry.toNonIndexed()
      : node.geometry
    const pos = geom.getAttribute('position')
    const m = node.matrixWorld
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i).applyMatrix4(m)
      b.fromBufferAttribute(pos, i + 1).applyMatrix4(m)
      c.fromBufferAttribute(pos, i + 2).applyMatrix4(m)
      triangles.push([a.clone(), b.clone(), c.clone()])
    }
  })

  const buffer = new ArrayBuffer(84 + triangles.length * 50)
  const view = new DataView(buffer)
  view.setUint32(80, triangles.length, true)
  let off = 84
  const ab = new THREE.Vector3()
  const cb = new THREE.Vector3()
  for (const [a, b, c] of triangles) {
    cb.subVectors(c, b)
    ab.subVectors(a, b)
    cb.cross(ab).normalize()
    view.setFloat32(off, cb.x, true)
    view.setFloat32(off + 4, cb.y, true)
    view.setFloat32(off + 8, cb.z, true)
    off += 12
    for (const v of [a, b, c]) {
      view.setFloat32(off, v.x, true)
      view.setFloat32(off + 4, v.y, true)
      view.setFloat32(off + 8, v.z, true)
      off += 12
    }
    view.setUint16(off, 0, true)
    off += 2
  }
  return buffer
}

/** Eksportuje obiekty i od razu pobiera plik .stl. */
export function downloadSTL(objects, filename = 'model.stl') {
  const buffer = exportSTL(objects)
  const blob = new Blob([buffer], { type: 'model/stl' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.stl') ? filename : filename + '.stl'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return buffer
}

/** Wczytuje plik .stl (File/Blob) → BufferGeometry z normalnymi. */
export async function loadSTLFile(file) {
  const buffer = await file.arrayBuffer()
  const loader = new STLLoader()
  let geometry = loader.parse(buffer)
  // STL to „zupa trójkątów" — scalamy zduplikowane wierzchołki, żeby siatka
  // była spójna (wymóg poprawnej klasyfikacji wnętrza w operacjach CSG)
  geometry.deleteAttribute('normal')
  geometry = mergeVertices(geometry, 1e-4)
  geometry.computeVertexNormals()
  return geometry
}
