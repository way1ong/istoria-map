// Втрата графіки (WebGL). Телефон може забрати в браузера графічний контекст, коли бракує пам'яті чи графічний
// процес перезапускається, — тоді мапа стає білою. Зазвичай браузер повертає контекст за мить: MapLibre сам
// відновлює підкладку і наші шари, стару мапу Allmaps додає знову src/oldmap.ts. Якщо контекст не повернувся
// за кілька секунд (поки сторінку видно), пропонуємо перезавантажити; вигляд основної мапи (центр, зум, стара
// мапа, прозорість) зберігаємо в sessionStorage на один раз.
import type { Map as MLMap } from 'maplibre-gl';
import { t } from './i18n';
import { hideToast, toast } from './ui/toast';

const KEY = 'istoria.mapView';
const WAIT_MS = 3000;

export interface SavedView {
  hash: string;
  center: [number, number];
  zoom: number;
  overlay?: string | null;
  opacity?: number;
}

/** Стежити за втратою контексту мапи; save — що ще зберегти перед перезавантаженням (лише для основної мапи). */
export function watchContextLoss(map: MLMap, save?: () => Pick<SavedView, 'overlay' | 'opacity'>): void {
  let lost = false;
  let timer = 0;
  let note = 0;
  const reload = () => {
    if (save) {
      const c = map.getCenter();
      const view: SavedView = { ...save(), hash: location.hash, center: [c.lng, c.lat], zoom: map.getZoom() };
      try { sessionStorage.setItem(KEY, JSON.stringify(view)); } catch { /* приватний режим без сховища */ }
    }
    location.reload();
  };
  // мапа може бути схована (відкрито текстовий розділ) — тоді чекаємо, доки її знову покажуть
  const shown = () => document.visibilityState === 'visible' && map.getContainer().getClientRects().length > 0;
  const arm = () => {
    clearTimeout(timer);
    if (!lost || !shown()) return;
    timer = window.setTimeout(() => {
      if (lost) note = toast(t('glLost'), { action: t('glReload'), onAction: reload, ms: 0 });
    }, WAIT_MS);
  };
  map.on('webglcontextlost', () => { lost = true; arm(); });
  map.on('webglcontextrestored', () => { lost = false; clearTimeout(timer); hideToast(note); });
  document.addEventListener('visibilitychange', arm);
  const seen = new IntersectionObserver(arm);
  seen.observe(map.getContainer());
  map.once('remove', () => { clearTimeout(timer); seen.disconnect(); document.removeEventListener('visibilitychange', arm); });
}

/** Вигляд мапи, збережений перед перезавантаженням, якщо маршрут той самий (читається один раз). */
export function takeSavedView(): SavedView | null {
  try {
    const s = sessionStorage.getItem(KEY);
    if (!s) return null;
    sessionStorage.removeItem(KEY);
    const v = JSON.parse(s) as SavedView;
    return v.hash === location.hash && Array.isArray(v.center) && typeof v.zoom === 'number' ? v : null;
  } catch {
    return null;
  }
}
