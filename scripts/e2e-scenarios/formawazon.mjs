// Scenariusz E2E: forma na doniczki/wazony z rdzeniem.
// Model testowy: „wiadro" — stożek ścięty ⌀30 (góra) / ⌀20 (dół), wys. 30, naczynie otwarte górą.
import * as THREE from 'three'
import { exportSTL } from '../../src/core/stl.js'

function makeBucketSTL() {
  const g = new THREE.CylinderGeometry(15, 10, 30, 32)
  g.rotateX(Math.PI / 2)
  g.translate(0, 0, 15)
  return Buffer.from(exportSTL(new THREE.Mesh(g)))
}

const near = (a, b, tol) => Math.abs(a - b) <= tol
const assertClean = (s, what) => {
  if (s.degenerate / s.triangles > 0.05) {
    throw new Error(`${what}: za dużo zdegenerowanych trójkątów (${s.degenerate}/${s.triangles})`)
  }
}

export async function scenario(page, ctx) {
  await page.locator('input[type=file]').setInputFiles({
    name: 'wiadro.stl', mimeType: 'model/stl', buffer: makeBucketSTL(),
  })
  await ctx.waitReady(page)

  // ── Wariant 1: ustawienia domyślne (ścianka odlewu 5, dno odlewu 6,
  //    ścianki formy 8, dno formy 6, płyta 4) ──────────────────────────
  // główny STL: forma 46 + odstęp 10 + zespół rdzenia 46 = ~102 szerokości
  const vBoth = await ctx.downloadFromButton(page) // „Pobierz STL"
  const sBoth = ctx.validateSTL(vBoth.buffer)
  if (!near(sBoth.size.x, 102, 3)) throw new Error(`szerokość zestawu ${sBoth.size.x.toFixed(1)} ≠ ~102 (46+10+46)`)
  if (!near(sBoth.size.y, 46, 1)) throw new Error(`głębokość zestawu ${sBoth.size.y.toFixed(1)} ≠ ~46`)
  if (!near(sBoth.size.z, 36, 1)) throw new Error(`wysokość zestawu ${sBoth.size.z.toFixed(1)} ≠ ~36 (forma: dno 6 + model 30)`)
  assertClean(sBoth, 'zestaw')

  // forma osobno: (30+2·8) × (30+2·8) × (6+30) = 46×46×36
  const vMold = await ctx.downloadFromButton(page, 'Pobierz formę')
  const sMold = ctx.validateSTL(vMold.buffer)
  if (!near(sMold.size.x, 46, 1) || !near(sMold.size.y, 46, 1)) {
    throw new Error(`podstawa formy ${sMold.size.x.toFixed(1)}×${sMold.size.y.toFixed(1)} ≠ 46×46`)
  }
  if (!near(sMold.size.z, 36, 1)) throw new Error(`wysokość formy ${sMold.size.z.toFixed(1)} ≠ 36 (dno 6 + model 30)`)
  // sam blok to 12 trójkątów — wnęka po stożku 32-segmentowym daje ich znacznie więcej
  if (sMold.triangles < 100) throw new Error(`za mało trójkątów na wnękę formy: ${sMold.triangles}`)
  assertClean(sMold, 'forma')

  // zespół rdzenia (drukowany płytą do dołu): płyta 46×46×4 + rdzeń 30−6 = wys. 28
  const vCore = await ctx.downloadFromButton(page, 'Pobierz rdzeń')
  const sCore = ctx.validateSTL(vCore.buffer)
  if (!near(sCore.size.x, 46, 1) || !near(sCore.size.y, 46, 1)) {
    throw new Error(`płyta rdzenia ${sCore.size.x.toFixed(1)}×${sCore.size.y.toFixed(1)} ≠ 46×46`)
  }
  if (!near(sCore.size.z, 28, 1)) throw new Error(`wysokość zespołu rdzenia ${sCore.size.z.toFixed(1)} ≠ 28 (płyta 4 + rdzeń 24)`)
  assertClean(sCore, 'rdzeń')

  // ── Wariant 2: ścianka odlewu 8, ścianki formy 12 ──────────────────
  // pola liczbowe suwaków w kolejności: 0=rozmiar, 1=ścianka odlewu,
  // 2=dno odlewu, 3=ścianki formy, 4=dno formy, 5=płyta
  const setNum = async (idx, v) => {
    const loc = page.locator('input[type=number]').nth(idx)
    await loc.fill(String(v))
    await loc.evaluate((el) => el.dispatchEvent(new Event('change')))
  }
  await setNum(1, 8)
  await setNum(3, 12)
  await page.waitForTimeout(700)
  await ctx.waitReady(page)

  // forma: (30+2·12) × (30+2·12) × (6+30) = 54×54×36
  const vMold2 = await ctx.downloadFromButton(page, 'Pobierz formę')
  const sMold2 = ctx.validateSTL(vMold2.buffer)
  if (!near(sMold2.size.x, 54, 1) || !near(sMold2.size.y, 54, 1)) {
    throw new Error(`podstawa formy (w2) ${sMold2.size.x.toFixed(1)}×${sMold2.size.y.toFixed(1)} ≠ 54×54`)
  }
  if (!near(sMold2.size.z, 36, 1)) throw new Error(`wysokość formy (w2) ${sMold2.size.z.toFixed(1)} ≠ 36`)
  assertClean(sMold2, 'forma (w2)')

  // zespół rdzenia (w2): węższy rdzeń (ścianka 8), płyta 54×54, wysokość nadal 28
  const vCore2 = await ctx.downloadFromButton(page, 'Pobierz rdzeń')
  const sCore2 = ctx.validateSTL(vCore2.buffer)
  if (!near(sCore2.size.x, 54, 1) || !near(sCore2.size.y, 54, 1)) {
    throw new Error(`płyta rdzenia (w2) ${sCore2.size.x.toFixed(1)}×${sCore2.size.y.toFixed(1)} ≠ 54×54`)
  }
  if (!near(sCore2.size.z, 28, 1)) throw new Error(`wysokość zespołu rdzenia (w2) ${sCore2.size.z.toFixed(1)} ≠ 28`)
  assertClean(sCore2, 'rdzeń (w2)')

  return [vBoth, vMold, vCore, vMold2, vCore2]
}
