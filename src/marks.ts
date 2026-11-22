// Власні мітки людини (прапорці на мапі): місце, назва, нотатка, колір. Зберігаються ЛИШЕ в цьому браузері
// (localStorage) — нічого не йде ні на сервер, ні в репозиторій; перенести на інший пристрій чи зберегти
// можна файлом GeoJSON (вивантажити / завантажити). Перший крок до мапи сигналів з плану (п. 13).
import { t } from './i18n';

export const MARK_COLORS = ['red', 'blue', 'green', 'yellow'] as const;
export type MarkColor = (typeof MARK_COLORS)[number];
export const MARK_HEX: Record<MarkColor, string> = { red: '#dc2626', blue: '#2563eb', green: '#15803d', yellow: '#eab308' };

export interface Mark {
  id: string;
  lon: number;
  lat: number;
  name: string;
  note: string;
  color: MarkColor;
  /** Коли поставлено (ISO 8601). */
  created: string;
  /** Точність GPS у метрах, якщо мітку поставлено «там, де я стою». */
  acc?: number;
}

const LS = 'istoria.marks';
let cache: Mark[] | null = null;
const listeners = new Set<() => void>();

const isColor = (x: unknown): x is MarkColor => MARK_COLORS.includes(x as MarkColor);
const validPos = (lon: unknown, lat: unknown): boolean =>
  typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
const str = (x: unknown, max: number): string => (typeof x === 'string' ? x : '').slice(0, max);

function clean(x: Partial<Mark> | null | undefined): Mark | null {
  if (!x || !validPos(x.lon, x.lat) || typeof x.id !== 'string' || !x.id) return null;
  const created = typeof x.created === 'string' && !Number.isNaN(Date.parse(x.created)) ? x.created : new Date().toISOString();
  const m: Mark = { id: x.id.slice(0, 64), lon: x.lon as number, lat: x.lat as number, name: str(x.name, 120), note: str(x.note, 4000), color: isColor(x.color) ? x.color : 'red', created };
  if (typeof x.acc === 'number' && Number.isFinite(x.acc) && x.acc >= 0) m.acc = Math.round(x.acc);
  return m;
}

/** Усі мітки, найновіші спершу. */
export function marks(): Mark[] {
  if (!cache) {
    try {
      const raw = JSON.parse(localStorage.getItem(LS) ?? '[]') as unknown;
      cache = (Array.isArray(raw) ? raw : []).map((x) => clean(x as Partial<Mark>)).filter((m): m is Mark => !!m);
    } catch {
      cache = [];
    }
  }
  return [...cache].sort((a, b) => b.created.localeCompare(a.created));
}
export const markById = (id: string): Mark | undefined => marks().find((m) => m.id === id);

/** false — браузер не дав записати (приватний режим, немає місця). */
function save(list: Mark[]): boolean {
  cache = list;
  let ok = true;
  try { localStorage.setItem(LS, JSON.stringify(list)); } catch { ok = false; }
  for (const cb of listeners) cb();
  return ok;
}
export function onMarksChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Нова мітка; назва типова — «Мітка N» з наступним вільним номером. */
export function addMark(at: [number, number], extra: Partial<Pick<Mark, 'name' | 'note' | 'color' | 'acc'>> = {}): Mark {
  const all = marks();
  const word = t('markDefault');
  const used = all.map((m) => new RegExp(`^${word} (\\d+)$`).exec(m.name)?.[1]).filter(Boolean).map(Number);
  const m: Mark = { id: newId(), lon: at[0], lat: at[1], name: extra.name ?? `${word} ${Math.max(0, ...used) + 1}`, note: extra.note ?? '', color: extra.color ?? 'red', created: new Date().toISOString() };
  if (typeof extra.acc === 'number') m.acc = Math.round(extra.acc);
  save([...all, m]);
  return m;
}
export function updateMark(id: string, patch: Partial<Omit<Mark, 'id' | 'created'>>): void {
  save(marks().map((m) => (m.id === id ? clean({ ...m, ...patch }) ?? m : m)));
}
export function deleteMark(id: string): void {
  save(marks().filter((m) => m.id !== id));
}

/** Мітки для шару мапи. */
export function marksGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: marks().map((m) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [m.lon, m.lat] }, properties: { id: m.id, name: m.name, color: m.color } })),
  };
}

/** Текст файлу для вивантаження: звичайний GeoJSON, який читають ГІС і навігатори. */
export function exportMarks(): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    name: 'istoria-map: мої мітки',
    features: marks().map((m) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
      properties: { id: m.id, name: m.name, note: m.note, color: m.color, created: m.created, ...(m.acc !== undefined ? { acc: m.acc } : {}) },
    })),
  }, null, 1);
}

/**
 * Додає мітки з файлу GeoJSON (наш формат або точки з інших програм: name/title, note/description/desc).
 * Мітки з уже наявним id чи тими самими координатами й назвою пропускаються. Кидає помилку, якщо це не GeoJSON.
 */
export function importMarks(text: string): { added: number; skipped: number } {
  const doc = JSON.parse(text) as { type?: string; features?: unknown[] };
  const feats = doc?.type === 'FeatureCollection' && Array.isArray(doc.features) ? doc.features : doc?.type === 'Feature' ? [doc] : null;
  if (!feats) throw new Error('not GeoJSON');
  const all = marks();
  const have = new Set(all.map((m) => m.id));
  const same = new Set(all.map((m) => `${m.lon.toFixed(6)},${m.lat.toFixed(6)},${m.name}`));
  let added = 0, skipped = 0;
  for (const f of feats as { geometry?: { type?: string; coordinates?: unknown[] }; properties?: Record<string, unknown> | null }[]) {
    const c = f?.geometry?.type === 'Point' ? f.geometry.coordinates : null;
    const p = f?.properties ?? {};
    const id = typeof p.id === 'string' && p.id ? p.id : newId() + added;
    const m = c ? clean({ id, lon: c[0] as number, lat: c[1] as number, name: str(p.name ?? p.title, 120), note: str(p.note ?? p.description ?? p.desc, 4000), color: p.color as MarkColor, created: str(p.created ?? p.time, 40), acc: p.acc as number }) : null;
    if (!m) { skipped++; continue; }
    const key = `${m.lon.toFixed(6)},${m.lat.toFixed(6)},${m.name}`;
    if (have.has(m.id) || same.has(key)) { skipped++; continue; }
    have.add(m.id); same.add(key);
    all.push(m);
    added++;
  }
  if (added) save(all);
  return { added, skipped };
}

/** Прапорець для списків і вибору кольору (SVG в рядку тексту). */
export function flagSvg(color: MarkColor, size = 18): string {
  return `<svg class="flag" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M6 2.5v19.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/><path d="M7 3.5h13l-3.4 4.5 3.4 4.5H7Z" fill="${MARK_HEX[color]}" stroke="#fff" stroke-width="1" stroke-linejoin="round"/></svg>`;
}
