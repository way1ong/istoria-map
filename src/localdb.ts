// Маленька обгортка над IndexedDB для власних даних людини, які лишаються ТІЛЬКИ в цьому браузері
// (шляхи — src/tracks.ts). У репозиторій і на сервер звідси нічого не йде.
const DB = 'istoria-local';
const VERSION = 1;
export const TRACKS_STORE = 'tracks';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB недоступна')); return; }
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TRACKS_STORE)) db.createObjectStore(TRACKS_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
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
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: транзакцію скасовано'));
  }));
}

export const idbAll = <T>(store: string): Promise<T[]> => run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
export const idbPut = <T>(store: string, value: T): Promise<unknown> => run(store, 'readwrite', (s) => s.put(value));
export const idbDelete = (store: string, id: string): Promise<unknown> => run(store, 'readwrite', (s) => s.delete(id));
