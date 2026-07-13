import * as THREE from 'three'
import { createViewer, previewMaterial } from '../core/viewer.js'
import { downloadSTL } from '../core/stl.js'
import {
  getToolLayout, group, slider, checkbox, select, button, fileDrop,
  makeStatus, debounce, nextFrame,
} from '../core/ui.js'

const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)
const viewer = createViewer(viewerEl)

let imageData = null // ImageData wybranego zdjęcia
let mesh = null

const regenDebounced = debounce(regen, 300)

// ── Panel ───────────────────────────────────────────────────────────
const gFile = group(controls, 'Zdjęcie')
fileDrop(gFile, {
  label: 'Wgraj zdjęcie',
  accept: 'image/*',
  hint: 'JPG / PNG — nic nie jest wysyłane',
  onFile: async (file) => {
    try {
      const bmp = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      const maxDim = 1024
      const s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
      canvas.width = Math.round(bmp.width * s)
      canvas.height = Math.round(bmp.height * s)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      regen()
    } catch {
      status('Nie udało się odczytać tego pliku graficznego.', 'error')
    }
  },
})

const gSize = group(controls, 'Wymiary')
const cWidth = slider(gSize, { label: 'Szerokość', min: 40, max: 250, step: 1, value: 100, onChange: regenDebounced })
const cMin = slider(gSize, { label: 'Grubość minimalna (jasne partie)', min: 0.4, max: 2, step: 0.1, value: 0.8, onChange: regenDebounced })
const cMax = slider(gSize, { label: 'Grubość maksymalna (cienie)', min: 1.5, max: 6, step: 0.1, value: 3.2, onChange: regenDebounced })
const cRes = slider(gSize, { label: 'Rozdzielczość', min: 2, max: 6, step: 0.5, value: 4, unit: 'px/mm', onChange: regenDebounced })

const gStyle = group(controls, 'Styl')
const cShape = select(gStyle, {
  label: 'Kształt',
  options: [
    { value: 'flat', label: 'Płaska tabliczka' },
    { value: 'arc', label: 'Łuk (stoi sama)' },
  ],
  value: 'flat',
  onChange: regenDebounced,
})
const cArc = slider(gStyle, { label: 'Kąt łuku', min: 40, max: 180, step: 5, value: 90, unit: '°', onChange: regenDebounced })
const cFrame = slider(gStyle, { label: 'Ramka', min: 0, max: 8, step: 0.5, value: 2, onChange: regenDebounced })
const cInvert = checkbox(gStyle, { label: 'Negatyw (odwróć jasność)', value: false, onChange: regenDebounced })

const gOut = group(controls, 'Eksport')
const btn = button(gOut, {
  label: 'Pobierz STL',
  kind: 'primary',
  onClick: () => {
    if (!mesh) return
    downloadSTL(mesh, 'litofania.stl')
    status('Zapisano litofania.stl', 'ok')
  },
})
btn.disabled = true
const hint = document.createElement('p')
hint.className = 'hint'
hint.textContent = 'Wskazówka: drukuj pionowo (obraz do przodu), 100% wypełnienia, jasny filament. Światło od tyłu ujawni zdjęcie.'
gOut.appendChild(hint)

status('Wgraj zdjęcie, aby zacząć.', 'info')

// ── Generowanie ─────────────────────────────────────────────────────
async function regen() {
  if (!imageData) return
  status('Generuję litofanię…', 'busy')
  await nextFrame()
  try {
    const geom = buildLithophane()
    mesh = new THREE.Mesh(geom, previewMaterial())
    viewer.setContent(mesh)
    viewer.fit()
    btn.disabled = false
    const tris = geom.getIndex() ? geom.getIndex().count / 3 : geom.getAttribute('position').count / 3
    status(`Gotowe — ${Math.round(tris / 1000)}k trójkątów. Możesz pobrać STL.`, 'ok')
  } catch (e) {
    console.error(e)
    status('Błąd generowania: ' + e.message, 'error')
  }
}

/**
 * Buduje siatkę litofanii (Z-w-górę): obraz w płaszczyźnie XZ,
 * grubość wzdłuż Y (przód Y=0 płaski, tył wytłaczany wg jasności).
 * Wersja płaska lub zgięta w łuk wokół pionowej osi.
 */
function buildLithophane() {
  const widthMm = cWidth.value
  const tMin = cMin.value
  const tMax = Math.max(cMax.value, tMin + 0.2)
  const frame = cFrame.value
  const res = cRes.value
  const invert = cInvert.value
  const arc = cShape.value === 'arc'
  const arcAngle = (cArc.value * Math.PI) / 180

  const imgW = imageData.width
  const imgH = imageData.height
  const heightMm = (widthMm * imgH) / imgW

  const nx = Math.max(8, Math.round(widthMm * res))
  const nz = Math.max(8, Math.round(heightMm * res))

  // luminancja siatki (uśrednianie obszarowe)
  const lum = new Float32Array(nx * nz)
  const { data } = imageData
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = Math.floor((i / nx) * imgW)
      const x1 = Math.max(x0 + 1, Math.floor(((i + 1) / nx) * imgW))
      const y0 = Math.floor((j / nz) * imgH)
      const y1 = Math.max(y0 + 1, Math.floor(((j + 1) / nz) * imgH))
      let sum = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const k = (y * imgW + x) * 4
          const a = data[k + 3] / 255
          const l = (0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]) / 255
          sum += l * a + (1 - a) // przezroczyste = białe
          n++
        }
      }
      let l = sum / n
      if (invert) l = 1 - l
      // obraz w pamięci ma Y w dół — odwracamy wiersze, żeby góra była na górze
      lum[(nz - 1 - j) * nx + i] = l
    }
  }

  const frameCells = frame > 0 ? Math.max(1, Math.round(frame * res)) : 0
  const NX = nx + frameCells * 2
  const NZ = nz + frameCells * 2
  const frameT = Math.min(tMax + 0.4, 6.5)

  const thick = (i, j) => {
    const ii = i - frameCells
    const jj = j - frameCells
    if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) return frameT
    // ciemne = grube (zatrzymuje światło)
    return tMin + (1 - lum[jj * nx + ii]) * (tMax - tMin)
  }

  const totalW = widthMm + frameCells * 2 / res
  const totalH = heightMm + frameCells * 2 / res
  const dx = totalW / (NX - 1)
  const dz = totalH / (NZ - 1)

  // pozycje: przód Y=0, tył Y=+grubość; łuk zgina wokół pionowej osi Z
  const R = arc ? totalW / arcAngle : 0
  const posOf = (i, j, y) => {
    const x = -totalW / 2 + i * dx
    const z = j * dz
    if (!arc) return [x, y, z]
    const theta = (x / totalW) * arcAngle
    const r = R + y
    return [Math.sin(theta) * r, R - Math.cos(theta) * r, z]
  }

  const positions = []
  const indices = []
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) positions.push(...posOf(i, j, 0))
  }
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) positions.push(...posOf(i, j, thick(i, j)))
  }
  const F = (i, j) => j * NX + i
  const B = (i, j) => NX * NZ + j * NX + i
  for (let j = 0; j < NZ - 1; j++) {
    for (let i = 0; i < NX - 1; i++) {
      // przód (patrzy na -Y / na zewnątrz łuku)
      indices.push(F(i, j), F(i + 1, j), F(i + 1, j + 1))
      indices.push(F(i, j), F(i + 1, j + 1), F(i, j + 1))
      // tył
      indices.push(B(i, j), B(i + 1, j + 1), B(i + 1, j))
      indices.push(B(i, j), B(i, j + 1), B(i + 1, j + 1))
    }
  }
  // ścianki: dół, góra, lewa, prawa
  for (let i = 0; i < NX - 1; i++) {
    indices.push(F(i, 0), B(i, 0), B(i + 1, 0))
    indices.push(F(i, 0), B(i + 1, 0), F(i + 1, 0))
    indices.push(F(i, NZ - 1), B(i + 1, NZ - 1), B(i, NZ - 1))
    indices.push(F(i, NZ - 1), F(i + 1, NZ - 1), B(i + 1, NZ - 1))
  }
  for (let j = 0; j < NZ - 1; j++) {
    indices.push(F(0, j), B(0, j + 1), B(0, j))
    indices.push(F(0, j), F(0, j + 1), B(0, j + 1))
    indices.push(F(NX - 1, j), B(NX - 1, j), B(NX - 1, j + 1))
    indices.push(F(NX - 1, j), B(NX - 1, j + 1), F(NX - 1, j + 1))
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  return geom
}
