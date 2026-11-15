// Генерує public/basemap-offline.json: стиль Protomaps «light» для локальної вирізки PMTiles.
// Запуск: node scripts/build-offline-style.mjs
import { writeFileSync } from 'node:fs';
import { layers, namedFlavor } from '@protomaps/basemaps';

const all = layers('protomaps', namedFlavor('light'), { lang: 'hu' })
  // Шари з іконками потребують спрайтів, яких офлайн немає
  .filter((l) => !(l.layout && l.layout['icon-image']));
const style = {
  version: 8,
  name: 'Protomaps light (офлайн, околиця Göd)',
  glyphs: 'fonts/{fontstack}/{range}.pbf',
  sources: {
    protomaps: {
      type: 'vector',
      url: 'pmtiles://tiles/god.pmtiles',
      attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
    },
  },
  layers: all,
};
writeFileSync('public/basemap-offline.json', JSON.stringify(style));
console.log('layers:', all.length);
