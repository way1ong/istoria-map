import type { HistEvent, HistMap, Period, Place } from './types';
import periodsJson from '../data/periods.json';

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
const textModules = import.meta.glob<string>('../data/texts/*/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
});

export const periods: Period[] = (periodsJson as { periods: Period[] }).periods;
export const places: Place[] = Object.values(placeModules);
export const events: HistEvent[] = Object.values(eventModules);
export const histMaps: HistMap[] = Object.values(mapModules);

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
