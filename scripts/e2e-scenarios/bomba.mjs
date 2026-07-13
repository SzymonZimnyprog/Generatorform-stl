// Scenariusz E2E: forma do bomb kąpielowych — parametryczna, generuje się od razu.
export async function scenario(page, ctx) {
  // wariant 1: domyślne ⌀55 — dwie czasze ⌀79 obok siebie, wysokość 29.5
  await ctx.waitReady(page)
  const v1 = await ctx.downloadFromButton(page)
  const s1 = ctx.validateSTL(v1.buffer)
  const near = (a, b, tol) => Math.abs(a - b) <= tol
  if (!near(s1.size.x, 170, 2)) throw new Error(`szerokość ${s1.size.x.toFixed(1)} ≠ ~170 (2 połówki ⌀79 + odstęp)`)
  if (!near(s1.size.z, 29.5, 1)) throw new Error(`wysokość ${s1.size.z.toFixed(1)} ≠ 29.5 (promień 27.5 + ścianka 2)`)
  if (s1.degenerate / s1.triangles > 0.05) throw new Error(`za dużo zdegenerowanych: ${s1.degenerate}`)

  // wariant 2: ⌀40 + otwór odpowietrzający
  const dia = page.locator('input[type=number]').nth(0)
  await dia.fill('40')
  await dia.evaluate((el) => el.dispatchEvent(new Event('change')))
  await page.locator('input[type=checkbox]').first().check()
  await page.waitForTimeout(700)
  await ctx.waitReady(page)
  const v2 = await ctx.downloadFromButton(page)
  const s2 = ctx.validateSTL(v2.buffer)
  if (!near(s2.size.z, 22, 1)) throw new Error(`wysokość ${s2.size.z.toFixed(1)} ≠ 22 (promień 20 + ścianka 2)`)
  if (!near(s2.size.x, 140, 2)) throw new Error(`szerokość ${s2.size.x.toFixed(1)} ≠ ~140`)
  return [v1, v2]
}
