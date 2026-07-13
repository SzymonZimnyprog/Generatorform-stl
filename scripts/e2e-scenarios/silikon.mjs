// Scenariusz E2E: wanna do silikonu — kula ⌀30 → otwarty pojemnik (± model na dnie).
export async function scenario(page, ctx) {
  await page.locator('input[type=file]').setInputFiles({
    name: 'model.stl', mimeType: 'model/stl', buffer: ctx.makeTestSTLBuffer(),
  })
  await ctx.waitReady(page)

  // wariant 1: domyślne z modelem na dnie — zewnętrznie 54.8×54.8×43
  const v1 = await ctx.downloadFromButton(page)
  const s1 = ctx.validateSTL(v1.buffer)
  const near = (a, b, tol) => Math.abs(a - b) <= tol
  if (!near(s1.size.x, 54.8, 1)) throw new Error(`szerokość ${s1.size.x.toFixed(1)} ≠ 54.8 (30 + 2×10 + 2×2.4)`)
  if (!near(s1.size.z, 43, 1)) throw new Error(`wysokość ${s1.size.z.toFixed(1)} ≠ 43 (dno 3 + model 30 + zapas 10)`)
  if (s1.degenerate / s1.triangles > 0.05) throw new Error(`za dużo zdegenerowanych: ${s1.degenerate}`)

  // wariant 2: bez modelu — te same wymiary, mniej trójkątów
  await page.locator('input[type=checkbox]').first().uncheck()
  await page.waitForTimeout(700)
  await ctx.waitReady(page)
  const v2 = await ctx.downloadFromButton(page)
  const s2 = ctx.validateSTL(v2.buffer)
  if (!near(s2.size.x, 54.8, 1) || !near(s2.size.z, 43, 1)) {
    throw new Error(`wymiary pustej wanny ${s2.size.x.toFixed(1)}×${s2.size.z.toFixed(1)} ≠ 54.8×43`)
  }
  if (s2.triangles >= s1.triangles) {
    throw new Error(`wanna bez modelu powinna mieć mniej trójkątów (${s2.triangles} ≥ ${s1.triangles})`)
  }
  return [v1, v2]
}
