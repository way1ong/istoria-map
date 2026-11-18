// Перевірка файлів у data/. Запуск: node scripts/validate-data.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const root = new URL('../data/', import.meta.url).pathname;
const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    err(path.replace(root, 'data/'), `некоректний JSON (${e.message})`);
    return null;
  }
}
function listJson(dir) {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: `data/${dir}/${f}`, path: join(full, f), name: basename(f, '.json') }));
}
const isLText = (v) => v && typeof v === 'object' && typeof v.uk === 'string' && v.uk.trim() !== '';
function checkSources(file, sources) {
  if (!Array.isArray(sources) || sources.length === 0) return err(file, 'поле sources порожнє або відсутнє');
  sources.forEach((s, i) => {
    if (!s || typeof s.title !== 'string' || !s.title.trim()) err(file, `sources[${i}].title відсутній`);
    if (s.url !== undefined && !/^https?:\/\//.test(s.url)) err(file, `sources[${i}].url має починатися з http(s)://`);
  });
}
// Місця й події мають лежати в околиці Göd; маршрути (походи, вали) можуть виходити далеко за неї, але лишатися в Карпатському басейні.
// Межі проєкту: уся Угорщина в сучасних кордонах із запасом на прикордонні об'єкти (Komárno, Štúrovo, Subotica тощо).
const REGION = [15.5, 23.5, 45.3, 49.2];
// Для анімацій (рухи військ тощо) межі ширші.
const WIDE = [12, 28, 43, 52];
function checkCoords(file, coords, label = 'coords', box = REGION) {
  if (!Array.isArray(coords) || coords.length !== 2 || coords.some((n) => typeof n !== 'number'))
    return err(file, `${label} має бути [lon, lat]`);
  const [lon, lat] = coords;
  const [x0, x1, y0, y1] = box;
  if (lon < x0 || lon > x1 || lat < y0 || lat > y1)
    err(file, `${label} [${lon}, ${lat}] поза очікуваною областю; можливо, переплутано lon/lat`);
}
function checkPhotos(file, photos) {
  if (photos === undefined) return;
  if (!Array.isArray(photos)) return err(file, 'photos має бути масивом');
  photos.forEach((p, i) => {
    for (const k of ['url', 'author', 'license', 'source'])
      if (typeof p?.[k] !== 'string' || !p[k].trim()) err(file, `photos[${i}].${k} відсутній`);
  });
}

// periods
const periodsDoc = readJson(join(root, 'periods.json'));
const periodIds = new Set();
if (periodsDoc) {
  const list = periodsDoc.periods;
  if (!Array.isArray(list) || list.length === 0) err('data/periods.json', 'periods має бути непорожнім масивом');
  else
    list.forEach((p, i) => {
      const f = `data/periods.json[${i}]`;
      if (typeof p.id !== 'string') err(f, 'id відсутній');
      else if (periodIds.has(p.id)) err(f, `дубльований id ${p.id}`);
      else periodIds.add(p.id);
      if (!isLText(p.name)) err(f, 'name.uk відсутній');
      if (typeof p.from !== 'number') err(f, 'from має бути числом');
      if (p.to !== null && typeof p.to !== 'number') err(f, 'to має бути числом або null');
      if (typeof p.to === 'number' && p.to < p.from) err(f, 'to менше за from');
      if (!/^#[0-9a-fA-F]{6}$/.test(p.color ?? '')) err(f, 'color має бути #rrggbb');
      if (!isLText(p.summary)) err(f, 'summary.uk відсутній');
      checkSources(f, p.sources);
    });
}

// places
const placeIds = new Set();
const placeTypes = ['settlement', 'archaeological', 'church', 'castle', 'monument', 'nature', 'farmstead', 'inn', 'mill', 'other'];
for (const { file, path, name } of listJson('places')) {
  const p = readJson(path);
  if (!p) continue;
  if (p.id !== name) err(file, `id "${p.id}" має збігатися з назвою файлу "${name}"`);
  placeIds.add(p.id);
  if (!isLText(p.name)) err(file, 'name.uk відсутній');
  if (!placeTypes.includes(p.type)) err(file, `type має бути одним із: ${placeTypes.join(', ')}`);
  checkCoords(file, p.coords);
  if (!['exact', 'approximate', 'settlement'].includes(p.coordsPrecision))
    err(file, 'coordsPrecision має бути exact | approximate | settlement');
  const openCoords = (p.sources ?? []).some((s) => /координати опубліковані відкрито/i.test(s?.note ?? ''));
  if (p.type === 'archaeological' && p.coordsPrecision === 'exact' && !openCoords)
    err(file, 'археологічна пам\'ятка з coordsPrecision "exact": додайте в note джерела фразу «Координати опубліковані відкрито» з поясненням, або змініть на approximate/settlement');
  if (!Array.isArray(p.periods) || p.periods.length === 0) err(file, 'periods порожній');
  else p.periods.forEach((id) => periodIds.has(id) || err(file, `невідомий період "${id}"`));
  if (!isLText(p.summary)) err(file, 'summary.uk відсутній');
  if (p.vanished !== undefined && typeof p.vanished !== 'boolean') err(file, 'vanished має бути true/false');
  if (p.description !== undefined && !isLText(p.description)) err(file, 'description.uk відсутній');
  checkPhotos(file, p.photos);
  checkSources(file, p.sources);
}

// events
const eventIds = new Set();
const dateRe = /^-?\d{1,4}(-\d{2}(-\d{2})?)?$/;
for (const { file, path, name } of listJson('events')) {
  const e = readJson(path);
  if (!e) continue;
  if (e.id !== name) err(file, `id "${e.id}" має збігатися з назвою файлу "${name}"`);
  eventIds.add(e.id);
  if (!isLText(e.title)) err(file, 'title.uk відсутній');
  if (!e.date || typeof e.date.from !== 'string' || !dateRe.test(e.date.from))
    err(file, 'date.from має бути рядком виду "1241", "1241-04" або "1241-04-11"');
  if (e.date?.to !== undefined && !dateRe.test(e.date.to)) err(file, 'date.to у неправильному форматі');
  if (!['exact', 'approximate', 'tradition'].includes(e.date?.precision))
    err(file, 'date.precision має бути exact | approximate | tradition');
  if (!periodIds.has(e.period)) err(file, `невідомий період "${e.period}"`);
  if (!Array.isArray(e.places)) err(file, 'places має бути масивом (може бути порожнім)');
  else e.places.forEach((id) => placeIds.has(id) || err(file, `невідоме місце "${id}"`));
  if (e.coords !== undefined) checkCoords(file, e.coords);
  if (!isLText(e.summary)) err(file, 'summary.uk відсутній');
  checkPhotos(file, e.photos);
  checkSources(file, e.sources);
}

// map-series.json: серії старих мап (аркуші однієї серії показуються разом)
const seriesPath = join(root, 'map-series.json');
const seriesIds = new Set();
if (existsSync(seriesPath)) {
  const ms = readJson(seriesPath);
  (ms?.series ?? []).forEach((s, i) => {
    const f = `data/map-series.json[${i}]`;
    if (typeof s.id !== 'string' || !s.id) err(f, 'id відсутній');
    else if (seriesIds.has(s.id)) err(f, `повторний id "${s.id}"`);
    else seriesIds.add(s.id);
    if (!isLText(s.title)) err(f, 'title.uk відсутній');
    if (s.overview) {
      const o = s.overview;
      if (typeof o.url !== 'string' || !existsSync(join(root, '..', 'public', o.url))) err(f, `overview.url: немає файлу public/${o.url}`);
      if (!Array.isArray(o.coordinates) || o.coordinates.length !== 4) err(f, 'overview.coordinates: потрібно 4 кути [NW, NE, SE, SW]');
      else o.coordinates.forEach((c, k) => checkCoords(f, c, `overview.coordinates[${k}]`));
      if (typeof o.maxzoom !== 'number' || o.maxzoom < 0 || o.maxzoom > 22) err(f, 'overview.maxzoom: число 0–22');
    }
    if (s.georef !== undefined && (typeof s.georef !== 'string' || !existsSync(join(root, '..', 'public', s.georef)))) err(f, `georef: немає файлу public/${s.georef}`);
    if (s.grayscale !== undefined && typeof s.grayscale !== 'boolean') err(f, 'grayscale: true або false');
    if (s.allmapsMinzoom !== undefined && (typeof s.allmapsMinzoom !== 'number' || s.allmapsMinzoom < 0 || s.allmapsMinzoom > 22)) err(f, 'allmapsMinzoom: число 0–22');
    if (s.georef && typeof s.georef === 'string' && existsSync(join(root, '..', 'public', s.georef))) {
      // Georeference Annotation: кожен аркуш — зображення IIIF і щонайменше 3 опорні точки
      const page = readJson(join(root, '..', 'public', s.georef));
      const items = page?.type === 'AnnotationPage' ? page.items : [page];
      (items ?? []).forEach((it, k) => {
        const src = it?.target?.source;
        const feats = it?.body?.features;
        if (!src || typeof src.id !== 'string' || !/^https:\/\//.test(src.id) || !(src.width > 0) || !(src.height > 0)) err(f, `georef item ${k}: target.source (id, width, height)`);
        if (!Array.isArray(feats) || feats.length < 3) err(f, `georef item ${k}: потрібно щонайменше 3 опорні точки`);
        else feats.forEach((p) => checkCoords(f, p?.geometry?.coordinates, `georef item ${k}`));
      });
    }
  });
}
const sheetsSeen = new Map();

// maps
for (const { file, path, name } of listJson('maps')) {
  const m = readJson(path);
  if (!m) continue;
  if (m.series !== undefined) {
    if (!seriesIds.has(m.series)) err(file, `невідома серія "${m.series}" (див. data/map-series.json)`);
    if (m.type !== 'image') err(file, 'аркуш серії має бути type: image');
    if (typeof m.sheet !== 'string' || !m.sheet.trim()) err(file, 'sheet: номер аркуша відсутній');
    else {
      const k = `${m.series}/${m.sheet}`;
      if (sheetsSeen.has(k)) err(file, `аркуш ${m.sheet} уже є у ${sheetsSeen.get(k)}`);
      sheetsSeen.set(k, file);
    }
  }
  if (m.type === 'image' && typeof m.url === 'string' && !/^https?:/.test(m.url) && !existsSync(join(root, '..', 'public', m.url)))
    err(file, `url: немає файлу public/${m.url}`);
  if (m.georef !== undefined && (typeof m.georef !== 'string' || !existsSync(join(root, '..', 'public', m.georef))))
    err(file, `georef: немає файлу public/${m.georef}`);
  if (m.id !== name) err(file, `id має збігатися з назвою файлу "${name}"`);
  if (!isLText(m.title)) err(file, 'title.uk відсутній');
  for (const k of ['license', 'attribution', 'url'])
    if (typeof m[k] !== 'string' || !m[k].trim()) err(file, `${k} відсутній`);
  if (!['image', 'xyz', 'geojson'].includes(m.type)) err(file, 'type має бути image | xyz | geojson');
  if (m.type === 'geojson') {
    // векторна накладка: url — шлях у data/ (напр. water/lipszky-1806.geojson)
    const gp = typeof m.url === 'string' ? join(root, m.url) : '';
    if (!gp || !/^water\/[\w.-]+\.geojson$/.test(m.url) || !existsSync(gp)) err(file, `url: для geojson потрібен файл data/water/*.geojson, а не "${m.url}"`);
    else {
      const g = readJson(gp);
      if (g?.type !== 'FeatureCollection' || !Array.isArray(g.features)) err(`data/${m.url}`, 'потрібна FeatureCollection');
      else g.features.forEach((f, k) => {
        const t = f?.geometry?.type;
        if (!['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(t)) err(`data/${m.url}`, `features[${k}]: тип геометрії ${t}`);
        const first = t === 'Polygon' ? f.geometry.coordinates?.[0]?.[0] : t === 'MultiPolygon' ? f.geometry.coordinates?.[0]?.[0]?.[0] : t === 'LineString' ? f.geometry.coordinates?.[0] : f.geometry.coordinates?.[0]?.[0];
        checkCoords(`data/${m.url}`, first, `features[${k}]`);
      });
      for (const k of ['license', 'attribution']) if (typeof g?.[k] !== 'string' || !g[k].trim()) err(`data/${m.url}`, `${k} відсутній`);
    }
  }
  if (m.type === 'image') {
    if (!Array.isArray(m.coordinates) || m.coordinates.length !== 4) err(file, 'coordinates: потрібно 4 кути [NW, NE, SE, SW]');
    else m.coordinates.forEach((c, i) => checkCoords(file, c, `coordinates[${i}]`));
  }
  if (m.periods) m.periods.forEach((id) => periodIds.has(id) || err(file, `невідомий період "${id}"`));
  if (!m.source || typeof m.source.title !== 'string') err(file, 'source.title відсутній');
}

// basemaps
const bm = readJson(join(root, 'basemaps.json'));
if (bm) (bm.basemaps ?? []).forEach((b, i) => {
  const f = `data/basemaps.json[${i}]`;
  if (typeof b.id !== 'string') err(f, 'id відсутній');
  if (!isLText(b.title)) err(f, 'title.uk відсутній');
  if (!['style', 'raster', 'relief'].includes(b.type)) err(f, 'type має бути style | raster | relief');
  if (b.type === 'style' && typeof b.url !== 'string') err(f, 'url відсутній');
  if ((b.type === 'raster' || b.type === 'relief') && !Array.isArray(b.tiles)) err(f, 'tiles має бути масивом');
  if (b.type === 'relief' && b.encoding !== undefined && !['terrarium', 'mapbox'].includes(b.encoding)) err(f, 'encoding має бути terrarium | mapbox');
  if (b.type === 'relief' && b.vector !== undefined && typeof b.vector !== 'string') err(f, 'vector має бути адресою');
  if (b.key !== undefined && typeof b.key !== 'string') err(f, 'key має бути рядком');
  for (const k of ['attribution', 'license']) if (typeof b[k] !== 'string') err(f, `${k} відсутній`);
});

// routes
const routesDir = join(root, 'routes');
if (existsSync(routesDir))
  for (const f of readdirSync(routesDir).filter((f) => f.endsWith('.geojson'))) {
    const file = `data/routes/${f}`;
    const g = readJson(join(routesDir, f));
    if (!g) continue;
    if (g.type !== 'FeatureCollection') err(file, 'очікується FeatureCollection');
    const dtRe = /^-?\d{1,4}(-\d{2}(-\d{2}(T\d{2}:\d{2})?)?)?$/;
    if (g.animation) {
      const a = g.animation;
      if (!dtRe.test(a.from ?? '') || !dtRe.test(a.to ?? '')) err(file, 'animation.from/to у неправильному форматі');
      if (!isLText(a.title)) err(file, 'animation.title.uk відсутній');
      if (a.event !== undefined && !eventIds.has(a.event)) err(file, `animation.event: невідома подія "${a.event}"`);
    }
    (g.features ?? []).forEach((ft, i) => {
      const pr = ft.properties ?? {};
      if (!periodIds.has(pr.period)) err(file, `features[${i}]: невідомий період "${pr.period}"`);
      if (!['military', 'trade', 'transport', 'border', 'growth'].includes(pr.kind)) err(file, `features[${i}]: kind має бути military | trade | transport | border | growth`);
      if (!isLText(pr.title)) err(file, `features[${i}]: title.uk відсутній`);
      for (const k of ['start', 'end']) if (pr[k] !== undefined && !dtRe.test(pr[k])) err(file, `features[${i}].${k} у неправильному форматі`);
      if (!['Point', 'LineString', 'Polygon'].includes(ft.geometry?.type)) err(file, `features[${i}]: geometry має бути Point | LineString | Polygon`);
      const coords = ft.geometry?.type === 'Point' ? [ft.geometry.coordinates] : ft.geometry?.type === 'LineString' ? ft.geometry.coordinates : (ft.geometry?.coordinates ?? []).flat();
      (coords ?? []).forEach((c, j) => checkCoords(`${file} features[${i}]`, c, `coords[${j}]`, WIDE));
      if (pr.values) pr.values.forEach((v, j) => { if (!dtRe.test(v.date ?? '') || typeof v.value !== 'number') err(file, `features[${i}].values[${j}] потребує date і числове value`); });
      checkSources(`${file} features[${i}]`, pr.sources);
    });
  }

// borders
const bordersDir = join(root, 'borders');
let bordersCount = 0;
if (existsSync(bordersDir)) {
  const files = readdirSync(bordersDir).filter((f) => f.endsWith('.geojson'));
  if (!files.includes('modern.geojson')) err('data/borders', 'відсутній modern.geojson із сучасними контурами');
  for (const f of files) {
    const file = `data/borders/${f}`;
    const g = readJson(join(bordersDir, f));
    if (!g) continue;
    if (g.type !== 'FeatureCollection') err(file, 'очікується FeatureCollection');
    if (!g.license || !g.attribution) err(file, 'потрібні license і attribution');
    checkSources(file, g.source ? [g.source] : []);
    if (f !== 'modern.geojson') {
      bordersCount++;
      const m = /^y(bc)?(\d+)\.geojson$/.exec(f);
      if (!m) { err(file, 'назва має бути y<рік>.geojson або ybc<рік>.geojson'); continue; }
      const year = m[1] ? -Number(m[2]) : Number(m[2]);
      if (g.year !== year) err(file, `поле year (${g.year}) не збігається з назвою файлу`);
      (g.features ?? []).forEach((ft, i) => {
        const pr = ft.properties ?? {};
        if (typeof pr.name !== 'string' || typeof pr.name_uk !== 'string') err(file, `features[${i}]: потрібні рядки name і name_uk (можуть бути порожні для безіменних територій)`);
        if (![1, 2, 3].includes(pr.precision)) err(file, `features[${i}]: precision має бути 1, 2 або 3`);
        if (!['Polygon', 'MultiPolygon'].includes(ft.geometry?.type)) err(file, `features[${i}]: geometry має бути Polygon | MultiPolygon`);
      });
    }
  }
}

// landscape: data/landscape/uk.md (обов'язково) і hu.md, перший рядок «# Заголовок»
const landDir = join(root, 'landscape');
if (existsSync(landDir)) {
  const files = readdirSync(landDir);
  for (const f of files) {
    if (f.endsWith('.md') && !['uk.md', 'hu.md'].includes(f)) err(`data/landscape/${f}`, 'дозволені лише uk.md і hu.md');
  }
  for (const f of files.filter((f) => f === 'uk.md' || f === 'hu.md')) {
    const txt = readFileSync(join(landDir, f), 'utf8');
    if (!/^# \S/.test(txt)) err(`data/landscape/${f}`, 'перший рядок має бути заголовком «# …»');
  }
  if (!files.includes('uk.md')) err('data/landscape', 'бракує uk.md');
}

// texts
const textsDir = join(root, 'texts');
if (existsSync(textsDir))
  for (const lang of readdirSync(textsDir)) {
    if (!['uk', 'hu'].includes(lang)) { err(`data/texts/${lang}`, 'дозволені лише папки uk і hu'); continue; }
    for (const f of readdirSync(join(textsDir, lang)).filter((f) => f.endsWith('.md'))) {
      const id = basename(f, '.md');
      if (!periodIds.has(id)) err(`data/texts/${lang}/${f}`, `назва файлу має бути id періоду; "${id}" невідомий`);
    }
  }

// tools: data/tools.json (вступ і підрозділи) і data/tools/<id>.json (інструменти)
const toolCatIds = new Set();
const toolsDocPath = join(root, 'tools.json');
const toolsDoc = existsSync(toolsDocPath) ? readJson(toolsDocPath) : null;
if (toolsDoc) {
  if (!isLText(toolsDoc.intro)) err('data/tools.json', 'intro.uk відсутній');
  if (!Array.isArray(toolsDoc.categories) || toolsDoc.categories.length === 0) err('data/tools.json', 'categories має бути непорожнім масивом');
  else
    toolsDoc.categories.forEach((c, i) => {
      if (!c?.id) err('data/tools.json', `categories[${i}].id відсутній`);
      else if (toolCatIds.has(c.id)) err('data/tools.json', `categories[${i}].id "${c.id}" повторюється`);
      else toolCatIds.add(c.id);
      if (!isLText(c?.name)) err('data/tools.json', `categories[${i}].name.uk відсутній`);
      if (!isLText(c?.summary)) err('data/tools.json', `categories[${i}].summary.uk відсутній`);
    });
}
const toolUsers = ['detectorist', 'archaeologist'];
const toolFiles = listJson('tools');
if (toolFiles.length && !toolsDoc) err('data/tools.json', 'файл потрібен, коли є data/tools/*.json');
for (const { file, path, name } of toolFiles) {
  const x = readJson(path);
  if (!x) continue;
  if (x.id !== name) err(file, `id "${x.id}" має збігатися з назвою файлу "${name}"`);
  if (!toolCatIds.has(x.category)) err(file, `невідомий підрозділ "${x.category}" (див. data/tools.json)`);
  if (typeof x.order !== 'number') err(file, 'order має бути числом');
  if (!isLText(x.name)) err(file, 'name.uk відсутній');
  if (!Array.isArray(x.users) || x.users.length === 0 || x.users.some((u) => !toolUsers.includes(u)))
    err(file, `users має бути непорожнім масивом зі значень ${toolUsers.join(', ')}`);
  if (!isLText(x.summary)) err(file, 'summary.uk відсутній');
  if (x.description !== undefined && !isLText(x.description)) err(file, 'description.uk відсутній');
  checkPhotos(file, x.photos);
  checkSources(file, x.sources);
}

if (errors.length) {
  console.error(`\nЗнайдено помилок у даних: ${errors.length}\n`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`Дані перевірено: ${periodIds.size} періодів, ${placeIds.size} місць, ${listJson("events").length} подій, ${listJson("maps").length} мап, ${existsSync(routesDir) ? readdirSync(routesDir).filter((f) => f.endsWith(".geojson")).length : 0} анімацій, ${bordersCount} років кордонів, ${toolFiles.length} інструментів.`);
