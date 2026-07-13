// Scenariusz E2E: dzielenie modelu — kula ⌀30 cięta płaszczyzną prostopadłą do Z.
// Wariant 1 (domyślne: Z, 50%, kołki ⌀4×10, luz 0.25): dwie kopuły 30×30×15
// obok siebie (odstęp 10 mm) + 2 dyble leżące z przodu.
// Wariant 2 (cięcie 30%, bez kołków): grubości części 9 i 21 → bbox.z ≈ 21.
import { join } from 'node:path'

export async function scenario(page, ctx) {
  const near = (a, b, tol) => Math.abs(a - b) <= tol
  const quality = (name, s) => {
    if (s.triangles <= 0) throw new Error(`${name}: brak trójkątów`)
    if (s.degenerate / s.triangles >= 0.05) {
      throw new Error(`${name}: zdegenerowane ${s.degenerate}/${s.triangles} (≥5%)`)
    }
  }

  await page.locator('input[type=file]').setInputFiles({
    name: 'model.stl', mimeType: 'model/stl', buffer: ctx.makeTestSTLBuffer(),
  })
  await ctx.waitReady(page)

  // ── Wariant 1: ustawienia domyślne (oś Z, 50%, kołki włączone)
  const v1 = await ctx.downloadFromButton(page)
  const s1 = ctx.validateSTL(v1.buffer)
  quality('W1 komplet', s1)
  if (s1.size.x < 68 || s1.size.x > 85) {
    throw new Error(`W1: szerokość X ${s1.size.x.toFixed(1)} poza 68–85 (2×30 + odstęp 10, dyble z przodu)`)
  }
  if (!near(s1.size.z, 15, 1)) throw new Error(`W1: wysokość Z ${s1.size.z.toFixed(1)} ≠ 15 ±1`)
  if (s1.size.y <= 31) {
    throw new Error(`W1: głębokość Y ${s1.size.y.toFixed(1)} ≤ 31 — brak dybli przed częściami?`)
  }
  if (s1.triangles < 300) throw new Error(`W1: podejrzanie mało trójkątów (${s1.triangles})`)

  // część A osobno: kopuła 30×30×15 (gniazda kołków nie zmieniają bboxa)
  const a1 = await ctx.downloadFromButton(page, 'Pobierz część A')
  const sa1 = ctx.validateSTL(a1.buffer)
  quality('W1 część A', sa1)
  if (!near(sa1.size.x, 30, 1) || !near(sa1.size.y, 30, 1) || !near(sa1.size.z, 15, 1)) {
    throw new Error(
      `W1 część A: ${sa1.size.x.toFixed(1)}×${sa1.size.y.toFixed(1)}×${sa1.size.z.toFixed(1)} ≠ 30×30×15 ±1`,
    )
  }

  await page.screenshot({ path: join(ctx.outDir, 'podzial-wariant1.png') })

  // ── Wariant 2: cięcie na 30% wysokości, bez kołków
  await page.locator('input[type=checkbox]').first().uncheck()
  const posInput = page.locator('input[type=number]').nth(1) // „Pozycja cięcia"
  await posInput.fill('30')
  await posInput.evaluate((el) => el.dispatchEvent(new Event('change')))
  await page.waitForTimeout(800) // debounce 300 ms
  await ctx.waitReady(page)

  const v2 = await ctx.downloadFromButton(page)
  const s2 = ctx.validateSTL(v2.buffer)
  quality('W2 komplet', s2)
  // po obróceniu i położeniu na stole wysokości części = ich grubości: 9 i 21
  if (!near(s2.size.z, 21, 1)) throw new Error(`W2: wysokość Z ${s2.size.z.toFixed(1)} ≠ 21 ±1 (grubsza część)`)
  // czapka ⌀~27 + odstęp 10 + kopuła ⌀30 ≈ 67; bez dybli z przodu → Y ≈ 30
  if (s2.size.x < 63 || s2.size.x > 71) throw new Error(`W2: szerokość X ${s2.size.x.toFixed(1)} poza 63–71`)
  if (!near(s2.size.y, 30, 1)) throw new Error(`W2: głębokość Y ${s2.size.y.toFixed(1)} ≠ 30 ±1 (dyble miały zniknąć)`)

  // część A osobno: czapka kuli grubości 9
  const a2 = await ctx.downloadFromButton(page, 'Pobierz część A')
  const sa2 = ctx.validateSTL(a2.buffer)
  quality('W2 część A', sa2)
  if (!near(sa2.size.z, 9, 1)) throw new Error(`W2 część A: wysokość ${sa2.size.z.toFixed(1)} ≠ 9 ±1`)
  if (!near(sa2.size.x, 27.2, 1.5)) throw new Error(`W2 część A: szerokość ${sa2.size.x.toFixed(1)} ≠ ~27.2 ±1.5`)

  return [v1, a1, v2, a2]
}
