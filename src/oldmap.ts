import { Popup } from 'maplibre-gl';
import type { CustomLayerInterface, ExpressionSpecification, FilterSpecification, GeoJSONSource, MapLayerMouseEvent, Map as MLMap } from 'maplibre-gl';
import { loadVectorOverlay, seriesById, seriesSheets } from './data';
import { lt, t } from './i18n';
import type { HistMap, LText } from './types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export interface OldMapHandle {
  setOpacity(v: number): void;
  /** Закрити підказку об'єкта векторної накладки (наприклад, коли вибрано інше місце). */
  closePopup(): void;
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

/** Події Allmaps (напр. 'imageinfofetcherror') MapLibre не знає в типах, тому підписуємося через цей інтерфейс. */
type Evented = { on(type: string, fn: (e: { layerId?: string }) => void): unknown; off(type: string, fn: (e: { layerId?: string }) => void): unknown };

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
  let onImageError: ((e: { layerId?: string }) => void) | null = null;
  const before = () => (opts.beforeId && map.getLayer(opts.beforeId) ? opts.beforeId : undefined);
  const setPointer = () => { map.getCanvas().style.cursor = 'pointer'; };
  const unsetPointer = () => { map.getCanvas().style.cursor = ''; };
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
  const vectorIds: { id: string; prop: 'fill-opacity' | 'line-opacity' | 'circle-opacity' | 'circle-stroke-opacity'; k: number }[] = [];
  const clickLayers: string[] = [];
  let onClick: ((e: MapLayerMouseEvent) => void) | null = null;
  let popup: Popup | null = null;
  if (!series && m.type === 'geojson' && m.legend?.length) {
    // Векторна накладка з умовними знаками: кожен вид об'єктів (properties.kind) малюється своїм стилем,
    // натискання показує підказку з назвою, поясненням точності й джерелом.
    const id = `${opts.prefix}-v`;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    ids.push(id);
    const width: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 8, 1.2, 12, 2.4, 15, 3.6];
    // площі знизу, далі лінії, кружки зверху
    const order = { fill: 0, line: 1, dash: 1, longdash: 1, point: 2 } as const;
    for (const it of [...m.legend].sort((a, b) => order[a.style] - order[b.style])) {
      const lid = `${id}-${it.kind}`;
      const filter: FilterSpecification = ['==', ['get', 'kind'], it.kind];
      if (it.style === 'fill') {
        map.addLayer({ id: lid, type: 'fill', source: id, filter, paint: { 'fill-color': it.color, 'fill-opacity': 0.55 * opacity, 'fill-outline-color': it.color } }, before());
        vectorIds.push({ id: lid, prop: 'fill-opacity', k: 0.55 });
      } else if (it.style === 'point') {
        map.addLayer({ id: lid, type: 'circle', source: id, filter, paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 12, 5, 15, 7],
          'circle-color': it.color, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
          'circle-opacity': opacity, 'circle-stroke-opacity': opacity,
        } }, before());
        vectorIds.push({ id: lid, prop: 'circle-opacity', k: 1 }, { id: lid, prop: 'circle-stroke-opacity', k: 1 });
      } else {
        const dash = it.style === 'dash' ? [2, 1.5] : it.style === 'longdash' ? [4, 2.5] : undefined;
        map.addLayer({ id: lid, type: 'line', source: id, filter, layout: { 'line-cap': dash ? 'butt' : 'round', 'line-join': 'round' },
          paint: { 'line-color': it.color, 'line-width': width, 'line-opacity': opacity, ...(dash ? { 'line-dasharray': dash } : {}) } }, before());
        vectorIds.push({ id: lid, prop: 'line-opacity', k: 1 });
      }
      ids.unshift(lid);
      clickLayers.push(lid);
    }
    const legend = m.legend;
    onClick = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const it = legend.find((x) => x.kind === f?.properties?.kind);
      if (!f || !it) return;
      // натиснули на мітку місця поверх накладки — відкривається картка місця, підказка не потрібна
      const placeLayers = ['places-dot', 'places-halo'].filter((l) => map.getLayer(l));
      if (placeLayers.length && map.queryRenderedFeatures(e.point, { layers: placeLayers }).length) return;
      // MapLibre віддає вкладені об'єкти властивостей рядком JSON
      const ltext = (v: unknown): string => {
        if (!v) return '';
        try { return lt((typeof v === 'string' ? JSON.parse(v) : v) as LText); } catch { return ''; }
      };
      const name = ltext(f.properties?.name);
      const fnote = ltext(f.properties?.note);
      const url = f.properties?.url && /^https:\/\//.test(String(f.properties.url)) ? String(f.properties.url) : '';
      const host = url ? new URL(url).hostname.replace(/^www\./, '') : '';
      const src = it.source;
      const html = `<div class="ov-pop"><strong>${esc(lt(it.label))}</strong>${name ? `<div class="ov-name">${esc(name)}</div>` : ''}`
        + (fnote ? `<p>${esc(fnote)}</p>` : '')
        + (it.note ? `<p>${esc(lt(it.note))}</p>` : '')
        + (src ? `<p class="ov-src">${t('sources')}: ${src.url ? `<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.title)}</a>` : esc(src.title)}</p>` : '')
        + (url ? `<p class="ov-src"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(host)}</a></p>` : '')
        + '</div>';
      popup?.remove();
      popup = new Popup({ maxWidth: '280px', closeButton: true }).setLngLat(e.lngLat).setHTML(html).addTo(map);
    };
    for (const lid of clickLayers) {
      map.on('click', lid, onClick);
      map.on('mouseenter', lid, setPointer);
      map.on('mouseleave', lid, unsetPointer);
    }
    void loadVectorOverlay(m.url).then((data) => {
      if (removed) return;
      (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
    }).catch((e) => console.warn('Векторна накладка:', e));
  } else if (!series && m.type === 'geojson') {
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
      // Шлях у public/ -> повна адреса. Не через new URL(m.url, …): він закодував би дужки {z}/{x}/{y}.
      const url = /^https?:\/\//.test(m.url) ? m.url : new URL('.', document.baseURI).href + m.url;
      map.addSource(id, {
        type: 'raster', tiles: [url], tileSize: m.tileSize ?? 256, attribution: m.attribution,
        ...(m.minzoom !== undefined ? { minzoom: m.minzoom } : {}),
        ...(m.maxzoom !== undefined ? { maxzoom: m.maxzoom } : {}),
        // поза межами тайлів немає: без bounds MapLibre запитував би їх і отримував 404
        ...(m.bounds ? { bounds: m.bounds } : {}),
      });
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
        // Allmaps не повторює невдалий запит info.json аркуша (збій сервера бібліотеки): тоді повертаємо
        // запасне зображення на всі масштаби, щоб на місці аркуша не лишилося дірки.
        onImageError = (e: { layerId?: string }) => {
          if (removed || e.layerId !== layerId) return;
          if (map.getLayer(ovId)) { map.setLayerZoomRange(ovId, 0, 24); map.setLayoutProperty(ovId, 'visibility', 'visible'); }
          if (map.getLayer(imgId)) map.setLayoutProperty(imgId, 'visibility', 'visible');
        };
        (map as unknown as Evented).on('imageinfofetcherror', onImageError);
      });
    }).catch((e) => console.warn('Allmaps:', e));
  }

  return {
    closePopup() {
      popup?.remove();
      popup = null;
    },
    setOpacity(v) {
      opacity = v;
      for (const id of ids) if (map.getLayer(id) && map.getLayer(id)!.type === 'raster') map.setPaintProperty(id, 'raster-opacity', v);
      for (const x of vectorIds) if (map.getLayer(x.id)) map.setPaintProperty(x.id, x.prop, x.k * v);
      warped?.setOpacity(v);
    },
    remove() {
      removed = true;
      if (update) map.off('moveend', update);
      if (onImageError) (map as unknown as Evented).off('imageinfofetcherror', onImageError);
      if (warped && map.getLayer(warped.id)) map.removeLayer(warped.id);
      warped = null;
      if (onClick) for (const lid of clickLayers) {
        map.off('click', lid, onClick);
        map.off('mouseenter', lid, setPointer);
        map.off('mouseleave', lid, unsetPointer);
      }
      unsetPointer();
      popup?.remove();
      popup = null;
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
    if (!s) { out.push({ value: m.id, label: `${lt(m.title)} (${typeof m.year === 'object' ? lt(m.year) : m.year})` }); continue; }
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
  const b = mapBox(s);
  return !!b && p[0] > b[0] && p[0] < b[2] && p[1] > b[1] && p[1] < b[3];
}

/** Межі мапи [захід, південь, схід, північ]: з кутів зображення або з bounds тайлів. */
export function mapBox(m: HistMap): [number, number, number, number] | null {
  const c = m.coordinates;
  if (c && c.length === 4) return [Math.min(c[0][0], c[3][0]), Math.min(c[2][1], c[3][1]), Math.max(c[1][0], c[2][0]), Math.max(c[0][1], c[1][1])];
  return m.bounds ?? null;
}

/** Чи покриває мапа (або будь-який аркуш її серії) точку. */
export function mapCovers(m: HistMap, p: [number, number]): boolean {
  return seriesSheets(m).some((s) => sheetCovers(s, p));
}
