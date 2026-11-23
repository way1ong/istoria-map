// Доповнення до service worker мапи. Сам sw.js створює Workbox під час збірки; цей файл підключається до нього
// через importScripts (vite.config.ts). Перед ним підключається sw-build-<відбиток>.js — один рядок, який збірка
// пише сама: відбиток усіх файлів застосунку (self.__ISTORIA_BUILD).
//
// Навіщо. Сховище браузера спільне для всіх сайтів з однієї адреси (на GitHub Pages — усі сайти одного власника),
// і сусідній сайт може стерти всі кеші — так уже бувало (CLAUDE.md, п. 35). Тому:
//  1. Завантажені пакети й збережені ділянки старих мап лежать не в Cache Storage, а в базі IndexedDB
//     «istoria-offline» (src/store.ts) — звідси їх і віддає istoriaServe.
//  2. Файли самого застосунку Workbox тримає в кеші; тут з них робиться запасна копія в тій самій базі, і якщо кеш
//     стерто, він відновлюється з копії просто під час відкриття сторінки — без інтернету й без трафіку.
(() => {
  'use strict';
  // Відбиток збірки. Запасну копію, зроблену іншою збіркою, не відновлюємо: її файли не збігаються з тими,
  // яких чекає цей service worker.
  const BUILD = self.__ISTORIA_BUILD || 'без-відбитка';
  const DB = 'istoria-offline';
  const FILES = 'files';
  const META = 'meta';
  const SCOPE = self.registration.scope; // напр. https://way1ong.github.io/istoria-map/
  const INDEX = `${SCOPE}index.html`;
  // те саме, що navigateFallbackDenylist у vite.config.ts: прямі посилання на файли — не сторінки застосунку
  const DENY = /\/(maps|tiles|offline|fonts|georef|icons|screenshots|photos)\//;
  // давні кеші пакетів (до переходу на IndexedDB): поки сторінка їх не перенесла, читаємо й звідти
  const LEGACY = {
    basemap: 'istoria-offline-basemap',
    generalkarte: 'istoria-offline-generalkarte',
    oldmaps: 'istoria-offline-oldmaps',
    photos: 'istoria-offline-photos',
    iiif: 'istoria-offline-iiif',
  };

  // ---------- база ----------
  let dbp = null;
  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => { db.close(); dbp = null; };
          db.onclose = () => { dbp = null; };
          resolve(db);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('blocked'));
      });
      dbp.catch(() => { dbp = null; });
    }
    return dbp;
  }
  function run(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      if (mode === 'readonly') req.onsuccess = () => resolve(req.result);
      else tx.oncomplete = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('aborted'));
    }));
  }
  const get = (bucket, url) => run(FILES, 'readonly', (s) => s.get([bucket, url]));
  const put = (bucket, url, blob) => run(FILES, 'readwrite', (s) => s.put(blob, [bucket, url]));
  const del = (bucket, url) => run(FILES, 'readwrite', (s) => s.delete([bucket, url]));
  const keysOf = (bucket) => run(FILES, 'readonly', (s) => s.getAllKeys(IDBKeyRange.bound([bucket], [bucket, []]))).then((ks) => ks.map((k) => k[1]));
  const metaGet = (key) => run(META, 'readonly', (s) => s.get(key));
  const metaSet = (key, value) => run(META, 'readwrite', (s) => s.put(value, key));

  const respond = (blob) => new Response(blob, { status: 200, headers: { 'Content-Type': blob.type || 'application/octet-stream' } });

  // ---------- пакети й ділянки ----------
  const legacyGone = {};
  async function fromLegacy(bucket, request) {
    const name = LEGACY[bucket];
    if (!name || legacyGone[bucket]) return undefined;
    if (!(await caches.has(name))) { legacyGone[bucket] = true; return undefined; }
    return caches.match(request, { cacheName: name, ignoreVary: true });
  }

  /**
   * Відповідь на запит файла пакета: зі сховища, інакше з мережі. keep — покласти отриманий з мережі файл у сховище
   * (так переглянуті тайли, зображення й фото лишаються й без завантаження цілого пакета); непрозорі відповіді
   * (без CORS, стан 0) не зберігаємо.
   */
  self.istoriaServe = async (bucket, request, event, keep) => {
    try {
      const blob = await get(bucket, request.url);
      if (blob) return respond(blob);
      const old = await fromLegacy(bucket, request);
      if (old) return old;
    } catch (e) { /* сховище недоступне — беремо з мережі */ }
    const res = await fetch(request);
    if (keep && res.status === 200 && event) {
      const copy = res.clone();
      event.waitUntil(copy.blob().then((b) => put(bucket, request.url, b)).catch(() => undefined));
    }
    return res;
  };

  // ---------- запасна копія файлів застосунку ----------
  const precacheName = async () => (await caches.keys()).find((n) => n.includes('-precache-') && n.endsWith(SCOPE));
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  let backing = null;
  /** Оновити копію, якщо кеш застосунку цілий і відрізняється від неї (або копію робила інша збірка). */
  function backupIfNeeded() {
    if (!backing) {
      backing = (async () => {
        const name = await precacheName();
        if (!name) return;
        const cache = await caches.open(name);
        const reqs = await cache.keys();
        const index = reqs.find((r) => r.url.split('?')[0] === INDEX);
        if (!index) return; // кеш неповний — добру копію не чіпаємо
        const urls = reqs.map((r) => r.url).sort();
        const meta = await metaGet('app');
        if (meta && meta.build === BUILD && meta.cache === name && same(meta.urls, urls)) return;
        for (const r of reqs) {
          const res = await cache.match(r);
          if (res) await put('app', r.url, await res.blob());
        }
        await metaSet('app', { build: BUILD, cache: name, index: index.url, urls, date: Date.now() });
        // зайве (файли попередньої версії) прибираємо вже після запису відомостей про нову копію
        const keep = new Set(urls);
        for (const k of await keysOf('app')) if (!keep.has(k)) await del('app', k);
      })().catch(() => undefined).then(() => { backing = null; });
    }
    return backing;
  }

  /** Відновити кеш застосунку з копії цієї самої збірки. Головна сторінка кладеться останньою: є вона — є все. */
  async function restore() {
    const meta = await metaGet('app');
    if (!meta || meta.build !== BUILD || !Array.isArray(meta.urls)) return null;
    const files = [];
    for (const url of meta.urls) {
      const blob = await get('app', url);
      if (!blob) return null; // копія неповна
      files.push([url, blob]);
    }
    const cache = await caches.open(meta.cache);
    for (const [url, blob] of files) if (url !== meta.index) await cache.put(url, respond(blob));
    const index = files.find(([url]) => url === meta.index);
    if (!index) return null;
    await cache.put(index[0], respond(index[1]));
    return cache;
  }

  async function navigate(event) {
    try {
      const name = (await precacheName()) || `workbox-precache-v2-${SCOPE}`;
      let cache = await caches.open(name);
      let hit = await cache.match(INDEX, { ignoreSearch: true });
      if (!hit) {
        // кеш застосунку стерто: відновлюємо з копії, мережа для цього не потрібна
        cache = await restore();
        hit = cache ? await cache.match(INDEX, { ignoreSearch: true }) : undefined;
      }
      if (hit) {
        event.waitUntil(backupIfNeeded());
        return hit;
      }
    } catch (e) { /* далі — мережа */ }
    return fetch(event.request);
  }

  // Відкриття сторінки застосунку. Обробник стоїть перед обробником Workbox (цей файл підключається раніше),
  // тож спершу перевіряється й за потреби відновлюється кеш, а решту файлів Workbox віддає вже з нього.
  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || req.mode !== 'navigate') return;
    const url = new URL(req.url);
    if (!url.href.startsWith(SCOPE) || DENY.test(url.pathname)) return;
    event.respondWith(navigate(event));
    event.stopImmediatePropagation();
  });

  // Сторінка просить оновити копію після запуску (перше встановлення: відкриття сторінки вже позаду)
  self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'istoria-backup') event.waitUntil(backupIfNeeded());
  });

  // Нова версія щойно запрацювала: копію варто оновити, навіть якщо сторінку не перезавантажать. Саму подію не
  // затримуємо (поки вона триває, сторінки чекають), тому — трохи згодом і без гарантії; основні приводи — вище.
  self.addEventListener('activate', () => { setTimeout(() => { backupIfNeeded(); }, 3000); });
})();
