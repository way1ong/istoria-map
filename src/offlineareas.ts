// Старі мапи в повній якості без інтернету: для вибраних ділянок оригінали Spezialkarte й мапи Ліпскі
// (тайли з серверів IIIF бібліотек — саме ті адреси, які запитує Allmaps) зберігаються в кеші браузера.
// Service worker (vite.config.ts) віддає їх Allmaps і без мережі, а з мережею — замість повторного завантаження.
// Цілу країну так не зберегти: аркуш IOS у повній роздільності важить ~130 МБ, тому — ділянками.
import { histMaps, mapSeries, places } from './data';
import { beginJob, endJob, failureKind, fetchInto, offlineSupported, setOfflineLost, siteUrl, tickJob, type DownloadResult } from './offline';
import type { Place } from './types';

/** Кеш ділянок; та сама назва — у правилі service worker для серверів IIIF. */
export const IIIF_CACHE = 'istoria-offline-iiif';
type BBox = [number, number, number, number];

export interface SavedArea {
  id: string;
  /** [захід, південь, схід, північ] */
  bbox: BBox;
  /** Назва найближчого до центру населеного пункту з підписів мапи (місцевою мовою) — для «біля …». */
  label?: string;
  /** Запасна назва: найближче населене місце з карток. */
  placeId?: string;
  bytes: number;
  tiles: number;
  /** YYYY-MM-DD */
  date: string;
}

const LS = 'istoria.offline.areas';
export function savedAreas(): SavedArea[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS) ?? '[]') as SavedArea[];
    return Array.isArray(v) ? v.filter((a) => Array.isArray(a.bbox) && a.bbox.length === 4) : [];
  } catch { return []; }
}
function saveAreas(list: SavedArea[]) {
  try { localStorage.setItem(LS, JSON.stringify(list)); } catch { /* без запам'ятовування */ }
  emitAreas();
}

/** Хто стежить за ділянками й налаштуванням меж на мапі (src/map.ts малює межі пунктиром). */
const areaListeners = new Set<() => void>();
export function onAreasChange(cb: () => void): () => void {
  areaListeners.add(cb);
  return () => areaListeners.delete(cb);
}
function emitAreas() { for (const cb of areaListeners) cb(); }

/**
 * Чи показувати рамки збережених ділянок на мапі. Вирішує лише перемикач у панелі «Без інтернету» (типово ввімкнено):
 * увімкнено — рамки видно завжди, з будь-якою старою мапою і без неї; вимкнено — не видно.
 * (Раніше рамки ще й ховалися самі без Spezialkarte чи мапи Ліпскі; автор 2026-11-22 сприйняв це як ваду:
 * галочка стоїть, а рамка зникає, щойно закрити панель.)
 */
const OUTLINE_LS = 'istoria.offline.areasOutline';
export function areasOutline(): boolean {
  try { return localStorage.getItem(OUTLINE_LS) !== '0'; } catch { return true; }
}
export function setAreasOutline(v: boolean): void {
  try { localStorage.setItem(OUTLINE_LS, v ? '1' : '0'); } catch { /* приватний режим */ }
  emitAreas();
}

/** «Показати» в списку ділянок: навіть з вимкненими рамками рамка з'являється на кілька секунд, щоб було видно, куди перенесло мапу. */
let peekTimer = 0;
export function peekAreas(ms = 8000): void {
  clearTimeout(peekTimer);
  peekTimer = window.setTimeout(() => { peekTimer = 0; emitAreas(); }, ms);
  emitAreas();
}
/** Чи малювати рамки просто зараз: увімкнено перемикачем або щойно натиснуто «Показати». */
export function areasVisible(): boolean {
  return areasOutline() || peekTimer !== 0;
}

/**
 * Чи вся видима частина мапи лежить у збережених ділянках (однією чи кількома сусідніми) — тоді запасні
 * зображення не потрібні. Перевіряємо сіткою 5×5 точок.
 */
export function areaCovers(b: BBox): boolean {
  const areas = savedAreas();
  if (!areas.length) return false;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
    const x = b[0] + ((b[2] - b[0]) * i) / 4, y = b[1] + ((b[3] - b[1]) * j) / 4;
    if (!areas.some((a) => x >= a.bbox[0] && x <= a.bbox[2] && y >= a.bbox[1] && y <= a.bbox[3])) return false;
  }
  return true;
}

/** Межі збережених ділянок для показу на мапі (пунктирні прямокутники). */
export function areasGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: savedAreas().map((a) => ({
      type: 'Feature' as const,
      properties: { id: a.id },
      geometry: { type: 'Polygon' as const, coordinates: [[[a.bbox[0], a.bbox[1]], [a.bbox[2], a.bbox[1]], [a.bbox[2], a.bbox[3]], [a.bbox[0], a.bbox[3]], [a.bbox[0], a.bbox[1]]]] },
    })),
  };
}

let storageP: Promise<number> | null = null;
/** Скільки насправді займають усі збережені ділянки: кожен тайл рахується один раз, хоч би скільки ділянок його мали. */
export function areasStorage(): Promise<number> {
  if (!storageP) {
    storageP = (async () => {
      if (!offlineSupported() || !(await caches.has(IIIF_CACHE))) return 0;
      const cache = await caches.open(IIIF_CACHE);
      let sum = 0;
      for (const r of await cache.keys()) {
        const res = await cache.match(r);
        const n = Number(res?.headers.get('content-length'));
        sum += Number.isFinite(n) && n > 0 ? n : (await res?.blob())?.size ?? 0;
      }
      return sum;
    })();
  }
  return storageP;
}

/** Ширина й висота ділянки в кілометрах. */
export function areaKm(b: BBox): [number, number] {
  const k = 111.32;
  return [(b[2] - b[0]) * k * Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180), (b[3] - b[1]) * k];
}

/** Найближче до центру ділянки місце (для назви). */
export function nearestPlace(b: BBox): Place | undefined {
  const c: [number, number] = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const kx = Math.cos(c[1] * Math.PI / 180);
  let best: Place | undefined;
  let bd = Infinity;
  for (const p of places) {
    if (p.type !== 'settlement') continue;
    const d = ((p.coords[0] - c[0]) * kx) ** 2 + (p.coords[1] - c[1]) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// ---------- прив'язки й тайли ----------
interface GeoItem {
  /** Адреса служби IIIF зображення (без /info.json). */
  service: string;
  /** Опорні точки: піксель скана ↔ [довгота, широта]. */
  gcps: { px: [number, number]; geo: [number, number] }[];
  bbox: BBox;
}

/** Файли прив'язок (Georeference Annotation) усіх старих мап, що показуються з IIIF. */
function georefPaths(): string[] {
  return [...new Set([...mapSeries.map((s) => s.georef), ...histMaps.map((m) => m.georef)].filter((x): x is string => !!x))];
}

/** Відповідь з кешу (якщо є), інакше з мережі — і тоді покласти її в кеш ділянок. */
async function cachedJson(url: string, cache: Cache): Promise<unknown> {
  const hit = await cache.match(url, { ignoreVary: true });
  if (hit) return hit.json();
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`${res.status}: ${url}`);
  await cache.put(url, res.clone());
  return res.json();
}

async function loadItems(cache: Cache): Promise<GeoItem[]> {
  const out: GeoItem[] = [];
  for (const path of georefPaths()) {
    const page = await cachedJson(siteUrl(path), cache) as { items?: { target: { source: { id: string } }; body: { features: { properties: { resourceCoords: [number, number] }; geometry: { coordinates: [number, number] } }[] } }[] };
    for (const it of page.items ?? []) {
      const gcps = it.body.features.map((f) => ({ px: f.properties.resourceCoords, geo: f.geometry.coordinates }));
      const lons = gcps.map((g) => g.geo[0]), lats = gcps.map((g) => g.geo[1]);
      out.push({ service: it.target.source.id.replace(/\/$/, ''), gcps, bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] });
    }
  }
  return out;
}

/** Найменші квадрати для px = a0 + a1·lon + a2·lat за найближчими до точки опорними точками. */
function localAffine(item: GeoItem, at: [number, number]) {
  const kx = Math.cos(at[1] * Math.PI / 180);
  const d2 = (g: { geo: [number, number] }) => ((g.geo[0] - at[0]) * kx) ** 2 + (g.geo[1] - at[1]) ** 2;
  const pts = [...item.gcps].sort((a, b) => d2(a) - d2(b)).slice(0, 12);
  // нормальні рівняння 3×3 для x і для y
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
  for (const g of pts) {
    const v = [1, g.geo[0] - at[0], g.geo[1] - at[1]];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) M[i][j] += v[i] * v[j];
      bx[i] += v[i] * g.px[0];
      by[i] += v[i] * g.px[1];
    }
  }
  const solve = (b: number[]) => {
    const A = M.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r < 3; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k]; }
    }
    return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
  };
  const ax = solve(bx), ay = solve(by);
  return (lon: number, lat: number): [number, number] => {
    const v = [1, lon - at[0], lat - at[1]];
    return [ax[0] * v[0] + ax[1] * v[1] + ax[2] * v[2], ay[0] * v[0] + ay[1] * v[1] + ay[2] * v[2]];
  };
}

/** Приблизний розмір тайла (байти) за сервером і масштабом: виміряно на зразках 2026-11-21. */
function estTile(url: string, scaleFactor: number): number {
  if (url.includes('davidrumsey.com')) return scaleFactor === 1 ? 830e3 : scaleFactor === 2 ? 600e3 : 300e3;
  if (url.includes('nypl.org')) return scaleFactor === 1 ? 100e3 : 70e3;
  return scaleFactor === 1 ? 460e3 : scaleFactor === 2 ? 220e3 : 80e3;
}

export interface AreaPlan {
  bbox: BBox;
  /** Адреси тайлів у тому самому вигляді, що їх запитує Allmaps. */
  tiles: string[];
  /** Скільки аркушів (зображень) зачіпає ділянка. */
  images: number;
  estBytes: number;
  /** Тайлів, яких ще немає серед збережених (інші ділянки могли вже мати частину), і їхній приблизний розмір. */
  newTiles: number;
  newBytes: number;
}

/**
 * Які тайли потрібні Allmaps для ділянки на всіх масштабах: аркуші, що її зачіпають, і для кожного — тайли всіх
 * рівнів піраміди IIIF, що покривають ділянку (з невеликим запасом). info.json аркушів кешуються заодно.
 */
export async function planArea(bbox: BBox): Promise<AreaPlan> {
  const cache = await caches.open(IIIF_CACHE);
  const items = (await loadItems(cache)).filter((it) => it.bbox[0] < bbox[2] && it.bbox[2] > bbox[0] && it.bbox[1] < bbox[3] && it.bbox[3] > bbox[1]);
  const { Image } = await import('@allmaps/iiif-parser');
  const tiles = new Set<string>();
  const have = new Set((await cache.keys()).map((r) => r.url));
  let estBytes = 0, newBytes = 0, newTiles = 0;
  for (const it of items) {
    const image = Image.parse(await cachedJson(`${it.service}/info.json`, cache));
    // ділянка, обрізана межами аркуша, у пікселях скана (рамка аркуша — з опорних точок)
    const w = Math.max(bbox[0], it.bbox[0]), s = Math.max(bbox[1], it.bbox[1]), e = Math.min(bbox[2], it.bbox[2]), n = Math.min(bbox[3], it.bbox[3]);
    const f = localAffine(it, [(w + e) / 2, (s + n) / 2]);
    const corners = [f(w, s), f(w, n), f(e, s), f(e, n)];
    const pad = 0.01 * Math.max(image.width, image.height);
    const x0 = Math.max(0, Math.min(...corners.map((c) => c[0])) - pad), x1 = Math.min(image.width, Math.max(...corners.map((c) => c[0])) + pad);
    const y0 = Math.max(0, Math.min(...corners.map((c) => c[1])) - pad), y1 = Math.min(image.height, Math.max(...corners.map((c) => c[1])) + pad);
    if (x1 <= x0 || y1 <= y0) continue;
    for (const lv of image.tileZoomLevels) {
      const c0 = Math.floor(x0 / lv.originalWidth), c1 = Math.min(lv.columns - 1, Math.floor(x1 / lv.originalWidth));
      const r0 = Math.floor(y0 / lv.originalHeight), r1 = Math.min(lv.rows - 1, Math.floor(y1 / lv.originalHeight));
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
        const url = image.getImageUrl(image.getTileImageRequest(lv, c, r), { preferredFormats: ['webp', 'jpg'] });
        if (tiles.has(url)) continue;
        tiles.add(url);
        const est = estTile(url, lv.scaleFactor);
        estBytes += est;
        if (!have.has(url)) { newTiles++; newBytes += est; }
      }
    }
  }
  return { bbox, tiles: [...tiles], images: items.length, estBytes, newTiles, newBytes };
}

const listUrl = (id: string) => siteUrl(`offline/areas/${id}.json`);

/**
 * Зберегти ділянку: info.json усіх аркушів (щоб Allmaps без мережі знав про всі аркуші) і тайли ділянки.
 * Уже збережені тайли (з інших ділянок) не завантажуються вдруге.
 */
export async function downloadArea(plan: AreaPlan, label?: string): Promise<DownloadResult> {
  if (!offlineSupported()) return 'error';
  const job = beginJob('area', true);
  if (!job) return 'error';
  try {
    await navigator.storage?.persist?.().catch(() => false);
    const cache = await caches.open(IIIF_CACHE);
    // info.json усіх аркушів: маленькі, а без них Allmaps без мережі не відкриє решту аркушів
    const items = await loadItems(cache);
    const have = new Set((await cache.keys()).map((r) => r.url));
    const infos = items.map((it) => `${it.service}/info.json`).filter((u) => !have.has(u));
    const tiles = plan.tiles.filter((u) => !have.has(u));
    job.total = infos.length + plan.tiles.length;
    job.done = job.total - infos.length - tiles.length;
    let fatal: unknown = null;
    const run = async (list: string[], conc: number) => {
      let next = 0;
      const worker = async () => {
        while (next < list.length && !job.abort.signal.aborted) {
          const url = list[next++];
          try {
            job.bytes += await fetchInto(cache, url, 0, job.abort.signal, () => {});
            job.done++;
            tickJob();
          } catch (e) {
            if (job.abort.signal.aborted) return;
            fatal = e;
            job.abort.abort();
            return;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(conc, Math.max(1, list.length)) }, worker));
    };
    // сервери бібліотек: info.json (маленькі) — по вісім, тайли — не більше чотирьох запитів одночасно
    await run(infos, 8);
    await run(tiles, 4);
    if (fatal) throw fatal;
    if (job.abort.signal.aborted) return 'aborted';
    const id = `a${Date.now().toString(36)}`;
    await cache.put(listUrl(id), new Response(JSON.stringify(plan.tiles), { headers: { 'content-type': 'application/json' } }));
    let bytes = 0;
    for (const u of plan.tiles) bytes += (await (await cache.match(u, { ignoreVary: true }))?.blob())?.size ?? 0;
    const area: SavedArea = { id, bbox: plan.bbox, label, placeId: nearestPlace(plan.bbox)?.id, bytes, tiles: plan.tiles.length, date: new Date().toISOString().slice(0, 10) };
    saveAreas([...savedAreas(), area]);
    storageP = null;
    setOfflineLost(false);
    return 'ok';
  } catch (e) {
    return failureKind(e);
  } finally {
    endJob(job);
  }
}

/** Видалити ділянку: лише тайли, яких не потребують інші збережені ділянки. */
export async function deleteArea(id: string): Promise<void> {
  const rest = savedAreas().filter((a) => a.id !== id);
  saveAreas(rest);
  storageP = null;
  if (!offlineSupported()) return;
  const cache = await caches.open(IIIF_CACHE);
  const list = async (aid: string) => ((await (await cache.match(listUrl(aid)))?.json()) ?? []) as string[];
  const keep = new Set<string>();
  for (const a of rest) for (const u of await list(a.id)) keep.add(u);
  for (const u of await list(id)) if (!keep.has(u)) await cache.delete(u, { ignoreVary: true });
  await cache.delete(listUrl(id));
  if (!rest.length) await caches.delete(IIIF_CACHE);
  storageP = null;
}

/** Кеш міг стерти браузер, коли бракувало місця, або інший сайт з тієї самої адреси: тоді збережених ділянок більше немає. */
export async function verifyAreas(): Promise<boolean> {
  if (!offlineSupported() || !savedAreas().length) return false;
  if (await caches.has(IIIF_CACHE)) return false;
  saveAreas([]);
  storageP = null;
  setOfflineLost(true);
  return true;
}
