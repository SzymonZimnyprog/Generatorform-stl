// Scenariusz E2E: napis 3D — polskie znaki, podstawka prostokątna,
// potem obrys liter z otworami do zawieszenia. Walidacja wymiarów STL.
export async function scenario(page, ctx) {
  // 0) Domyślna generacja po wejściu na stronę ("Zosia", prostokąt)
  await ctx.waitReady(page)
  const short = await ctx.downloadFromButton(page)

  // 1) Wariant 1: dłuższy tekst z polskimi znakami, podstawka prostokątna
  await page.locator('#controls textarea').fill('Zośka 3D')
  await page.waitForTimeout(700) // debounce 300 ms
  await ctx.waitReady(page)
  const rect = await ctx.downloadFromButton(page)

  const s0 = ctx.validateSTL(short.buffer)
  const s1 = ctx.validateSTL(rect.buffer)
  if (s1.openEdges > 0) {
    throw new Error(`napis z prostokątną podstawką nie jest szczelny (${s1.openEdges} otwartych krawędzi)`)
  }
  // z = grubość podstawki (4) + grubość liter (8) − 0,1 zagłębienia
  const zRect = 4 + 8 - 0.1
  if (Math.abs(s1.size.z - zRect) > 0.3) {
    throw new Error(`wysokość ${s1.size.z.toFixed(2)} ≠ ~${zRect} mm (podstawka + litery − 0,1)`)
  }
  if (s1.size.x <= s0.size.x + 10) {
    throw new Error(`szerokość nie rośnie z długością tekstu ("Zosia" ${s0.size.x.toFixed(1)} vs "Zośka 3D" ${s1.size.x.toFixed(1)})`)
  }
  // wysokość fontu 30 mm (wersaliki ~70%) + margines 2×5 mm
  if (s1.size.y < 20 || s1.size.y > 50) {
    throw new Error(`głębokość ${s1.size.y.toFixed(1)} mm poza zakresem 20–50 (tekst 30 + 2×5 marginesu)`)
  }

  // 2) Wariant 2: podstawka „obrys liter" + otwory do zawieszenia + inne grubości
  await page.locator('label.ctl', { hasText: 'Typ podstawki' }).locator('select').selectOption('outline')
  await page.locator('label.ctl-check', { hasText: 'Otwory do zawieszenia' }).locator('input').check()
  const num = (label) => page.locator('label.ctl', { hasText: label }).locator('input[type=number]')
  await num('Grubość liter').fill('6')
  await num('Grubość liter').evaluate((el) => el.dispatchEvent(new Event('change')))
  await num('Grubość podstawki').fill('3')
  await num('Grubość podstawki').evaluate((el) => el.dispatchEvent(new Event('change')))
  await page.waitForTimeout(700)
  await ctx.waitReady(page)
  const outline = await ctx.downloadFromButton(page)

  const s2 = ctx.validateSTL(outline.buffer)
  if (s2.openEdges > 0) {
    throw new Error(`napis z obrysem i otworami nie jest szczelny (${s2.openEdges} otwartych krawędzi)`)
  }
  const zOutline = 3 + 6 - 0.1
  if (Math.abs(s2.size.z - zOutline) > 0.3) {
    throw new Error(`wysokość obrysu ${s2.size.z.toFixed(2)} ≠ ~${zOutline} mm`)
  }
  // obrys = tekst + margines z każdej strony → obwiednia jak przy prostokącie
  // (±4 mm luzu na „uszka" wokół otworów do zawieszenia)
  if (Math.abs(s2.size.x - s1.size.x) > 4 || Math.abs(s2.size.y - s1.size.y) > 4) {
    throw new Error(`obwiednia obrysu ${s2.size.x.toFixed(1)}×${s2.size.y.toFixed(1)} ≠ prostokąta ${s1.size.x.toFixed(1)}×${s1.size.y.toFixed(1)}`)
  }
  // otwory: obrys z dziurami musi mieć zauważalnie więcej trójkątów niż sam obrys prostokąta
  if (s2.triangles < 500) {
    throw new Error(`podejrzanie mało trójkątów (${s2.triangles}) — obrys lub otwory nie powstały`)
  }

  return [short, rect, outline]
}
