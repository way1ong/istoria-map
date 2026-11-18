import type { CustomLayerInterface, GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import { loadVectorOverlay, seriesById, seriesSheets } from './data';
import { lt } from './i18n';
import type { HistMap } from './types';

export interface OldMapHandle {
  setOpacity(v: number): void;
  remove(): void;
}

type Corners = [[number, number], [number, number], [number, number], [number, number]];

/** Allmaps малює через WebGL2; без нього лишаються звичайні зображення. */
let webgl2: boolean | null = null;
function hasWebGL2(): boolean {
  if (webgl2 === null) {
    try { webgl2 = !!document.createElement('canvas').getContext('webgl2'); } catch { webgl2 = false; }
  }
  return webgl2;
}

/** Мінімальний інтерфейс шару Allmaps, яким ми користуємося. */
interface WarpedLayer extends CustomLayerInterface {
  setOpacity(v: number): void;
  addGeoreferenceAnnotationByUrl(url: string): Promise<unknown>;
}

/**
 * Додає стару мапу на мапу MapLibre.
 * - Окрема мапа — одним шаром-зображенням.
 * - Аркуш серії (поле series) — разом з іншими аркушами серії: на дрібних масштабах зведена мозаїка,
 *   ближче — лише аркуші в полі зору (на телефоні не треба тягнути всі аркуші одразу).
 * - Якщо мапа чи серія має georef, поверх показуються оригінали в повній якості з серверів IIIF
 *   бібліотек (бібліотека Allmaps вантажить лише видимі шматки потрібної роздільності); звичайні
 *   зображення під ними лишаються запасним шаром.
 */
export function addOldMap(map: MLMap, m: HistMap, opts: { prefix: string; beforeId?: string; opacity: number }): OldMapHandle {
  const ids: string[] = [];
  let opacity = opts.opacity;
  let removed = false;
  let warped: WarpedLayer | null = null;
  const before = () => (opts.beforeId && map.getLayer(opts.beforeId) ? opts.beforeId : undefined);
  const addImage = (id: string, url: string, coordinates: [number, number][], zoom: { minzoom?: number; maxzoom?: number } = {}) => {
    map.addSource(id, { type: 'image', url, coordinates: coordinates as Corners });
    map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity }, ...zoom }, before());
    ids.push(id);
  };

  const series = seriesById(m.series);
  const georef = hasWebGL2() ? (series ? series.georef : m.georef) : undefined;
  const members = series ? seriesSheets(m) : [m];

  // Підпис джерел у кнопці «i» мапи: невидимий шар з атрибуцією, поки стара мапа показана.
  const credits = series?.attribution ?? [...new Set(members.map((x) => x.attribution))].join('; ');
  const attrId = `${opts.prefix}-attr`;
  map.addSource(attrId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: credits });
  map.addLayer({ id: attrId, type: 'circle', source: attrId, paint: { 'circle-radius': 0 } });
  ids.push(attrId);

  let update: (() => void) | null = null;
  const vectorIds: { id: string; prop: 'fill-opacity' | 'line-opacity'; k: number }[] = [];
  if (!series && m.type === 'geojson') {
    // Векторна накладка: заливка й контур; дані вантажаться ліниво.
    const id = `${opts.prefix}-v`;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, paint: { 'fill-color': '#2f7fd8', 'fill-opacity': 0.45 * opacity } }, before());
    map.addLayer({ id: `${id}-line`, type: 'line', source: id, paint: { 'line-color': '#1b4f8f', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 12, 1.6], 'line-opacity': opacity } }, before());
    ids.push(`${id}-fill`, `${id}-line`, id);
    vectorIds.push({ id: `${id}-fill`, prop: 'fill-opacity', k: 0.45 }, { id: `${id}-line`, prop: 'line-opacity', k: 1 });
    void loadVectorOverlay(m.url).then((data) => {
      if (removed) return;
      (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
    }).catch((e) => console.warn('Векторна накладка:', e));
  } else if (!series) {
    const id = `${opts.prefix}-0`;
    if (m.type === 'image' && m.coordinates) addImage(id, m.url, m.coordinates);
    else {
      map.addSource(id, { type: 'raster', tiles: [m.url], tileSize: 256, attribution: m.attribution });
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity } }, before());
      ids.push(id);
    }
  } else if (georef && series.overview) {
    // Оригінали серії йдуть з IIIF; мозаїка — дрібніше за allmapsMinzoom і запасний шар, поки вантажиться Allmaps.
    addImage(`${opts.prefix}-ov`, series.overview.url, series.overview.coordinates);
  } else {
    const sheets = members.filter((s) => s.type === 'image' && s.coordinates);
    const ov = series.overview;
    const ovMax = ov?.maxzoom ?? 0;
    // Мозаїка — на всіх масштабах (вона покриває всю серію), окремі аркуші з public/maps — поверх неї
    // при наближенні, лише ті, що в полі зору.
    if (ov) addImage(`${opts.prefix}-ov`, ov.url, ov.coordinates);
    const added = new Set<string>();
    update = () => {
      const z = map.getZoom();
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

  if (georef) {
    // Бібліотеку вантажимо лише тоді, коли справді показуємо стару мапу.
    void import('@allmaps/maplibre').then(({ WarpedMapLayer }) => {
      if (removed) return;
      const layerId = `${opts.prefix}-warped`;
      const layer = new WarpedMapLayer({ layerId, ...(series?.grayscale ? { saturation: 0 } : {}) }) as unknown as WarpedLayer;
      map.addLayer(layer, before());
      // дрібніше за allmapsMinzoom шар прихований: MapLibre не викликає render, тож Allmaps нічого не вантажить
      if (series?.allmapsMinzoom) map.setLayerZoomRange(layerId, series.allmapsMinzoom, 24);
      warped = layer;
      layer.setOpacity(opacity);
      return layer.addGeoreferenceAnnotationByUrl(new URL(georef, document.baseURI).href).then(() => {
        if (removed) return;
        // Запасне зображення під оригіналами ховаємо там, де малює Allmaps: інакше при неповній
        // прозорості дві копії накладаються (трохи різна прив'язка дає «подвійне» зображення).
        const ovId = `${opts.prefix}-ov`, imgId = `${opts.prefix}-0`;
        if (series && map.getLayer(ovId)) {
          if (series.allmapsMinzoom) map.setLayerZoomRange(ovId, 0, series.allmapsMinzoom);
          else map.setLayoutProperty(ovId, 'visibility', 'none');
        } else if (!series && map.getLayer(imgId)) map.setLayoutProperty(imgId, 'visibility', 'none');
      });
    }).catch((e) => console.warn('Allmaps:', e));
  }

  return {
    setOpacity(v) {
      opacity = v;
      for (const id of ids) if (map.getLayer(id) && map.getLayer(id)!.type === 'raster') map.setPaintProperty(id, 'raster-opacity', v);
      for (const x of vectorIds) if (map.getLayer(x.id)) map.setPaintProperty(x.id, x.prop, x.k * v);
      warped?.setOpacity(v);
    },
    remove() {
      removed = true;
      if (update) map.off('moveend', update);
      if (warped && map.getLayer(warped.id)) map.removeLayer(warped.id);
      warped = null;
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
