// Scenariusz E2E: brelok — (1) pastylka z wypukłym napisem „Żółw" (polskie
// znaki, ucho z otworem po lewej), (2) prostokąt z grawerem, grubość 5 mm,
// otwór po prawej. Wymiary STL walidowane względem ustawień; rozmiar tekstu
// odczytujemy z paska statusu („tekst W × H mm").
export async function scenario(page, ctx) {
  const num = (label) => page.locator('label.ctl', { hasText: label }).locator('input[type=number]')
  const sel = (label) => page.locator('label.ctl', { hasText: label }).locator('select')
  const setNum = async (label, v) => {
    await num(label).fill(String(v))
    await num(label).evaluate((el) => el.dispatchEvent(new Event('change')))
  }
  const textDims = (statusText) => {
    const m = statusText.match(/tekst\s+([\d.]+)\s*×\s*([\d.]+)\s*mm/)
    if (!m) throw new Error('status nie podaje wymiarów tekstu: ' + statusText)
    return { w: parseFloat(m[1]), h: parseFloat(m[2]) }
  }
  const earOut = 1.2 * ((4.5 + 5) / 2) // część ucha wystająca poza podkładkę (⌀ otworu 4,5)

  // 0) generacja domyślna („Kuba") po wejściu na stronę
  await ctx.waitReady(page)

  // 1) Wariant 1: „Żółw" — pastylka, tekst wypukły
  //    (domyślne: margines 4, grubość 3,5, relief 1,2, otwór ⌀4,5 po lewej)
  await page.locator('#controls input[type=text]').fill('Żółw')
  await page.waitForTimeout(700) // debounce 300 ms
  const st1 = await ctx.waitReady(page)
  const t1 = textDims(st1)
  const v1 = await ctx.downloadFromButton(page)
  const s1 = ctx.validateSTL(v1.buffer)

  if (s1.openEdges > 0) {
    throw new Error(`pastylka z reliefem nie jest szczelna (${s1.openEdges} otwartych krawędzi)`)
  }
  if (s1.triangles <= 200) throw new Error(`za mało trójkątów (${s1.triangles})`)
  const z1 = 3.5 + 1.2 // grubość podkładki + wysokość reliefu
  if (Math.abs(s1.size.z - z1) > 0.3) {
    throw new Error(`wysokość ${s1.size.z.toFixed(2)} ≠ ~${z1} mm (podkładka + relief)`)
  }
  // ucho: brelok musi być szerszy niż sam tekst z marginesami (2×4 mm)
  if (s1.size.x <= t1.w + 8 + 2) {
    throw new Error(`szerokość ${s1.size.x.toFixed(1)} mm bez śladu ucha (tekst ${t1.w} + marginesy 8)`)
  }
  const x1 = t1.w + 8 + earOut
  if (Math.abs(s1.size.x - x1) > 2) {
    throw new Error(`szerokość ${s1.size.x.toFixed(1)} ≠ ~${x1.toFixed(1)} mm (tekst + marginesy + ucho)`)
  }
  // głębokość pastylki = wysokość tekstu + 2×margines
  if (Math.abs(s1.size.y - (t1.h + 8)) > 1.5) {
    throw new Error(`głębokość ${s1.size.y.toFixed(1)} ≠ ~${(t1.h + 8).toFixed(1)} mm (tekst + marginesy)`)
  }

  // 2) Wariant 2: prostokąt, tekst grawerowany, grubość 5 mm, otwór po prawej
  await sel('Kształt podkładki').selectOption('rect')
  await sel('Styl tekstu').selectOption('engraved')
  await sel('Pozycja otworu').selectOption('right')
  await setNum('Grubość podkładki', 5)
  await page.waitForTimeout(700)
  const st2 = await ctx.waitReady(page)
  const t2 = textDims(st2)
  const v2 = await ctx.downloadFromButton(page)
  const s2 = ctx.validateSTL(v2.buffer)

  if (s2.triangles <= 200) throw new Error(`za mało trójkątów w wariancie 2 (${s2.triangles})`)
  if (Math.abs(s2.size.z - 5) > 0.2) {
    throw new Error(`grawer nie może zmieniać wysokości: ${s2.size.z.toFixed(2)} ≠ 5 mm (grubość podkładki)`)
  }
  const x2 = t2.w + 8 + earOut
  if (Math.abs(s2.size.x - x2) > 2) {
    throw new Error(`szerokość ${s2.size.x.toFixed(1)} ≠ ~${x2.toFixed(1)} mm (tekst + marginesy + ucho)`)
  }
  if (Math.abs(s2.size.y - (t2.h + 8)) > 1.5) {
    throw new Error(`głębokość prostokąta ${s2.size.y.toFixed(1)} ≠ ~${(t2.h + 8).toFixed(1)} mm`)
  }
  if (s2.openEdges > 0) {
    throw new Error(`grawerowany brelok nie jest szczelny (${s2.openEdges} otwartych krawędzi)`)
  }

  return [v1, v2]
}
