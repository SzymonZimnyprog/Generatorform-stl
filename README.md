# Generator Form STL

Darmowe **generatory 3D dla makerów** działające w 100% w przeglądarce — bez rejestracji,
bez wysyłania plików na serwer, bez CAD-a. Wzorowane na [meshcast.app](https://meshcast.app/).
Każde narzędzie ma podgląd 3D na żywo i eksportuje **binarny STL** (milimetry, oś Z w górę)
gotowy do slicera.

## Narzędzia

| Narzędzie | Co robi |
|---|---|
| 🧊 **Forma dwuczęściowa z STL** | Forma odlewnicza z otworem wlewowym i zamkami — do silikonu, wosku, mydła, żywicy |
| 🫙 **Wanna do silikonu** | Obudowa drukowana razem z modelem — zalej silikonem i masz elastyczną formę |
| 🛶 **Forma do laminowania** | Negatyw z wnęką lub kopyto na płycie — laminaty, żywica z włóknem, termoformowanie |
| 🛁 **Forma do bomb kąpielowych** | Dwie półkuliste prasy z kołnierzami i otworem odpowietrzającym |
| 🍪 **Wykrawacz do ciastek** | Obrazek/rysunek → foremka tnąca z ostrzem, ścianką i kołnierzem |
| 🖼️ **Litofania** | Zdjęcie → relief 3D, który pokazuje obraz pod światło (płaski lub łuk) |
| ✍️ **Napis / szyld 3D** | Tekst → wypukły napis na podstawce (prostokąt lub obrys), z otworami do zawieszenia |
| 🖋️ **Stempel** | Tekst → stempel z uchwytem, automatyczne lustrzane odbicie |
| 🔑 **Brelok** | Tekst na zawieszce z prawdziwym otworem na kółko, relief lub grawer |
| 🌱 **Doniczka z STL** | Dowolny model → doniczka z pustym środkiem i otworami odpływowymi |
| 🍫 **Tacka** | Parametryczna tacka na lód/czekoladki: półkule, kostki, walce, serca, gwiazdy |
| 🏺 **Forma na doniczki i wazony** | Forma zewnętrzna + rdzeń na płycie — puste naczynia z betonu, gipsu, jesmonite |
| 📱 **Tabliczka QR** | Link/tekst jako wypukły kod QR, z uchem do zawieszenia |
| ✂️ **Dzielenie modelu** | Cięcie STL płaszczyzną na części do druku, z kołkami pasującymi |

Wszystkie napisy obsługują polskie znaki (ĄĆĘŁŃÓŚŹŻ) — 4 wbudowane kroje pisma.

## Uruchomienie

```bash
npm install
npm run dev       # serwer deweloperski (http://localhost:5173)
npm run build     # produkcyjny build do dist/
npm run preview   # podgląd builda
```

Aplikacja jest w pełni statyczna — zawartość `dist/` można hostować gdziekolwiek
(GitHub Pages, Netlify, dowolny serwer HTTP).

### Publikacja na GitHub Pages

Repozytorium zawiera workflow `.github/workflows/deploy.yml`, który buduje i publikuje
aplikację przy każdym pushu do `main`/`master`. Żeby go aktywować, wejdź jednorazowo w
**Settings → Pages** i ustaw **Source: GitHub Actions**. Aplikacja będzie dostępna pod
`https://<użytkownik>.github.io/<repozytorium>/` (build używa ścieżek względnych, więc
działa w podkatalogu bez dodatkowej konfiguracji).

## Testy

```bash
npm run test:core        # testy jednostkowe modułów geometrii (Node)
npm run build
node scripts/e2e.mjs     # testy e2e wszystkich narzędzi w Chromium (Playwright):
                         # klikają UI, pobierają STL i walidują geometrię
node scripts/e2e.mjs litofania   # pojedyncze narzędzie
```

## Architektura

- **Vite** (multi-page app) — każde narzędzie to osobna strona: `<narzędzie>.html` + `src/tools/<narzędzie>.js`
- **three.js** — podgląd 3D i budowa geometrii
- **three-bvh-csg** — operacje na bryłach (formy, doniczki, grawer)
- **opentype.js** — tekst 3D z plików TTF (pełne polskie znaki)
- **clipper-lib** — offsety i operacje na wielokątach (wykrawacze, obrysy)

Moduły wspólne w `src/core/` (podgląd, eksport STL, kontrolki UI, CSG, tekst, wektoryzacja) —
opisane w [docs/CORE-API.md](docs/CORE-API.md). Konwencja geometrii: **milimetry, Z w górę,
stół druku na z=0**.
