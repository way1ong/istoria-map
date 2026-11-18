import { Map as MLMap, Marker, type LngLatLike, type StyleSpecification } from 'maplibre-gl';
import { basemapStyle, getPreferredBasemap, setPreferredBasemap } from './basemap';
import { basemaps, histMaps, periodById, places } from './data';
import { lt, t } from './i18n';
import { addOldMap, mapChoices, mapCovers } from './oldmap';
import type { Place } from './types';

export interface CompareHandle { destroy(): void }

const EMPTY_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#efe9dc' } }], glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf' };

function placesGeo(periodId: string | null, lang: string) {
  return {
    type: 'FeatureCollection' as const,
    features: places
      .filter((p) => !periodId || p.periods.includes(periodId))
      .map((p) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: p.coords },
        properties: { id: p.id, label: lt(p.name), color: periodById(p.periods[0])?.color ?? '#6b7280', vanished: p.vanished ? 1 : 0, lang },
      })),
  };
}

function addPlacesLayers(map: MLMap, periodId: string | null) {
  map.addSource('cmp-places', { type: 'geojson', data: placesGeo(periodId, document.documentElement.lang) });
  map.addLayer({ id: 'cmp-dot', type: 'circle', source: 'cmp-places', paint: { 'circle-radius': 6, 'circle-color': ['case', ['==', ['get', 'vanished'], 1], '#ffffff', ['get', 'color']], 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2.5 } });
  map.addLayer({ id: 'cmp-label', type: 'symbol', source: 'cmp-places', layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 9 }, paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
}

/** Дві синхронні мапи: стара зверху, сучасна знизу; хрестик і дзеркальний курсор. */
export function mountCompare(container: HTMLElement, opts: { mapId?: string; periodId?: string | null; baseId?: string; onChange: (q: { map: string; base: string }) => void; onPlace: (id: string) => void }): CompareHandle {
  const hm = histMaps.find((m) => m.id === opts.mapId) ?? histMaps[0];
  const base = basemaps.find((b) => b.id === opts.baseId) ?? getPreferredBasemap();
  setPreferredBasemap(base.id);
  container.innerHTML = `
    <div class="cmp-bar">
      <select class="cmp-map">${mapChoices(histMaps, hm?.id).map((c) => `<option value="${c.value}" ${c.value === hm?.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
      <select class="cmp-base" aria-label="${t('modernMap')}">${basemaps.map((b) => `<option value="${b.id}" ${b.id === base.id ? 'selected' : ''}>${lt(b.short) || lt(b.title)}</option>`).join('')}</select>
    </div>
    <div class="cmp-pane cmp-top"><div class="cmp-map-el"></div><div class="cmp-cross"></div><span class="cmp-tag">${t('oldMap')}</span></div>
    <div class="cmp-pane cmp-bottom"><div class="cmp-map-el"></div><div class="cmp-cross"></div><span class="cmp-tag">${t('modernMap')}</span></div>
    <p class="cmp-hint">${t('compareHint')}</p>`;
  const [topEl, botEl] = [...container.querySelectorAll<HTMLElement>('.cmp-map-el')];
  // Стартуємо від Göd; якщо мапа (чи її серія аркушів) його не покриває, беремо центр мапи.
  const god: [number, number] = [19.14, 47.7];
  const center: LngLatLike = !hm?.coordinates || mapCovers(hm, god) ? god : [(hm.coordinates[0][0] + hm.coordinates[2][0]) / 2, (hm.coordinates[0][1] + hm.coordinates[2][1]) / 2];
  // Для мап на всю країну стартуємо з оглядового масштабу, для аркушів околиць — з детального
  const span = hm?.coordinates ? hm.coordinates[1][0] - hm.coordinates[0][0] : 0;
  const common = { center, zoom: span > 2 ? 9 : 12, attributionControl: { compact: true } as const, pitchWithRotate: false, dragRotate: false };
  const top = new MLMap({ container: topEl, style: EMPTY_STYLE, ...common });
  const bot = new MLMap({ container: botEl, style: basemapStyle(base), ...common });
  const period = opts.periodId ?? null;

  // style.load спрацьовує і при першому завантаженні, і після зміни стилю
  top.on('style.load', () => { if (!top.getSource('cmp-places')) { addPlacesLayers(top, period); if (hm) addOldMap(top, hm, { prefix: 'cmp-old', beforeId: 'cmp-dot', opacity: 1 }); } });
  bot.on('style.load', () => { if (!bot.getSource('cmp-places')) addPlacesLayers(bot, period); });

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
  container.querySelector<HTMLSelectElement>('.cmp-base')!.onchange = (e) => opts.onChange({ map: hm?.id ?? '', base: (e.target as HTMLSelectElement).value });

  const ro = new ResizeObserver(() => { top.resize(); bot.resize(); });
  ro.observe(container);
  return { destroy() { ro.disconnect(); top.remove(); bot.remove(); } };
}
