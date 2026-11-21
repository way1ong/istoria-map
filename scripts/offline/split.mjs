// Розбиває вирізку PMTiles на частини по 16 МіБ у public/offline/ (GitHub не приймає файли понад 100 МБ,
// а дрібні частини легше докачати) і пише опис public/offline/hungary.json.
// Запуск: node scripts/offline/split.mjs <вирізка.pmtiles> <збірка Protomaps, напр. 20261120>
import { openSync, readSync, fstatSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { PMTiles } from 'pmtiles';

const [file, build] = process.argv.slice(2);
if (!file || !/^\d{8}$/.test(build ?? '')) {
  console.error('Запуск: node scripts/offline/split.mjs <вирізка.pmtiles> <YYYYMMDD>');
  process.exit(1);
}
const PART = 16 * 2 ** 20;
const OUT = 'public/offline';
const fd = openSync(file, 'r');
const size = fstatSync(fd).size;
const src = {
  getKey: () => file,
  getBytes: async (o, l) => { const b = Buffer.alloc(l); readSync(fd, b, 0, l, o); return { data: b.buffer.slice(b.byteOffset, b.byteOffset + l) }; },
};
const h = await new PMTiles(src).getHeader();

for (const f of readdirSync(OUT)) if (/^hungary-\d{8}-\d+\.bin$/.test(f)) unlinkSync(`${OUT}/${f}`);
const parts = [];
for (let off = 0, i = 0; off < size; off += PART, i++) {
  const len = Math.min(PART, size - off);
  const b = Buffer.alloc(len);
  readSync(fd, b, 0, len, off);
  const name = `hungary-${build}-${String(i).padStart(2, '0')}.bin`;
  writeFileSync(`${OUT}/${name}`, b);
  parts.push({ url: `offline/${name}`, bytes: len });
}
const desc = {
  _comment: 'Мапа Угорщини для роботи без інтернету: вирізка зі збірки Protomaps (дані OpenStreetMap), частини файлу PMTiles. Створюється скриптами в scripts/offline/ (README там), вручну не редагувати.',
  date: `${build.slice(0, 4)}-${build.slice(4, 6)}-${build.slice(6)}`,
  build: `https://build.protomaps.com/${build}.pmtiles`,
  minzoom: h.minZoom,
  maxzoom: h.maxZoom,
  bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat],
  bytes: size,
  parts,
};
writeFileSync(`${OUT}/hungary.json`, JSON.stringify(desc, null, 2) + '\n');
console.log(`частин: ${parts.length}, байт: ${size}, зум ${h.minZoom}–${h.maxZoom}`);
