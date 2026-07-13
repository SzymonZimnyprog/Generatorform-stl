// Scenariusz E2E: doniczka — STL (kula ⌀30) → doniczka z odpływem.
export async function scenario(page, ctx) {
  await page.locator('input[type=file]').setInputFiles({
    name: 'model.stl', mimeType: 'model/stl', buffer: ctx.makeTestSTLBuffer(),
  })
  await ctx.waitReady(page)

  // wariant 1: wysokość 60 (kula 30 → skala 2×, ⌀ 60), ścięcie 95%, 1 otwór
  const h = page.locator('input[type=number]').nth(0)
  await h.fill('60')
  await h.evaluate((el) => el.dispatchEvent(new Event('change')))
  await page.waitForTimeout(700)
  await ctx.waitReady(page)
  const v1 = await ctx.downloadFromButton(page)
  const s1 = ctx.validateSTL(v1.buffer)
  if (Math.abs(s1.size.z - 57) > 1.5) throw new Error(`wysokość ${s1.size.z.toFixed(1)} ≠ ~57 (60 · 95%)`)
  if (Math.abs(s1.size.x - 60) > 3) throw new Error(`szerokość ${s1.size.x.toFixed(1)} ≠ ~60`)
  if (s1.triangles < 400) throw new Error(`za mało trójkątów: ${s1.triangles}`)
  if (s1.degenerate / s1.triangles > 0.05) throw new Error(`za dużo zdegenerowanych: ${s1.degenerate}`)

  // wariant 2: 3 otwory, grubsza ścianka
  await page.locator('select').first().selectOption('3')
  const wall = page.locator('input[type=number]').nth(1)
  await wall.fill('5')
  await wall.evaluate((el) => el.dispatchEvent(new Event('change')))
  await page.waitForTimeout(700)
  await ctx.waitReady(page)
  const v2 = await ctx.downloadFromButton(page)
  const s2 = ctx.validateSTL(v2.buffer)
  if (s2.triangles <= s1.triangles) {
    throw new Error(`3 otwory powinny dać więcej trójkątów (${s2.triangles} ≤ ${s1.triangles})`)
  }
  return [v1, v2]
}
