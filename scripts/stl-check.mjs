// Walidacja binarnego pliku STL.
export function validateSTL(buffer) {
  const view = new DataView(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.byteLength)
  if (view.byteLength < 84) throw new Error('Plik krótszy niż nagłówek STL')
  const triangles = view.getUint32(80, true)
  const expected = 84 + triangles * 50
  if (view.byteLength !== expected) {
    throw new Error(`Rozmiar pliku ${view.byteLength} ≠ oczekiwany ${expected} (${triangles} trójkątów)`)
  }
  if (triangles === 0) throw new Error('STL ma 0 trójkątów')

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  let degenerate = 0
  const edges = new Map()
  const vkey = (x, y, z) => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`

  for (let i = 0; i < triangles; i++) {
    const base = 84 + i * 50 + 12
    const v = []
    for (let j = 0; j < 3; j++) {
      const x = view.getFloat32(base + j * 12, true)
      const y = view.getFloat32(base + j * 12 + 4, true)
      const z = view.getFloat32(base + j * 12 + 8, true)
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(`Nieprawidłowa współrzędna w trójkącie ${i}`)
      }
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
      v.push(vkey(x, y, z))
    }
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) { degenerate++; continue }
    for (let j = 0; j < 3; j++) {
      const a = v[j]
      const b = v[(j + 1) % 3]
      const ek = a < b ? a + '|' + b : b + '|' + a
      edges.set(ek, (edges.get(ek) || 0) + 1)
    }
  }
  let openEdges = 0
  let overEdges = 0
  for (const c of edges.values()) {
    if (c === 1) openEdges++
    else if (c > 2) overEdges++
  }
  const size = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ }
  if (size.x <= 0 && size.y <= 0 && size.z <= 0) throw new Error('Zdegenerowany bounding box')
  return {
    triangles,
    degenerate,
    openEdges,
    overEdges,
    bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    size,
  }
}
