import { addProtocol, type StyleSpecification } from 'maplibre-gl';
import { PMTiles, Protocol, type RangeResponse, type Source } from 'pmtiles';
import { basemaps } from './data';
import type { Basemap } from './types';

/** Джерело PMTiles з пам'яті: файл читається цілком один раз, тому сервіс-воркеру не потрібні Range-запити. */
class MemorySource implements Source {
  constructor(private key: string, private buf: ArrayBuffer) {}
  getKey(): string { return this.key; }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: this.buf.slice(offset, offset + length) };
  }
}

export const OFFLINE_PMTILES = 'tiles/god.pmtiles';
let protocol: Protocol | null = null;
let preload: Promise<void> | null = null;

/** Реєструє протокол pmtiles:// (один раз). */
export function ensurePmtiles(): void {
  if (protocol) return;
  protocol = new Protocol();
  addProtocol('pmtiles', protocol.tile);
}

/** Завантажує вирізку тайлів у пам'ять (~13 МБ); повторні виклики повертають ту саму обіцянку. */
export function preloadOffline(): Promise<void> {
  ensurePmtiles();
  if (!preload) {
    preload = fetch(OFFLINE_PMTILES)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((buf) => { protocol!.add(new PMTiles(new MemorySource(OFFLINE_PMTILES, buf))); })
      .catch((e) => { preload = null; throw e; });
  }
  return preload;
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
