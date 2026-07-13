import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** Prostokąt z zaokrąglonymi rogami jako THREE.Shape (środek w 0,0). */
export function roundedRectShape(w, h, r) {
  r = Math.max(0, Math.min(r, w / 2 - 0.01, h / 2 - 0.01))
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
  s.lineTo(x + w, y + h - r)
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
  s.lineTo(x + r, y + h)
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(x, y + r)
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
  return s
}

/** Elipsa/koło jako THREE.Shape. */
export function circleShape(r, segments = 64) {
  const s = new THREE.Shape()
  s.absarc(0, 0, r, 0, Math.PI * 2, false)
  s.curves[0].aClockwise = false
  return s
}

function signedArea(pts) {
  let a = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % n]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

function pointInPolygon(pt, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x
    const yi = pts[i].y
    const xj = pts[j].x
    const yj = pts[j].y
    if ((yi > pt.y) !== (yj > pt.y) &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Zamienia listę zamkniętych konturów na THREE.Shape[] z poprawnie
 * przypisanymi dziurami (parzystość zagnieżdżenia), niezależnie od
 * kierunku nawijania w danych wejściowych.
 * Kontury: tablice punktów {x,y} LUB obiekty THREE.Path.
 */
export function contoursToShapes(contours) {
  const items = contours
    .map((c) => {
      const isPath = !!(c && c.curves) // THREE.Path / THREE.Shape
      const path = isPath ? c : polylineToPath(c)
      const pts = isPath ? c.getPoints(12) : c
      return { path, pts, area: Math.abs(signedArea(pts)) }
    })
    .filter((it) => it.area > 1e-6 && it.pts.length >= 3)

  // głębokość zagnieżdżenia = w ilu innych konturach leży punkt konturu
  for (const it of items) {
    let depth = 0
    const probe = it.pts[0]
    for (const other of items) {
      if (other === it) continue
      if (other.area <= it.area) continue
      if (pointInPolygon(probe, other.pts)) depth++
    }
    it.depth = depth
  }

  const outers = items.filter((it) => it.depth % 2 === 0)
  const holes = items.filter((it) => it.depth % 2 === 1)

  const shapes = []
  for (const o of outers) {
    const shape = new THREE.Shape()
    shape.curves = o.path.curves
    shape.autoClose = true
    shape._pts = o.pts
    shape._area = o.area
    shapes.push(shape)
  }
  for (const h of holes) {
    // dziura trafia do najmniejszego outera, który ją zawiera
    let best = null
    for (const s of shapes) {
      if (s._area > h.area && pointInPolygon(h.pts[0], s._pts)) {
        if (!best || s._area < best._area) best = s
      }
    }
    if (best) {
      const hp = new THREE.Path()
      hp.curves = h.path.curves
      hp.autoClose = true
      best.holes.push(hp)
    }
  }
  for (const s of shapes) { delete s._pts; delete s._area }
  return shapes
}

function polylineToPath(pts) {
  const p = new THREE.Path()
  p.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y)
  p.closePath()
  return p
}

/**
 * Wyciąga kształty na wysokość `depth` wzdłuż +Z (0..depth).
 * curveSegments — gęstość łuków.
 */
export function extrudeShapes(shapes, depth, { curveSegments = 24, bevel = 0 } = {}) {
  const arr = Array.isArray(shapes) ? shapes : [shapes]
  const geom = new THREE.ExtrudeGeometry(arr, {
    depth,
    curveSegments,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  })
  geom.computeVertexNormals()
  return geom
}

/** Łączy geometrie w jedną (ujednolica atrybuty do position+normal). */
export function mergeGeoms(geoms) {
  const prepared = geoms.filter(Boolean).map((g) => {
    const c = g.index ? g.toNonIndexed() : g.clone()
    for (const name of Object.keys(c.attributes)) {
      if (name !== 'position' && name !== 'normal') c.deleteAttribute(name)
    }
    if (!c.getAttribute('normal')) c.computeVertexNormals()
    return c
  })
  return mergeGeometries(prepared, false)
}

/** Centruje geometrię w XY i stawia na Z=0. */
export function placeOnGround(geometry) {
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  const cx = (bb.min.x + bb.max.x) / 2
  const cy = (bb.min.y + bb.max.y) / 2
  geometry.translate(-cx, -cy, -bb.min.z)
  return geometry
}

/** Rozmiar geometrii {x,y,z}. */
export function sizeOf(geometry) {
  geometry.computeBoundingBox()
  return geometry.boundingBox.getSize(new THREE.Vector3())
}
