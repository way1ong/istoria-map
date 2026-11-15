import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

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
  plugins: [geojsonPlugin()],
  build: { target: 'es2022', sourcemap: false },
});
