import type { StyleSpecification } from 'maplibre-gl';
import { basemaps } from './data';
import type { Basemap } from './types';

/** Стиль MapLibre для підкладки: готовий URL стилю або растровий стиль з тайлів. */
export function basemapStyle(b: Basemap): StyleSpecification | string {
  if (b.type === 'style' && b.url) return b.url;
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
