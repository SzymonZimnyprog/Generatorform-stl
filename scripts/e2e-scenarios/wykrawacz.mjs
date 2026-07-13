// Scenariusz E2E: wykrawacz — obrazek (serce) → foremka; dwa warianty wymiarów.
export async function scenario(page, ctx) {
  // Pole liczbowe suwaka po etykiecie: fill + ręczny event `change`.
  const setSlider = async (labelText, value) => {
    const num = page
      .locator('label.ctl', { hasText: labelText })
      .locator('input[type=number]')
    await num.fill(String(value))
    await num.evaluate((el) => el.dispatchEvent(new Event('change')))
  }

  const png = await ctx.makeTestPNG() // serce na białym tle
  await page.locator('input[type=file]').setInputFiles({
    name: 'serce.png', mimeType: 'image/png', buffer: png,
  })
  await ctx.waitReady(page)
  const v1 = await ctx.downloadFromButton(page)

  // Wariant 1 (domyślne): kontur 80 mm + 2×(ostrze 0.8 + ścianka 1.6 + kołnierz 4) = 92.8 mm
  const s1 = ctx.validateSTL(v1.buffer)
  const dim1 = Math.max(s1.size.x, s1.size.y)
  if (s1.openEdges > 0) throw new Error(`wariant 1 nie jest szczelny (${s1.openEdges} otwartych krawędzi)`)
  if (Math.abs(dim1 - 92.8) > 2) throw new Error(`wariant 1: dłuższy bok ${dim1.toFixed(1)} mm ≠ ~92.8 mm`)
  if (Math.abs(s1.size.z - 16) > 0.3) throw new Error(`wariant 1: wysokość ${s1.size.z.toFixed(1)} mm ≠ 16 mm`)

  // Wariant 2: mniejszy (60 mm) i wyższy (20 mm) → dłuższy bok 60 + 12.8 = 72.8 mm
  await setSlider('Szerokość (dłuższy bok)', 60)
  await setSlider('Wysokość całkowita', 20)
  await page.waitForTimeout(700) // debounce 300 ms — czekamy aż ruszy nowa generacja
  await ctx.waitReady(page)
  const v2 = await ctx.downloadFromButton(page)

  const s2 = ctx.validateSTL(v2.buffer)
  const dim2 = Math.max(s2.size.x, s2.size.y)
  if (s2.openEdges > 0) throw new Error(`wariant 2 nie jest szczelny (${s2.openEdges} otwartych krawędzi)`)
  if (Math.abs(dim2 - 72.8) > 2) throw new Error(`wariant 2: dłuższy bok ${dim2.toFixed(1)} mm ≠ ~72.8 mm`)
  if (Math.abs(s2.size.z - 20) > 0.3) throw new Error(`wariant 2: wysokość ${s2.size.z.toFixed(1)} mm ≠ 20 mm`)

  // proporcje: wariant 2 ma być wyraźnie mniejszy w planie od wariantu 1
  if (dim2 >= dim1) throw new Error('wariant 2 nie jest mniejszy od wariantu 1')

  return [v1, v2]
}
