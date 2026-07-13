// Scenariusz E2E: tabliczka QR — (1) domyślna generacja przy starcie
// (https://github.com, wypukła, 60 mm), (2) „TEST-1234" grawerowana 40 mm,
// (3) wypukła 40 mm z uchem do zawieszenia (stan do zrzutu ekranu —
// na zrzucie mają być widoczne 3 kwadratowe wzorce pozycjonujące w rogach).
export async function scenario(page, ctx) {
  const num = (label) => page.locator('label.ctl', { hasText: label }).locator('input[type=number]')
  const sel = (label) => page.locator('label.ctl', { hasText: label }).locator('select')
  const setNum = async (label, v) => {
    await num(label).fill(String(v))
    await num(label).evaluate((el) => el.dispatchEvent(new Event('change')))
  }
  const near = (a, b, tol) => Math.abs(a - b) <= tol

  // 1) Wariant 1: domyślne ustawienia — generacja od razu po wejściu.
  //    60×60, podstawa 2,4 + relief 1,2 (wypukły, bez ucha).
  const st1 = await ctx.waitReady(page)
  if (!st1.includes('Druk dwukolorowy')) {
    throw new Error('status wypukłego kodu nie podpowiada druku dwukolorowego: ' + st1)
  }
  const v1 = await ctx.downloadFromButton(page)
  const s1 = ctx.validateSTL(v1.buffer)
  if (!near(s1.size.x, 60, 0.5) || !near(s1.size.y, 60, 0.5)) {
    throw new Error(`podstawa ${s1.size.x.toFixed(1)}×${s1.size.y.toFixed(1)} ≠ 60×60`)
  }
  if (!near(s1.size.z, 3.6, 0.5)) {
    throw new Error(`wysokość ${s1.size.z.toFixed(2)} ≠ 3,6 (podstawa 2,4 + moduły 1,2)`)
  }
  if (s1.triangles <= 500) throw new Error(`za mało trójkątów na kod QR: ${s1.triangles}`)
  if (s1.openEdges !== 0) {
    throw new Error(`wypukła tabliczka (bez CSG) nie jest szczelna: ${s1.openEdges} otwartych krawędzi`)
  }
  if (s1.degenerate / s1.triangles >= 0.05) {
    throw new Error(`za dużo zdegenerowanych trójkątów: ${s1.degenerate}/${s1.triangles}`)
  }

  // 2) Wariant 2: „TEST-1234", styl grawerowany, rozmiar 40 — grawer nie
  //    zmienia obrysu ani wysokości płytki (CSG: dopuszczamy otwarte
  //    krawędzie/T-złącza, pilnujemy tylko zdegenerowanych trójkątów).
  await page.locator('#controls input[type=text]').fill('TEST-1234')
  await sel('Styl').selectOption('engraved')
  await setNum('Rozmiar (bok)', 40)
  await page.waitForTimeout(700) // debounce 300 ms
  await ctx.waitReady(page)
  const v2 = await ctx.downloadFromButton(page)
  const s2 = ctx.validateSTL(v2.buffer)
  if (!near(s2.size.x, 40, 0.5) || !near(s2.size.y, 40, 0.5)) {
    throw new Error(`podstawa graweru ${s2.size.x.toFixed(1)}×${s2.size.y.toFixed(1)} ≠ 40×40`)
  }
  if (!near(s2.size.z, 2.4, 0.5)) {
    throw new Error(`grawer nie może zmieniać wysokości: ${s2.size.z.toFixed(2)} ≠ 2,4`)
  }
  if (s2.triangles <= 200) throw new Error(`za mało trójkątów w grawerze: ${s2.triangles}`)
  if (s2.degenerate / s2.triangles >= 0.05) {
    throw new Error(`za dużo zdegenerowanych trójkątów po CSG: ${s2.degenerate}/${s2.triangles}`)
  }

  // 3) Wariant 3: z powrotem wypukły + ucho do zawieszenia (⌀4, R=4,5 →
  //    wystaje 1,2·R = 5,4 mm poza górną krawędź). Bez CSG → szczelny.
  await sel('Styl').selectOption('raised')
  await page.locator('label.ctl-check', { hasText: 'Ucho do zawieszenia' }).locator('input[type=checkbox]').check()
  await page.waitForTimeout(700)
  await ctx.waitReady(page)
  const v3 = await ctx.downloadFromButton(page)
  const s3 = ctx.validateSTL(v3.buffer)
  if (!near(s3.size.x, 40, 0.7)) throw new Error(`szerokość z uchem ${s3.size.x.toFixed(1)} ≠ 40`)
  if (!near(s3.size.y, 45.4, 1)) {
    throw new Error(`głębokość z uchem ${s3.size.y.toFixed(1)} ≠ ~45,4 (40 + ucho 5,4)`)
  }
  if (!near(s3.size.z, 3.6, 0.5)) throw new Error(`wysokość z uchem ${s3.size.z.toFixed(2)} ≠ 3,6`)
  if (s3.openEdges !== 0) {
    throw new Error(`tabliczka z uchem (bez CSG) nie jest szczelna: ${s3.openEdges} otwartych krawędzi`)
  }

  return [v1, v2, v3]
}
