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
  | 'farmstead'
  | 'inn'
  | 'mill'
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
  /** true, якщо об'єкта вже немає на місцевості (хутір, корчма, млин зі старої мапи). */
  vanished?: boolean;
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

/** Властивості об'єкта в data/routes/*.geojson */
export interface RouteProps {
  id: string;
  period: string;
  kind: 'military' | 'trade' | 'transport' | 'border' | 'growth';
  title: LText;
  /** Початок і кінець руху: "1849-04-09", "1849-04-10T12:00" або рік "324". */
  start?: string;
  end?: string;
  /** Сторона/колір групи, напр. "hu" або "at"; колір беруть із палітри. */
  side?: string;
  note?: LText;
  /** Для kind=growth: ряд значень у часі (населення тощо). */
  values?: { date: string; value: number; label?: LText }[];
  sources: Source[];
}

export interface RouteCollection {
  type: 'FeatureCollection';
  /** Параметри анімації для всього файлу. */
  animation?: {
    event?: string;
    from: string;
    to: string;
    title: LText;
    note?: LText;
  };
  features: {
    type: 'Feature';
    geometry:
      | { type: 'LineString'; coordinates: [number, number][] }
      | { type: 'Point'; coordinates: [number, number] }
      | { type: 'Polygon'; coordinates: [number, number][][] };
    properties: RouteProps;
  }[];
}

/** Сучасна підкладка (data/basemaps.json). */
export interface Basemap {
  id: string;
  title: LText;
  type: 'style' | 'raster';
  url?: string;
  tiles?: string[];
  tileSize?: number;
  maxzoom?: number;
  attribution: string;
  license: string;
  licenseUrl?: string;
  source?: Source;
}
