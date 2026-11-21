// Робота без інтернету: пакети файлів у кеші браузера (Cache Storage) і читання з них мапи Угорщини.
//
// Пакети: basemap — сучасна мапа (частини файлу PMTiles, стиль, шрифти), generalkarte — тайли генеральної
// мапи ~1910, oldmaps — запасні зображення старих мап (огляд Spezialkarte, аркуші біля Göd, Ліпскі),
// photos — мініатюри фото карток. Перелік файлів дає offline/packs.json (його створює
// scripts/offline/packs-plugin.mjs під час збірки), перелік фото — самі дані карток.
// Тайли generalkarte, зображення старих мап і фото service worker (vite.config.ts) бере з тих самих кешів;
// мапу Угорщини й шрифти читають напряму обробники адрес pmtiles:// і offline:// — вони працюють і тоді,
// коли service worker ще не встановився.
import { addProtocol, type AddProtocolAction } from 'maplibre-gl';
import { events, places, tools } from './data';
import { thumbUrl } from './ui/render';

export type PackId = 'basemap' | 'generalkarte' | 'oldmaps' | 'photos';
export const PACK_IDS: PackId[] = ['basemap', 'generalkarte', 'oldmaps', 'photos'];
/** Назви кешів; ті самі назви — у правилах service worker у vite.config.ts. */
export const CACHE_NAME: Record<PackId, string> = {
  basemap: 'istoria-offline-basemap',
  generalkarte: 'istoria-offline-generalkarte',
  oldmaps: 'istoria-offline-oldmaps',
  photos: 'istoria-offline-photos',
};

/** Корінь сайту, напр. https://way1ong.github.io/istoria-map/ */
const SITE = new URL(import.meta.env.BASE_URL, location.href).href;
export const siteUrl = (path: string) => new URL(path, SITE).href;
/** Cache Storage є лише на https (і localhost). */
export const offlineSupported = () => typeof caches !== 'undefined';

/** [шлях від кореня сайту або повна адреса, розмір у байтах (0 — невідомий)] */
type FileEntry = [string, number];
export interface PackManifest {
  version: string;
  bytes: number;
  files: FileEntry[];
  /** Лише для basemap: частини файлу PMTiles (назви містять дату збірки, тож довантажуються без повторів). */
  parts?: FileEntry[];
  /** Для basemap: дата даних OpenStreetMap (YYYY-MM-DD). */
  date?: string;
  maxzoom?: number;
}
export type PacksManifest = Record<Exclude<PackId, 'photos'>, PackManifest>;

let manifestP: Promise<PacksManifest> | null = null;
/** offline/packs.json з сайту (без мережі — помилка; тоді панель показує лише те, що вже встановлено). */
export function loadManifest(): Promise<PacksManifest> {
  if (!manifestP) {
    const p: Promise<PacksManifest> = fetch(siteUrl('offline/packs.json'), { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`offline/packs.json: ${r.status}`);
      return r.json() as Promise<PacksManifest>;
    });
    p.catch(() => { if (manifestP === p) manifestP = null; });
    manifestP = p;
  }
  return manifestP;
}

const hashStr = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
};

/** Пакет фото: мініатюри (як їх показують картки) усіх фото місць, подій та інструментів. */
export function photosManifest(): PackManifest {
  const urls = new Set<string>();
  for (const x of [...places, ...events, ...tools]) for (const ph of x.photos ?? []) urls.add(thumbUrl(ph.url));
  // на сторінці «Інструменти» картки показують першу фотографію меншою мініатюрою
  for (const x of tools) if (x.photos?.[0]) urls.add(thumbUrl(x.photos[0].url, 330));
  const files = [...urls].filter((u) => u.startsWith('https://thumb.wikimedia.org/')).sort().map((u): FileEntry => [u, 0]);
  return { version: hashStr(files.map((f) => f[0]).join('\n')), bytes: 0, files };
}

// ---------- що встановлено ----------
export interface Installed {
  version: string;
  bytes: number;
  files: number;
  /** Для basemap: дата даних і частини файлу — щоб читати мапу без мережі й без offline/packs.json. */
  date?: string;
  parts?: FileEntry[];
}
const lsKey = (id: PackId) => `istoria.offline.${id}`;
const pendKey = (id: PackId) => `istoria.offline.${id}.pending`;
function readLS<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null; } catch { return null; }
}
function writeLS(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch { /* приватний режим — без запам'ятовування */ }
}
export function installed(id: PackId): Installed | null {
  const v = readLS<Installed>(lsKey(id));
  return v && typeof v.version === 'string' ? v : null;
}
/** Незавершене завантаження: версія пакета, скільки перших файлів переліку вже записано, хід у байтах (чи файлах). */
export interface Pending { version: string; next: number; done: number; total: number }
export function pending(id: PackId): Pending | null {
  const v = readLS<Pending>(pendKey(id));
  return v && typeof v.version === 'string' ? v : null;
}
/** Чи можна показати мапу Угорщини без мережі. */
export const offlineMapReady = () => offlineSupported() && !!installed('basemap')?.parts?.length;

const listeners = new Set<() => void>();
/** Підписка на зміни: хід завантаження, встановлення чи видалення пакета. */
export function onOfflineChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
const emit = () => listeners.forEach((cb) => cb());

// ---------- читання мапи Угорщини з кешу ----------
/** Джерело для бібліотеки pmtiles: шматки файлу беруться з частин, що лежать у кеші браузера. */
class CachedPartsSource {
  private starts: number[] = [];
  private total = 0;
  private blobs = new Map<number, Promise<Blob>>();
  constructor(private key: string, private parts: FileEntry[]) {
    for (const [, n] of parts) { this.starts.push(this.total); this.total += n; }
  }
  getKey() { return this.key; }
  private part(i: number): Promise<Blob> {
    let b = this.blobs.get(i);
    if (b) this.blobs.delete(i); // перенести в кінець (найсвіжіший)
    else {
      const url = siteUrl(this.parts[i][0]);
      b = caches.match(url, { ignoreVary: true }).then((r) => {
        if (!r) throw new Error(`немає в кеші: ${url}`);
        // відповідь з кешу — посилання на файл на диску, у пам'ять він не читається
        return r.blob();
      });
      b.catch(() => { if (this.blobs.get(i) === b) this.blobs.delete(i); });
    }
    this.blobs.set(i, b);
    if (this.blobs.size > 8) this.blobs.delete(this.blobs.keys().next().value!);
    return b;
  }
  async getBytes(offset: number, length: number) {
    const end = Math.min(offset + length, this.total);
    const pieces: Blob[] = [];
    for (let i = 0; i < this.parts.length && offset < end; i++) {
      const s = this.starts[i], e = s + this.parts[i][1];
      if (e <= offset || s >= end) continue;
      const blob = await this.part(i);
      pieces.push(blob.slice(Math.max(offset, s) - s, Math.min(end, e) - s));
    }
    return { data: await new Blob(pieces).arrayBuffer() };
  }
}

let pmtilesProto: Promise<AddProtocolAction> | null = null;
/** Після встановлення, оновлення чи видалення пакета мапи: наступний запит відкриє файл заново. */
function resetOfflineSource() { pmtilesProto = null; }

if (offlineSupported()) {
  // pmtiles://offline-hungary — мапа Угорщини з частин у кеші (бібліотека pmtiles вантажиться лише тоді)
  addProtocol('pmtiles', async (params, ac) => {
    if (!pmtilesProto) {
      const p = import('pmtiles').then(({ PMTiles, Protocol }) => {
        const proto = new Protocol();
        proto.add(new PMTiles(new CachedPartsSource('offline-hungary', installed('basemap')?.parts ?? [])));
        return proto.tilev4 as AddProtocolAction;
      });
      p.catch(() => { if (pmtilesProto === p) pmtilesProto = null; });
      pmtilesProto = p;
    }
    return (await pmtilesProto)(params, ac);
  });
}
// offline://<шлях від кореня сайту> — стиль і шрифти: з кешу пакета, а якщо їх там немає — із сайту
addProtocol('offline', async (params, ac) => {
  const url = siteUrl(params.url.slice('offline://'.length));
  let res = offlineSupported() ? await caches.match(url, { ignoreVary: true }) : undefined;
  if (!res) res = await fetch(url, { signal: ac.signal });
  if (!res.ok) throw new Error(`${res.status}: ${url}`);
  return { data: params.type === 'json' ? await res.json() : await res.arrayBuffer() };
});

// ---------- завантаження ----------
export interface Job {
  id: PackId;
  /** Байти (або кількість файлів, якщо розміри невідомі — для фото). */
  done: number;
  total: number;
  byCount: boolean;
  failed: number;
  abort: AbortController;
}
let job: Job | null = null;
export const currentJob = () => job;

export type DownloadResult = 'ok' | 'aborted' | 'quota' | 'net' | 'error';

/** Помилка, після якої варто повторити запит (сервер перевантажений чи обрив зв'язку). */
class Retry extends Error {}
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res, rej) => {
  const id = setTimeout(res, ms);
  signal.addEventListener('abort', () => { clearTimeout(id); rej(signal.reason); }, { once: true });
});

/** Завантажити один файл у кеш, рахуючи байти на льоту; розмір перевіряється, якщо відомий. */
async function fetchInto(cache: Cache, url: string, expected: number, signal: AbortSignal, onBytes: (n: number) => void): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    let got = 0;
    try {
      // no-store: файл іде лише в кеш пакета, без другої копії в звичайному кеші браузера
      const res = await fetch(url, { signal, cache: 'no-store', mode: 'cors', credentials: 'omit' });
      if (res.status === 429 || res.status >= 500) throw new Retry(`${res.status}`);
      if (!res.ok || !res.body) throw new Error(`${res.status}: ${url}`);
      const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctl) { got += chunk.byteLength; onBytes(chunk.byteLength); ctl.enqueue(chunk); },
      });
      await cache.put(url, new Response(res.body.pipeThrough(counter), { status: 200, headers: res.headers }));
      if (expected > 0 && got !== expected) {
        await cache.delete(url);
        throw new Retry(`розмір ${got} замість ${expected}`);
      }
      return got;
    } catch (e) {
      onBytes(-got);
      if (signal.aborted || (e as Error).name === 'QuotaExceededError') throw e;
      const retryable = e instanceof Retry || e instanceof TypeError; // TypeError — збій мережі
      if (!retryable || attempt >= 3) throw e;
      await sleep(1500 * 2 ** attempt, signal);
    }
  }
}

/**
 * Завантажити або оновити пакет. Файли зі сталими адресами (стиль, шрифти, тайли, зображення) при новій
 * версії переписуються всі, частини мапи й фото — лише ті, яких ще немає; зайве з кешу потім прибирається.
 * Поки йде оновлення, попередня версія пакета лишається робочою. Перерване завантаження продовжується
 * з того місця, де зупинилось.
 */
export async function downloadPack(id: PackId): Promise<DownloadResult> {
  if (job || !offlineSupported()) return 'error';
  const abort = new AbortController();
  const current: Job = { id, done: 0, total: 0, byCount: id === 'photos', failed: 0, abort };
  job = current;
  emit();
  let last = 0;
  const tick = () => { const now = Date.now(); if (now - last > 250) { last = now; emit(); } };
  try {
    const m = id === 'photos' ? photosManifest() : (await loadManifest())[id];
    // браузер не стиратиме дані сам, якщо дозволить (у Chrome — для встановленого застосунку)
    await navigator.storage?.persist?.().catch(() => false);
    const cache = await caches.open(CACHE_NAME[id]);
    const have = new Set((await cache.keys()).map((r) => r.url));
    // перелік, який переписується повністю, і перелік, де беремо лише відсутні файли
    const over = id === 'photos' ? [] : m.files;
    const incr = id === 'photos' ? m.files : m.parts ?? [];
    const pend = pending(id);
    const start = installed(id)?.version === m.version ? over.length : pend?.version === m.version ? Math.min(pend.next, over.length) : 0;
    const todoOver = over.slice(start);
    const tasks = [...todoOver.map((f, i) => ({ f, i })), ...incr.filter(([p]) => !have.has(siteUrl(p))).map((f) => ({ f, i: -1 }))];
    // хід рахуємо від усього пакета, а не від залишку
    const all = [...over, ...incr];
    current.total = current.byCount ? all.length : all.reduce((s, f) => s + f[1], 0);
    current.done = current.byCount ? all.length - tasks.length : current.total - tasks.reduce((s, t) => s + t.f[1], 0);
    // частини по 16 МБ — по дві разом, дрібні файли — по шість (фото — по три: сервер Вікісховища обмежує частоту)
    const conc = id === 'basemap' ? 2 : id === 'photos' ? 3 : 6;
    const doneFlags = new Array<boolean>(todoOver.length).fill(false);
    let prefix = 0;
    let next = 0;
    let fatal: unknown = null;
    let lastSave = 0;
    const save = () => writeLS(pendKey(id), { version: m.version, next: start + prefix, done: current.done, total: current.total } satisfies Pending);
    save();
    const worker = async () => {
      while (next < tasks.length && !abort.signal.aborted) {
        const t = tasks[next++];
        try {
          await fetchInto(cache, siteUrl(t.f[0]), t.f[1], abort.signal, (b) => { if (!current.byCount) { current.done += b; tick(); } });
          if (current.byCount) { current.done++; tick(); }
          if (t.i >= 0) {
            doneFlags[t.i] = true;
            while (prefix < doneFlags.length && doneFlags[prefix]) prefix++;
          }
          if (Date.now() - lastSave > 2000) { lastSave = Date.now(); save(); }
        } catch (e) {
          if (abort.signal.aborted) return;
          // окреме фото могли перейменувати чи видалити на Вікісховищі — решту все одно беремо
          if (id === 'photos' && (e as Error).name !== 'QuotaExceededError') { current.failed++; current.done++; tick(); continue; }
          fatal = e;
          abort.abort();
          return;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(conc, Math.max(1, tasks.length)) }, worker));
    save();
    if (fatal) throw fatal;
    if (abort.signal.aborted) return 'aborted';
    // прибрати з кешу те, чого в новій версії вже немає (старі частини мапи, фото видалених карток)
    const keep = new Set(all.map(([p]) => siteUrl(p)));
    for (const r of await cache.keys()) if (!keep.has(r.url)) await cache.delete(r);
    let bytes = m.bytes;
    if (id === 'photos') {
      bytes = 0;
      for (const r of await cache.keys()) bytes += (await (await cache.match(r))?.blob())?.size ?? 0;
    }
    writeLS(lsKey(id), { version: m.version, bytes, files: all.length - current.failed, date: m.date, parts: m.parts } satisfies Installed);
    writeLS(pendKey(id), null);
    if (id === 'basemap') resetOfflineSource();
    return 'ok';
  } catch (e) {
    if ((e as Error)?.name === 'QuotaExceededError') return 'quota';
    if (e instanceof TypeError || e instanceof Retry || navigator.onLine === false) return 'net';
    console.warn('Пакет без інтернету:', e);
    return 'error';
  } finally {
    if (job === current) job = null;
    emit();
  }
}

/** Зупинити поточне завантаження (уже записані файли лишаються, можна продовжити). */
export function stopDownload() { job?.abort.abort('stop'); }

export async function deletePack(id: PackId): Promise<void> {
  if (job?.id === id) job.abort.abort('stop');
  if (offlineSupported()) await caches.delete(CACHE_NAME[id]);
  writeLS(lsKey(id), null);
  writeLS(pendKey(id), null);
  if (id === 'basemap') resetOfflineSource();
  emit();
}

/**
 * Перевірка після запуску: браузер міг стерти кеш, коли бракувало місця. Тоді позначка «встановлено»
 * знімається, щоб не вмикати мапу, якої вже немає. Повертає true, якщо щось змінилось.
 */
export async function verifyInstalled(): Promise<boolean> {
  if (!offlineSupported()) return false;
  let changed = false;
  for (const id of PACK_IDS) {
    const inst = installed(id);
    if (!inst) continue;
    let ok = await caches.has(CACHE_NAME[id]);
    if (ok && id === 'basemap') {
      const have = new Set((await (await caches.open(CACHE_NAME[id])).keys()).map((r) => r.url));
      ok = (inst.parts ?? []).every(([p]) => have.has(siteUrl(p)));
    }
    if (!ok) { writeLS(lsKey(id), null); changed = true; }
  }
  if (changed) { resetOfflineSource(); emit(); }
  return changed;
}

/** Скільки місця займає сайт і скільки дозволено, чи захищено дані від автоматичного стирання. */
export async function storageInfo(): Promise<{ usage?: number; quota?: number; persisted?: boolean }> {
  const st = navigator.storage;
  const [est, persisted] = await Promise.all([
    st?.estimate?.().catch(() => undefined),
    st?.persisted?.().catch(() => undefined),
  ]);
  return { usage: est?.usage, quota: est?.quota, persisted };
}
