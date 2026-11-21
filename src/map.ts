import {
  GeolocateControl,
  Map as MLMap,
  NavigationControl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 завантажує воркер окремим файлом; Vite збирає його як окремий worker-чанк.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
import { basemaps, histMaps, periodById, places } from './data';
import { basemapStyle, chooseBasemap, localizeBasemapLabels, offlineBasemap, setPreferredBasemap } from './basemap';
import { installed, offlineMapReady } from './offline';
import { lt } from './i18n';
import { colorFor, loadBorders, loadModern } from './borders';
import { addOldMap, type OldMapHandle } from './oldmap';
import { DOT_RADIUS, DOT_STROKE, HALO_RADIUS } from './markers';
import type { BorderCollection, HistMap, Place, PlaceType } from './types';

// Стартовий вигляд: уся Угорщина (центр країни, зум під екран телефона).
const CENTER: [number, number] = [19.4, 47.15];
const SRC = 'places';
const BORDERS_SRC = 'borders';
const MODERN_SRC = 'modern-outline';
/** Нижче цього зуму показуються історичні кордони; вище — лише місця. */
const BORDERS_MAXZOOM = 9;

export interface MapController {
  map: MLMap;
  setPeriod(periodId: string | null): void;
  setSelected(placeId: string | null): void;
  flyTo(place: Place): void;
  setOverlay(mapId: string | null): void;
  setOverlayOpacity(v: number): void;
  refreshLabels(): void;
  setBasemap(id: string): void;
  currentBasemap(): string;
  /** Зникла чи з'явилася мережа, або мапу з пристрою завантажено чи видалено: перевибрати підкладку й накладку. */
  networkChanged(): void;
  /** Підкладку змінила сама мапа (стиль з інтернету не завантажився — узято мапу з пристрою). */
  onBasemapChange(cb: () => void): void;
  /** Рік повзунка (null = усі періоди): перемикає шар історичних кордонів. */
  setYear(year: number | null): void;
  /** Викликається, коли змінюється рік або видимість шару кордонів (для підпису). */
  onBorders(cb: (info: { year: number; attribution: string } | null) => void): void;
  /** Фільтр місць за типом (порожній набір = усі типи) і «лише зниклі». */
  setPlaceFilter(f: PlaceFilter): void;
  /** Типи місць, якими обмежує мітки вибрана накладка (поле placeTypes у data/maps), або null. */
  overlayPlaceTypes(): PlaceType[] | null;
}

export interface PlaceFilter {
  types: PlaceType[];
  vanishedOnly: boolean;
}

/** Чи проходить місце фільтр періоду й типу. */
export function placeVisible(p: Place, periodId: string | null, f: PlaceFilter, onlyTypes?: PlaceType[] | null): boolean {
  if (periodId && !p.periods.includes(periodId)) return false;
  // накладка з полем placeTypes (напр. укріплення) лишає на мапі лише свої типи місць
  if (onlyTypes?.length && !onlyTypes.includes(p.type)) return false;
  if (f.types.length && !f.types.includes(p.type)) return false;
  if (f.vanishedOnly && !p.vanished) return false;
  return true;
}

/**
 * Місця з однаковими координатами (наприклад, кілька об'єктів з точністю «центр
 * населеного пункту») розводяться по колу радіусом ~120 м лише для показу, щоб
 * кожну мітку можна було натиснути. Дані в картці лишаються незмінними.
 */
function spread(list: Place[]): Map<string, [number, number]> {
  const groups = new Map<string, Place[]>();
  for (const p of list) {
    const k = p.coords.join(',');
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const out = new Map<string, [number, number]>();
  for (const g of groups.values()) {
    if (g.length === 1) { out.set(g[0].id, g[0].coords); continue; }
    const r = 0.0012;
    g.forEach((p, i) => {
      const a = (2 * Math.PI * i) / g.length;
      out.set(p.id, [p.coords[0] + (r * Math.cos(a)) / Math.cos((p.coords[1] * Math.PI) / 180), p.coords[1] + r * Math.sin(a)]);
    });
  }
  return out;
}

function featureCollection(periodId: string | null, lang: string, filter: PlaceFilter, forceId: string | null, onlyTypes: PlaceType[] | null) {
  // вибране місце (з пошуку чи «Що поруч») показуємо навіть тоді, коли фільтр типу його ховає
  const visible = places.filter((p) => p.id === forceId || placeVisible(p, periodId, filter, onlyTypes));
  const pos = spread(visible);
  return {
    type: 'FeatureCollection' as const,
    features: visible
      .map((p) => {
        const period = periodById(p.periods[0]);
        return {
          type: 'Feature' as const,
          id: p.id,
          geometry: { type: 'Point' as const, coordinates: pos.get(p.id) ?? p.coords },
          properties: {
            id: p.id,
            label: lt(p.name),
            color: period?.color ?? '#6b7280',
            vanished: p.vanished ? 1 : 0,
            lang,
          },
        };
      }),
  };
}

/** Широкий екран (ПК): картка місця — панель праворуч, а не знизу. */
export const isWide = () => matchMedia('(min-width: 900px)').matches;

export function createMap(container: HTMLElement, onSelect: (id: string | null) => void): MapController {
  let basemap = chooseBasemap();
  // чи завантажився стиль поточної підкладки (для переходу на мапу з пристрою, якщо мережі насправді немає)
  let styleOk = false;
  const map = new MLMap({
    container,
    style: basemapStyle(basemap),
    center: CENTER,
    zoom: 6,
    attributionControl: { compact: true },
    // старі мапи в повній якості (Allmaps) не підтримують нахил мапи
    maxPitch: 0,
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new GeolocateControl({ trackUserLocation: false }), 'top-right');

  let currentPeriod: string | null = null;
  let placeFilter: PlaceFilter = { types: [], vanishedOnly: false };
  let selected: string | null = null;
  let lang = document.documentElement.lang || 'uk';

  const opacityExpr = (sel: string | null): ExpressionSpecification | number =>
    sel ? ['case', ['==', ['get', 'id'], sel], 1, 0.25] : 1;

  const addLayers = () => {
    if (map.getSource(SRC)) return;
    // Історичні кордони: заливка за державою, контур і підпис; видимі лише при віддаленні.
    map.addSource(BORDERS_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'borders-fill', type: 'fill', source: BORDERS_SRC, maxzoom: BORDERS_MAXZOOM,
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'precision'], 3], 0.22, 0.16] },
    });
    map.addLayer({
      id: 'borders-line', type: 'line', source: BORDERS_SRC, maxzoom: BORDERS_MAXZOOM,
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-opacity': 0.9, 'line-dasharray': ['case', ['==', ['get', 'precision'], 3], ['literal', [1, 0]], ['literal', [3, 2]]] },
    });
    map.addLayer({
      id: 'borders-label', type: 'symbol', source: BORDERS_SRC, maxzoom: BORDERS_MAXZOOM,
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-letter-spacing': 0.08, 'text-transform': 'uppercase', 'text-max-width': 8 },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.5 },
    });
    // Сучасний контур Угорщини і медьє Пешт пунктиром для порівняння
    map.addSource(MODERN_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'modern-line', type: 'line', source: MODERN_SRC, maxzoom: BORDERS_MAXZOOM,
      paint: { 'line-color': '#111827', 'line-width': ['case', ['==', ['get', 'id'], 'hungary'], 1.8, 1], 'line-dasharray': ['literal', [2, 2]], 'line-opacity': 0.8 },
    });
    map.addSource(SRC, { type: 'geojson', data: featureCollection(currentPeriod, lang, placeFilter, selected, currentOverlay?.placeTypes ?? null) });
    map.addLayer({
      id: 'places-halo',
      type: 'circle',
      source: SRC,
      paint: { 'circle-radius': HALO_RADIUS, 'circle-color': ['get', 'color'], 'circle-opacity': 0.25 },
    });
    map.addLayer({
      id: 'places-dot',
      type: 'circle',
      source: SRC,
      paint: {
        'circle-radius': DOT_RADIUS,
        // Зниклі об'єкти (хутори, корчми, млини) малюються порожнім кружком
        'circle-color': ['case', ['==', ['get', 'vanished'], 1], '#ffffff', ['get', 'color']],
        'circle-stroke-color': ['case', ['==', ['get', 'vanished'], 1], ['get', 'color'], '#ffffff'],
        'circle-stroke-width': DOT_STROKE,
      },
    });
    map.addLayer({
      id: 'places-label',
      type: 'symbol',
      source: SRC,
      // Підписи лише з зуму 8: на огляді всієї країни 230+ назв накладалися б
      minzoom: 8,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-max-width': 12,
      },
      paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });

    for (const layer of ['places-dot', 'places-halo']) {
      map.on('click', layer, (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (f) onSelect(String(f.properties?.id));
      });
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
  };
  map.on('load', addLayers);
  // Після зміни стилю підкладки шари місць і накладання треба додати знову
  map.on('style.load', () => { styleOk = true; localizeBasemapLabels(map, lang); addLayers(); applySelection(); if (currentOverlay) addOverlay(currentOverlay, overlayOpacity); void applyBorders(); });
  // версія пакета мапи з пристрою, з якою завантажено стиль (після оновлення пакета стиль треба перечитати)
  let offlineVersion: string | undefined = basemap.type === 'offline' ? installed('basemap')?.version : undefined;
  const useStyle = (b: typeof basemap) => {
    basemap = b;
    styleOk = false;
    offlineVersion = b.type === 'offline' ? installed('basemap')?.version : undefined;
    map.setStyle(basemapStyle(b));
  };
  // Стиль підкладки не завантажився (браузер вважає, що мережа є, а її немає): беремо мапу з пристрою, якщо вона є.
  let basemapCb: (() => void) | null = null;
  map.on('error', (e) => {
    // з власним обробником MapLibre сам помилок не пише — лишаємо їх у консолі, як було
    console.error(e.error ?? e);
    const off = offlineBasemap();
    if (!styleOk && off && basemap.id !== off.id && offlineMapReady()) { useStyle(off); basemapCb?.(); }
  });
  map.on('click', (e: MapMouseEvent) => {
    if (!map.getLayer('places-dot')) return;
    const hits = map.queryRenderedFeatures(e.point, { layers: ['places-dot', 'places-halo'] });
    if (hits.length === 0) onSelect(null);
  });

  const refresh = () => {
    const src = map.getSource(SRC) as GeoJSONSource | undefined;
    src?.setData(featureCollection(currentPeriod, lang, placeFilter, selected, currentOverlay?.placeTypes ?? null));
  };
  const applySelection = () => {
    if (!map.getLayer('places-dot')) return;
    map.setPaintProperty('places-dot', 'circle-opacity', opacityExpr(selected));
    map.setPaintProperty('places-dot', 'circle-stroke-opacity', opacityExpr(selected));
    map.setPaintProperty('places-halo', 'circle-opacity', selected ? ['case', ['==', ['get', 'id'], selected], 0.35, 0.08] : 0.25);
    map.setPaintProperty('places-label', 'text-opacity', opacityExpr(selected));
  };

  // Стара мапа поверх сучасної; аркуші серії — разом (див. src/oldmap.ts).
  let overlay: OldMapHandle | null = null;
  // Ключ показаної накладки: для аркушів серії — id серії (будь-який її аркуш показує ту саму серію).
  let overlayKey: string | null = null;
  const keyOf = (m: HistMap | null) => (m ? m.series ?? m.id : null);
  const removeOverlay = () => {
    overlay?.remove();
    overlay = null;
    overlayKey = null;
  };
  const addOverlay = (m: HistMap, opacity: number) => {
    removeOverlay();
    overlay = addOldMap(map, m, { prefix: 'overlay', beforeId: 'places-halo', opacity });
    overlayKey = keyOf(m);
  };
  /** Виконати, коли наші джерела вже в стилі; інакше — після наступного style.load
   *  (подія 'load' буває лише раз, а isStyleLoaded() хибне, поки вантажаться плитки). */
  const whenReady = (fn: () => void) => {
    if (map.getSource(SRC)) fn();
    else map.once('style.load', fn);
  };

  let overlayOpacity = 0.7;
  let currentOverlay: HistMap | null = null;

  let currentYear: number | null = null;
  let bordersCb: ((info: { year: number; attribution: string } | null) => void) | null = null;
  let bordersSeq = 0;
  // Підпис кордонів показуємо лише там, де видно самі кордони (зум < BORDERS_MAXZOOM).
  let bordersInfo: { year: number; attribution: string } | null = null;
  const emitBorders = () => bordersCb?.(bordersInfo && map.getZoom() < BORDERS_MAXZOOM ? bordersInfo : null);
  map.on('zoomend', emitBorders);
  const bordersData = (b: BorderCollection) => ({
    type: 'FeatureCollection' as const,
    features: b.features.map((f) => ({
      type: 'Feature' as const,
      geometry: f.geometry as GeoJSON.Geometry,
      properties: {
        label: (lang === 'hu' ? f.properties.name_hu : f.properties.name_uk) || f.properties.name,
        color: colorFor(f.properties.subjecto || f.properties.name),
        precision: f.properties.precision,
      },
    })),
  });
  const applyBorders = async () => {
    const seq = ++bordersSeq;
    const src = map.getSource(BORDERS_SRC) as GeoJSONSource | undefined;
    const msrc = map.getSource(MODERN_SRC) as GeoJSONSource | undefined;
    if (!src || !msrc) return;
    if (currentYear === null) {
      src.setData({ type: 'FeatureCollection', features: [] });
      msrc.setData({ type: 'FeatureCollection', features: [] });
      bordersInfo = null;
      emitBorders();
      return;
    }
    const [b, m] = await Promise.all([loadBorders(currentYear), loadModern()]);
    if (seq !== bordersSeq) return; // рік змінився, поки вантажилось
    src.setData(bordersData(b));
    msrc.setData(m as unknown as GeoJSON.FeatureCollection);
    bordersInfo = { year: b.year, attribution: `${b.attribution}; ${m.attribution}` };
    emitBorders();
  };

  return {
    map,
    setPeriod(id) {
      if (id === currentPeriod) return;
      currentPeriod = id;
      whenReady(refresh);
    },
    setSelected(id) {
      const changed = id !== selected;
      selected = id;
      // нове місце — стара підказка накладки вже не про нього; зняття вибору (клік по мапі) підказку не чіпає
      if (changed && id) overlay?.closePopup();
      // дані оновлюємо, бо вибране місце показується навіть поза періодом чи фільтром типу
      whenReady(() => { if (changed) refresh(); applySelection(); });
    },
    setPlaceFilter(f) {
      placeFilter = f;
      if (map.getSource(SRC)) refresh();
    },
    overlayPlaceTypes() { return currentOverlay?.placeTypes?.length ? currentOverlay.placeTypes : null; },
    flyTo(place) {
      // Зсув, щоб мітку не закривала картка: на телефоні вона знизу, на ПК — панель праворуч (400 px).
      map.flyTo({ center: place.coords, zoom: Math.max(map.getZoom(), 13), duration: 800, offset: isWide() ? [-210, 0] : [0, -120] });
    },
    setOverlay(mapId) {
      const m = mapId ? histMaps.find((x) => x.id === mapId) ?? null : null;
      const typesChanged = JSON.stringify(currentOverlay?.placeTypes ?? null) !== JSON.stringify(m?.placeTypes ?? null);
      currentOverlay = m;
      if (typesChanged) whenReady(refresh);
      // та сама мапа чи серія вже показана — нічого не перебудовуємо (інакше Allmaps заново тягне плитки IIIF)
      whenReady(() => {
        if (keyOf(currentOverlay) === overlayKey && (overlay || !currentOverlay)) return;
        if (!currentOverlay) removeOverlay();
        else addOverlay(currentOverlay, overlayOpacity);
      });
    },
    setOverlayOpacity(v) {
      overlayOpacity = v;
      overlay?.setOpacity(v);
    },
    refreshLabels() {
      lang = document.documentElement.lang || 'uk';
      whenReady(() => { localizeBasemapLabels(map, lang); refresh(); void applyBorders(); });
    },
    setYear(year) {
      if (year === currentYear) return;
      currentYear = year;
      whenReady(() => void applyBorders());
    },
    onBorders(cb) { bordersCb = cb; },
    setBasemap(id) {
      const b = basemaps.find((x) => x.id === id);
      if (!b || b.id === basemap.id) return;
      setPreferredBasemap(id);
      useStyle(b);
    },
    currentBasemap() { return basemap.id; },
    onBasemapChange(cb) { basemapCb = cb; },
    networkChanged() {
      const b = chooseBasemap();
      // мапу з пристрою оновили — стиль треба перечитати, навіть якщо підкладка та сама
      if (b.id !== basemap.id || (b.type === 'offline' && installed('basemap')?.version !== offlineVersion)) { useStyle(b); return; }
      // стара мапа з оригіналами IIIF без мережі показується запасними зображеннями (і навпаки)
      if (currentOverlay && (currentOverlay.georef || currentOverlay.series)) whenReady(() => { if (currentOverlay) addOverlay(currentOverlay, overlayOpacity); });
    },
  };
}
