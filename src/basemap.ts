import { addProtocol, type StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { basemaps } from './data';
import type { Basemap } from './types';

let protocolReady = false;
/** Реєструє протокол pmtiles:// для локальної вирізки тайлів (один раз). */
export function ensurePmtiles(): void {
  if (protocolReady) return;
  addProtocol('pmtiles', new Protocol().tile);
  protocolReady = true;
}

/** Стиль MapLibre для підкладки: готовий URL стилю або растровий стиль з тайлів. */
export function basemapStyle(b: Basemap): StyleSpecification | string {
  ensurePmtiles();
  if (b.type === 'style' && b.url) return b.url;
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles: b.tiles ?? [], tileSize: b.tileSize ?? 256, maxzoom: b.maxzoom ?? 18, attribution: b.attribution } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
    glyphs: 'fonts/{fontstack}/{range}.pbf',
  };
}

const STORAGE = 'istoria-basemap';
export function getPreferredBasemap(): Basemap {
  let id: string | null = null;
  try { id = localStorage.getItem(STORAGE); } catch { /* ignore */ }
  const offline = basemaps.find((b) => b.id === 'offline');
  // Без інтернету автоматично беремо локальну вирізку
  if (typeof navigator !== 'undefined' && !navigator.onLine && offline) return offline;
  return basemaps.find((b) => b.id === id) ?? basemaps[0];
}
export function setPreferredBasemap(id: string): void {
  try { localStorage.setItem(STORAGE, id); } catch { /* ignore */ }
}
