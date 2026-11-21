// Генерує public/offline/basemap-hungary.json: стиль Protomaps «light» для мапи Угорщини без інтернету.
// Шари, яким потрібні значки (спрайтів офлайн немає), прибрано; у підписів населених пунктів прибрано лише значок.
// Адреси offline://… і pmtiles://offline-hungary обробляє src/offline.ts: файли беруться з кешу браузера
// (пакет «Сучасна мапа Угорщини»), а без нього — з сайту.
// Запуск: node scripts/offline/build-offline-style.mjs
import { writeFileSync } from 'node:fs';
import { layers, namedFlavor } from '@protomaps/basemaps';

const DROP = new Set(['pois', 'roads_shields', 'roads_oneway']);
const flavor = namedFlavor('light');
const all = layers('protomaps', flavor, { lang: 'hu' })
  .filter((l) => !DROP.has(l.id))
  .map((l) => {
    // поза вирізкою (далеко від Угорщини на великих зумах) тайлів немає: тло кольору суходолу замість сірого
    if (l.id === 'background') return { ...l, paint: { ...l.paint, 'background-color': flavor.earth } };
    if (!l.layout || !('icon-image' in l.layout)) return l;
    const { 'icon-image': _icon, ...layout } = l.layout;
    return { ...l, layout };
  });
const style = {
  version: 8,
  name: 'Protomaps light — Угорщина без інтернету',
  glyphs: 'offline://fonts/{fontstack}/{range}.pbf',
  sources: {
    protomaps: {
      type: 'vector',
      url: 'pmtiles://offline-hungary',
      attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
    },
  },
  layers: all,
};
writeFileSync('public/offline/basemap-hungary.json', JSON.stringify(style));
console.log('шарів:', all.length);
