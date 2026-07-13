// E2E: buduje aplikację nie trzeba — serwuje dist/ i klika w narzędzie w Chromium.
// Użycie: node scripts/e2e.mjs <narzędzie> [narzędzie…]   (bez argumentów = wszystkie)
// Wymaga wcześniejszego `npm run build`. Zrzuty i STL trafiają do scripts/e2e-out/.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSTL } from './stl-check.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, process.env.DIST || 'dist')
const outDir = join(root, 'scripts', 'e2e-out')
mkdirSync(outDir, { recursive: true })

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml',
}

function serve() {
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (path.endsWith('/')) path += 'index.html'
    const file = join(dist, path)
    if (!existsSync(file)) { res.writeHead(404); res.end('not found ' + path); return }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  return new Promise((resolve) => server.listen(0, () => resolve(server)))
}

// ── Pomocnicze zasoby testowe ───────────────────────────────────────

/** PNG z prostym kształtem (serce) — do wykrawacza/stempla/litofanii. */
export async function makeTestPNG(browser, { size = 240, gradient = false } = {}) {
  const page = await browser.newPage()
  const dataUrl = await page.evaluate(({ size, gradient }) => {
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    if (gradient) {
      const g = ctx.createLinearGradient(0, 0, size, size)
      g.addColorStop(0, '#000')
      g.addColorStop(1, '#fff')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = '#333'
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size / 4, 0, Math.PI * 2)
      ctx.fill()
    } else {
      // serce
      ctx.fillStyle = '#000'
      ctx.beginPath()
      const s = size / 240
      ctx.moveTo(120 * s, 210 * s)
      ctx.bezierCurveTo(40 * s, 150 * s, 20 * s, 90 * s, 70 * s, 60 * s)
      ctx.bezierCurveTo(100 * s, 42 * s, 120 * s, 70 * s, 120 * s, 90 * s)
      ctx.bezierCurveTo(120 * s, 70 * s, 140 * s, 42 * s, 170 * s, 60 * s)
      ctx.bezierCurveTo(220 * s, 90 * s, 200 * s, 150 * s, 120 * s, 210 * s)
      ctx.fill()
    }
    return c.toDataURL('image/png')
  }, { size, gradient })
  await page.close()
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

/** Mały STL (kula ze spłaszczonym dołem) — do formy/doniczki. */
export function makeTestSTLBuffer() {
  const R = 15
  const rings = 12
  const segs = 16
  const pts = []
  // czasza od dołu (spłaszczona) do góry
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI
    for (let j = 0; j < segs; j++) {
      const th = (j / segs) * 2 * Math.PI
      pts.push([
        R * Math.sin(phi) * Math.cos(th),
        R * Math.sin(phi) * Math.sin(th),
        R - R * Math.cos(phi),
      ])
    }
  }
  const tris = []
  const at = (i, j) => pts[i * segs + (j % segs)]
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = at(i, j)
      const b = at(i + 1, j)
      const c = at(i + 1, j + 1)
      const d = at(i, j + 1)
      // na biegunach pomijamy zdegenerowane trójkąty (pierścień = punkt);
      // kolejność wierzchołków tak, by normalne wskazywały NA ZEWNĄTRZ
      if (i < rings - 1) tris.push([a, c, b])
      if (i > 0) tris.push([a, d, c])
    }
  }
  const buf = Buffer.alloc(84 + tris.length * 50)
  buf.writeUInt32LE(tris.length, 80)
  let off = 84
  for (const t of tris) {
    off += 12 // normalna 0,0,0 — loadery liczą same
    for (const [x, y, z] of t) {
      buf.writeFloatLE(x, off)
      buf.writeFloatLE(y, off + 4)
      buf.writeFloatLE(z, off + 8)
      off += 12
    }
    off += 2
  }
  return buf
}

/** Czeka aż status pokaże sukces (status-ok) lub błąd — zwraca tekst. */
export async function waitReady(page, timeout = 60000) {
  const el = page.locator('#status')
  await page.waitForFunction(
    () => {
      const s = document.getElementById('status')
      return s && (s.className.includes('status-ok') || s.className.includes('status-error'))
    },
    { timeout },
  )
  const cls = await el.getAttribute('class')
  const text = await el.textContent()
  if (cls.includes('status-error')) throw new Error('Narzędzie zgłosiło błąd: ' + text)
  return text
}

/** Klika przycisk pobierania i zwraca bufor pobranego STL. */
export async function downloadFromButton(page, label = 'Pobierz STL') {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.getByRole('button', { name: label }).first().click(),
  ])
  const path = await download.path()
  return { buffer: readFileSync(path), filename: download.suggestedFilename() }
}

// ── Uruchomienie scenariuszy ────────────────────────────────────────
async function main() {
  const scenDir = join(root, 'scripts', 'e2e-scenarios')
  let names = process.argv.slice(2)
  if (!names.length) {
    names = readdirSync(scenDir).filter((f) => f.endsWith('.mjs')).map((f) => f.replace('.mjs', ''))
  }
  const server = await serve()
  const port = server.address().port
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  })
  let failures = 0

  for (const name of names) {
    const t0 = Date.now()
    process.stdout.write(`▶ ${name} … `)
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    try {
      const { scenario } = await import(join(scenDir, name + '.mjs'))
      await page.goto(`http://127.0.0.1:${port}/${name}.html`)
      const ctx = {
        browser, port, outDir,
        makeTestPNG: (opts) => makeTestPNG(browser, opts),
        makeTestSTLBuffer, waitReady, downloadFromButton, validateSTL,
      }
      const results = await scenario(page, ctx)
      await page.screenshot({ path: join(outDir, name + '.png') })
      for (const [i, r] of (results || []).entries()) {
        if (r?.buffer) {
          writeFileSync(join(outDir, `${name}-${i}.stl`), r.buffer)
          const stats = validateSTL(r.buffer)
          console.log(`\n   STL[${i}] ${r.filename}: ${stats.triangles} trójkątów, ` +
            `wymiary ${stats.size.x.toFixed(1)}×${stats.size.y.toFixed(1)}×${stats.size.z.toFixed(1)} mm, ` +
            `krawędzie otwarte: ${stats.openEdges}, zdeg.: ${stats.degenerate}`)
        }
      }
      if (errors.length) console.log(`   ⚠ błędy konsoli: ${errors.slice(0, 3).join(' | ').slice(0, 300)}`)
      console.log(`   ✔ OK (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
    } catch (e) {
      failures++
      await page.screenshot({ path: join(outDir, name + '-FAIL.png') }).catch(() => {})
      console.log(`\n   ✘ BŁĄD: ${e.message}`)
      if (errors.length) console.log(`   konsola: ${errors.slice(0, 5).join(' | ').slice(0, 500)}`)
    }
    await page.close()
  }
  await browser.close()
  server.close()
  console.log(failures ? `\n${failures} scenariuszy padło` : '\nWszystkie scenariusze przeszły ✔')
  process.exit(failures ? 1 : 0)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) main()
