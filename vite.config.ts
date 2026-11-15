import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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
export default defineConfig({
  base: '/istoria-map/',
  plugins: [
    geojsonPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Історія околиць Göd',
        short_name: 'Istoria Göd',
        description: 'Історична мапа околиць Göd, Vác і Dunakeszi',
        lang: 'uk',
        start_url: '/istoria-map/',
        scope: '/istoria-map/',
        display: 'standalone',
        background_color: '#f5efe0',
        theme_color: '#1f2937',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Усе зібране, включно зі старими мапами, вирізкою тайлів і шрифтами, кешується при встановленні
        globPatterns: ['**/*.{js,css,html,json,png,jpg,pbf,pmtiles,woff2}'],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: /^https:\/\/tiles\.openfreemap\.org\//, handler: 'CacheFirst', options: { cacheName: 'openfreemap', expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 60 } } },
          { urlPattern: /^https:\/\/tiles\.maps\.eox\.at\//, handler: 'CacheFirst', options: { cacheName: 'sentinel', expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 60 } } },
          { urlPattern: /^https:\/\/ibasemaps-api\.arcgis\.com\//, handler: 'NetworkOnly' },
          { urlPattern: /^https:\/\/upload\.wikimedia\.org\//, handler: 'CacheFirst', options: { cacheName: 'photos', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 180 } } },
        ],
      },
    }),
  ],
  build: { target: 'es2022', sourcemap: false },
});
