import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { offlinePacks } from './scripts/offline/packs-plugin.mjs';

// Функція service worker з public/sw-extra.js: правила нижче потрапляють у sw.js текстом і викликають її там.
declare const istoriaServe: (bucket: string, request: Request, event: unknown, keep: boolean) => Promise<Response>;

/** Дає змогу імпортувати data/routes/*.geojson як JSON-модулі. */
function geojsonPlugin(): Plugin {
  return {
    name: 'geojson-as-json',
    transform(_code, id) {
      if (!id.endsWith('.geojson')) return null;
      const json = readFileSync(id, 'utf8');
      return { code: `export default ${json};`, map: null };
    },
  };
}

const walk = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)])) : [];

/**
 * Відбиток усього, що йде в кеш застосунку (див. globPatterns нижче), рахується з готової теки збірки і записується
 * у файл sw-build-<відбиток>.js; service worker підключає його перед public/sw-extra.js. Навіщо: запасну копію файлів
 * застосунку, зроблену іншою збіркою, відновлювати не можна — її файли не збігаються з тими, яких чекає service
 * worker. Відбиток залежить лише від вмісту, тож збірка без змін дає той самий sw.js і не викликає сповіщення
 * про нову версію; назва файла з відбитком не дає браузерові підсунути стару копію зі свого кешу.
 */
function writeBuildId(outDir: string): string {
  const rel = (f: string) => f.slice(outDir.length + 1).replace(/\\/g, '/');
  const cached = (r: string) =>
    !/^(sw\.js|workbox-[^/]*\.js|sw-build-[^/]*\.js)$/.test(r)
    && (/\.(js|css|html|webmanifest)$/.test(r) || /^icons\/[^/]+\.png$/.test(r) || /^georef\/[^/]+\.json$/.test(r) || /^photos\/[^/]+\.(jpe?g|png|webp)$/.test(r));
  const h = createHash('sha1');
  for (const f of walk(outDir).filter((x) => cached(rel(x))).sort()) {
    h.update(rel(f));
    h.update(readFileSync(f));
  }
  const id = h.digest('hex').slice(0, 12);
  writeFileSync(join(outDir, `sw-build-${id}.js`), `self.__ISTORIA_BUILD='${id}';\n`);
  return `sw-build-${id}.js`;
}

// Сайт публікується на GitHub Pages за адресою https://way1ong.github.io/istoria-map/
// Service worker (vite-plugin-pwa, Workbox): застосунок відкривається без інтернету. Код, дані, тексти й накладки
// лежать у збірці й кешуються одразу; мапи й фото — пакетами з панелі «Без інтернету» (src/offline.ts) у базі
// IndexedDB (src/store.ts), звідки їх віддає istoriaServe з public/sw-extra.js. Функції urlPattern і handler переносяться
// в sw.js текстом, тому адреси й назви розділів у них записано прямо, без змінних.
export default defineConfig({
  base: '/istoria-map/',
  plugins: [
    geojsonPlugin(),
    offlinePacks(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // маніфест лежить у public/manifest.webmanifest
      manifest: false,
      integration: {
        // тека збірки вже готова: рахуємо відбиток і підключаємо файл з ним перед sw-extra.js
        beforeBuildServiceWorker(options) {
          options.workbox.importScripts = [writeBuildId(options.outDir), 'sw-extra.js'];
        },
      },
      workbox: {
        // прив'язки старих мап (georef) потрібні Allmaps і без мережі — для збережених ділянок
        // photos/ — власні зображення до карток (вирізки старих мап): невеликі, тож ідуть у кеш застосунку
        globPatterns: ['**/*.{js,css,html,webmanifest}', 'icons/*.png', 'georef/*.json', 'photos/*.{jpg,jpeg,png,webp}'],
        // основний файл з усіма даними ~3 МБ
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // пакети зі сховища IndexedDB і відновлення кешу застосунку з копії: public/sw-extra.js; перед ним
        // збірка додає файл з відбитком (integration вище)
        importScripts: ['sw-extra.js'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/(maps|tiles|offline|fonts|georef|icons|screenshots|photos)\//],
        runtimeCaching: [
          {
            // тайли генеральної мапи ~1910: пакет «Генеральна мапа» і переглянуті ділянки
            urlPattern: ({ url, request }) => url.pathname.startsWith('/istoria-map/tiles/generalkarte/') && request.cache !== 'no-store',
            handler: async ({ request, event }) => istoriaServe('generalkarte', request, event, true),
          },
          {
            // запасні зображення старих мап (огляд Spezialkarte, аркуші біля Göd, Ліпскі)
            urlPattern: ({ url, request }) => url.pathname.startsWith('/istoria-map/maps/') && request.cache !== 'no-store',
            handler: async ({ request, event }) => istoriaServe('oldmaps', request, event, true),
          },
          {
            // мініатюри фото з Вікісховища (відповіді з CORS; непрозорі не зберігаємо — вони займали б багато місця)
            urlPattern: ({ url, request }) => url.hostname === 'thumb.wikimedia.org' && request.cache !== 'no-store',
            handler: async ({ request, event }) => istoriaServe('photos', request, event, true),
          },
          {
            // оригінали старих мап із серверів IIIF бібліотек: збережені ділянки (src/offlineareas.ts) — зі сховища,
            // решта — з мережі без зберігання (браузер і так тримає їх у звичайному кеші)
            urlPattern: ({ url, request }) => (url.hostname === 'iiif.ios-regensburg.de' || url.hostname === 'iiif.nypl.org'
              || (url.hostname === 'www.davidrumsey.com' && url.pathname.startsWith('/luna/servlet/iiif/'))) && request.cache !== 'no-store',
            handler: async ({ request, event }) => istoriaServe('iiif', request, event, false),
          },
          {
            // стиль OpenFreeMap і його TileJSON: остання отримана версія лишається для роботи без мережі
            // (самі тайли браузер і так тримає в кеші: сервер дозволяє 10 років)
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org' && (url.pathname.startsWith('/styles/') || url.pathname === '/planet'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'istoria-ofm-style', expiration: { maxEntries: 20 }, cacheableResponse: { statuses: [200] } },
          },
          {
            // шрифти й значки стилю OpenFreeMap (шрифти сервер дозволяє кешувати лише тиждень)
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org' && (url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/sprites/')),
            handler: 'CacheFirst',
            options: { cacheName: 'istoria-ofm-assets', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 60 }, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  build: { target: 'es2022', sourcemap: false },
});
