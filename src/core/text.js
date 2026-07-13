import * as THREE from 'three'
import opentype from 'opentype.js'
import { contoursToShapes } from './geometry.js'

/** Dostępne fonty (TTF w public/fonts, pełne polskie znaki). */
export const FONTS = [
  { id: 'montserrat', label: 'Montserrat — gruby, nowoczesny', file: 'fonts/Montserrat-ExtraBold.ttf' },
  { id: 'roboto', label: 'Roboto — klasyczny', file: 'fonts/Roboto-Bold.ttf' },
  { id: 'lobster', label: 'Lobster — ozdobny', file: 'fonts/Lobster-Regular.ttf' },
  { id: 'pacifico', label: 'Pacifico — pisany', file: 'fonts/Pacifico-Regular.ttf' },
]

export function fontOptions() {
  return FONTS.map((f) => ({ value: f.id, label: f.label }))
}

const cache = new Map()

/** Ładuje font po id (z cache). */
export async function loadFont(id) {
  if (cache.has(id)) return cache.get(id)
  const meta = FONTS.find((f) => f.id === id) || FONTS[0]
  const url = import.meta.env.BASE_URL + meta.file
  const buf = await (await fetch(url)).arrayBuffer()
  const font = opentype.parse(buf)
  cache.set(id, font)
  return font
}

/**
 * Zamienia tekst (może być wielolinijkowy) na THREE.Shape[] w mm.
 * `size` — wysokość fontu (em) w mm. Zwraca { shapes, width, height }.
 * Kształty leżą w płaszczyźnie XY, wyśrodkowane, Y w górę.
 */
export function textToShapes(font, text, size, { lineHeight = 1.25, letterSpacing = 0, align = 'center' } = {}) {
  const lines = String(text).split('\n').map((l) => l.trimEnd())
  const scale = size / font.unitsPerEm
  const widths = lines.map((l) => measureLine(font, l, size, letterSpacing))
  const maxW = Math.max(...widths, 0.001)

  const contours = []
  lines.forEach((line, i) => {
    if (!line) return
    let x0 = 0
    if (align === 'center') x0 = -widths[i] / 2
    else if (align === 'right') x0 = maxW / 2 - widths[i]
    else x0 = -maxW / 2
    const y0 = -i * size * lineHeight
    const path = font.getPath(line, x0, 0, size, { kerning: true, letterSpacing: letterSpacing / size })
    // opentype rysuje w układzie canvas (Y w dół) — odbijamy Y i przesuwamy linię
    contours.push(...openTypePathToPaths(path, y0))
  })

  const shapes = contoursToShapes(contours)

  // wyśrodkuj pionowo względem całego bloku
  const bbox = new THREE.Box2()
  for (const s of shapes) {
    for (const p of s.getPoints(8)) bbox.expandByPoint(p)
    for (const h of s.holes) for (const p of h.getPoints(8)) bbox.expandByPoint(p)
  }
  if (!bbox.isEmpty()) {
    const cx = (bbox.min.x + bbox.max.x) / 2
    const cy = (bbox.min.y + bbox.max.y) / 2
    for (const s of shapes) shiftPath(s, -cx, -cy)
    for (const s of shapes) for (const h of s.holes) shiftPath(h, -cx, -cy)
    bbox.min.x -= cx; bbox.max.x -= cx
    bbox.min.y -= cy; bbox.max.y -= cy
  }
  return {
    shapes,
    width: bbox.isEmpty() ? 0 : bbox.max.x - bbox.min.x,
    height: bbox.isEmpty() ? 0 : bbox.max.y - bbox.min.y,
  }
}

function measureLine(font, line, size, letterSpacing) {
  return font.getAdvanceWidth(line, size, { kerning: true, letterSpacing: letterSpacing / size })
}

function shiftPath(path, dx, dy) {
  for (const curve of path.curves) {
    for (const key of ['v0', 'v1', 'v2', 'v3']) {
      const v = curve[key]
      if (v && v.isVector2) { v.x += dx; v.y += dy }
    }
  }
  if (path.currentPoint) { path.currentPoint.x += dx; path.currentPoint.y += dy }
}

/** Rozbija opentype.Path na osobne zamknięte THREE.Path (Y odbite). */
function openTypePathToPaths(otPath, yOffset = 0) {
  const paths = []
  let cur = null
  let startX = 0
  let startY = 0
  const Y = (y) => -y + yOffset
  for (const cmd of otPath.commands) {
    switch (cmd.type) {
      case 'M':
        cur = new THREE.Path()
        paths.push(cur)
        cur.moveTo(cmd.x, Y(cmd.y))
        startX = cmd.x; startY = Y(cmd.y)
        break
      case 'L':
        cur?.lineTo(cmd.x, Y(cmd.y))
        break
      case 'C':
        cur?.bezierCurveTo(cmd.x1, Y(cmd.y1), cmd.x2, Y(cmd.y2), cmd.x, Y(cmd.y))
        break
      case 'Q':
        cur?.quadraticCurveTo(cmd.x1, Y(cmd.y1), cmd.x, Y(cmd.y))
        break
      case 'Z':
        if (cur) { cur.lineTo(startX, startY); cur.autoClose = true }
        cur = null
        break
    }
  }
  return paths.filter((p) => p.curves.length > 0)
}
