// Scenariusz E2E: stempel — polskie znaki, prostokąt+uchwyt, koło bez uchwytu,
// oraz kontrola symetrii lustrzanego odbicia.
export async function scenario(page, ctx) {
  // Poczekaj na pierwszą generację (domyślne "ANIA"), żeby nie łapać starych statusów.
  await ctx.waitReady(page)

  // Wariant 1: „Żółć" (polskie znaki), prostokąt + uchwyt + lustro (domyślne).
  await page.locator('#controls textarea').fill('Żółć')
  await page.waitForTimeout(700) // debounce
  await ctx.waitReady(page)
  const mirrored = await ctx.downloadFromButton(page)

  // Ten sam tekst bez lustra — szerokość STL musi zostać (symetria odbicia).
  const mirrorBox = page.locator('#controls input[type=checkbox]').nth(0)
  await mirrorBox.setChecked(false)
  await page.waitForTimeout(700)
  await ctx.waitReady(page)
  const plain = await ctx.downloadFromButton(page)

  // Wariant 2: koło, bez uchwytu, bez lustra.
  await page.locator('#controls select').nth(1).selectOption('circle')
  await page.locator('#controls input[type=checkbox]').nth(1).setChecked(false)
  await page.waitForTimeout(700)
  await ctx.waitReady(page)
  const round = await ctx.downloadFromButton(page)

  const s1 = ctx.validateSTL(mirrored.buffer)
  const s2 = ctx.validateSTL(plain.buffer)
  const s3 = ctx.validateSTL(round.buffer)

  // Wariant 1: szczelność i pełna wysokość (relief 1.5 + płytka 4 + uchwyt 22 + kulka ø14).
  if (s1.openEdges > 0) throw new Error(`stempel z uchwytem nie jest szczelny (${s1.openEdges} otwartych krawędzi)`)
  const h1 = 1.5 + 4 + 22 + 14
  if (Math.abs(s1.size.z - h1) > 3) throw new Error(`wysokość ${s1.size.z.toFixed(1)} ≠ ~${h1} mm (relief+płytka+uchwyt+kulka)`)
  if (s1.bbox.min[2] < -0.01) throw new Error(`model schodzi pod stół (min z = ${s1.bbox.min[2]})`)

  // Symetria lustra: szerokość z odbiciem ≈ bez odbicia.
  if (Math.abs(s1.size.x - s2.size.x) > 0.3) {
    throw new Error(`lustro zmienia szerokość: ${s1.size.x.toFixed(2)} vs ${s2.size.x.toFixed(2)} mm`)
  }

  // Wariant 2: tylko relief + płytka (1.5 + 4), okrągła podstawa.
  if (s3.openEdges > 0) throw new Error(`stempel okrągły nie jest szczelny (${s3.openEdges} otwartych krawędzi)`)
  if (Math.abs(s3.size.z - 5.5) > 0.5) throw new Error(`wysokość ${s3.size.z.toFixed(2)} ≠ ~5.5 mm (relief+płytka)`)
  if (Math.abs(s3.size.x - s3.size.y) > 0.5) throw new Error(`płytka nie jest kołem: ${s3.size.x.toFixed(1)}×${s3.size.y.toFixed(1)} mm`)
  // Średnica koła = przekątna tekstu + 2·margines — musi być większa niż sam tekst.
  if (s3.size.x < s2.size.x) throw new Error('koło mniejsze niż prostokątna płytka z tym samym tekstem')

  return [mirrored, round]
}
