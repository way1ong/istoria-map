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
  /** Серія з data/map-series.json: аркуші однієї серії показуються разом. */
  series?: string;
  /** Номер аркуша в серії, напр. "14:XX". */
  sheet?: string;
  /** Georeference Annotation (шлях у public/): оригінал у повній якості з сервера IIIF бібліотеки через Allmaps. */
  georef?: string;
}

/** Серія старих мап (data/map-series.json). */
export interface MapSeries {
  id: string;
  title: LText;
  note?: LText;
  /** Зведена мозаїка аркушів для дрібних масштабів: видно до зуму maxzoom, далі — окремі аркуші. */
  overview?: { url: string; coordinates: [number, number][]; maxzoom: number };
  /** Georeference Annotation усіх аркушів серії (шлях у public/) для показу оригіналів через Allmaps. */
  georef?: string;
  /** Короткий підпис джерел для кнопки «i» мапи (замість підписів кожного аркуша). */
  attribution?: string;
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
  /** Коротка назва для кнопок. */
  short?: LText;
  /** style: готовий стиль MapLibre; raster: тайли зображень; relief: тіньовий рельєф з тайлів висот (tiles) і сучасна вода з векторних тайлів (vector). */
  type: 'style' | 'raster' | 'relief';
  url?: string;
  tiles?: string[];
  /** Для relief: кодування тайлів висот. */
  encoding?: 'terrarium' | 'mapbox';
  /** Для relief: адреса векторних тайлів OpenMapTiles (вода й назви міст). */
  vector?: string;
  /** Ключ API для сервісів, що його вимагають; підставляється замість {key}. */
  key?: string;
  tileSize?: number;
  maxzoom?: number;
  attribution: string;
  license: string;
  licenseUrl?: string;
  source?: Source;
}

/** Історичні кордони одного року (data/borders/y<рік>.geojson). */
export interface BorderCollection {
  type: 'FeatureCollection';
  year: number;
  license: string;
  licenseUrl?: string;
  attribution: string;
  source: Source;
  features: {
    type: 'Feature';
    geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
    properties: { name: string; name_uk: string; name_hu: string; subjecto: string; precision: 1 | 2 | 3 };
  }[];
}

/** Сучасні контури для порівняння (data/borders/modern.geojson). */
export interface ModernOutlines {
  type: 'FeatureCollection';
  license: string;
  attribution: string;
  source: Source;
  features: { type: 'Feature'; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown }; properties: { id: string; name_uk: string; name_hu: string } }[];
}

/** Кому інструмент корисніший: пошуковцям з металошукачем чи археологам. */
export type ToolUser = 'detectorist' | 'archaeologist';

export interface ToolCategory {
  id: string;
  name: LText;
  summary: LText;
}

/** data/tools.json: вступ до розділу і порядок підрозділів. */
export interface ToolsDoc {
  intro: LText;
  categories: ToolCategory[];
}

/** data/tools/<id>.json: один інструмент або прийом. */
export interface Tool {
  id: string;
  category: string;
  /** Порядок у межах підрозділу (менше = вище). */
  order: number;
  name: LText;
  users: ToolUser[];
  summary: LText;
  /** Markdown */
  description?: LText;
  photos?: Photo[];
  sources: Source[];
}
