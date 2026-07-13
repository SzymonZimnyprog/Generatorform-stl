# Generator Form STL — API modułów wspólnych

Aplikacja: przeglądarkowe generatory STL dla makerów (jak meshcast.app), 100% klienckie.
Stack: Vite (MPA), three.js, three-bvh-csg, opentype.js, clipper-lib. UI po polsku.

## Konwencje — WAŻNE

- **Geometria zawsze w milimetrach, Z-w-górę** (jak w druku 3D). Podłoże (stół) to z=0.
  Viewer sam obraca zawartość do wyświetlenia — nie obracaj nic „dla wyglądu".
- Każde narzędzie to para: `<slug>.html` (już istnieje, NIE edytuj) + `src/tools/<slug>.js` (Twój plik).
- HTML zawiera: `#controls` (panel), `#viewer` (podgląd), `#status` (pasek statusu).
- Przycisk pobierania MUSI mieć etykietę dokładnie **„Pobierz STL"** (testy e2e go szukają).
- Sukces generacji sygnalizuj `status('…', 'ok')`, błąd `status('…', 'error')` — testy e2e
  czekają na jedną z tych klas. Przed ciężkim liczeniem: `status('Generuję…', 'busy')` + `await nextFrame()`.
- Zmiany suwaków przeliczaj przez `debounce(regen, 300)`.
- **Uwaga na hoisting**: `const regenDebounced = debounce(regen, 300)` zdefiniuj PRZED
  pierwszym użyciem w kontrolkach (deklaracja `function regen()` może być niżej).

## src/core/viewer.js

```js
import { createViewer, previewMaterial, previewMaterialAlt } from '../core/viewer.js'
const viewer = createViewer(viewerEl)      // scena, kamera, orbit, siatka stołu
viewer.setContent(meshLubTablica)          // podmienia całą zawartość
viewer.fit()                               // kadruje kamerę na zawartość
previewMaterial()                          // bursztynowy MeshStandardMaterial (DoubleSide)
previewMaterialAlt()                       // niebieski — np. druga połówka formy
```

## src/core/stl.js

```js
import { downloadSTL, exportSTL, loadSTLFile } from '../core/stl.js'
downloadSTL(meshLubTablica, 'nazwa.stl')   // uwzględnia transformacje meshy; pobiera plik
const geom = await loadSTLFile(file)       // File → BufferGeometry (z normalnymi)
```

## src/core/ui.js

```js
import { getToolLayout, group, slider, select, textInput, checkbox, button,
         fileDrop, makeStatus, debounce, nextFrame } from '../core/ui.js'
const { controls, viewerEl, statusEl } = getToolLayout()
const status = makeStatus(statusEl)        // status(msg, 'info'|'busy'|'ok'|'error'); status() czyści
const g = group(controls, 'Wymiary')       // sekcja panelu
const c = slider(g, { label, min, max, step, value, unit='mm', onChange })  // c.value (get/set)
select(g, { label, options:[{value,label}], value, onChange })
textInput(g, { label, value, placeholder, multiline=false, onChange })
checkbox(g, { label, value, onChange })
const btn = button(g, { label:'Pobierz STL', kind:'primary', onClick })     // zwraca <button>
fileDrop(g, { label, accept:'image/*', hint, onFile })                       // klik + drag&drop
```

## src/core/geometry.js

```js
import { roundedRectShape, circleShape, contoursToShapes, extrudeShapes,
         mergeGeoms, placeOnGround, sizeOf } from '../core/geometry.js'
roundedRectShape(w, h, r)                  // THREE.Shape, środek w (0,0)
circleShape(r)
contoursToShapes(kontury)                  // [{x,y}…][] lub THREE.Path[] → THREE.Shape[] z dziurami
                                           // (parzystość zagnieżdżenia, kierunek nawijania obojętny)
extrudeShapes(shapes, depth, {curveSegments=24})  // wyciąga wzdłuż +Z: z=0..depth → BufferGeometry
mergeGeoms([g1, g2, …])                    // scala w jedną (ujednolica atrybuty)
placeOnGround(geom)                        // centruje XY, stawia min.z na 0 (mutuje)
sizeOf(geom)                               // Vector3 z wymiarami bboxa
```

## src/core/csg.js  (operacje na bryłach)

```js
import { subtract, union, intersect, subtractAll, unionAll, meshAt } from '../core/csg.js'
// wejście: THREE.Mesh (transformacje „wypiekane") lub BufferGeometry; wynik: BufferGeometry
const g = subtract(pudełko, meshAt(cylinderGeom, { x:0, y:0, z:10, rx:Math.PI/2 }))
meshAt(geom, {x,y,z,rx,ry,rz,sx,sy,sz})    // szybkie ustawienie bryły do CSG
```
Uwaga: `THREE.CylinderGeometry` ma oś wzdłuż Y — do pionowego otworu (oś Z) użyj `rx: Math.PI/2`.
CSG bywa kosztowne — rób najpierw `mergeGeoms` wielu odejmowanych brył i odejmij raz.
(mergeGeoms scala siatki bez CSG — wystarcza, gdy bryły odejmujemy; do sumy brył które mają
tworzyć poprawną, szczelną powłokę zewnętrzną, użyj `union`/`unionAll`.)

## src/core/text.js  (tekst 3D — polskie znaki działają)

```js
import { loadFont, fontOptions, textToShapes, FONTS } from '../core/text.js'
select(g, { label:'Krój pisma', options: fontOptions(), value:'montserrat', onChange })
const font = await loadFont('montserrat')  // cache; 'roboto' | 'lobster' | 'pacifico'
const { shapes, width, height } = textToShapes(font, 'Zośka\nAla', 30, { align:'center' })
// shapes: THREE.Shape[] w płaszczyźnie XY (Y w górę), wyśrodkowane wokół (0,0), w mm.
// `30` = wysokość fontu (em) w mm; realna wysokość wersalika to ~70% tej wartości.
const geom = extrudeShapes(shapes, 5)      // litery grube na 5 mm (z=0..5)
```

## src/core/trace.js  (obrazek → kontury → kształty)

```js
import { fileToImageData, luminanceMask, traceContours, smoothLoop, simplifyLoop,
         cleanPolygons, offsetPolygons, diffPolygons, polygonsToShapes,
         keepLargest, clipperToPoints } from '../core/trace.js'
const img = await fileToImageData(file, 480)          // ImageData (przeskalowane)
const mask = luminanceMask(img, { threshold:128, invert:false })  // 1 = ciemne piksele
let loops = traceContours(mask, img.width, img.height) // zamknięte pętle, piksele, Y-w-górę
loops = loops.map(l => simplifyLoop(smoothLoop(l, 1), 0.8))
let polys = cleanPolygons(loops)                       // format Clippera (dalsze operacje)
polys = keepLargest(polys)                             // największy kontur + jego dziury
const grown = offsetPolygons(polys, 2)                 // offset ±mm (w jedn. wejściowych = px!)
const ring = diffPolygons(grown, polys)                // pierścień (kształt z dziurą)
const shapes = polygonsToShapes(ring)                  // → THREE.Shape[] (skala nadal w px)
```
Skalowanie px→mm zrób na geometrii (`geom.scale(k, k, 1)`) albo przelicz punkty
(`clipperToPoints(polys)`) przed budową kształtów. Offsety licz w px: `deltaPx = deltaMm / k`,
gdzie `k = docelowaSzerokośćMm / szerokośćKonturuPx`.

## Weryfikacja narzędzia (OBOWIĄZKOWA)

1. Build do WŁASNEGO katalogu (żeby nie kolidować z innymi):
   `npx vite build --outDir dist-<slug>` (z katalogu repo).
2. Scenariusz e2e: `scripts/e2e-scenarios/<slug>.mjs` — eksportuje `async function scenario(page, ctx)`.
   Wzór: `scripts/e2e-scenarios/litofania.mjs`. Dostępne w `ctx`:
   - `makeTestPNG({gradient:false})` → Buffer PNG (serce na białym tle; gradient=true → gradient+koło)
   - `makeTestSTLBuffer()` → Buffer STL (kopuła ~30 mm, płaski spód na z=0)
   - `waitReady(page)` → czeka na status ok/error, zwraca tekst statusu
   - `downloadFromButton(page)` → klika „Pobierz STL", zwraca `{buffer, filename}`
   - `validateSTL(buffer)` → `{triangles, size, openEdges, degenerate, bbox}` lub wyjątek
   Zwróć tablicę pobranych plików `[{buffer, filename}]` — runner zapisze je i zwaliduje.
   W scenariuszu ustawiaj wartości przez `page.locator(...)` (input[type=file] → `setInputFiles`
   z `{name, mimeType, buffer}`; select → `selectOption`; tekst → `fill`).
   Pole liczbowe suwaka: `fill('60')` + `dispatchEvent(new Event('change'))`:
   `await loc.fill('60'); await loc.evaluate(el => el.dispatchEvent(new Event('change')))`.
   **Po każdej zmianie parametrów** odczekaj `await page.waitForTimeout(700)` (debounce!)
   ZANIM wywołasz `waitReady` — inaczej złapiesz status z poprzedniej generacji.
3. Uruchom: `DIST=dist-<slug> node scripts/e2e.mjs <slug>` — musi przejść bez błędów.
   Zrzut ekranu ląduje w `scripts/e2e-out/<slug>.png` — OBEJRZYJ go (Read) i oceń,
   czy model wygląda sensownie (nie pusty, nie „eksplodowany", proporcje ok).
4. Kryteria jakości STL: `openEdges === 0` (szczelność) tam, gdzie to możliwe;
   wymiary zgodne z ustawieniami ±10%; brak błędów w konsoli przeglądarki.

## Czego NIE robić

- NIE edytuj plików wspólnych: `src/core/*`, `src/style.css`, `index.html`, `*.html`,
  `scripts/e2e.mjs`, `scripts/stl-check.mjs`, `vite.config.js`, `package.json`,
  ani plików innych narzędzi.
- NIE instaluj nowych zależności.
- NIE commituj do gita.
- NIE używaj katalogu `dist/` (tylko `dist-<slug>`).
