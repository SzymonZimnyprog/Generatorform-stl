// Scenariusz E2E: forma — wgraj STL, wygeneruj dwuczęściową formę, pobierz i zweryfikuj wymiary.
// Oczekiwane wymiary liczone są z pomiaru modelu wejściowego i ustawień:
//   pudełko = (W+2s) × (D+2s) × (Hm+dno+góra); połówki po obrocie leżą płaszczyzną
//   podziału do góry, obok siebie (odstęp 2×8 mm); zamki (promień r) wystają z połówki A.
import { join } from 'node:path'

export async function scenario(page, ctx) {
  const stl = ctx.makeTestSTLBuffer()
  const src = ctx.validateSTL(stl)
  const longest = Math.max(src.size.x, src.size.y, src.size.z)

  const expectNear = (name, actual, expected, tol) => {
    if (Math.abs(actual - expected) > tol) {
      throw new Error(`${name}: ${actual.toFixed(2)} ≠ oczekiwane ${expected.toFixed(2)} ±${tol}`)
    }
  }
  const expectQuality = (name, s) => {
    if (s.triangles <= 0) throw new Error(`${name}: brak trójkątów`)
    if (s.degenerate >= 0.05 * s.triangles) {
      throw new Error(`${name}: ${s.degenerate} zdegenerowanych trójkątów (≥5% z ${s.triangles})`)
    }
  }
  // wymiary pudełka formy dla docelowego wymiaru `target` i ścianek s=8, dna/góry=8
  const boxFor = (target) => {
    const k = target / longest
    return { w: src.size.x * k + 16, d: src.size.y * k + 16, h: src.size.z * k + 16 }
  }

  await page.locator('input[type=file]').setInputFiles({
    name: 'model.stl', mimeType: 'model/stl', buffer: stl,
  })
  await ctx.waitReady(page)

  // ── Wariant 1: ustawienia domyślne (ścianki 8, dno/góra 8, zamki wł., promień 3)
  const t1 = Math.min(150, Math.max(10, Math.round(longest))) // narzędzie ustawia cel = oryginał
  const b1 = boxFor(t1)
  const lockR = 3

  // zrzut wariantu 1 (z zamkami) do oceny wizualnej
  await page.screenshot({ path: join(ctx.outDir, 'forma-wariant1.png') })

  const both1 = await ctx.downloadFromButton(page)
  const halfA1 = await ctx.downloadFromButton(page, 'Pobierz połówkę A')
  const halfB1 = await ctx.downloadFromButton(page, 'Pobierz połówkę B')

  const sBoth1 = ctx.validateSTL(both1.buffer)
  const sA1 = ctx.validateSTL(halfA1.buffer)
  const sB1 = ctx.validateSTL(halfB1.buffer)
  expectQuality('forma (obie połówki)', sBoth1)
  expectQuality('połówka A', sA1)
  expectQuality('połówka B', sB1)

  // obie połówki obok siebie: 2 × szerokość pudełka + 2 × 8 mm odstępu
  expectNear('W1 forma: szerokość X', sBoth1.size.x, 2 * b1.w + 16, 6)
  expectNear('W1 forma: głębokość Y', sBoth1.size.y, b1.h, 2) // po obrocie: dawna wysokość
  expectNear('W1 forma: wysokość Z (połówka + zamki)', sBoth1.size.z, b1.d / 2 + lockR, 2)

  // połówka A: pudełko/2 po obrocie + wystające zamki
  expectNear('W1 połówka A: X', sA1.size.x, b1.w, 2)
  expectNear('W1 połówka A: Y', sA1.size.y, b1.h, 2)
  expectNear('W1 połówka A: Z (zamki wystają)', sA1.size.z, b1.d / 2 + lockR, 2)
  if (sA1.triangles <= 800) throw new Error(`W1 połówka A: za mało trójkątów (${sA1.triangles} ≤ 800)`)

  // połówka B: wgłębienia zamiast wypustek — nic nie wystaje ponad płaszczyznę podziału
  expectNear('W1 połówka B: Z (bez wypustek)', sB1.size.z, b1.d / 2, 2)

  // ── Wariant 2: bez zamków, docelowy najdłuższy wymiar 20 mm
  await page.locator('input[type=checkbox]').first().uncheck()
  const targetInput = page.locator('input[type=number]').first()
  await targetInput.fill('20')
  await targetInput.evaluate((el) => el.dispatchEvent(new Event('change')))
  await page.waitForTimeout(700) // debounce 300 ms
  await ctx.waitReady(page)

  const b2 = boxFor(20)
  const both2 = await ctx.downloadFromButton(page)
  const sBoth2 = ctx.validateSTL(both2.buffer)
  expectQuality('W2 forma (obie połówki)', sBoth2)
  expectNear('W2 forma: szerokość X', sBoth2.size.x, 2 * b2.w + 16, 6)
  expectNear('W2 forma: głębokość Y', sBoth2.size.y, b2.h, 2)
  expectNear('W2 forma: wysokość Z (bez zamków)', sBoth2.size.z, b2.d / 2, 2)
  if (sBoth2.size.x >= sBoth1.size.x) {
    throw new Error('W2: forma dla mniejszego modelu nie jest mniejsza od W1')
  }

  return [both1, halfA1, halfB1, both2]
}
