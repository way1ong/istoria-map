// Робота без інтернету: пакети файлів у сховищі браузера і читання з них мапи Угорщини.
//
// Файли лежать у базі IndexedDB (src/store.ts), а не в Cache Storage: кеші спільні для всіх сайтів з однієї адреси,
// і сусідній сайт може їх стерти (CLAUDE.md, п. 35). Те, що завантажили до цієї зміни, переноситься з давніх кешів
// само (migrateLegacy), а поки переноситься — читається й звідти.
//
// Пакети: basemap — сучасна мапа (частини файлу PMTiles, стиль, шрифти), generalkarte — тайли генеральної
// мапи ~1910, oldmaps — запасні зображення старих мап (огляд Spezialkarte, аркуші біля Göd, Ліпскі),
// photos — мініатюри фото карток. Перелік файлів дає offline/packs.json (його створює
// scripts/offline/packs-plugin.mjs під час збірки), перелік фото — самі дані карток.
// Тайли generalkarte, зображення старих мап і фото service worker (vite.config.ts, public/sw-extra.js)
// бере з того самого сховища; мапу Угорщини й шрифти читають напряму обробники адрес pmtiles:// і offline:// —
// вони працюють і тоді, коли service worker ще не встановився.
import { addProtocol, type AddProtocolAction } from 'maplibre-gl';
import { events, finds, illustrations, places, tools } from './data';
import { storeClear, storeDelete, storeGet, storeKeys, storePut, storeSizes, storeSupported } from './store';
import { thumbUrl } from './ui/render';

export type PackId = 'basemap' | 'generalkarte' | 'oldmaps' | 'photos';
export const PACK_IDS: PackId[] = ['basemap', 'generalkarte', 'oldmaps', 'photos'];
/** Розділи сховища: пакети й збережені ділянки старих мап (src/offlineareas.ts). */
export type PackBucket = PackId | 'iiif';
/** Давні кеші (до 23.11.2026 пакети лежали в Cache Storage); ті самі назви — у public/sw-extra.js. */
export const LEGACY_CACHE: Record<PackBucket, string> = {
  basemap: 'istoria-offline-basemap',
  generalkarte: 'istoria-offline-generalkarte',
  oldmaps: 'istoria-offline-oldmaps',
  photos: 'istoria-offline-photos',
  iiif: 'istoria-offline-iiif',
};

/** Корінь сайту, напр. https://way1ong.github.io/istoria-map/ */
const SITE = new URL(import.meta.env.BASE_URL, location.href).href;
export const siteUrl = (path: string) => new URL(path, SITE).href;
/** Потрібні IndexedDB і service worker; останній (як і Cache Storage) є лише на https і localhost. */
export const offlineSupported = () => storeSupported() && typeof caches !== 'undefined';

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

/** Пакет фото: мініатюри (як їх показують картки) усіх фото місць, знахідок, подій та інструментів. */
export function photosManifest(): PackManifest {
  const urls = new Set<string>();
  for (const x of [...places, ...events, ...tools]) for (const ph of x.photos ?? []) urls.add(thumbUrl(ph.url));
  // ілюстрації в текстах «Історії» й «Ландшафту» (data/illustrations.json)
  for (const ill of Object.values(illustrations)) urls.add(thumbUrl(ill.url));
  // на сторінках «Інструменти» і «Знахідки» картки показують першу фотографію меншою мініатюрою
  for (const x of [...tools, ...finds]) if (x.photos?.[0]) urls.add(thumbUrl(x.photos[0].url, 330));
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

// ---------- завантажене зникло ----------
const LOST_KEY = 'istoria.offline.lost';
/**
 * Позначка «завантажене раніше зникло зі сховища»: браузер може стерти дані сайту, коли на пристрої бракує місця,
 * або їх очищує сама людина. (Сусідні сайти з тієї самої адреси, які стирали давні кеші, до бази IndexedDB
 * не дістають.) Панель показує пояснення, доки його не закриють або не завантажать щось знову.
 */
export const offlineLost = (): boolean => readLS<number>(LOST_KEY) !== null;
export function setOfflineLost(v: boolean): void {
  if (offlineLost() === v) return;
  writeLS(LOST_KEY, v ? Date.now() : null);
  emit();
}

// ---------- давні кеші ----------
/** Розділи, чий давній кеш ще може існувати (після перенесення чи перевірки розділ звідси зникає). */
const legacyLeft = new Set<PackBucket>(['basemap', 'generalkarte', 'oldmaps', 'photos', 'iiif']);

/** Файл пакета: зі сховища, а якщо давній кеш ще не перенесено — з нього. */
export async function packBlob(bucket: PackBucket, url: string): Promise<Blob | undefined> {
  const blob = await storeGet(bucket, url);
  if (blob) return blob;
  if (!legacyLeft.has(bucket) || typeof caches === 'undefined') return undefined;
  return (await caches.match(url, { cacheName: LEGACY_CACHE[bucket], ignoreVary: true }).catch(() => undefined))?.blob();
}

/** Адреси файлів розділу — у сховищі й у ще не перенесеному давньому кеші. */
export async function packKeys(bucket: PackBucket): Promise<Set<string>> {
  const keys = new Set(await storeKeys(bucket));
  if (legacyLeft.has(bucket) && typeof caches !== 'undefined' && await caches.has(LEGACY_CACHE[bucket])) {
    for (const r of await (await caches.open(LEGACY_CACHE[bucket])).keys()) keys.add(r.url);
  }
  return keys;
}

type LegacyEntry = (bucket: PackBucket, url: string, res: Response) => Promise<boolean>;
let legacyEntry: LegacyEntry | null = null;
/** Записи давнього кешу, які переносяться не як файли (переліки тайлів ділянок — src/offlineareas.ts). */
export function onLegacyEntry(fn: LegacyEntry): void { legacyEntry = fn; }

let migrateP: Promise<void> | null = null;
/**
 * Перенести завантажене з давніх кешів у сховище (один раз, у тлі): файл записується в базу й одразу прибирається
 * з кешу, тож зайвого місця це майже не займає. Якщо щось не вдалося, давній кеш лишається й читається далі.
 */
export function migrateLegacy(): Promise<void> {
  migrateP ??= (async () => {
    if (!offlineSupported()) { legacyLeft.clear(); return; }
    for (const bucket of [...legacyLeft]) {
      const name = LEGACY_CACHE[bucket];
      try {
        if (await caches.has(name)) {
          const cache = await caches.open(name);
          for (const req of await cache.keys()) {
            const res = await cache.match(req);
            if (res && !(await legacyEntry?.(bucket, req.url, res.clone()))) await storePut(bucket, req.url, await res.blob());
            await cache.delete(req);
          }
          await caches.delete(name);
        }
        legacyLeft.delete(bucket);
      } catch (e) {
        console.warn('Перенесення завантаженого в нове сховище:', name, e);
      }
    }
  })();
  return migrateP;
}

// ---------- читання мапи Угорщини зі сховища ----------
/** Джерело для бібліотеки pmtiles: шматки файлу беруться з частин, що лежать у сховищі браузера. */
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
      b = packBlob('basemap', url).then((blob) => {
        if (!blob) throw new Error(`немає у сховищі: ${url}`);
        // Blob зі сховища — посилання на файл на диску, у пам'ять він не читається
        return blob;
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
  // pmtiles://offline-hungary — мапа Угорщини з частин у сховищі (бібліотека pmtiles вантажиться лише тоді)
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
// offline://<шлях від кореня сайту> — стиль і шрифти: зі сховища пакета, а якщо їх там немає — із сайту
addProtocol('offline', async (params, ac) => {
  const url = siteUrl(params.url.slice('offline://'.length));
  const blob = offlineSupported() ? await packBlob('basemap', url).catch(() => undefined) : undefined;
  if (blob) return { data: params.type === 'json' ? JSON.parse(await blob.text()) : await blob.arrayBuffer() };
  const res = await fetch(url, { signal: ac.signal });
  if (!res.ok) throw new Error(`${res.status}: ${url}`);
  return { data: params.type === 'json' ? await res.json() : await res.arrayBuffer() };
});

// ---------- завантаження ----------
/** Завантаження: пакет або ділянка старих мап у повній якості (src/offlineareas.ts). */
export type JobId = PackId | 'area';
export interface Job {
  id: JobId;
  /** Байти (або кількість файлів, якщо розміри невідомі — для фото й ділянок). */
  done: number;
  total: number;
  byCount: boolean;
  failed: number;
  /** Скільки байтів уже записано (для ділянок, де хід рахується файлами). */
  bytes: number;
  abort: AbortController;
}
let job: Job | null = null;
export const currentJob = () => job;
/** Почати завантаження, якщо інше не йде (одночасно — лише одне). */
export function beginJob(id: JobId, byCount: boolean): Job | null {
  if (job) return null;
  job = { id, done: 0, total: 0, byCount, failed: 0, bytes: 0, abort: new AbortController() };
  emit();
  return job;
}
export function endJob(j: Job) {
  if (job === j) job = null;
  emit();
}
let lastTick = 0;
/** Повідомити панель про хід (не частіше ніж раз на чверть секунди). */
export function tickJob() {
  const now = Date.now();
  if (now - lastTick > 250) { lastTick = now; emit(); }
}

export type DownloadResult = 'ok' | 'aborted' | 'quota' | 'net' | 'error';

/** Помилка, після якої варто повторити запит (сервер перевантажений чи обрив зв'язку). */
export class Retry extends Error {}
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res, rej) => {
  const id = setTimeout(res, ms);
  signal.addEventListener('abort', () => { clearTimeout(id); rej(signal.reason); }, { once: true });
});

/** Завантажити один файл у сховище, рахуючи байти на льоту; розмір перевіряється, якщо відомий. */
export async function fetchInto(bucket: PackBucket, url: string, expected: number, signal: AbortSignal, onBytes: (n: number) => void): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    let got = 0;
    try {
      // no-store: файл іде лише у сховище пакета, без другої копії в звичайному кеші браузера
      const res = await fetch(url, { signal, cache: 'no-store', mode: 'cors', credentials: 'omit' });
      if (res.status === 429 || res.status >= 500) throw new Retry(`${res.status}`);
      if (!res.ok || !res.body) throw new Error(`${res.status}: ${url}`);
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.byteLength;
        onBytes(value.byteLength);
        chunks.push(value as Uint8Array<ArrayBuffer>);
      }
      if (expected > 0 && got !== expected) throw new Retry(`розмір ${got} замість ${expected}`);
      // найбільші файли — частини мапи по 16 МіБ; у пам'яті вони лише до запису
      await storePut(bucket, url, new Blob(chunks, { type: res.headers.get('content-type') ?? '' }));
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
  if (!offlineSupported()) return 'error';
  const current = beginJob(id, id === 'photos');
  if (!current) return 'error';
  const abort = current.abort;
  const tick = tickJob;
  try {
    const m = id === 'photos' ? photosManifest() : (await loadManifest())[id];
    // браузер не стиратиме дані сам, якщо дозволить (у Chrome — для встановленого застосунку)
    await navigator.storage?.persist?.().catch(() => false);
    // давній кеш (якщо є) спершу має перейти в сховище: далі рахуємо лише те, що лежить там
    await migrateLegacy();
    const have = new Set(await storeKeys(id));
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
          await fetchInto(id, siteUrl(t.f[0]), t.f[1], abort.signal, (b) => { if (!current.byCount) { current.done += b; tick(); } });
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
    // прибрати зі сховища те, чого в новій версії вже немає (старі частини мапи, фото видалених карток)
    const keep = new Set(all.map(([p]) => siteUrl(p)));
    for (const url of await storeKeys(id)) if (!keep.has(url)) await storeDelete(id, url);
    let bytes = m.bytes;
    if (id === 'photos') {
      bytes = 0;
      for (const n of (await storeSizes(id)).values()) bytes += n;
    }
    writeLS(lsKey(id), { version: m.version, bytes, files: all.length - current.failed, date: m.date, parts: m.parts } satisfies Installed);
    writeLS(pendKey(id), null);
    writeLS(LOST_KEY, null);
    if (id === 'basemap') resetOfflineSource();
    return 'ok';
  } catch (e) {
    return failureKind(e);
  } finally {
    endJob(current);
  }
}

/** Вид невдачі завантаження для повідомлення в панелі. */
export function failureKind(e: unknown): DownloadResult {
  if ((e as Error)?.name === 'QuotaExceededError') return 'quota';
  if (e instanceof TypeError || e instanceof Retry || navigator.onLine === false) return 'net';
  console.warn('Завантаження без інтернету:', e);
  return 'error';
}

/** Зупинити поточне завантаження (уже записані файли лишаються, можна продовжити). */
export function stopDownload() { job?.abort.abort('stop'); }

export async function deletePack(id: PackId): Promise<void> {
  if (job?.id === id) job.abort.abort('stop');
  if (offlineSupported()) {
    await storeClear(id);
    await caches.delete(LEGACY_CACHE[id]);
  }
  writeLS(lsKey(id), null);
  writeLS(pendKey(id), null);
  if (id === 'basemap') resetOfflineSource();
  emit();
}

/**
 * Перевірка після запуску: сховище міг стерти браузер, коли бракувало місця (а давній кеш — ще й інший сайт
 * з тієї самої адреси). Тоді позначка «встановлено» знімається, щоб не вмикати мапу, якої вже немає, і ставиться
 * позначка «завантажене зникло» — для пояснення людині. Повертає true, якщо щось змінилось.
 */
export async function verifyInstalled(): Promise<boolean> {
  if (!offlineSupported()) return false;
  let changed = false;
  for (const id of PACK_IDS) {
    const inst = installed(id);
    if (!inst) continue;
    const have = await packKeys(id);
    let ok = have.size > 0;
    if (ok && id === 'basemap') ok = (inst.parts ?? []).every(([p]) => have.has(siteUrl(p)));
    if (!ok) { writeLS(lsKey(id), null); changed = true; }
  }
  if (changed) { writeLS(LOST_KEY, Date.now()); resetOfflineSource(); emit(); }
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
