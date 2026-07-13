// Scenariusz E2E: litofania — wgraj zdjęcie, wygeneruj, pobierz STL (płaska i łuk).
export async function scenario(page, ctx) {
  const png = await ctx.makeTestPNG({ gradient: true })
  await page.locator('input[type=file]').setInputFiles({
    name: 'test.png', mimeType: 'image/png', buffer: png,
  })
  await ctx.waitReady(page)
  const flat = await ctx.downloadFromButton(page)

  // wariant łukowy
  await page.locator('select').first().selectOption('arc')
  await page.waitForTimeout(700) // debounce 300 ms — czekamy aż zacznie się nowa generacja
  await ctx.waitReady(page)
  const arc = await ctx.downloadFromButton(page)

  const s1 = ctx.validateSTL(flat.buffer)
  const s2 = ctx.validateSTL(arc.buffer)
  if (s1.openEdges > 0) throw new Error(`płaska litofania nie jest szczelna (${s1.openEdges} otwartych krawędzi)`)
  if (Math.abs(s1.size.x - 104) > 2) throw new Error(`szerokość ${s1.size.x} ≠ ~104 mm (100 + ramka)`)
  if (s2.size.y < 20) throw new Error('łuk wygląda na płaski')
  return [flat, arc]
}
