import type { Basemap, HistEvent, HistMap, Period, Place, RouteCollection, Tool, ToolsDoc } from './types';
import periodsJson from '../data/periods.json';
import basemapsJson from '../data/basemaps.json';
import toolsJson from '../data/tools.json';

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
const toolModules = import.meta.glob<Tool>('../data/tools/*.json', {
  eager: true,
  import: 'default',
});
const textModules = import.meta.glob<string>('../data/texts/*/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
});

export const periods: Period[] = (periodsJson as { periods: Period[] }).periods;
export const places: Place[] = Object.values(placeModules);
export const basemaps: Basemap[] = (basemapsJson as { basemaps: Basemap[] }).basemaps
  // Підкладки з {key} в адресі доступні лише із заповненим ключем.
  .filter((b) => !(b.tiles ?? []).some((u) => u.includes('{key}')) || (b.key ?? '').trim() !== '')
  .map((b) => ({ ...b, tiles: b.tiles?.map((u) => u.replace('{key}', encodeURIComponent(b.key ?? ''))) }));
export const events: HistEvent[] = Object.values(eventModules);
export const histMaps: HistMap[] = Object.values(mapModules);
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
