import type { Basemap, HistEvent, HistMap, MapSeries, Period, Photo, Place, RouteCollection, Tool, ToolsDoc } from './types';
import periodsJson from '../data/periods.json';
import basemapsJson from '../data/basemaps.json';
import toolsJson from '../data/tools.json';
import mapSeriesJson from '../data/map-series.json';
import illustrationsJson from '../data/illustrations.json';

const placeModules = import.meta.glob<Place>('../data/places/*.json', {
  eager: true,
  import: 'default',
});
const eventModules = import.meta.glob<HistEvent>('../data/events/*.json', {
  eager: true,
  import: 'default',
});
const mapModules = import.meta.glob<HistMap>('../data/maps/*.json', {
  eager: true,
  import: 'default',
});
const routeModules = import.meta.glob<RouteCollection>('../data/routes/*.geojson', {
  eager: true,
  import: 'default',
});
/** Векторні накладки (data/water/*.geojson, data/fortifications/*.geojson) — вантажаться ліниво, лише коли їх вибрано в списку мап. */
const vectorModules = import.meta.glob<GeoJSON.FeatureCollection>(['../data/water/*.geojson', '../data/fortifications/*.geojson'], { import: 'default' });
export function loadVectorOverlay(url: string): Promise<GeoJSON.FeatureCollection> {
  const key = `../data/${url}`;
  const load = vectorModules[key];
  return load ? load() : Promise.reject(new Error(`немає файлу data/${url}`));
}
const toolModules = import.meta.glob<Tool>('../data/tools/*.json', {
  eager: true,
  import: 'default',
});
const landscapeModules = import.meta.glob<string>('../data/landscape/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const textModules = import.meta.glob<string>('../data/texts/*/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
});

export const periods: Period[] = (periodsJson as { periods: Period[] }).periods;
/** Ілюстрації для текстів (data/illustrations.json): у Markdown вставляються рядком `![](id)`. */
export const illustrations: Record<string, Photo> = (illustrationsJson as { illustrations: Record<string, Photo> }).illustrations;
export function illustrationById(id: string): Photo | undefined {
  return Object.prototype.hasOwnProperty.call(illustrations, id) ? illustrations[id] : undefined;
}
export const places: Place[] = Object.values(placeModules);
export const basemaps: Basemap[] = (basemapsJson as { basemaps: Basemap[] }).basemaps
  // Підкладки з {key} в адресі доступні лише із заповненим ключем.
  .filter((b) => !(b.tiles ?? []).some((u) => u.includes('{key}')) || (b.key ?? '').trim() !== '')
  .map((b) => ({ ...b, tiles: b.tiles?.map((u) => u.replace('{key}', encodeURIComponent(b.key ?? ''))) }));
export const events: HistEvent[] = Object.values(eventModules);
export const histMaps: HistMap[] = Object.values(mapModules);
export const mapSeries: MapSeries[] = (mapSeriesJson as unknown as { series: MapSeries[] }).series;
export function seriesById(id: string | undefined): MapSeries | undefined {
  return id ? mapSeries.find((s) => s.id === id) : undefined;
}
/** Усі аркуші серії, до якої належить мапа (або лише вона сама). */
export function seriesSheets(m: HistMap): HistMap[] {
  return m.series ? histMaps.filter((x) => x.series === m.series) : [m];
}
export const routes: RouteCollection[] = Object.values(routeModules);
export const toolsDoc: ToolsDoc = toolsJson as ToolsDoc;
const catIndex = (id: string) => toolsDoc.categories.findIndex((c) => c.id === id);
/** Інструменти в порядку підрозділів з data/tools.json, далі за полем order. */
export const tools: Tool[] = Object.values(toolModules).sort((a, b) => catIndex(a.category) - catIndex(b.category) || a.order - b.order);
export function toolById(id: string): Tool | undefined {
  return tools.find((x) => x.id === id);
}

/** Анімації, прив'язані до події. */
export function routesForEvent(eventId: string): RouteCollection[] {
  return routes.filter((r) => r.animation?.event === eventId);
}

export function periodById(id: string): Period | undefined {
  return periods.find((p) => p.id === id);
}
export function placeById(id: string): Place | undefined {
  return places.find((p) => p.id === id);
}
export function eventById(id: string): HistEvent | undefined {
  return events.find((e) => e.id === id);
}

/** Текст періоду: шукає ../data/texts/<lang>/<periodId>.md, інакше uk. */
export function periodText(periodId: string, lang: string): string | undefined {
  const key = `../data/texts/${lang}/${periodId}.md`;
  const fallback = `../data/texts/uk/${periodId}.md`;
  return textModules[key] ?? textModules[fallback];
}

/** Текст розділу «Ландшафт»: data/landscape/<lang>.md, інакше uk. */
export function landscapeText(lang: string): string | undefined {
  return landscapeModules[`../data/landscape/${lang}.md`] ?? landscapeModules['../data/landscape/uk.md'];
}
