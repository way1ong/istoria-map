// Форми міток місць. Колір мітки означає період, форма — тип місця: на мапі видно, що це за об'єкт
// (церква, замок, археологічна пам'ятка, укріплення…), а не лише з якої він доби. Зниклі об'єкти — порожні.
// Одні й ті самі контури малюються на мапі (зображення для шару symbol, створюються за потреби),
// у списках пошуку й «Що поруч» і у фільтрі типів, який водночас править за легенду.
import type { ExpressionSpecification, Map as MLMap } from 'maplibre-gl';
import type { PlaceType } from './types';

export type Shape = 'circle' | 'square' | 'diamond' | 'triangle' | 'triangle-down' | 'cross' | 'star' | 'house';

/** Форма за типом місця. Хутори, корчми й млини — «будиночок»; «інше» ділить коло з містами й селами. */
export const SHAPE: Record<PlaceType, Shape> = {
  settlement: 'circle',
  other: 'circle',
  castle: 'square',
  military: 'diamond',
  archaeological: 'triangle',
  nature: 'triangle-down',
  church: 'cross',
  monument: 'star',
  farmstead: 'house',
  inn: 'house',
  mill: 'house',
};

/** П'ятипроменева зірка з центром (12; 12,6). */
function starPath(): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 4.7 : 10.6;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12.6 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** Контури у квадраті 24×24 з центром (12; 12); площі підібрано так, щоб фігури здавалися однаковими. */
export const SHAPE_PATH: Record<Shape, string> = {
  circle: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16Z',
  square: 'M6.5 5h11a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5h-11a1.5 1.5 0 0 1-1.5-1.5v-11a1.5 1.5 0 0 1 1.5-1.5Z',
  diamond: 'M12 2L22 12L12 22L2 12Z',
  triangle: 'M12 2L21.8 18.6H2.2Z',
  'triangle-down': 'M2.2 5.4H21.8L12 22Z',
  cross: 'M9 3h6v6h6v6h-6v6h-6v-6H3V9h6Z',
  star: starPath(),
  house: 'M12 3.2L20.2 10.4V20H3.8V10.4Z',
};

/** Значок для списків і легенди (SVG в рядку тексту). */
export function shapeSvg(shape: Shape, color: string, vanished = false, size = 16): string {
  const fill = vanished ? '#ffffff' : color;
  const stroke = vanished ? color : '#ffffff';
  return `<svg class="shp" viewBox="-2 -2 28 28" width="${size}" height="${size}" aria-hidden="true"><path d="${SHAPE_PATH[shape]}" fill="${fill}" stroke="${stroke}" stroke-width="${vanished ? 3 : 2.5}" stroke-linejoin="round"/>${vanished ? '' : `<path d="${SHAPE_PATH[shape]}" fill="none" stroke="${color}" stroke-width="0.6" opacity=".55"/>`}</svg>`;
}

// ---------- зображення для мапи ----------
const PREFIX = 'mk|';
const RATIO = 3;
/** Логічний розмір зображення: фігура 24 px і по 2 px на контур з кожного боку. */
const BOX = 28;

function draw(shape: Shape, color: string, vanished: boolean): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = BOX * RATIO;
  const g = c.getContext('2d')!;
  g.scale(RATIO, RATIO);
  g.translate(2, 2);
  const path = new Path2D(SHAPE_PATH[shape]);
  g.lineJoin = 'round';
  g.fillStyle = vanished ? '#ffffff' : color;
  g.strokeStyle = vanished ? color : '#ffffff';
  g.lineWidth = vanished ? 3 : 2.6;
  g.stroke(path);
  g.fill(path);
  return g.getImageData(0, 0, c.width, c.height);
}

/** Назва зображення мітки: форма, колір і «зник» беруться з властивостей об'єкта (shape, color, vanished). */
export const MARKER_IMAGE: ExpressionSpecification = ['concat', PREFIX, ['get', 'shape'], '|', ['get', 'color'], '|', ['to-string', ['get', 'vanished']]];

/**
 * Розмір значка за масштабом: фігура 16 px відповідає кружку радіуса 8 (див. src/markers.ts).
 * k — множник (у «Порівняти» мітки трохи менші).
 */
export const markerSize = (k = 1): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], 5, 0.44 * k, 7, 0.56 * k, 9, 0.76 * k, 12, 1.0 * k, 15, 1.14 * k];

/**
 * Мапа просить зображення мітки, якого ще немає, — малюємо його на льоту (лише потрібні поєднання).
 * У MapLibre 6 це робить «розв'язувач» відсутніх зображень: подія styleimagemissing приходить уже після
 * відмови, і перший показ лишився б без значків. Розв'язувач на мапі один і переживає зміну стилю.
 */
export function useMarkerImages(map: MLMap): void {
  map.setMissingStyleImageResolver(async (id: string) => {
    if (!id.startsWith(PREFIX) || map.hasImage(id)) return;
    const [, shape, color, vanished] = id.split('|');
    if (!(shape in SHAPE_PATH) || !/^#[0-9a-f]{6}$/i.test(color)) return;
    map.addImage(id, draw(shape as Shape, color, vanished === '1'), { pixelRatio: RATIO });
  });
}
