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
import { histMaps, periodById, places } from './data';
import { lt } from './i18n';
import type { HistMap, Place } from './types';

// Центр: околиці Göd. Стартовий вигляд охоплює Dunakeszi — Göd — Vác.
const CENTER: [number, number] = [19.14, 47.7];
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const SRC = 'places';
const OVERLAY_SRC = 'overlay';
const OVERLAY_LAYER = 'overlay-layer';

export interface MapController {
  map: MLMap;
  setPeriod(periodId: string | null): void;
  setSelected(placeId: string | null): void;
  flyTo(place: Place): void;
  setOverlay(mapId: string | null): void;
  setOverlayOpacity(v: number): void;
  refreshLabels(): void;
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

function featureCollection(periodId: string | null, lang: string) {
  const visible = places.filter((p) => !periodId || p.periods.includes(periodId));
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
            lang,
          },
        };
      }),
  };
}

export function createMap(container: HTMLElement, onSelect: (id: string | null) => void): MapController {
  const map = new MLMap({
    container,
    style: STYLE_URL,
    center: CENTER,
    zoom: 11,
    attributionControl: { compact: true },
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new GeolocateControl({ trackUserLocation: false }), 'top-right');

  let currentPeriod: string | null = null;
  let selected: string | null = null;
  let lang = document.documentElement.lang || 'uk';

  const opacityExpr = (sel: string | null): ExpressionSpecification | number =>
    sel ? ['case', ['==', ['get', 'id'], sel], 1, 0.25] : 1;

  map.on('load', () => {
    map.addSource(SRC, { type: 'geojson', data: featureCollection(currentPeriod, lang) });
    map.addLayer({
      id: 'places-halo',
      type: 'circle',
      source: SRC,
      paint: { 'circle-radius': 14, 'circle-color': ['get', 'color'], 'circle-opacity': 0.25 },
    });
    map.addLayer({
      id: 'places-dot',
      type: 'circle',
      source: SRC,
      paint: {
        'circle-radius': 7,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });
    map.addLayer({
      id: 'places-label',
      type: 'symbol',
      source: SRC,
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
    map.on('click', (e: MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: ['places-dot', 'places-halo'] });
      if (hits.length === 0) onSelect(null);
    });
  });

  const refresh = () => {
    const src = map.getSource(SRC) as GeoJSONSource | undefined;
    src?.setData(featureCollection(currentPeriod, lang));
  };
  const applySelection = () => {
    if (!map.getLayer('places-dot')) return;
    map.setPaintProperty('places-dot', 'circle-opacity', opacityExpr(selected));
    map.setPaintProperty('places-dot', 'circle-stroke-opacity', opacityExpr(selected));
    map.setPaintProperty('places-halo', 'circle-opacity', selected ? ['case', ['==', ['get', 'id'], selected], 0.35, 0.08] : 0.25);
    map.setPaintProperty('places-label', 'text-opacity', opacityExpr(selected));
  };

  const removeOverlay = () => {
    if (map.getLayer(OVERLAY_LAYER)) map.removeLayer(OVERLAY_LAYER);
    if (map.getSource(OVERLAY_SRC)) map.removeSource(OVERLAY_SRC);
  };
  const addOverlay = (m: HistMap, opacity: number) => {
    removeOverlay();
    if (m.type === 'image' && m.coordinates) {
      map.addSource(OVERLAY_SRC, {
        type: 'image',
        url: m.url,
        coordinates: m.coordinates as [[number, number], [number, number], [number, number], [number, number]],
      });
    } else {
      map.addSource(OVERLAY_SRC, { type: 'raster', tiles: [m.url], tileSize: 256, attribution: m.attribution });
    }
    map.addLayer(
      { id: OVERLAY_LAYER, type: 'raster', source: OVERLAY_SRC, paint: { 'raster-opacity': opacity } },
      'places-halo',
    );
  };

  let overlayOpacity = 0.7;

  return {
    map,
    setPeriod(id) {
      currentPeriod = id;
      if (map.isStyleLoaded()) refresh();
      else map.once('load', refresh);
    },
    setSelected(id) {
      selected = id;
      if (map.isStyleLoaded()) applySelection();
      else map.once('load', applySelection);
    },
    flyTo(place) {
      // Зсув угору, щоб мітку не закривала нижня картка.
      map.flyTo({ center: place.coords, zoom: Math.max(map.getZoom(), 13), duration: 800, offset: [0, -120] });
    },
    setOverlay(mapId) {
      const run = () => {
        const m = mapId ? histMaps.find((x) => x.id === mapId) : undefined;
        if (!m) removeOverlay();
        else addOverlay(m, overlayOpacity);
      };
      if (map.isStyleLoaded()) run();
      else map.once('load', run);
    },
    setOverlayOpacity(v) {
      overlayOpacity = v;
      if (map.getLayer(OVERLAY_LAYER)) map.setPaintProperty(OVERLAY_LAYER, 'raster-opacity', v);
    },
    refreshLabels() {
      lang = document.documentElement.lang || 'uk';
      if (map.isStyleLoaded()) refresh();
    },
  };
}
