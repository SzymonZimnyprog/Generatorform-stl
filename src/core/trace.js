import ClipperLib from 'clipper-lib'
import { contoursToShapes } from './geometry.js'

/**
 * Wektoryzacja obrazka: bitmapa → kontury → (Clipper) czyszczenie,
 * offsety i zamiana na THREE.Shape. Współrzędne wynikowe w pikselach
 * obrazka (Y w górę) — skalowanie do mm robi narzędzie.
 */

const CLIP_SCALE = 100 // Clipper działa na intach

/** Wczytuje File → ImageData (przeskalowane, max `maxDim` px). */
export async function fileToImageData(file, maxDim = 480) {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
  const w = Math.max(2, Math.round(bmp.width * scale))
  const h = Math.max(2, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/**
 * Maska binarna z obrazka: 1 = wypełnione (ciemne piksele).
 * Piksele przezroczyste traktowane są jako tło.
 */
export function luminanceMask(imageData, { threshold = 128, invert = false } = {}) {
  const { data, width, height } = imageData
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const a = data[i * 4 + 3]
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    let solid = a > 40 && lum < threshold
    if (invert) solid = a > 40 && lum >= threshold
    mask[i] = solid ? 1 : 0
  }
  return mask
}

/**
 * Marching squares: maska → zamknięte pętle [{x,y},…] (piksele, Y w górę).
 */
export function traceContours(mask, width, height) {
  // siatka z paddingiem 1, wartości w rogach komórek
  const W = width + 2
  const H = height + 2
  const at = (x, y) => {
    if (x < 1 || y < 1 || x > width || y > height) return 0
    return mask[(y - 1) * width + (x - 1)]
  }
  // segmenty: klucz punktu startu → [punkt startu, punkt końca]
  const segs = new Map()
  const key = (x, y) => `${x},${y}` // współrzędne ×2 (środki krawędzi)

  const addSeg = (x1, y1, x2, y2) => {
    const k = key(x1, y1)
    if (!segs.has(k)) segs.set(k, [])
    segs.get(k).push([x2, y2])
  }

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = at(x, y)
      const tr = at(x + 1, y)
      const br = at(x + 1, y + 1)
      const bl = at(x, y + 1)
      const idx = (tl << 3) | (tr << 2) | (br << 1) | bl
      if (idx === 0 || idx === 15) continue
      // punkty środków krawędzi w podwojonych współrzędnych
      const T = [x * 2 + 1, y * 2]
      const R = [x * 2 + 2, y * 2 + 1]
      const B = [x * 2 + 1, y * 2 + 2]
      const L = [x * 2, y * 2 + 1]
      // segmenty skierowane tak, aby wypełnienie było po lewej
      switch (idx) {
        case 1: addSeg(...B, ...L); break
        case 2: addSeg(...R, ...B); break
        case 3: addSeg(...R, ...L); break
        case 4: addSeg(...T, ...R); break
        case 5: addSeg(...T, ...L); addSeg(...B, ...R); break
        case 6: addSeg(...T, ...B); break
        case 7: addSeg(...T, ...L); break
        case 8: addSeg(...L, ...T); break
        case 9: addSeg(...B, ...T); break
        case 10: addSeg(...L, ...B); addSeg(...R, ...T); break
        case 11: addSeg(...R, ...T); break
        case 12: addSeg(...L, ...R); break
        case 13: addSeg(...B, ...R); break
        case 14: addSeg(...L, ...B); break
      }
    }
  }

  // łączenie segmentów w pętle
  const loops = []
  for (const [startKey, targets] of segs) {
    while (targets.length) {
      const first = startKey.split(',').map(Number)
      let cur = targets.pop()
      const loop = [first, cur]
      let guard = 0
      while (guard++ < 1e6) {
        const k = key(cur[0], cur[1])
        const nexts = segs.get(k)
        if (!nexts || !nexts.length) break
        cur = nexts.pop()
        if (cur[0] === first[0] && cur[1] === first[1]) break
        loop.push(cur)
      }
      if (loop.length >= 3) {
        loops.push(loop.map(([px, py]) => ({
          x: px / 2 - 1,
          y: height - (py / 2 - 1), // odbicie Y: obrazek Y-w-dół → geometria Y-w-górę
        })))
      }
    }
  }
  return loops
}

/** Uproszczenie Ramera–Douglasa–Peuckera (zamknięta pętla). */
export function simplifyLoop(pts, epsilon = 0.8) {
  if (pts.length < 5 || epsilon <= 0) return pts
  const rdp = (points, eps) => {
    if (points.length < 3) return points
    const first = points[0]
    const last = points[points.length - 1]
    let maxD = -1
    let idx = -1
    const dx = last.x - first.x
    const dy = last.y - first.y
    const len = Math.hypot(dx, dy) || 1e-9
    for (let i = 1; i < points.length - 1; i++) {
      const d = Math.abs(dy * points[i].x - dx * points[i].y + last.x * first.y - last.y * first.x) / len
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > eps) {
      const l = rdp(points.slice(0, idx + 1), eps)
      const r = rdp(points.slice(idx), eps)
      return l.slice(0, -1).concat(r)
    }
    return [first, last]
  }
  const out = rdp([...pts, pts[0]], epsilon)
  out.pop()
  return out.length >= 3 ? out : pts
}

/** Wygładzenie Chaikina (zamknięta pętla), `iterations` rund. */
export function smoothLoop(pts, iterations = 1) {
  let p = pts
  for (let it = 0; it < iterations; it++) {
    const out = []
    for (let i = 0; i < p.length; i++) {
      const a = p[i]
      const b = p[(i + 1) % p.length]
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    p = out
  }
  return p
}

function toClipper(loops) {
  return loops.map((loop) => loop.map((p) => ({
    X: Math.round(p.x * CLIP_SCALE),
    Y: Math.round(p.y * CLIP_SCALE),
  })))
}

function fromClipper(paths) {
  return paths.map((path) => path.map((p) => ({ X: p.X, Y: p.Y })))
}

/** Do punktów {x,y}. */
export function clipperToPoints(paths) {
  return paths.map((path) => path.map((p) => ({ x: p.X / CLIP_SCALE, y: p.Y / CLIP_SCALE })))
}

/**
 * Czyści/scala pętle (nonzero fill) → poprawne wielokąty Clippera.
 * Zwraca ścieżki w formacie Clippera (do dalszych offsetów).
 */
export function cleanPolygons(loops, { minArea = 4 } = {}) {
  const c = new ClipperLib.Clipper()
  c.AddPaths(toClipper(loops), ClipperLib.PolyType.ptSubject, true)
  const solution = new ClipperLib.Paths()
  c.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  )
  const cleaned = ClipperLib.Clipper.CleanPolygons(solution, CLIP_SCALE * 0.15)
  return fromClipper(cleaned).filter(
    (p) => Math.abs(ClipperLib.Clipper.Area(p)) > minArea * CLIP_SCALE * CLIP_SCALE,
  )
}

/**
 * Offset wielokątów o `delta` (w jednostkach wejściowych, może być ujemny).
 * Wejście/wyjście: ścieżki Clippera (z cleanPolygons/offsetPolygons).
 */
export function offsetPolygons(paths, delta, { joinRound = true } = {}) {
  const co = new ClipperLib.ClipperOffset(2, CLIP_SCALE * 0.25)
  co.AddPaths(
    paths,
    joinRound ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtMiter,
    ClipperLib.EndType.etClosedPolygon,
  )
  const out = new ClipperLib.Paths()
  co.Execute(out, delta * CLIP_SCALE)
  return fromClipper(out)
}

/** Różnica zbiorów wielokątów: a − b (ścieżki Clippera). */
export function diffPolygons(a, b) {
  const c = new ClipperLib.Clipper()
  c.AddPaths(a, ClipperLib.PolyType.ptSubject, true)
  c.AddPaths(b, ClipperLib.PolyType.ptClip, true)
  const out = new ClipperLib.Paths()
  c.Execute(
    ClipperLib.ClipType.ctDifference,
    out,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  )
  return fromClipper(out)
}

/** Ścieżki Clippera → THREE.Shape[] (z dziurami). */
export function polygonsToShapes(paths) {
  return contoursToShapes(clipperToPoints(paths))
}

/** Największy wielokąt (największe pole) ze ścieżek Clippera — z dziurami zostawionymi w środku. */
export function keepLargest(paths, { withHoles = true } = {}) {
  if (!paths.length) return paths
  let best = null
  let bestArea = -1
  for (const p of paths) {
    const a = ClipperLib.Clipper.Area(p)
    if (a > bestArea) { bestArea = a; best = p }
  }
  if (!withHoles) return [best]
  // zostaw dziury (pętle o przeciwnej orientacji) leżące w najlepszym
  const out = [best]
  for (const p of paths) {
    if (p === best) continue
    if (ClipperLib.Clipper.Area(p) < 0) {
      const pt = p[0]
      if (ClipperLib.Clipper.PointInPolygon(pt, best) !== 0) out.push(p)
    }
  }
  return out
}
