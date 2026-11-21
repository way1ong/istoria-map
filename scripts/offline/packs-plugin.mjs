// Плагін Vite: під час збірки створює offline/packs.json — перелік файлів пакетів для роботи без інтернету
// (їх завантажує src/offline.ts): мапа Угорщини (частини PMTiles з public/offline/hungary.json, стиль, шрифти),
// тайли генеральної мапи ~1910 і запасні зображення старих мап, на які посилаються data/maps і data/map-series.json.
// Версія пакета — відбиток вмісту файлів: коли він змінюється, застосунок пропонує оновити завантажений пакет.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
const rel = (f) => f.replace(/\\/g, '/').replace(/^public\//, '');

/** Перелік [шлях від кореня сайту, розмір] і версія за вмістом (або лише за назвами й розмірами). */
function pack(paths, byContent = true) {
  const h = createHash('sha1');
  const files = [...paths].sort().map((f) => {
    const b = readFileSync(f);
    h.update(rel(f));
    h.update(byContent ? b : String(b.length));
    return [rel(f), b.length];
  });
  return { version: h.digest('hex').slice(0, 12), bytes: files.reduce((s, [, n]) => s + n, 0), files };
}

export function offlinePacks() {
  return {
    name: 'offline-packs',
    apply: 'build',
    generateBundle() {
      const hu = JSON.parse(readFileSync('public/offline/hungary.json', 'utf8'));
      const fonts = walk('public/fonts').filter((f) => f.endsWith('.pbf'));
      const files = pack([...fonts, 'public/offline/basemap-hungary.json']);
      // частини мапи не читаємо зайвий раз (310 МБ): дата збірки вже в їхніх назвах
      const parts = hu.parts.map((p) => [p.url, p.bytes]);
      const ph = createHash('sha1').update(files.version).update(JSON.stringify(parts)).digest('hex').slice(0, 12);
      const basemap = { version: ph, bytes: files.bytes + hu.bytes, files: files.files, parts, date: hu.date, maxzoom: hu.maxzoom };

      const generalkarte = pack(walk('public/tiles/generalkarte').filter((f) => f.endsWith('.avif')));

      const images = new Set();
      for (const f of readdirSync('data/maps').filter((x) => x.endsWith('.json'))) {
        const m = JSON.parse(readFileSync(join('data/maps', f), 'utf8'));
        if (m.type === 'image' && /^maps\//.test(m.url)) images.add(`public/${m.url}`);
      }
      for (const s of JSON.parse(readFileSync('data/map-series.json', 'utf8')).series ?? [])
        if (s.overview?.url && /^maps\//.test(s.overview.url)) images.add(`public/${s.overview.url}`);
      const oldmaps = pack(images);

      this.emitFile({ type: 'asset', fileName: 'offline/packs.json', source: JSON.stringify({ basemap, generalkarte, oldmaps }) });
    },
  };
}
