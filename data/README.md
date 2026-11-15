# Дані застосунку

Усе, що показує застосунок, лежить у цій папці. Код у `src/` читає файли автоматично: достатньо додати новий JSON у потрібну папку і злити в `main`.

## Загальні правила
- Кожен запис має масив `sources` з хоча б одним джерелом: `{ "title": "...", "url": "...", "note": "..." }`.
- Локалізований текст: `{ "uk": "обов'язково", "hu": "необов'язково" }`.
- Координати завжди як `[довгота, широта]` (lon, lat), наприклад `[19.163, 47.683]`.
- Markdown у полі `description` і в `texts/`: заголовки, списки, посилання.

## periods.json
Список періодів. Поля: `id`, `name`, `from`, `to` (null = дотепер), `color`, `summary`, `sources`. Роки до н. е. від'ємні.

## places/<id>.json
Одне місце. Поля:
- `id` (латиницею, як назва файлу), `name`, `type`: `settlement | archaeological | church | castle | monument | nature | other`
- `coords`, `coordsPrecision`: `exact | approximate | settlement`
- `periods`: масив id періодів, у яких місце показується
- `summary` (1–2 речення), `description` (Markdown, необов'язково)
- `photos`: масив `{ "url", "author", "license", "licenseUrl", "source", "caption" }`
- `sources`

## events/<id>.json
Подія. Поля: `id`, `title`, `date: { "from": "1241", "to": "1242", "precision": "exact | approximate | tradition" }`, `period`, `places` (id місць), `coords` (необов'язково), `summary`, `description`, `photos`, `sources`.

## maps/<id>.json
Стара мапа для накладання. Поля: `id`, `title`, `year`, `author`, `license`, `licenseUrl`, `attribution`, `source`, `type`: `image` або `xyz`, `url`, `coordinates` (для `image`: 4 кути NW, NE, SE, SW), `periods`.

## routes/<id>.geojson
Анімовані мапи. Файл FeatureCollection з додатковим полем `animation`:
```json
"animation": { "event": "vaci-csata-1849", "from": "1849-04-08", "to": "1849-04-10T18:00", "title": { "uk": "..." }, "note": { "uk": "..." } }
```
Анімація показується на сторінці події `event`. Кожен feature має `properties`:
- `id`, `period`, `kind`: `military | trade | transport | border | growth`
- `title`, `note` (локалізовані), `side` (`hu`, `at`, `ru` задають колір сторони)
- `start`, `end`: момент початку і кінця руху, формати `"324"`, `"1849-04-10"`, `"1849-04-10T12:00"`. Лінія «малюється» від `start` до `end`, точка з'являється у `start`.
- для `kind: growth` на точці: `values: [{ "date": "1850", "value": 988 }, ...]`, коло росте за значенням.
- `sources` обов'язкові для кожного feature.
Геометрія: `LineString` (рух), `Point` (позиція або ріст), `Polygon` (територія, проявляється між `start` і `end`).

## texts/uk/<period-id>.md, texts/hu/<period-id>.md
Довгий текст періоду. Угорський варіант необов'язковий.

## Перевірка
`npm run validate` (виконується автоматично при push) перевірить обов'язкові поля, посилання на періоди й координати та вкаже файл із помилкою.

## basemaps.json
Сучасні підкладки для мапи та режиму «Порівняти». `type: "style"` з `url` стилю MapLibre або `type: "raster"` з `tiles` (шаблон із `{z}/{x}/{y}` або `{z}/{y}/{x}`). Якщо адреса містить `{key}`, підкладка з'являється лише коли заповнено поле `key`. Для Esri World Imagery: створіть безкоштовний акаунт на location.arcgis.com, зробіть API-ключ із правом Basemaps і обмеженням на реферер `way1ong.github.io`, вставте його в `key`. Ключ у публічному репозиторії видно всім, тому обмеження за реферером обов'язкове.
