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
import { areasGeoJSON, areasVisible, onAreasChange, savedAreas } from './offlineareas';
import { watchTracking } from './tracking';
import { addMarksLayer, MARKS_LAYER, watchMarks } from './markslayer';
import { addTracksLayer, TRACKS_CASING, watchTracks } from './trackslayer';
import { lt } from './i18n';
import { colorFor, loadBorders, loadModern } from './borders';
import { addOldMap, type OldMapHandle } from './oldmap';
import { HALO_RADIUS } from './markers';
import { MARKER_IMAGE, markerSize, SHAPE, useMarkerImages } from './shapes';
import type { BorderCollection, HistMap, Place, PlaceType } from './types';

// Стартовий вигляд: уся Угорщина (центр країни, зум під екран телефона).
const CENTER: [number, number] = [19.4, 47.15];
const SRC = 'places';
/** Межі збережених ділянок старих мап (див. applyAreas). */
const AREAS_ID = 'offline-saved-areas';
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
  /** Натиснуто власну мітку (прапорець). */
  onMarkClick(cb: (id: string) => void): void;
  /** Довге натискання на мапі (або права кнопка миші): координати точки [довгота, широта]. */
  onLongPress(cb: (at: [number, number]) => void): void;
  /**
   * Перехопити дотики до мапи (вимірювання): поки обробник заданий, дотик віддає йому точку й не відкриває
   * картки місць і міток, а довге натискання не ставить мітку. null — повернути звичайну поведінку.
   */
  onMapTap(cb: ((at: [number, number]) => void) | null): void;
  /** Увімкнути точку місця людини (стеження), якщо її ще не ввімкнено. */
  locate(): void;
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
            // форма мітки — за типом місця (src/shapes.ts)
            shape: SHAPE[p.type],
            vanished: p.vanished ? 1 : 0,
            // є фото — біля кружка значок фотоапарата
            photo: p.photos?.length ? 1 : 0,
            lang,
          },
        };
      }),
  };
}

/** Значок фотоапарата 32×32 (на екрані 16×16): білий кружок з темним контуром і фотоапаратом. */
function cameraIcon(): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#1f2937';
  g.lineWidth = 2;
  g.beginPath(); g.arc(16, 16, 14, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#1f2937';
  g.beginPath();
  if (typeof g.roundRect === 'function') g.roundRect(7, 11, 18, 12, 2.5); else g.rect(7, 11, 18, 12);
  g.fill();
  g.fillRect(12, 8.5, 8, 3.5);
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(16, 17, 4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1f2937';
  g.beginPath(); g.arc(16, 17, 2.2, 0, Math.PI * 2); g.fill();
  return g.getImageData(0, 0, 32, 32);
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
  useMarkerImages(map);
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  // Кнопка місця стежить за людиною: точка рухається разом з нею (і на старій мапі), екран при цьому не гасне.
  const geolocate = new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true, fitBoundsOptions: { maxZoom: 15 } });
  map.addControl(geolocate, 'top-right');
  watchTracking(map, geolocate);

  let currentPeriod: string | null = null;
  let placeFilter: PlaceFilter = { types: [], vanishedOnly: false };
  let selected: string | null = null;
  let lang = document.documentElement.lang || 'uk';

  const opacityExpr = (sel: string | null): ExpressionSpecification | number =>
    sel ? ['case', ['==', ['get', 'id'], sel], 1, 0.25] : 1;

  let layerHandlers = false;
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
    // Мітка: колір — період, форма — тип місця; зниклі об'єкти (хутори, корчми, млини) — порожні.
    // Зображення малюються за потреби (useMarkerImages).
    map.addLayer({
      id: 'places-dot',
      type: 'symbol',
      source: SRC,
      layout: { 'icon-image': MARKER_IMAGE, 'icon-size': markerSize(), 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    });
    // значок фотоапарата в правому верхньому куті кружка місця, у якого є фото
    if (!map.hasImage('photo-badge')) map.addImage('photo-badge', cameraIcon(), { pixelRatio: 2 });
    map.addLayer({
      id: 'places-photo',
      type: 'symbol',
      source: SRC,
      // у містах місць з фото багато: значки лише при наближенні
      minzoom: 11,
      filter: ['==', ['get', 'photo'], 1],
      layout: { 'icon-image': 'photo-badge', 'icon-offset': [9, -9], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
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

    // Власні шляхи — лінії над старою мапою, під мітками місць (src/trackslayer.ts).
    addTracksLayer(map, 'places-halo');
    // Власні мітки людини — прапорці поверх усього (src/markslayer.ts); дані лише з цього браузера.
    addMarksLayer(map);

    // обробники шарів прив'язуються один раз: після зміни підкладки шари додаються знову, а обробники лишаються
    if (layerHandlers) return;
    layerHandlers = true;
    for (const layer of ['places-dot', 'places-halo', 'places-photo']) {
      map.on('click', layer, (e: MapLayerMouseEvent) => {
        // прапорець поверх місця: відкривається мітка, а не картка місця під нею; під час вимірювання дотик ставить точку
        if (tapCb || onFlag(e.point)) return;
        const f = e.features?.[0];
        if (f) onSelect(String(f.properties?.id));
      });
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
  };
  map.on('load', addLayers);
  // Після зміни стилю підкладки шари місць і накладання треба додати знову
  map.on('style.load', () => { styleOk = true; localizeBasemapLabels(map, lang); addLayers(); applySelection(); applyAreas(); if (currentOverlay) addOverlay(currentOverlay, overlayOpacity); void applyBorders(); });
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
    if (tapCb) { tapCb([e.lngLat.lng, e.lngLat.lat]); return; }
    if (!map.getLayer('places-dot')) return;
    if (onFlag(e.point)) return;
    const hits = map.queryRenderedFeatures(e.point, { layers: ['places-dot', 'places-halo', 'places-photo'] });
    if (hits.length === 0) onSelect(null);
  });

  // ---------- власні мітки ----------
  let markCb: ((id: string) => void) | null = null;
  let longPressCb: ((at: [number, number]) => void) | null = null;
  let tapCb: ((at: [number, number]) => void) | null = null;
  const onFlag = (pt: MapMouseEvent['point']) => !!map.getLayer(MARKS_LAYER) && map.queryRenderedFeatures(pt, { layers: [MARKS_LAYER] }).length > 0;
  map.on('click', MARKS_LAYER, (e: MapLayerMouseEvent) => {
    if (tapCb) return;
    const id = e.features?.[0]?.properties?.id;
    if (id) markCb?.(String(id));
  });
  map.on('mouseenter', MARKS_LAYER, () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', MARKS_LAYER, () => (map.getCanvas().style.cursor = ''));
  watchMarks(map);
  watchTracks(map);
  // Довге натискання пальцем (≈ 0,65 с без руху) або права кнопка миші — нова мітка в цій точці.
  {
    const el = map.getCanvasContainer();
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    let lastTouch = 0;
    const cancel = () => { clearTimeout(timer); timer = 0; start = null; };
    const at = (t: Touch) => { const r = el.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; };
    el.addEventListener('touchstart', (e) => {
      lastTouch = Date.now();
      cancel();
      if (e.touches.length !== 1 || !longPressCb) return;
      const p = at(e.touches[0]);
      start = p;
      timer = window.setTimeout(() => {
        timer = 0;
        if (!start || !longPressCb || tapCb) return;
        start = null;
        // на прапорці довге натискання нової мітки не ставить
        if (onFlag([p.x, p.y] as unknown as MapMouseEvent['point'])) return;
        const ll = map.unproject([p.x, p.y]);
        navigator.vibrate?.(35);
        longPressCb([ll.lng, ll.lat]);
      }, 650);
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (!start) return;
      const p = at(e.touches[0]);
      if (e.touches.length !== 1 || Math.hypot(p.x - start.x, p.y - start.y) > 10) cancel();
    }, { passive: true });
    el.addEventListener('touchend', cancel, { passive: true });
    el.addEventListener('touchcancel', cancel, { passive: true });
    map.on('contextmenu', (e: MapMouseEvent) => {
      // на телефоні довге натискання дає ще й цю подію — її вже опрацював таймер
      if (Date.now() - lastTouch < 1500 || !longPressCb || tapCb) return;
      e.preventDefault();
      if (!onFlag(e.point)) longPressCb([e.lngLat.lng, e.lngLat.lat]);
    });
  }

  const refresh = () => {
    const src = map.getSource(SRC) as GeoJSONSource | undefined;
    src?.setData(featureCollection(currentPeriod, lang, placeFilter, selected, currentOverlay?.placeTypes ?? null));
  };
  const applySelection = () => {
    if (!map.getLayer('places-dot')) return;
    map.setPaintProperty('places-dot', 'icon-opacity', opacityExpr(selected));
    map.setPaintProperty('places-halo', 'circle-opacity', selected ? ['case', ['==', ['get', 'id'], selected], 0.35, 0.08] : 0.25);
    map.setPaintProperty('places-label', 'text-opacity', opacityExpr(selected));
    map.setPaintProperty('places-photo', 'icon-opacity', opacityExpr(selected));
  };

  // Межі ділянок старих мап, збережених для роботи без інтернету (src/offlineareas.ts): пунктир над старою мапою,
  // під мітками місць. Показує й ховає їх лише перемикач у панелі «Без інтернету» (areasVisible).
  const applyAreas = () => {
    if (!map.getLayer('places-halo')) return;
    const show = savedAreas().length > 0 && areasVisible();
    const src = map.getSource(AREAS_ID) as GeoJSONSource | undefined;
    if (!show) {
      if (map.getLayer(AREAS_ID)) map.removeLayer(AREAS_ID);
      if (src) map.removeSource(AREAS_ID);
      return;
    }
    if (src) { src.setData(areasGeoJSON()); return; }
    map.addSource(AREAS_ID, { type: 'geojson', data: areasGeoJSON() });
    map.addLayer({ id: AREAS_ID, type: 'line', source: AREAS_ID, paint: { 'line-color': '#f59e0b', 'line-width': 2.5, 'line-dasharray': [3, 2] } }, 'places-halo');
  };
  onAreasChange(() => whenReady(applyAreas));

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
    overlay = addOldMap(map, m, { prefix: 'overlay', beforeId: [TRACKS_CASING, AREAS_ID, 'places-halo'], opacity });
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
    onMarkClick(cb) { markCb = cb; },
    onLongPress(cb) { longPressCb = cb; },
    onMapTap(cb) { tapCb = cb; map.getCanvasContainer().classList.toggle('measuring', !!cb); },
    locate() {
      const btn = map.getContainer().querySelector('.maplibregl-ctrl-geolocate');
      // trigger() перемикає стан, тому викликаємо лише коли стеження вимкнене
      if (btn && !/maplibregl-ctrl-geolocate-(active|background|waiting)/.test(btn.className)) geolocate.trigger();
    },
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
