import * as THREE from 'three'
import { createViewer, previewMaterial } from '../core/viewer.js'
import { downloadSTL } from '../core/stl.js'
import {
  getToolLayout, group, slider, select, textInput, checkbox, button,
  makeStatus, debounce, nextFrame,
} from '../core/ui.js'
import { loadFont, fontOptions, textToShapes } from '../core/text.js'
import {
  roundedRectShape, extrudeShapes, mergeGeoms, placeOnGround, sizeOf,
} from '../core/geometry.js'
import { cleanPolygons, offsetPolygons, polygonsToShapes, clipperToPoints } from '../core/trace.js'

const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)
const viewer = createViewer(viewerEl)

// Operacje 2D robimy w skali ×10 — tolerancja czyszczenia Clippera spada
// wtedy z 0,15 mm do 0,015 mm i drobne detale (kropki, ogonki) nie znikają.
const S = 10
const HOLE_R = 2 // otwory do zawieszenia ⌀4 mm
const HOLE_INSET = 4.5 // środek otworu 4,5 mm od krawędzi prostokąta
const PAD_R = 4.5 // promień uszka wokół otworu przy podstawce obrysowej

let mesh = null

const regenDebounced = debounce(regen, 300)

// ── Panel ───────────────────────────────────────────────────────────
const gText = group(controls, 'Tekst')
const cText = textInput(gText, {
  label: 'Treść napisu',
  value: 'Zosia',
  placeholder: 'np. Zosia\n(Enter = nowa linia)',
  multiline: true,
  onChange: regenDebounced,
})
const cFont = select(gText, {
  label: 'Krój pisma',
  options: fontOptions(),
  value: 'montserrat',
  onChange: regenDebounced,
})
const cAlign = select(gText, {
  label: 'Wyrównanie (dla wielu linii)',
  options: [
    { value: 'left', label: 'Do lewej' },
    { value: 'center', label: 'Do środka' },
    { value: 'right', label: 'Do prawej' },
  ],
  value: 'center',
  onChange: regenDebounced,
})

const gSize = group(controls, 'Wymiary')
const cHeight = slider(gSize, { label: 'Wysokość tekstu', min: 10, max: 80, step: 1, value: 30, onChange: regenDebounced })
const cThick = slider(gSize, { label: 'Grubość liter (wyciągnięcie)', min: 2, max: 20, step: 0.5, value: 8, onChange: regenDebounced })
const cSpacing = slider(gSize, { label: 'Odstęp liter', min: -2, max: 10, step: 0.5, value: 0, onChange: regenDebounced })

const gBase = group(controls, 'Podstawka')
const cBase = select(gBase, {
  label: 'Typ podstawki',
  options: [
    { value: 'none', label: 'Brak (same litery)' },
    { value: 'rect', label: 'Prostokąt' },
    { value: 'outline', label: 'Obrys liter' },
  ],
  value: 'rect',
  onChange: () => { updateVisibility(); regenDebounced() },
})
const cMargin = slider(gBase, { label: 'Margines', min: 2, max: 15, step: 0.5, value: 5, onChange: regenDebounced })
const cBaseThick = slider(gBase, { label: 'Grubość podstawki', min: 1, max: 8, step: 0.5, value: 4, onChange: regenDebounced })
const cRound = slider(gBase, { label: 'Zaokrąglenie rogów', min: 0, max: 10, step: 0.5, value: 3, onChange: regenDebounced })
const cHoles = checkbox(gBase, { label: 'Otwory do zawieszenia', value: false, onChange: regenDebounced })

const gOut = group(controls, 'Eksport')
const btn = button(gOut, {
  label: 'Pobierz STL',
  kind: 'primary',
  onClick: () => {
    if (!mesh) return
    downloadSTL(mesh, 'napis.stl')
    status('Zapisano napis.stl', 'ok')
  },
})
btn.disabled = true
const hint = document.createElement('p')
hint.className = 'hint'
hint.textContent = 'Druk na płasko: podstawka na stole, litery do góry. Po 2–3 warstwach podstawki możesz zmienić kolor filamentu, aby litery miały inny kolor niż tło.'
gOut.appendChild(hint)

function updateVisibility() {
  const base = cBase.value
  cMargin.el.style.display = base === 'none' ? 'none' : ''
  cBaseThick.el.style.display = base === 'none' ? 'none' : ''
  cRound.el.style.display = base === 'rect' ? '' : 'none'
  cHoles.el.style.display = base === 'none' ? 'none' : ''
}
updateVisibility()
regen()

// ── Generowanie ─────────────────────────────────────────────────────
async function regen() {
  const text = cText.value
  if (!text.trim()) {
    btn.disabled = true
    status('Wpisz tekst, aby wygenerować model.', 'info')
    return
  }
  status('Generuję napis…', 'busy')
  await nextFrame()
  try {
    const font = await loadFontSafe(cFont.value)
    const { geom, notes } = buildModel(font, text)
    mesh = new THREE.Mesh(geom, previewMaterial())
    viewer.setContent(mesh)
    viewer.fit()
    btn.disabled = false
    const s = sizeOf(geom)
    const tris = Math.round(geom.getAttribute('position').count / 3)
    let msg = `Gotowe — ${s.x.toFixed(0)} × ${s.y.toFixed(0)} × ${s.z.toFixed(1)} mm, ${tris.toLocaleString('pl-PL')} trójkątów.`
    if (cBase.value === 'none') {
      msg += ' Uwaga: bez podstawki litery mogą nie być ze sobą połączone — sprawdź przed drukiem.'
    }
    for (const n of notes) msg += ' ' + n
    status(msg, 'ok')
  } catch (e) {
    console.error(e)
    status('Błąd generowania: ' + e.message, 'error')
  }
}

/**
 * opentype.js nie wspiera części lookupów GSUB (np. Roboto rzuca wyjątkiem
 * przy prawie każdym słowie). Polskie znaki są prekomponowane, więc tablica
 * substytucji nie jest potrzebna — wyłączamy ją; kerning (GPOS/kern) zostaje.
 * Cache fontów jest per-strona, więc nie wpływa to na inne narzędzia.
 */
async function loadFontSafe(id) {
  const font = await loadFont(id)
  if (font.tables && font.tables.gsub) font.tables.gsub = undefined
  return font
}

/**
 * Buduje napis (Z-w-górę, mm): podstawka 0..grubośćPodstawki, litery
 * wyciągnięte do góry i zagłębione 0,1 mm w podstawkę (pewne połączenie,
 * bez z-fightingu). Całość wyśrodkowana i postawiona na z=0.
 */
function buildModel(font, text) {
  const baseType = cBase.value
  const letterT = cThick.value
  const margin = cMargin.value
  const baseT = cBaseThick.value
  const notes = []

  const { shapes, width, height } = textToShapes(font, text, cHeight.value, {
    letterSpacing: cSpacing.value,
    align: cAlign.value,
  })
  if (!shapes.length || width <= 0) throw new Error('tekst nie zawiera drukowalnych znaków')

  // Normalizacja konturów liter Clipperem: scala samoprzecinające się
  // obrysy glifów (np. „B", „8", „ą"), przez które ExtrudeGeometry
  // robiłaby nieszczelne bryły. Praca w skali ×10 zachowuje detale.
  const loops = []
  for (const s of shapes) {
    loops.push(scaleLoop(s.getPoints(24)))
    for (const h of s.holes) loops.push(scaleLoop(h.getPoints(24)))
  }
  const letterPolys = cleanPolygons(loops, { minArea: 0.2 * S * S })
  const letterShapes = polygonsToShapes(letterPolys)
  if (!letterShapes.length) throw new Error('tekst nie zawiera drukowalnych znaków')
  const letters = extrudeShapes(letterShapes, letterT, { curveSegments: 4 })
  letters.scale(1 / S, 1 / S, 1)

  if (baseType === 'none') return { geom: placeOnGround(letters), notes }

  letters.translate(0, 0, baseT - 0.1)

  let base
  if (baseType === 'rect') {
    const w = width + 2 * margin
    const h = height + 2 * margin
    const shape = roundedRectShape(w, h, cRound.value)
    if (cHoles.value) {
      if (w >= 2 * HOLE_INSET + 6 && h >= HOLE_INSET + 4.5) {
        for (const c of [
          { x: -w / 2 + HOLE_INSET, y: h / 2 - HOLE_INSET },
          { x: w / 2 - HOLE_INSET, y: h / 2 - HOLE_INSET },
        ]) {
          const hole = new THREE.Path()
          hole.absarc(c.x, c.y, HOLE_R, 0, Math.PI * 2, true)
          shape.holes.push(hole)
        }
      } else {
        notes.push('Podstawka jest za mała na otwory do zawieszenia — pominięto je.')
      }
    }
    base = extrudeShapes(shape, baseT)
  } else {
    base = buildOutlineBase(letterPolys, loops, margin, baseT, cHoles.value, notes)
  }

  return { geom: placeOnGround(mergeGeoms([base, letters])), notes }
}

/**
 * Podstawka „obrys": kontury liter + offset o margines (tekst jest już w mm,
 * więc delta offsetu też w mm — tu dodatkowo w skali ×10), scalone w pełne
 * pola pod literami. Otwory do zawieszenia dostają okrągłe „uszka" przy
 * skrajnych górnych punktach liter — zawsze trafiają w materiał i mają
 * ≥2,5 mm ścianki, a nie wchodzą pod litery.
 */
function buildOutlineBase(letterPolys, loops, margin, baseT, withHoles, notes) {
  const polys = offsetPolygons(letterPolys, margin * S)
  // obrys ma być pełny pod literami — odrzucamy kontrpętle (dziury liter)
  const solidLoops = clipperToPoints(polys).filter((l) => shoelace(l) > 0)
  if (!solidLoops.length) throw new Error('nie udało się wyznaczyć obrysu tekstu')

  let centers = null
  if (withHoles) {
    centers = outlineHoleCenters(loops, margin)
    for (const c of centers) solidLoops.push(circleLoop(c.x, c.y, PAD_R * S))
  }

  // union scala nachodzące obrysy (i uszka) w spójne pola
  const merged = cleanPolygons(solidLoops, { minArea: 0.2 * S * S })
  const baseShapes = polygonsToShapes(merged)
  if (!baseShapes.length) throw new Error('nie udało się wyznaczyć obrysu tekstu')
  if (baseShapes.length > 1) {
    notes.push(`Obrys składa się z ${baseShapes.length} rozłącznych części — zwiększ margines, aby je połączyć.`)
  }
  if (centers) {
    for (const c of centers) punchHole(baseShapes, c.x, c.y)
  }
  const geom = extrudeShapes(baseShapes, baseT, { curveSegments: 24 })
  geom.scale(1 / S, 1 / S, 1)
  return geom
}

/**
 * Środki otworów przy podstawce obrysowej: skrajne punkty liter
 * w kierunkach ↖ i ↗, odsunięte po przekątnej w pas marginesu
 * (ale co najmniej tak, by otwór nie wszedł pod litery).
 */
function outlineHoleCenters(loops, margin) {
  let pl = null
  let pr = null
  let vl = -Infinity
  let vr = -Infinity
  for (const loop of loops) {
    for (const p of loop) {
      if (p.y - p.x > vl) { vl = p.y - p.x; pl = p }
      if (p.y + p.x > vr) { vr = p.y + p.x; pr = p }
    }
  }
  const d = Math.max(margin / 2, HOLE_R + 0.4) * S * Math.SQRT1_2
  return [
    { x: pl.x - d, y: pl.y + d },
    { x: pr.x + d, y: pr.y + d },
  ]
}

/** Dodaje okrągłą dziurę do tego kształtu z listy, który zawiera jej środek. */
function punchHole(shapes, cx, cy) {
  for (const s of shapes) {
    if (!pointInLoop({ x: cx, y: cy }, s.getPoints(4))) continue
    const hole = new THREE.Path()
    hole.absarc(cx, cy, HOLE_R * S, 0, Math.PI * 2, true)
    s.holes.push(hole)
    return true
  }
  return false
}

// ── Pomocnicze 2D ───────────────────────────────────────────────────
function scaleLoop(pts) {
  return pts.map((p) => ({ x: p.x * S, y: p.y * S }))
}

function circleLoop(cx, cy, r, n = 36) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  }
  return pts
}

function pointInLoop(pt, loop) {
  let inside = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]
    const b = loop[j]
    if ((a.y > pt.y) !== (b.y > pt.y) &&
        pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

function shoelace(loop) {
  let a = 0
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]
    const q = loop[(i + 1) % loop.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}
