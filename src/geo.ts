// Відстані й площі на місцевості.
// Для шляхів і вимірювання — еліпсоїд WGS84 у місцевій площині (радіуси кривини на середній широті): проти
// точної формули Вінсенті розбіжність менша за 0,001 % на відстанях до десятків кілометрів (перевірено
// 2026-11-22; куля на широті Угорщини занижує відстані схід–захід на ~0,3 %, а площі — на стільки ж).
// Для списку «Що поруч» лишається відстань по кулі: там значення округлюються до 10 м.
import { t } from './i18n';

const R = 6371008.8;
const RAD = Math.PI / 180;
/** Еліпсоїд WGS84: велика піввісь і квадрат ексцентриситету. */
const WGS_A = 6378137;
const WGS_E2 = 0.00669437999014;

/** Метрів на радіан широти (M) і довготи вздовж паралелі (N·cos φ) на широті φ, градуси. */
function scale(latDeg: number): [number, number] {
  const sin = Math.sin(latDeg * RAD);
  const w = 1 - WGS_E2 * sin * sin;
  return [(WGS_A * (1 - WGS_E2)) / w ** 1.5, (WGS_A / Math.sqrt(w)) * Math.cos(latDeg * RAD)];
}

/** Відстань між двома точками [довгота, широта] на еліпсоїді WGS84, м (для шляхів і вимірювання). */
export function distance(a: number[], b: number[]): number {
  const [m, n] = scale((a[1] + b[1]) / 2);
  return Math.hypot((b[0] - a[0]) * RAD * n, (b[1] - a[1]) * RAD * m);
}

/** Відстань між двома точками [довгота, широта] по кулі, м (для переліку «Що поруч»). */
export function haversine(a: number[], b: number[]): number {
  const dLat = (b[1] - a[1]) * RAD, dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Напрям з a на b, градуси від півночі за годинниковою стрілкою. */
export function bearing(a: number[], b: number[]): number {
  const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD);
  const x = Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) - Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Довжина ламаної, м. */
export function pathLength(pts: number[][]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += distance(pts[i - 1], pts[i]);
  return s;
}

/**
 * Площа многокутника, м². Контур задається вершинами без повтору першої; напрям обходу не важить.
 * Вершини переносяться в місцеву площину (метри на схід і північ від першої вершини за радіусами кривини
 * WGS84 на середній широті), далі — формула Гаусса. Для ділянок до десятків кілометрів це точно.
 */
export function ringArea(pts: number[][]): number {
  const k = pts.length;
  if (k < 3) return 0;
  const [m, n] = scale(pts.reduce((sum, p) => sum + p[1], 0) / k);
  const xy = pts.map((p) => [(p[0] - pts[0][0]) * RAD * n, (p[1] - pts[0][1]) * RAD * m]);
  let s = 0;
  for (let i = 0; i < k; i++) {
    const a = xy[i], b = xy[(i + 1) % k];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s / 2);
}

const num = (x: number, digits: number) => x.toFixed(digits).replace('.', ',');
/** Розряди через вузький нерозривний пробіл: 12 340. */
const group = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');

/** Довжина словами: «245 м», «1,25 км», «12,4 км». */
export function fmtLength(m: number): string {
  if (m < 1000) return `${Math.round(m)} ${t('unitM')}`;
  const km = m / 1000;
  return `${num(km, km < 10 ? 2 : 1)} ${t('unitKm')}`;
}

/** Площа словами: «8 320 м² · 0,83 га», «12,40 га», «124,0 га · 1,24 км²», «13 741 км²». */
export function fmtArea(m2: number): string {
  const ha = m2 / 10000;
  if (ha < 1) return `${group(m2)} ${t('unitM2')} · ${num(ha, 2)} ${t('unitHa')}`;
  if (ha < 100) return `${num(ha, 2)} ${t('unitHa')}`;
  if (ha < 10000) return `${num(ha, 1)} ${t('unitHa')} · ${num(ha / 100, 2)} ${t('unitKm2')}`;
  return `${group(ha / 100)} ${t('unitKm2')}`;
}

/** Тривалість: «45 с», «18 хв», «1 год 12 хв». */
export function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.max(0, Math.round(sec))} ${t('unitSec')}`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} ${t('unitMin')}`;
  return `${Math.floor(min / 60)} ${t('unitHour')} ${min % 60} ${t('unitMin')}`;
}
