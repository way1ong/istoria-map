import type { BorderCollection, ModernOutlines } from './types';

/**
 * Історичні кордони (data/borders/y<рік>.geojson, ybc<рік>.geojson) вантажаться
 * ліниво: один файл на обраний рік. Сучасні контури (modern.geojson) окремо.
 */
const modules = import.meta.glob<BorderCollection>('../data/borders/y*.geojson', { import: 'default' });
const modernModule = import.meta.glob<ModernOutlines>('../data/borders/modern.geojson', { import: 'default' });

function yearOfKey(key: string): number {
  const m = /y(bc)?(\d+)\.geojson$/.exec(key)!;
  return m[1] ? -Number(m[2]) : Number(m[2]);
}

/** Усі доступні роки за зростанням. */
export const borderYears: number[] = Object.keys(modules).map(yearOfKey).sort((a, b) => a - b);

/** Найближчий доступний рік, не пізніший за заданий; якщо такого нема — найраніший. */
export function nearestBorderYear(year: number): number {
  let best = borderYears[0];
  for (const y of borderYears) if (y <= year) best = y;
  return best;
}

const cache = new Map<number, Promise<BorderCollection>>();
export function loadBorders(year: number): Promise<BorderCollection> {
  const y = nearestBorderYear(year);
  if (!cache.has(y)) {
    const key = Object.keys(modules).find((k) => yearOfKey(k) === y)!;
    cache.set(y, modules[key]());
  }
  return cache.get(y)!;
}

let modernCache: Promise<ModernOutlines> | null = null;
export function loadModern(): Promise<ModernOutlines> {
  if (!modernCache) modernCache = Object.values(modernModule)[0]();
  return modernCache;
}

/** Стабільний пастельний колір для назви держави (однаковий у всі роки). */
export function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 55%)`;
}
