// Scenariusz E2E: forma do laminowania — kula ⌀30 → negatyw i pozytyw.
export async function scenario(page, ctx) {
  await page.locator('input[type=file]').setInputFiles({
    name: 'model.stl', mimeType: 'model/stl', buffer: ctx.makeTestSTLBuffer(),
  })
  await ctx.waitReady(page)

  // wariant 1: negatyw, głębokość 50% — blok 50×50×20 z półkulistą wnęką
  const v1 = await ctx.downloadFromButton(page)
  const s1 = ctx.validateSTL(v1.buffer)
  const near = (a, b, tol) => Math.abs(a - b) <= tol
  if (!near(s1.size.x, 50, 1) || !near(s1.size.y, 50, 1)) {
    throw new Error(`podstawa ${s1.size.x.toFixed(1)}×${s1.size.y.toFixed(1)} ≠ 50×50 (model 30 + 2×kołnierz 10)`)
  }
  if (!near(s1.size.z, 20, 1)) throw new Error(`wysokość ${s1.size.z.toFixed(1)} ≠ 20 (dno 5 + 50% z 30)`)
  // pudełko bez wnęki to 12 trójkątów — wnęka z niskopoligonowej kuli daje ~200+
  if (s1.triangles < 100) throw new Error(`za mało trójkątów na wnękę: ${s1.triangles}`)
  if (s1.degenerate / s1.triangles > 0.05) throw new Error(`za dużo zdegenerowanych: ${s1.degenerate}`)

  // wariant 2: pozytyw — płyta 50×50×5 + kula na wierzchu (wys. ~35)
  await page.locator('select').first().selectOption('pozytyw')
  await page.waitForTimeout(700)
  await ctx.waitReady(page)
  const v2 = await ctx.downloadFromButton(page)
  const s2 = ctx.validateSTL(v2.buffer)
  if (!near(s2.size.z, 35, 1)) throw new Error(`wysokość kopyta ${s2.size.z.toFixed(1)} ≠ ~35 (płyta 5 + kula 30)`)
  if (!near(s2.size.x, 50, 1)) throw new Error(`szerokość płyty ${s2.size.x.toFixed(1)} ≠ 50`)
  return [v1, v2]
}
