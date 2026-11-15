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
function checkCoords(file, coords, label = 'coords') {
  if (!Array.isArray(coords) || coords.length !== 2 || coords.some((n) => typeof n !== 'number'))
    return err(file, `${label} має бути [lon, lat]`);
  const [lon, lat] = coords;
  if (lon < 18 || lon > 20.5 || lat < 46.5 || lat > 48.5)
    err(file, `${label} [${lon}, ${lat}] поза регіоном (очікується околиця Göd); можливо, переплутано lon/lat`);
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
const placeTypes = ['settlement', 'archaeological', 'church', 'castle', 'monument', 'nature', 'other'];
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
  if (p.type === 'archaeological' && p.coordsPrecision === 'exact')
    err(file, 'археологічна пам\'ятка з coordsPrecision "exact": підтвердьте в note джерела, що офіційне джерело публікує точні координати, або змініть на approximate/settlement');
  if (!Array.isArray(p.periods) || p.periods.length === 0) err(file, 'periods порожній');
  else p.periods.forEach((id) => periodIds.has(id) || err(file, `невідомий період "${id}"`));
  if (!isLText(p.summary)) err(file, 'summary.uk відсутній');
  if (p.description !== undefined && !isLText(p.description)) err(file, 'description.uk відсутній');
  checkPhotos(file, p.photos);
  checkSources(file, p.sources);
}

// events
const dateRe = /^-?\d{1,4}(-\d{2}(-\d{2})?)?$/;
for (const { file, path, name } of listJson('events')) {
  const e = readJson(path);
  if (!e) continue;
  if (e.id !== name) err(file, `id "${e.id}" має збігатися з назвою файлу "${name}"`);
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

// maps
for (const { file, path, name } of listJson('maps')) {
  const m = readJson(path);
  if (!m) continue;
  if (m.id !== name) err(file, `id має збігатися з назвою файлу "${name}"`);
  if (!isLText(m.title)) err(file, 'title.uk відсутній');
  for (const k of ['license', 'attribution', 'url'])
    if (typeof m[k] !== 'string' || !m[k].trim()) err(file, `${k} відсутній`);
  if (!['image', 'xyz'].includes(m.type)) err(file, 'type має бути image | xyz');
  if (m.type === 'image') {
    if (!Array.isArray(m.coordinates) || m.coordinates.length !== 4) err(file, 'coordinates: потрібно 4 кути [NW, NE, SE, SW]');
    else m.coordinates.forEach((c, i) => checkCoords(file, c, `coordinates[${i}]`));
  }
  if (m.periods) m.periods.forEach((id) => periodIds.has(id) || err(file, `невідомий період "${id}"`));
  if (!m.source || typeof m.source.title !== 'string') err(file, 'source.title відсутній');
}

// routes
const routesDir = join(root, 'routes');
if (existsSync(routesDir))
  for (const f of readdirSync(routesDir).filter((f) => f.endsWith('.geojson'))) {
    const file = `data/routes/${f}`;
    const g = readJson(join(routesDir, f));
    if (!g) continue;
    if (g.type !== 'FeatureCollection') err(file, 'очікується FeatureCollection');
    (g.features ?? []).forEach((ft, i) => {
      const pr = ft.properties ?? {};
      if (!periodIds.has(pr.period)) err(file, `features[${i}]: невідомий період "${pr.period}"`);
      if (!['military', 'trade', 'border', 'growth'].includes(pr.kind)) err(file, `features[${i}]: kind має бути military | trade | border | growth`);
      if (!isLText(pr.title)) err(file, `features[${i}]: title.uk відсутній`);
      checkSources(`${file} features[${i}]`, pr.sources);
    });
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

if (errors.length) {
  console.error(`\nЗнайдено помилок у даних: ${errors.length}\n`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`Дані перевірено: ${periodIds.size} періодів, ${placeIds.size} місць, ${listJson('events').length} подій, ${listJson('maps').length} мап.`);
