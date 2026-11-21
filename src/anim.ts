import { Map as MLMap, type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { formatYear, getLang, lt, t } from './i18n';
import type { RouteCollection, RouteProps } from './types';
import { basemapStyle, chooseBasemap } from './basemap';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const KIND_COLORS: Record<RouteProps['kind'], string> = {
  military: '#c62828',
  trade: '#ef6c00',
  transport: '#00838f',
  border: '#6a1b9a',
  growth: '#2e7d32',
};
const SIDE_COLORS: Record<string, string> = { hu: '#c62828', at: '#1565c0', ru: '#4e342e', mn: '#37474f' };

/** "1849-04-10T12:00" | "1849-04-10" | "1849-04" | "324" | "-500" → мс UTC */
export function parseDate(s: string): number {
  const m = s.match(/^(-?\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?(?:T(\d{2}):(\d{2}))?$/);
  if (!m) return NaN;
  const d = new Date(0);
  d.setUTCFullYear(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, m[3] ? Number(m[3]) : 1);
  d.setUTCHours(m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0, 0, 0);
  return d.getTime();
}

function formatTime(ms: number, detail: 'year' | 'day' | 'minute'): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const yr = formatYear(y);
  if (detail === 'year') return yr;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  if (detail === 'day') return `${dd}.${mm}.${yr}`;
  return `${dd}.${mm}.${yr} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function detailOf(c: RouteCollection): 'year' | 'day' | 'minute' {
  const all = [c.animation?.from ?? '', c.animation?.to ?? '', ...c.features.flatMap((f) => [f.properties.start ?? '', f.properties.end ?? ''])];
  if (all.some((s) => s.includes('T'))) return 'minute';
  if (all.some((s) => /^-?\d{1,4}-\d{2}-\d{2}$/.test(s))) return 'day';
  return 'year';
}

function dist(a: [number, number], b: [number, number]): number {
  const kx = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * kx, a[1] - b[1]);
}

/** Частина лінії від початку до частки f ∈ [0,1] і точка-голова. */
function partial(coords: [number, number][], f: number): { line: [number, number][]; head: [number, number] } {
  if (f <= 0) return { line: [coords[0]], head: coords[0] };
  const segs = coords.slice(1).map((c, i) => dist(coords[i], c));
  const total = segs.reduce((a, b) => a + b, 0);
  let left = total * Math.min(1, f);
  const out: [number, number][] = [coords[0]];
  for (let i = 0; i < segs.length; i++) {
    if (left >= segs[i]) { out.push(coords[i + 1]); left -= segs[i]; continue; }
    const r = segs[i] ? left / segs[i] : 0;
    const p: [number, number] = [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * r, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * r];
    out.push(p);
    return { line: out, head: p };
  }
  return { line: out, head: coords[coords.length - 1] };
}

function colorOf(p: RouteProps): string {
  return (p.side && SIDE_COLORS[p.side]) || KIND_COLORS[p.kind];
}

function interpValue(values: NonNullable<RouteProps['values']>, time: number): { v: number; label?: string } | null {
  const pts = values.map((x) => ({ t: parseDate(x.date), v: x.value, label: x.label })).sort((a, b) => a.t - b.t);
  if (time < pts[0].t) return null;
  for (let i = 1; i < pts.length; i++) {
    if (time <= pts[i].t) {
      const r = (time - pts[i - 1].t) / (pts[i].t - pts[i - 1].t || 1);
      return { v: pts[i - 1].v + (pts[i].v - pts[i - 1].v) * r, label: lt(r < 0.5 ? pts[i - 1].label : pts[i].label) || undefined };
    }
  }
  const last = pts[pts.length - 1];
  return { v: last.v, label: lt(last.label) || undefined };
}

/** Будує GeoJSON-стан анімації на момент time. */
function stateAt(c: RouteCollection, time: number) {
  const lines: Feature[] = [];
  const heads: Feature[] = [];
  const points: Feature[] = [];
  const fills: Feature[] = [];
  const maxVal = Math.max(1, ...c.features.flatMap((f) => (f.properties.values ?? []).map((v) => v.value)));
  for (const f of c.features) {
    const p = f.properties;
    const s = p.start ? parseDate(p.start) : -Infinity;
    const e = p.end ? parseDate(p.end) : s;
    const color = colorOf(p);
    const label = lt(p.title);
    if (time < s) continue;
    if (f.geometry.type === 'LineString') {
      const f01 = e > s ? Math.min(1, (time - s) / (e - s)) : 1;
      const { line, head } = partial(f.geometry.coordinates, f01);
      if (line.length > 1) lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: { color, kind: p.kind } });
      heads.push({ type: 'Feature', geometry: { type: 'Point', coordinates: head }, properties: { color, label, moving: f01 < 1 ? 1 : 0 } });
    } else if (f.geometry.type === 'Point') {
      if (p.values?.length) {
        const iv = interpValue(p.values, time);
        if (!iv) continue;
        const r = 6 + 34 * Math.sqrt(iv.v / maxVal);
        points.push({ type: 'Feature', geometry: f.geometry, properties: { color, r, label: `${label}: ${Math.round(iv.v)}${iv.label ? ` (${iv.label})` : ''}` } });
      } else {
        heads.push({ type: 'Feature', geometry: f.geometry, properties: { color, label, moving: 0 } });
      }
    } else if (f.geometry.type === 'Polygon') {
      const op = e > s ? Math.min(1, (time - s) / (e - s)) : 1;
      fills.push({ type: 'Feature', geometry: f.geometry, properties: { color, opacity: 0.15 + 0.35 * op } });
    }
  }
  const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
  return { lines: fc(lines), heads: fc(heads), points: fc(points), fills: fc(fills) };
}

function boundsOf(c: RouteCollection): LngLatBoundsLike {
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  const add = ([x, y]: [number, number]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  for (const f of c.features) {
    const g = f.geometry;
    if (g.type === 'Point') add(g.coordinates);
    else if (g.type === 'LineString') g.coordinates.forEach(add);
    else g.coordinates.flat().forEach(add);
  }
  // Одна точка або дуже мала область: розширюємо, щоб мапа не наближалася до максимуму.
  const pad = 0.04;
  if (maxX - minX < pad) { minX -= pad; maxX += pad; }
  if (maxY - minY < pad) { minY -= pad; maxY += pad; }
  return [[minX, minY], [maxX, maxY]];
}

export interface AnimHandle { destroy(): void }

/** Монтує анімовану мапу з елементами керування в контейнер. */
export function mountAnimation(container: HTMLElement, c: RouteCollection): AnimHandle {
  const from = parseDate(c.animation?.from ?? c.features[0].properties.start ?? '0');
  const to = parseDate(c.animation?.to ?? c.features[0].properties.end ?? '1');
  const detail = detailOf(c);
  container.innerHTML = `
    <div class="anim-map"></div>
    <div class="anim-ctl">
      <button class="anim-play" aria-label="${t('play')}">▶</button>
      <input class="anim-range" type="range" min="0" max="1000" value="0" />
      <span class="anim-time"></span>
    </div>
    <ul class="anim-legend"></ul>`;
  const mapEl = container.querySelector<HTMLElement>('.anim-map')!;
  const btn = container.querySelector<HTMLButtonElement>('.anim-play')!;
  const range = container.querySelector<HTMLInputElement>('.anim-range')!;
  const timeEl = container.querySelector<HTMLElement>('.anim-time')!;
  const legend = container.querySelector<HTMLElement>('.anim-legend')!;
  const seen = new Set<string>();
  for (const f of c.features) {
    const key = `${colorOf(f.properties)}|${lt(f.properties.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const li = document.createElement('li');
    li.innerHTML = `<span class="sw" style="background:${colorOf(f.properties)}"></span>${lt(f.properties.title)}${f.properties.note ? ` <small>${lt(f.properties.note)}</small>` : ''}`;
    legend.append(li);
  }

  // без мережі — мапа з пристрою, якщо її завантажено
  const chosen = chooseBasemap();
  const map = new MLMap({ container: mapEl, style: chosen.type === 'offline' ? basemapStyle(chosen) : STYLE_URL, bounds: boundsOf(c), fitBoundsOptions: { padding: 40, maxZoom: 13 }, attributionControl: { compact: true } });
  let time = from;
  let playing = false;
  let raf = 0;
  let last = 0;
  const durationMs = 12000; // тривалість повного відтворення

  const apply = () => {
    const st = stateAt(c, time);
    (map.getSource('anim-lines') as GeoJSONSource | undefined)?.setData(st.lines);
    (map.getSource('anim-heads') as GeoJSONSource | undefined)?.setData(st.heads);
    (map.getSource('anim-points') as GeoJSONSource | undefined)?.setData(st.points);
    (map.getSource('anim-fills') as GeoJSONSource | undefined)?.setData(st.fills);
    range.value = String(Math.round(((time - from) / (to - from || 1)) * 1000));
    timeEl.textContent = formatTime(time, detail);
  };

  map.on('load', () => {
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
    map.addSource('anim-fills', { type: 'geojson', data: empty });
    map.addSource('anim-lines', { type: 'geojson', data: empty });
    map.addSource('anim-heads', { type: 'geojson', data: empty });
    map.addSource('anim-points', { type: 'geojson', data: empty });
    map.addLayer({ id: 'anim-fills', type: 'fill', source: 'anim-fills', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] } });
    map.addLayer({ id: 'anim-lines-casing', type: 'line', source: 'anim-lines', paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.8 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'anim-lines', type: 'line', source: 'anim-lines', paint: { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-dasharray': ['case', ['==', ['get', 'kind'], 'border'], ['literal', [2, 1.5]], ['literal', [1, 0]]] }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'anim-points', type: 'circle', source: 'anim-points', paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'color'], 'circle-opacity': 0.35, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'anim-points-label', type: 'symbol', source: 'anim-points', layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top' }, paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
    map.addLayer({ id: 'anim-heads', type: 'circle', source: 'anim-heads', paint: { 'circle-radius': ['case', ['==', ['get', 'moving'], 1], 8, 6], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'anim-heads-label', type: 'symbol', source: 'anim-heads', layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 10, 'text-allow-overlap': false }, paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
    apply();
  });

  const tick = (now: number) => {
    if (!playing) return;
    const dt = last ? now - last : 0;
    last = now;
    time = Math.min(to, time + ((to - from) * dt) / durationMs);
    apply();
    if (time >= to) { playing = false; btn.textContent = '▶'; return; }
    raf = requestAnimationFrame(tick);
  };
  btn.onclick = () => {
    if (playing) { playing = false; btn.textContent = '▶'; cancelAnimationFrame(raf); return; }
    if (time >= to) time = from;
    playing = true; last = 0; btn.textContent = '❚❚'; raf = requestAnimationFrame(tick);
  };
  range.oninput = () => {
    playing = false; btn.textContent = '▶'; cancelAnimationFrame(raf);
    time = from + (Number(range.value) / 1000) * (to - from);
    apply();
  };
  void getLang();
  return { destroy() { playing = false; cancelAnimationFrame(raf); map.remove(); } };
}
