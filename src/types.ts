export type Lang = 'uk' | 'hu';

/** Локалізований текст: українська обов'язкова, угорська необов'язкова. */
export interface LText {
  uk: string;
  hu?: string;
}

export interface Source {
  title: string;
  url?: string;
  /** Уточнення: сторінка, дата доступу, що саме підтверджує. */
  note?: string;
}

export interface Period {
  id: string;
  name: LText;
  /** Рік від (від'ємні значення = до н. е.). */
  from: number;
  /** Рік до; null = до сьогодні. */
  to: number | null;
  color: string;
  summary: LText;
  sources: Source[];
}

export type CoordsPrecision = 'exact' | 'approximate' | 'settlement';
export type PlaceType =
  | 'settlement'
  | 'archaeological'
  | 'church'
  | 'castle'
  | 'monument'
  | 'nature'
  | 'other';

export interface Photo {
  /** URL зображення або шлях у public/photos/. */
  url: string;
  author: string;
  license: string;
  licenseUrl?: string;
  /** Сторінка, звідки взято зображення. */
  source: string;
  caption?: LText;
}

export interface Place {
  id: string;
  name: LText;
  type: PlaceType;
  /** [довгота, широта] */
  coords: [number, number];
  coordsPrecision: CoordsPrecision;
  periods: string[];
  summary: LText;
  /** Markdown */
  description?: LText;
  photos?: Photo[];
  sources: Source[];
}

export type DatePrecision = 'exact' | 'approximate' | 'tradition';

export interface HistEvent {
  id: string;
  title: LText;
  date: { from: string; to?: string; precision: DatePrecision };
  period: string;
  places: string[];
  coords?: [number, number];
  summary: LText;
  description?: LText;
  photos?: Photo[];
  sources: Source[];
}

export interface HistMap {
  id: string;
  title: LText;
  year: number | string;
  author?: string;
  license: string;
  licenseUrl?: string;
  attribution: string;
  source: Source;
  /** image: один скан з 4 кутами; xyz: тайли {z}/{x}/{y}. */
  type: 'image' | 'xyz';
  url: string;
  /** Для image: 4 кути [NW, NE, SE, SW] як [lon, lat]. */
  coordinates?: [number, number][];
  periods?: string[];
}
