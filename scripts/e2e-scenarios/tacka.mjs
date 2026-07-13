// Scenariusz E2E: tacka — parametryczna, generuje się od razu.
export async function scenario(page, ctx) {
  // wariant 1: domyślne — 2×4 półkule ⌀24: W=130, D=70, H=15
  await ctx.waitReady(page)
  const v1 = await ctx.downloadFromButton(page)
  const s1 = ctx.validateSTL(v1.buffer)
  const near = (a, b, tol) => Math.abs(a - b) <= tol
  if (!near(s1.size.x, 130, 1)) throw new Error(`W ${s1.size.x.toFixed(1)} ≠ 130`)
  if (!near(s1.size.y, 70, 1)) throw new Error(`D ${s1.size.y.toFixed(1)} ≠ 70`)
  if (!near(s1.size.z, 15, 1)) throw new Error(`H ${s1.size.z.toFixed(1)} ≠ 15`)
  // wynik CSG ma T-złącza na szwach (slicery je akceptują) — nie wymagamy openEdges===0
  if (s1.degenerate / s1.triangles > 0.05) throw new Error(`za dużo zdegenerowanych: ${s1.degenerate}`)
  if (s1.triangles < 500) throw new Error(`za mało trójkątów: ${s1.triangles}`)

  // wariant 2: 1×2 serca, rozmiar 30, głębokość 12: W=82, D=46
  const num = (i) => page.locator('input[type=number]').nth(i)
  for (const [i, val] of [[0, '1'], [1, '2'], [2, '30'], [3, '12']]) {
    await num(i).fill(val)
    await num(i).evaluate((el) => el.dispatchEvent(new Event('change')))
  }
  await page.locator('select').first().selectOption('heart')
  await page.waitForTimeout(700)
  await ctx.waitReady(page)
  const v2 = await ctx.downloadFromButton(page)
  const s2 = ctx.validateSTL(v2.buffer)
  if (!near(s2.size.x, 82, 2)) throw new Error(`W ${s2.size.x.toFixed(1)} ≠ 82`)
  if (!near(s2.size.y, 46, 2)) throw new Error(`D ${s2.size.y.toFixed(1)} ≠ 46`)
  return [v1, v2]
}
