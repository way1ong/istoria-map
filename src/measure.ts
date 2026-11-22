// Вимірювання на мапі: людина ставить точки дотиком; рахуються довжина ламаної, а від трьох точок —
// площа й периметр многокутника (контур замикається пунктиром). Нічого не зберігається.
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import { distance, fmtLength, pathLength, ringArea } from './geo';

type LonLat = [number, number];
const SRC = 'measure';
const COLOR = '#b45309';

export interface Measure {
  add(at: LonLat): void;
  undo(): void;
  clear(): void;
  count(): number;
  /** Довжина ламаної, м. */
  length(): number;
  /** Периметр замкненого контуру, м (0, якщо точок менше трьох). */
  perimeter(): number;
  /** Площа многокутника, м² (0, якщо точок менше трьох). */
  area(): number;
  onChange(cb: () => void): void;
  /** Перемалювати підписи (змінилась мова). */
  refresh(): void;
  destroy(): void;
}

export function createMeasure(map: MLMap): Measure {
  let pts: LonLat[] = [];
  let changeCb: (() => void) | null = null;

  const data = (): GeoJSON.FeatureCollection => {
    const f: GeoJSON.Feature[] = [];
    if (pts.length >= 3) {
      f.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] }, properties: { kind: 'fill' } });
      f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [pts[pts.length - 1], pts[0]] }, properties: { kind: 'close', len: fmtLength(distance(pts[pts.length - 1], pts[0])) } });
    }
    for (let i = 1; i < pts.length; i++)
      f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [pts[i - 1], pts[i]] }, properties: { kind: 'seg', len: fmtLength(distance(pts[i - 1], pts[i])) } });
    pts.forEach((p, i) => f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { kind: 'pt', first: i === 0 ? 1 : 0 } }));
    return { type: 'FeatureCollection', features: f };
  };

  /** Джерело й шари поверх усього; після зміни підкладки їх треба додати знову. */
  const ensure = () => {
    if (map.getSource(SRC)) return;
    map.addSource(SRC, { type: 'geojson', data: data() });
    map.addLayer({ id: 'measure-fill', type: 'fill', source: SRC, filter: ['==', ['get', 'kind'], 'fill'], paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.2 } });
    map.addLayer({ id: 'measure-casing', type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'seg'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 5.5, 'line-opacity': 0.9 } });
    map.addLayer({ id: 'measure-close', type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'close'], paint: { 'line-color': COLOR, 'line-width': 2, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: 'measure-line', type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'seg'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': COLOR, 'line-width': 3 } });
    map.addLayer({
      id: 'measure-len', type: 'symbol', source: SRC, filter: ['in', ['get', 'kind'], ['literal', ['seg', 'close']]],
      layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'len'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, -0.9], 'text-allow-overlap': false },
      paint: { 'text-color': '#7c2d12', 'text-halo-color': '#ffffff', 'text-halo-width': 1.8 },
    });
    map.addLayer({
      id: 'measure-pt', type: 'circle', source: SRC, filter: ['==', ['get', 'kind'], 'pt'],
      paint: { 'circle-radius': ['case', ['==', ['get', 'first'], 1], 6, 4.5], 'circle-color': '#ffffff', 'circle-stroke-color': COLOR, 'circle-stroke-width': 2.5 },
    });
  };
  const draw = () => {
    ensure();
    (map.getSource(SRC) as GeoJSONSource | undefined)?.setData(data());
    changeCb?.();
  };
  const onStyle = () => { if (pts.length) draw(); };
  map.on('style.load', onStyle);

  return {
    add(at) { pts.push(at); draw(); },
    undo() { pts.pop(); draw(); },
    clear() { pts = []; draw(); },
    count: () => pts.length,
    length: () => pathLength(pts),
    perimeter: () => (pts.length >= 3 ? pathLength(pts) + distance(pts[pts.length - 1], pts[0]) : 0),
    area: () => ringArea(pts),
    onChange(cb) { changeCb = cb; },
    refresh: draw,
    destroy() {
      map.off('style.load', onStyle);
      changeCb = null;
      for (const id of ['measure-pt', 'measure-len', 'measure-line', 'measure-close', 'measure-casing', 'measure-fill']) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(SRC)) map.removeSource(SRC);
    },
  };
}
