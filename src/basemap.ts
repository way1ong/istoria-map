import type { ExpressionSpecification, Map as MLMap, StyleSpecification } from 'maplibre-gl';
import { basemaps } from './data';
import type { Basemap } from './types';

/** Стиль MapLibre для підкладки: готовий URL стилю або растровий стиль з тайлів. */
export function basemapStyle(b: Basemap): StyleSpecification | string {
  if (b.type === 'style' && b.url) return b.url;
  if (b.type === 'relief') return reliefStyle(b);
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles: b.tiles ?? [], tileSize: b.tileSize ?? 256, maxzoom: b.maxzoom ?? 18, attribution: b.attribution } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  };
}

const STORAGE = 'istoria-basemap';
export function getPreferredBasemap(): Basemap {
  let id: string | null = null;
  try { id = localStorage.getItem(STORAGE); } catch { /* ignore */ }
  return basemaps.find((b) => b.id === id) ?? basemaps[0];
}
export function setPreferredBasemap(id: string): void {
  try { localStorage.setItem(STORAGE, id); } catch { /* ignore */ }
}

/** Тіньовий рельєф з тайлів висот, поверх нього сучасна вода й назви міст з векторних тайлів OpenMapTiles. */
function reliefStyle(b: Basemap): StyleSpecification {
  const water = '#4f8fd1';
  const style: StyleSpecification = {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      dem: { type: 'raster-dem', tiles: b.tiles ?? [], tileSize: b.tileSize ?? 256, maxzoom: b.maxzoom ?? 15, encoding: b.encoding ?? 'terrarium', attribution: b.attribution },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#f4f0e6' } },
      { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.9, 'hillshade-shadow-color': '#4b3f33', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#6b5a48' } },
    ],
  };
  if (b.vector) {
    style.sources.omt = { type: 'vector', url: b.vector };
    style.layers.push(
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': water, 'fill-opacity': 0.55 } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': water, 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, ['match', ['get', 'class'], 'river', 1.2, 0.4], 14, ['match', ['get', 'class'], 'river', 3, 1.2]] } },
      { id: 'towns', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]], layout: { 'text-field': ['coalesce', ['get', 'name:hu'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 11 }, paint: { 'text-color': '#374151', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 } },
    );
  }
  return style;
}

/**
 * Підписи підкладки мовою інтерфейсу. Стиль OpenFreeMap бере англійські назви (name_en: «Hungary», «Danube»),
 * тож для всіх його підписів назв ставимо name:uk / name:hu з OSM, а де їх немає — місцеву назву (name).
 */
export function localizeBasemapLabels(map: MLMap, lang: string): void {
  const style = map.getStyle();
  if (!style?.layers) return;
  const expr: ExpressionSpecification = ['coalesce', ['get', `name:${lang}`], ['get', 'name']];
  for (const l of style.layers) {
    if (l.type !== 'symbol') continue;
    const tf = map.getLayoutProperty(l.id, 'text-field');
    if (tf === undefined || tf === null) continue;
    const js = JSON.stringify(tf);
    if (!/"name_en"|"name:latin"|"name:(uk|hu)"|\{name(:latin|_en)?\}/.test(js)) continue;
    map.setLayoutProperty(l.id, 'text-field', expr);
  }
}
