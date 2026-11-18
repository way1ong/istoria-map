import type { Map as MLMap } from 'maplibre-gl';
import { seriesById, seriesSheets } from './data';
import { lt } from './i18n';
import type { HistMap } from './types';

export interface OldMapHandle {
  setOpacity(v: number): void;
  remove(): void;
}

type Corners = [[number, number], [number, number], [number, number], [number, number]];

/**
 * Додає стару мапу на мапу MapLibre.
 * Окрема мапа — одним шаром. Аркуш серії (поле series) — разом з іншими аркушами серії:
 * на дрібних масштабах показується зведена мозаїка серії, ближче вантажаються лише аркуші,
 * що потрапляють у видиму частину (на телефоні не треба тягнути всі аркуші одразу).
 */
export function addOldMap(map: MLMap, m: HistMap, opts: { prefix: string; beforeId?: string; opacity: number }): OldMapHandle {
  const ids: string[] = [];
  let opacity = opts.opacity;
  const before = () => (opts.beforeId && map.getLayer(opts.beforeId) ? opts.beforeId : undefined);
  const addImage = (id: string, url: string, coordinates: [number, number][], zoom: { minzoom?: number; maxzoom?: number } = {}) => {
    map.addSource(id, { type: 'image', url, coordinates: coordinates as Corners });
    map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity }, ...zoom }, before());
    ids.push(id);
  };

  const series = seriesById(m.series);
  let update: (() => void) | null = null;
  if (!series) {
    const id = `${opts.prefix}-0`;
    if (m.type === 'image' && m.coordinates) addImage(id, m.url, m.coordinates);
    else {
      map.addSource(id, { type: 'raster', tiles: [m.url], tileSize: 256, attribution: m.attribution });
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity } }, before());
      ids.push(id);
    }
  } else {
    const sheets = seriesSheets(m).filter((s) => s.type === 'image' && s.coordinates);
    const ov = series.overview;
    const ovMax = ov?.maxzoom ?? 0;
    let ovAdded = false;
    const added = new Set<string>();
    update = () => {
      const z = map.getZoom();
      // оглядову мозаїку вантажимо лише тоді, коли вона може знадобитися
      if (ov && !ovAdded && z < ovMax + 0.5) {
        addImage(`${opts.prefix}-ov`, ov.url, ov.coordinates, { maxzoom: ovMax });
        ovAdded = true;
      }
      // аркуші — трохи раніше, ніж їх стане видно, щоб не було порожнечі при наближенні
      if (ov && z < ovMax - 0.5) return;
      const b = map.getBounds();
      for (const s of sheets) {
        if (added.has(s.id)) continue;
        const c = s.coordinates!;
        const west = Math.min(c[0][0], c[3][0]), east = Math.max(c[1][0], c[2][0]);
        const north = Math.max(c[0][1], c[1][1]), south = Math.min(c[2][1], c[3][1]);
        if (east < b.getWest() || west > b.getEast() || north < b.getSouth() || south > b.getNorth()) continue;
        added.add(s.id);
        addImage(`${opts.prefix}-s-${s.id}`, s.url, c, ov ? { minzoom: ovMax } : {});
      }
    };
    map.on('moveend', update);
    update();
  }
  return {
    setOpacity(v) {
      opacity = v;
      for (const id of ids) if (map.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', v);
    },
    remove() {
      if (update) map.off('moveend', update);
      for (const id of ids) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
      ids.length = 0;
    },
  };
}

/** Пункти списку старих мап: аркуші однієї серії — одним пунктом (значення — вибраний аркуш або перший). */
export function mapChoices(list: HistMap[], selectedId?: string | null): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const m of list) {
    const s = seriesById(m.series);
    if (!s) { out.push({ value: m.id, label: `${lt(m.title)} (${m.year})` }); continue; }
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const members = list.filter((x) => x.series === s.id);
    // типово — аркуш з Göd, щоб «Порівняти» відкривалося на околицях Göd
    const value = members.some((x) => x.id === selectedId) ? selectedId! : (members.find((x) => sheetCovers(x, GOD)) ?? members[0]).id;
    out.push({ value, label: lt(s.title) });
  }
  return out;
}

const GOD: [number, number] = [19.14, 47.7];
function sheetCovers(s: HistMap, p: [number, number]): boolean {
  const c = s.coordinates;
  return !!c && p[0] > c[0][0] && p[0] < c[1][0] && p[1] < c[0][1] && p[1] > c[2][1];
}

/** Чи покриває мапа (або будь-який аркуш її серії) точку. */
export function mapCovers(m: HistMap, p: [number, number]): boolean {
  return seriesSheets(m).some((s) => sheetCovers(s, p));
}
