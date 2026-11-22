// Власні шляхи людини (треки): пройдений шлях, записаний тут під час прогулянки або завантажений з файлу
// (GPX чи GeoJSON з іншої програми — наприклад, з майбутньої програми для копу, яка пише GPS з вимкненим екраном).
// Зберігаються ЛИШЕ в цьому браузері (IndexedDB, src/localdb.ts); у репозиторій і на сервер нічого не йде.
import { fmtDateTime, t } from './i18n';
import { distance, pathLength } from './geo';
import { idbAll, idbDelete, idbPut, TRACKS_STORE } from './localdb';
import { MARK_COLORS, MARK_HEX, type MarkColor } from './marks';
import { holdScreen } from './tracking';

/** Точка шляху: довгота, широта, час у мс від епохи (0 — часу немає). */
export type TrackPoint = [number, number, number];

export interface Track {
  id: string;
  name: string;
  color: MarkColor;
  /** Початок шляху (ISO 8601): час першої точки, а якщо часів немає — час завантаження файлу. */
  created: string;
  /** Записано тут чи завантажено з файлу. */
  source: 'rec' | 'file';
  /** Відрізки шляху: новий відрізок починається після перерви (сигнал зник, екран гаснув, пауза у файлі). */
  segs: TrackPoint[][];
  /** Довжина, м. */
  length: number;
  /** Тривалість за часами точок, с (сума по відрізках); немає часів — немає поля. */
  duration?: number;
  /** Не показувати на мапі. */
  hidden?: boolean;
  /** Запис ще триває. */
  recording?: boolean;
}

let cache: Track[] = [];
let loading: Promise<void> | null = null;
/** Браузер не дав сховища (приватний режим, немає місця): шляхи живуть лише до закриття вкладки. */
let noStorage = false;
const listeners = new Set<() => void>();
const emit = () => { for (const cb of listeners) cb(); };

export function onTracksChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export const tracksStorageFailed = () => noStorage;

const isColor = (x: unknown): x is MarkColor => MARK_COLORS.includes(x as MarkColor);
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const validPos = (lon: unknown, lat: unknown): boolean =>
  typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;

/** Довжина й тривалість за відрізками. */
function measure(segs: TrackPoint[][]): { length: number; duration?: number } {
  let length = 0, duration = 0, timed = false;
  for (const s of segs) {
    length += pathLength(s);
    const a = s[0]?.[2] ?? 0, b = s[s.length - 1]?.[2] ?? 0;
    if (a > 0 && b > a) { duration += (b - a) / 1000; timed = true; }
  }
  return timed ? { length, duration } : { length };
}

function clean(x: Partial<Track> | null | undefined): Track | null {
  if (!x || typeof x.id !== 'string' || !x.id || !Array.isArray(x.segs)) return null;
  const segs = x.segs
    .map((s) => (Array.isArray(s) ? s : []).filter((p) => Array.isArray(p) && validPos(p[0], p[1])).map((p): TrackPoint => [r6(p[0]), r6(p[1]), Number.isFinite(p[2]) && p[2] > 0 ? Math.round(p[2]) : 0]))
    .filter((s) => s.length > 0);
  const created = typeof x.created === 'string' && !Number.isNaN(Date.parse(x.created)) ? x.created : new Date().toISOString();
  const tr: Track = { id: x.id.slice(0, 64), name: (typeof x.name === 'string' ? x.name : '').slice(0, 120), color: isColor(x.color) ? x.color : 'blue', created, source: x.source === 'file' ? 'file' : 'rec', segs, ...measure(segs) };
  if (x.hidden) tr.hidden = true;
  if (x.recording) tr.recording = true;
  return tr;
}

async function persist(tr: Track): Promise<boolean> {
  try { await idbPut(TRACKS_STORE, tr); return true; } catch { noStorage = true; return false; }
}

/** Читає шляхи зі сховища браузера (один раз); далі `tracks()` віддає їх з пам'яті. */
export function loadTracks(): Promise<void> {
  loading ??= idbAll<Track>(TRACKS_STORE)
    .then((list) => {
      const fromDb = list.map((x) => clean(x)).filter((x): x is Track => !!x);
      // запис, який обірвало закриття вкладки чи перезавантаження: шлях лишається, як його встигли зберегти
      for (const tr of fromDb) if (tr.recording) { delete tr.recording; void persist(tr); }
      const have = new Set(cache.map((x) => x.id));
      cache = [...cache, ...fromDb.filter((x) => !have.has(x.id))];
    })
    .catch(() => { noStorage = true; })
    .then(emit);
  return loading;
}

/** Усі шляхи, найновіші спершу. */
export const tracks = (): Track[] => [...cache].sort((a, b) => b.created.localeCompare(a.created));
export const trackById = (id: string): Track | undefined => cache.find((x) => x.id === id);
export const trackPoints = (tr: Track): number => tr.segs.reduce((n, s) => n + s.length, 0);

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function updateTrack(id: string, patch: Partial<Pick<Track, 'name' | 'color' | 'hidden'>>): void {
  const tr = trackById(id);
  if (!tr) return;
  if (patch.name !== undefined) tr.name = patch.name.slice(0, 120);
  if (patch.color !== undefined && isColor(patch.color)) tr.color = patch.color;
  if (patch.hidden !== undefined) { if (patch.hidden) tr.hidden = true; else delete tr.hidden; }
  void persist(tr);
  emit();
}

export function deleteTrack(id: string): void {
  // шлях, який саме записується: зупиняємо запис без збереження
  if (rec?.track.id === id) { navigator.geolocation.clearWatch(rec.watch); rec = null; holdScreen(-1); }
  cache = cache.filter((x) => x.id !== id);
  void idbDelete(TRACKS_STORE, id).catch(() => undefined);
  emit();
}

/** Лінії для шару мапи: один об'єкт на шлях, відрізки — частини MultiLineString. */
export function tracksGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: cache
      .filter((tr) => !tr.hidden)
      .map((tr) => ({
        type: 'Feature' as const,
        geometry: { type: 'MultiLineString' as const, coordinates: tr.segs.filter((s) => s.length > 1).map((s) => s.map((p) => [p[0], p[1]])) },
        properties: { id: tr.id, color: MARK_HEX[tr.color] },
      }))
      .filter((f) => f.geometry.coordinates.length > 0),
  };
}

/** Рамка шляху [захід, південь, схід, північ] або null, якщо точок немає. */
export function trackBounds(tr: Track): [number, number, number, number] | null {
  let w = 180, s = 90, e = -180, n = -90;
  for (const seg of tr.segs) for (const p of seg) { w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
  return w <= e ? [w, s, e, n] : null;
}

// ---------- файл: завантаження ----------
type Parsed = { name: string; segs: TrackPoint[][] };

function parseGpx(text: string): Parsed[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('not GPX');
  const pt = (el: Element): TrackPoint | null => {
    const lat = Number(el.getAttribute('lat')), lon = Number(el.getAttribute('lon'));
    if (el.getAttribute('lat') === null || el.getAttribute('lon') === null || !validPos(lon, lat)) return null;
    const time = Date.parse(el.getElementsByTagName('time')[0]?.textContent ?? '');
    return [r6(lon), r6(lat), Number.isNaN(time) ? 0 : time];
  };
  const pts = (els: HTMLCollectionOf<Element>) => [...els].map(pt).filter((p): p is TrackPoint => !!p);
  /** Назва — лише власний елемент name, а не name вкладених точок. */
  const nameOf = (el: Element) => [...el.children].find((c) => c.localName === 'name')?.textContent?.trim() ?? '';
  const out: Parsed[] = [];
  for (const trk of doc.getElementsByTagName('trk')) out.push({ name: nameOf(trk), segs: [...trk.getElementsByTagName('trkseg')].map((s) => pts(s.getElementsByTagName('trkpt'))) });
  for (const rte of doc.getElementsByTagName('rte')) out.push({ name: nameOf(rte), segs: [pts(rte.getElementsByTagName('rtept'))] });
  if (!out.length && !doc.getElementsByTagName('gpx').length) throw new Error('not GPX');
  return out;
}

function parseGeoJson(text: string): Parsed[] {
  type G = { type?: string; coordinates?: unknown; geometries?: G[] };
  type F = { type?: string; geometry?: G | null; properties?: Record<string, unknown> | null; features?: F[] };
  const doc = JSON.parse(text) as F & G;
  const feats: F[] = doc.type === 'FeatureCollection' && Array.isArray(doc.features) ? doc.features : doc.type === 'Feature' ? [doc] : doc.type ? [{ type: 'Feature', geometry: doc, properties: {} }] : [];
  if (!doc.type) throw new Error('not GeoJSON');
  const out: Parsed[] = [];
  for (const f of feats) {
    const p = f.properties ?? {};
    const lines = (g: G | null | undefined): unknown[][] =>
      !g ? [] : g.type === 'LineString' ? [g.coordinates as unknown[]] : g.type === 'MultiLineString' ? (g.coordinates as unknown[][]) : g.type === 'GeometryCollection' ? (g.geometries ?? []).flatMap(lines) : [];
    const ls = lines(f.geometry);
    if (!ls.length) continue;
    // часи точок: властивість coordTimes (так пишуть перетворювачі GPX → GeoJSON) — один перелік або по одному на лінію
    const ct = (p.coordTimes ?? p.coordinateProperties ?? p.times) as unknown;
    const times: unknown[][] = Array.isArray(ct) ? (Array.isArray(ct[0]) ? (ct as unknown[][]) : [ct as unknown[]]) : [];
    const segs = ls.map((line, i) => (Array.isArray(line) ? line : []).map((c, k): TrackPoint | null => {
      const xy = c as unknown[];
      if (!Array.isArray(xy) || !validPos(xy[0], xy[1])) return null;
      const raw = times[i]?.[k];
      const time = typeof raw === 'number' ? raw : typeof raw === 'string' ? Date.parse(raw) : NaN;
      return [r6(xy[0] as number), r6(xy[1] as number), Number.isFinite(time) && time > 0 ? time : 0];
    }).filter((x): x is TrackPoint => !!x));
    out.push({ name: typeof p.name === 'string' ? p.name : typeof p.title === 'string' ? p.title : '', segs });
  }
  return out;
}

/**
 * Додає шляхи з файлу GPX (trk, rte) або GeoJSON (LineString, MultiLineString). Шлях з тією самою назвою,
 * першою точкою й кількістю точок, що вже є, пропускається. Кидає помилку, якщо файл не розпізнано.
 */
export async function importTracks(text: string, fileName: string): Promise<{ added: number; skipped: number; first?: Track }> {
  const parsed = text.trimStart().startsWith('<') ? parseGpx(text) : parseGeoJson(text);
  const base = fileName.replace(/\.[^.]+$/, '').slice(0, 100);
  const key = (name: string, segs: TrackPoint[][]) => `${name}|${segs[0]?.[0]?.slice(0, 2).join(',')}|${segs.reduce((n, s) => n + s.length, 0)}`;
  const have = new Set(cache.map((x) => key(x.name, x.segs)));
  let added = 0, skipped = 0;
  let first: Track | undefined;
  for (const [i, p] of parsed.entries()) {
    const segs = p.segs.filter((s) => s.length > 1);
    const name = (p.name || (parsed.length > 1 ? `${base} ${i + 1}` : base) || t('trackDefault')).slice(0, 120);
    if (!segs.length || have.has(key(name, segs))) { skipped++; continue; }
    const t0 = segs[0][0][2];
    const tr: Track = { id: newId() + added, name, color: 'blue', created: new Date(t0 > 0 ? t0 : Date.now()).toISOString(), source: 'file', segs, ...measure(segs) };
    have.add(key(name, segs));
    cache.push(tr);
    await persist(tr);
    first ??= tr;
    added++;
  }
  if (added) emit();
  return { added, skipped, first };
}

// ---------- файл: вивантаження ----------
const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Шлях у форматі GPX 1.1 — його читають навігатори, ГІС і більшість програм для прогулянок. */
export function exportGpx(tr: Track): string {
  const seg = (s: TrackPoint[]) => `<trkseg>\n${s.map((p) => `<trkpt lat="${p[1]}" lon="${p[0]}">${p[2] > 0 ? `<time>${new Date(p[2]).toISOString()}</time>` : ''}</trkpt>`).join('\n')}\n</trkseg>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="istoria-map" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><time>${xml(tr.created)}</time></metadata>\n<trk><name>${xml(tr.name)}</name>\n${tr.segs.map(seg).join('\n')}\n</trk>\n</gpx>\n`;
}

// ---------- запис ----------
/** Точки з гіршою точністю GPS не записуємо: вони лише псують лінію. */
const MAX_ACCURACY = 40;
/** Перерва в сигналі понад стільки секунд і зсув понад GAP_M метрів — новий відрізок (не малюємо пряму через невідоме). */
const GAP_S = 60;
const GAP_M = 30;

let rec: { track: Track; watch: number; accuracy: number | null; weak: boolean; unsaved: number; savedAt: number } | null = null;

export const isRecording = (): boolean => !!rec;
/** Стан запису для панелі: шлях, остання точність GPS (м) і чи сигнал зараз заслабкий. */
export const recordingState = (): { track: Track; accuracy: number | null; weak: boolean } | null => (rec ? { track: rec.track, accuracy: rec.accuracy, weak: rec.weak } : null);

function onPosition(pos: GeolocationPosition): void {
  if (!rec) return;
  const { longitude: lon, latitude: lat, accuracy } = pos.coords;
  rec.accuracy = Math.round(accuracy);
  rec.weak = accuracy > MAX_ACCURACY;
  if (rec.weak || !validPos(lon, lat)) { emit(); return; }
  const tr = rec.track;
  const p: TrackPoint = [r6(lon), r6(lat), Math.round(pos.timestamp || Date.now())];
  let seg = tr.segs[tr.segs.length - 1];
  const last = seg[seg.length - 1];
  if (last) {
    const d = distance(last, p);
    if ((p[2] - last[2]) / 1000 > GAP_S && d > GAP_M) { seg = []; tr.segs.push(seg); }
    // стоїмо на місці: дрібні коливання GPS не записуємо
    else if (d < Math.max(3, accuracy * 0.3)) { emit(); return; }
    else tr.length += d;
  }
  seg.push(p);
  // тривалість — за першою й останньою точкою кожного відрізка (довжину вже додано вище)
  tr.duration = tr.segs.reduce((sum, x) => sum + (x.length > 1 ? (x[x.length - 1][2] - x[0][2]) / 1000 : 0), 0);
  rec.unsaved++;
  if (rec.unsaved >= 25 || Date.now() - rec.savedAt > 20000) flush();
  emit();
}

function flush(): void {
  if (!rec || !rec.unsaved) return;
  rec.unsaved = 0;
  rec.savedAt = Date.now();
  void persist(rec.track);
}
// вкладку ховають або закривають — зберігаємо, що встигли записати
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush);

/** Починає запис шляху. false — браузер не має доступу до місця. */
export function startRecording(): boolean {
  if (rec) return true;
  if (!('geolocation' in navigator)) return false;
  const now = new Date();
  const track: Track = { id: newId(), name: `${t('trackDefault')} ${fmtDateTime(now.toISOString())}`, color: 'blue', created: now.toISOString(), source: 'rec', segs: [[]], length: 0, recording: true };
  cache.push(track);
  const watch = navigator.geolocation.watchPosition(onPosition, () => { if (rec) { rec.weak = true; emit(); } }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  rec = { track, watch, accuracy: null, weak: false, unsaved: 0, savedAt: Date.now() };
  // поки йде запис, екран не гасне: із загаслим екраном браузер перестає давати координати
  holdScreen(1);
  emit();
  return true;
}

/** Завершує запис. Повертає шлях або null, якщо точок замало (тоді його не зберігаємо). */
export async function stopRecording(): Promise<Track | null> {
  if (!rec) return null;
  const { track, watch } = rec;
  navigator.geolocation.clearWatch(watch);
  rec = null;
  holdScreen(-1);
  delete track.recording;
  track.segs = track.segs.filter((s) => s.length > 1);
  Object.assign(track, measure(track.segs));
  if (!track.segs.length) {
    cache = cache.filter((x) => x.id !== track.id);
    void idbDelete(TRACKS_STORE, track.id).catch(() => undefined);
    emit();
    return null;
  }
  await persist(track);
  emit();
  return track;
}
