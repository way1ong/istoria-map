import { defineConfig } from 'vite';

// Сайт публікується на GitHub Pages за адресою https://way1ong.github.io/istoria-map/
export default defineConfig({
  base: '/istoria-map/',
  build: { target: 'es2022', sourcemap: false },
});
