// Сховище завантаженого для роботи без інтернету: база IndexedDB «istoria-offline».
//
// Чому не Cache Storage. Сховище браузера спільне для всіх сайтів з однієї адреси (на GitHub Pages — усі сайти
// одного власника), а саморобні service worker часто «прибирають за собою», стираючи всі кеші, крім власних.
// Так сусідній застосунок кілька разів стер завантажені мапи (CLAUDE.md, п. 35). Баз IndexedDB такі прибиральники
// не чіпають, тому файли пакетів, збережені ділянки старих мап і запасна копія файлів самого застосунку лежать тут.
// Ту саму базу читає service worker (public/sw-extra.js) — будова там має збігатися з цією.
//
// Сховок files: ключ [розділ, адреса], значення — Blob (тип вмісту зберігається в самому Blob).
// Сховок meta: дрібні записи за назвою (перелік тайлів ділянки, відомості про копію застосунку).
export type Bucket = 'app' | 'basemap' | 'generalkarte' | 'oldmaps' | 'photos' | 'iiif';

const DB = 'istoria-offline';
const VERSION = 1;
const FILES = 'files';
const META = 'meta';

export const storeSupported = () => typeof indexedDB !== 'undefined';

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (!storeSupported()) { reject(new Error('IndexedDB недоступна')); return; }
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => {
      const db = req.result;
      // інша вкладка чи service worker хоче оновити базу — не тримаємо її
      db.onversionchange = () => { db.close(); dbp = null; };
      db.onclose = () => { dbp = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB: помилка відкриття'));
    req.onblocked = () => reject(new Error('IndexedDB заблокована іншою вкладкою'));
  });
  // невдале відкриття не запам'ятовуємо: наступна спроба пробує знову
  dbp.catch(() => { dbp = null; });
  return dbp;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    // для запису чекаємо завершення транзакції: лише тоді дані справді на диску
    if (mode === 'readonly') req.onsuccess = () => resolve(req.result);
    else tx.oncomplete = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
    // коли бракує місця, транзакцію скасовують з QuotaExceededError — передаємо помилку як є
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: транзакцію скасовано'));
  }));
}

/** Усі ключі одного розділу: від [розділ] до [розділ, []] (масив у порядку ключів більший за будь-який рядок). */
const range = (bucket: Bucket) => IDBKeyRange.bound([bucket], [bucket, []]);

export const storeGet = (bucket: Bucket, url: string): Promise<Blob | undefined> =>
  run<Blob | undefined>(FILES, 'readonly', (s) => s.get([bucket, url]) as IDBRequest<Blob | undefined>);

export const storePut = (bucket: Bucket, url: string, blob: Blob): Promise<void> =>
  run(FILES, 'readwrite', (s) => s.put(blob, [bucket, url])).then(() => undefined);

export const storeDelete = (bucket: Bucket, url: string): Promise<void> =>
  run(FILES, 'readwrite', (s) => s.delete([bucket, url])).then(() => undefined);

export const storeClear = (bucket: Bucket): Promise<void> =>
  run(FILES, 'readwrite', (s) => s.delete(range(bucket))).then(() => undefined);

/** Адреси всіх файлів розділу. */
export const storeKeys = (bucket: Bucket): Promise<string[]> =>
  run<IDBValidKey[]>(FILES, 'readonly', (s) => s.getAllKeys(range(bucket))).then((keys) => keys.map((k) => (k as [string, string])[1]));

/** Розміри файлів розділу (адреса → байти); самі файли при цьому в пам'ять не читаються. */
export function storeSizes(bucket: Bucket): Promise<Map<string, number>> {
  return open().then((db) => new Promise<Map<string, number>>((resolve, reject) => {
    const out = new Map<string, number>();
    const tx = db.transaction(FILES, 'readonly');
    const req = tx.objectStore(FILES).openCursor(range(bucket));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) { resolve(out); return; }
      out.set((c.key as [string, string])[1], (c.value as Blob).size ?? 0);
      c.continue();
    };
    req.onerror = () => reject(req.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: транзакцію скасовано'));
  }));
}

export const metaGet = <T>(key: string): Promise<T | undefined> =>
  run<T | undefined>(META, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
export const metaSet = (key: string, value: unknown): Promise<void> =>
  run(META, 'readwrite', (s) => s.put(value, key)).then(() => undefined);
export const metaDelete = (key: string): Promise<void> =>
  run(META, 'readwrite', (s) => s.delete(key)).then(() => undefined);
