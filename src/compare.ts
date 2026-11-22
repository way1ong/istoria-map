import { GeolocateControl, Map as MLMap, Marker, type LngLatLike, type StyleSpecification } from 'maplibre-gl';
import { availableBasemaps, basemapStyle, chooseBasemap, getPreferredBasemap, LOCAL_GLYPHS, localizeBasemapLabels, setPreferredBasemap } from './basemap';
import { basemaps, histMaps, periodById, places } from './data';
import { lt, t } from './i18n';
import { addOldMap, mapBox, mapChoices, mapCovers } from './oldmap';
import { watchContextLoss } from './glloss';
import { MARKER_IMAGE, markerSize, SHAPE, useMarkerImages } from './shapes';
import { watchTracking } from './tracking';
import { addMarksLayer } from './markslayer';
import { addTracksLayer, watchTracks } from './trackslayer';
import type { Place } from './types';

export interface CompareHandle { destroy(): void }

const EMPTY_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#efe9dc' } }], glyphs: LOCAL_GLYPHS };

function placesGeo(periodId: string | null, lang: string) {
  return {
    type: 'FeatureCollection' as const,
    features: places
      .filter((p) => !periodId || p.periods.includes(periodId))
      .map((p) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: p.coords },
        properties: { id: p.id, label: lt(p.name), color: periodById(p.periods[0])?.color ?? '#6b7280', shape: SHAPE[p.type], vanished: p.vanished ? 1 : 0, lang },
      })),
  };
}

function addPlacesLayers(map: MLMap, periodId: string | null) {
  map.addSource('cmp-places', { type: 'geojson', data: placesGeo(periodId, document.documentElement.lang) });
  // ті самі мітки, що на головній мапі (колір — період, форма — тип), трохи менші
  map.addLayer({ id: 'cmp-dot', type: 'symbol', source: 'cmp-places', layout: { 'icon-image': MARKER_IMAGE, 'icon-size': markerSize(0.85), 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
  map.addLayer({ id: 'cmp-label', type: 'symbol', source: 'cmp-places', layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 9 }, paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
  // власні шляхи (вкладка «Шляхи» на головній мапі) — під мітками місць, над старою мапою
  addTracksLayer(map, 'cmp-dot');
}

/** Дві синхронні мапи: стара зверху, сучасна знизу; хрестик і дзеркальний курсор. */
export function mountCompare(container: HTMLElement, opts: { mapId?: string; periodId?: string | null; baseId?: string; onChange: (q: { map: string; base: string }) => void; onPlace: (id: string) => void }): CompareHandle {
  // Векторні накладки (болота 1806) порівнювати нема з чим: зверху порожнє тло, тож лише растрові мапи.
  const rasterMaps = histMaps.filter((m) => m.type !== 'geojson');
  const hm = rasterMaps.find((m) => m.id === opts.mapId) ?? rasterMaps[0];
  const wanted = basemaps.find((b) => b.id === opts.baseId) ?? getPreferredBasemap();
  // без мережі — мапа з пристрою (якщо завантажена); вибір людини при цьому не перезаписуємо
  const base = chooseBasemap(wanted);
  if (base.id === wanted.id) setPreferredBasemap(base.id);
  container.innerHTML = `
    <div class="cmp-bar">
      <select class="cmp-map">${mapChoices(rasterMaps, hm?.id).map((c) => `<option value="${c.value}" ${c.value === hm?.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
      ${availableBasemaps().length > 1 && navigator.onLine !== false ? `<select class="cmp-base" aria-label="${t('modernMap')}">${availableBasemaps().map((b) => `<option value="${b.id}" ${b.id === base.id ? 'selected' : ''}>${lt(b.short) || lt(b.title)}</option>`).join('')}</select>` : ''}
    </div>
    <div class="cmp-pane cmp-top"><div class="cmp-map-el"></div><div class="cmp-cross"></div><span class="cmp-tag">${t('oldMap')}</span></div>
    <div class="cmp-pane cmp-bottom"><div class="cmp-map-el"></div><div class="cmp-cross"></div><span class="cmp-tag">${t('modernMap')}</span></div>
    <p class="cmp-hint">${t('compareHint')}</p>`;
  const [topEl, botEl] = [...container.querySelectorAll<HTMLElement>('.cmp-map-el')];
  // Стартуємо від Göd; якщо мапа (чи її серія аркушів) його не покриває, беремо центр мапи.
  const god: [number, number] = [19.14, 47.7];
  const box = hm ? mapBox(hm) : null;
  const center: LngLatLike = !hm || !box || mapCovers(hm, god) ? god : [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  // Для мап на всю країну стартуємо з оглядового масштабу, для аркушів околиць — з детального;
  // для тайлів — з найдетальнішого зуму, який для них є
  const span = box ? box[2] - box[0] : 0;
  const zoom = hm?.maxzoom !== undefined ? Math.min(hm.maxzoom, 12) : span > 2 ? 9 : 12;
  const common = { center, zoom, attributionControl: { compact: true } as const, pitchWithRotate: false, dragRotate: false, maxPitch: 0 };
  const top = new MLMap({ container: topEl, style: EMPTY_STYLE, ...common });
  const bot = new MLMap({ container: botEl, style: basemapStyle(base), ...common });
  watchContextLoss(top);
  watchContextLoss(bot);
  useMarkerImages(top);
  useMarkerImages(bot);
  // Кнопка місця на сучасній мапі; та сама точка — на старій, щоб бачити, де стоїш на мапі тих часів.
  const geolocate = new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true, fitBoundsOptions: { maxZoom: 15 } });
  bot.addControl(geolocate, 'top-right');
  const meEl = document.createElement('div');
  meEl.className = 'me-dot';
  const meOnTop = new Marker({ element: meEl });
  watchTracking(bot, geolocate, (at) => { if (at) meOnTop.setLngLat(at).addTo(top); else meOnTop.remove(); });
  const period = opts.periodId ?? null;

  // style.load спрацьовує і при першому завантаженні, і після зміни стилю
  // Власні мітки-прапорці (панель «Мої мітки» на головній мапі) видно на обох мапах: легше знайти своє місце на старій.
  top.on('style.load', () => { if (!top.getSource('cmp-places')) { addPlacesLayers(top, period); if (hm) addOldMap(top, hm, { prefix: 'cmp-old', beforeId: ['tracks-casing', 'cmp-dot'], opacity: 1 }); } addMarksLayer(top); });
  bot.on('style.load', () => { localizeBasemapLabels(bot, document.documentElement.lang || 'uk'); if (!bot.getSource('cmp-places')) addPlacesLayers(bot, period); addMarksLayer(bot); });

  // синхронізація положення
  let lock = false;
  const sync = (from: MLMap, to: MLMap) => () => {
    if (lock) return;
    lock = true;
    to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing() });
    lock = false;
  };
  top.on('move', sync(top, bot));
  bot.on('move', sync(bot, top));

  // дзеркальний курсор
  const mkDot = () => { const d = document.createElement('div'); d.className = 'cmp-dot'; return d; };
  const dotOnBot = new Marker({ element: mkDot() }).setLngLat(center).addTo(bot);
  const dotOnTop = new Marker({ element: mkDot() }).setLngLat(center).addTo(top);
  dotOnBot.getElement().style.display = 'none'; dotOnTop.getElement().style.display = 'none';
  top.on('mousemove', (e) => { dotOnBot.setLngLat(e.lngLat); dotOnBot.getElement().style.display = ''; });
  bot.on('mousemove', (e) => { dotOnTop.setLngLat(e.lngLat); dotOnTop.getElement().style.display = ''; });
  top.on('mouseout', () => (dotOnBot.getElement().style.display = 'none'));
  bot.on('mouseout', () => (dotOnTop.getElement().style.display = 'none'));
  top.on('touchmove', (e) => { dotOnBot.setLngLat(e.lngLat); dotOnBot.getElement().style.display = ''; });
  bot.on('touchmove', (e) => { dotOnTop.setLngLat(e.lngLat); dotOnTop.getElement().style.display = ''; });

  for (const m of [top, bot]) {
    m.on('click', 'cmp-dot', (e) => { const id = e.features?.[0]?.properties?.id; if (id) opts.onPlace(String(id)); });
    m.on('mouseenter', 'cmp-dot', () => (m.getCanvas().style.cursor = 'pointer'));
    m.on('mouseleave', 'cmp-dot', () => (m.getCanvas().style.cursor = ''));
  }

  container.querySelector<HTMLSelectElement>('.cmp-map')!.onchange = (e) => opts.onChange({ map: (e.target as HTMLSelectElement).value, base: base.id });
  // вибору підкладки немає без інтернету (інші не завантажаться) і коли підкладка одна
  const baseSel = container.querySelector<HTMLSelectElement>('.cmp-base');
  if (baseSel) baseSel.onchange = (e) => opts.onChange({ map: hm?.id ?? '', base: (e.target as HTMLSelectElement).value });

  const ro = new ResizeObserver(() => { top.resize(); bot.resize(); });
  ro.observe(container);
  // шляхи читаються зі сховища не миттєво: лінії домальовуються, коли прочитаються
  const offTracks = [watchTracks(top), watchTracks(bot)];
  return { destroy() { offTracks.forEach((off) => off()); ro.disconnect(); top.remove(); bot.remove(); } };
}
