import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { offlinePacks } from './scripts/offline/packs-plugin.mjs';

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

// Сайт публікується на GitHub Pages за адресою https://way1ong.github.io/istoria-map/
// Service worker (vite-plugin-pwa, Workbox): застосунок відкривається без інтернету. Код, дані, тексти й накладки
// лежать у збірці й кешуються одразу; мапи й фото — пакетами з панелі «Без інтернету» (src/offline.ts), у кеші
// з тими самими назвами, що й правила нижче. Функції urlPattern переносяться в sw.js текстом, тому адреси
// в них записано прямо, без змінних.
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
      workbox: {
        // прив'язки старих мап (georef) потрібні Allmaps і без мережі — для збережених ділянок
        // photos/ — власні зображення до карток (вирізки старих мап): невеликі, тож ідуть у кеш застосунку
        globPatterns: ['**/*.{js,css,html,webmanifest}', 'icons/*.png', 'georef/*.json', 'photos/*.{jpg,jpeg,png,webp}'],
        // основний файл з усіма даними ~3 МБ
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/(maps|tiles|offline|fonts|georef|icons|screenshots|photos)\//],
        runtimeCaching: [
          {
            // тайли генеральної мапи ~1910: пакет «Генеральна мапа» і переглянуті ділянки
            urlPattern: ({ url, request }) => url.pathname.startsWith('/istoria-map/tiles/generalkarte/') && request.cache !== 'no-store',
            handler: 'CacheFirst',
            options: { cacheName: 'istoria-offline-generalkarte', matchOptions: { ignoreVary: true }, cacheableResponse: { statuses: [200] } },
          },
          {
            // запасні зображення старих мап (огляд Spezialkarte, аркуші біля Göd, Ліпскі)
            urlPattern: ({ url, request }) => url.pathname.startsWith('/istoria-map/maps/') && request.cache !== 'no-store',
            handler: 'CacheFirst',
            options: { cacheName: 'istoria-offline-oldmaps', matchOptions: { ignoreVary: true }, cacheableResponse: { statuses: [200] } },
          },
          {
            // мініатюри фото з Вікісховища (відповіді з CORS; непрозорі не кешуємо — вони займали б багато місця)
            urlPattern: ({ url, request }) => url.hostname === 'thumb.wikimedia.org' && request.cache !== 'no-store',
            handler: 'CacheFirst',
            options: { cacheName: 'istoria-offline-photos', matchOptions: { ignoreVary: true }, cacheableResponse: { statuses: [200] } },
          },
          {
            // оригінали старих мап із серверів IIIF бібліотек: збережені ділянки (src/offlineareas.ts) — з кешу,
            // решта — з мережі без додаткового кешування (браузер і так тримає їх у звичайному кеші)
            urlPattern: ({ url }) => url.hostname === 'iiif.ios-regensburg.de' || url.hostname === 'iiif.nypl.org'
              || (url.hostname === 'www.davidrumsey.com' && url.pathname.startsWith('/luna/servlet/iiif/')),
            handler: async ({ request }) => (await caches.match(request, { cacheName: 'istoria-offline-iiif', ignoreVary: true })) || fetch(request),
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
