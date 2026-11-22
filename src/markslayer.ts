// Шар власних міток-прапорців на мапі (src/marks.ts): основна мапа й обидві мапи режиму «Порівняти».
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import { MARK_COLORS, MARK_HEX, marksGeoJSON, onMarksChange, type MarkColor } from './marks';

export const MARKS_LAYER = 'marks-flag';
const MARKS_SRC = 'my-marks';

/** Прапорець 30×34 (на екрані): держак стоїть у точці мітки (низ зображення посередині). */
function flagIcon(color: MarkColor): ImageData {
  const R = 3;
  const c = document.createElement('canvas');
  c.width = 30 * R; c.height = 34 * R;
  const g = c.getContext('2d')!;
  g.scale(R, R);
  g.lineJoin = 'round'; g.lineCap = 'round';
  const pole = new Path2D('M15 4V31.5');
  const cloth = new Path2D('M15.5 4.5H28L24.6 9.5L28 14.5H15.5Z');
  // білий контур, щоб прапорець було видно на будь-якій мапі
  g.strokeStyle = '#ffffff'; g.lineWidth = 5.2; g.stroke(pole);
  g.lineWidth = 3; g.stroke(cloth);
  g.fillStyle = MARK_HEX[color]; g.fill(cloth);
  g.strokeStyle = 'rgba(17,24,39,.55)'; g.lineWidth = 0.8; g.stroke(cloth);
  g.strokeStyle = '#1f2937'; g.lineWidth = 2.4; g.stroke(pole);
  g.fillStyle = '#1f2937';
  g.beginPath(); g.arc(15, 31.6, 2.1, 0, Math.PI * 2); g.fill();
  return g.getImageData(0, 0, c.width, c.height);
}

/**
 * Додає прапорці в поточний стиль мапи поверх усіх шарів; викликати після кожного style.load
 * (зміна підкладки прибирає і джерело, і зображення). Дані — лише з цього браузера.
 */
export function addMarksLayer(map: MLMap): void {
  if (map.getSource(MARKS_SRC)) return;
  for (const c of MARK_COLORS) if (!map.hasImage(`flag-${c}`)) map.addImage(`flag-${c}`, flagIcon(c), { pixelRatio: 3 });
  map.addSource(MARKS_SRC, { type: 'geojson', data: marksGeoJSON() });
  map.addLayer({
    id: MARKS_LAYER,
    type: 'symbol',
    source: MARKS_SRC,
    layout: {
      'icon-image': ['concat', 'flag-', ['get', 'color']],
      'icon-anchor': 'bottom',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.9, 11, 1.25],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-field': ['step', ['zoom'], '', 11, ['get', 'name']],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 0.25],
      'text-max-width': 10,
      'text-optional': true,
      'text-allow-overlap': false,
    },
    paint: { 'text-color': '#7f1d1d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
  });
}

/** Перемальовує прапорці, коли мітки змінюються; повертає функцію відписки. */
export function watchMarks(map: MLMap): () => void {
  return onMarksChange(() => (map.getSource(MARKS_SRC) as GeoJSONSource | undefined)?.setData(marksGeoJSON()));
}
