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
const RETRY_MS = 3000;

/** Чи дає браузер сторінці WebGL2 (MapLibre 6 без нього мапу не створює). Пробний контекст одразу звільняємо. */
export function webgl2Available(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

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
  let waitTimer = 0;
  let note = 0;
  const reloadNow = () => {
    if (save) {
      const c = map.getCenter();
      const view: SavedView = { ...save(), hash: location.hash, center: [c.lng, c.lat], zoom: map.getZoom() };
      try { sessionStorage.setItem(KEY, JSON.stringify(view)); } catch { /* приватний режим без сховища */ }
    }
    location.reload();
  };
  // Поки браузер не дає графіку взагалі (після збою він блокує її для сайту на секунди чи до перезапуску),
  // перезавантаження дало б сторінку без мапи — тоді чекаємо, доки графіка з'явиться, і лише тоді перезавантажуємо.
  const reload = () => {
    if (webgl2Available()) { reloadNow(); return; }
    note = toast(t('glWait'), { ms: 0 });
    clearInterval(waitTimer);
    waitTimer = window.setInterval(() => {
      if (!lost) { clearInterval(waitTimer); return; }
      if (webgl2Available()) { clearInterval(waitTimer); reloadNow(); }
    }, RETRY_MS);
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
  map.on('webglcontextrestored', () => { lost = false; clearTimeout(timer); clearInterval(waitTimer); hideToast(note); });
  document.addEventListener('visibilitychange', arm);
  const seen = new IntersectionObserver(arm);
  seen.observe(map.getContainer());
  map.once('remove', () => { clearTimeout(timer); clearInterval(waitTimer); seen.disconnect(); document.removeEventListener('visibilitychange', arm); });
}

/**
 * Мапа не створилась, бо браузер не дав графіки (WebGL2) — найчастіше відразу після збою графіки на телефоні.
 * Показує в host пояснення з кнопкою «Спробувати знову» і сам перевіряє що 3 с, поки host видно; щойно графіка
 * є — прибирає пояснення й викликає retry. Повертає функцію, що прибирає пояснення й припиняє перевірки.
 */
export function showGlFailure(host: HTMLElement, retry: () => void): () => void {
  host.querySelector(':scope > .gl-fail')?.remove();
  const box = document.createElement('div');
  box.className = 'gl-fail';
  box.setAttribute('role', 'alert');
  const title = document.createElement('b');
  title.textContent = t('glFailTitle');
  const text = document.createElement('p');
  text.textContent = t('glFail');
  const hint = document.createElement('p');
  hint.textContent = t('glFailHint');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'off-btn primary';
  btn.textContent = t('glRetry');
  box.append(title, text, hint, btn);
  host.appendChild(box);
  let timer = 0;
  let done = false;
  const stop = () => { done = true; clearInterval(timer); box.remove(); };
  const attempt = (): boolean => {
    if (done || !webgl2Available()) return false;
    stop();
    retry();
    return true;
  };
  btn.onclick = () => {
    if (attempt()) return;
    btn.disabled = true;
    window.setTimeout(() => { btn.disabled = false; }, 1500);
  };
  timer = window.setInterval(() => {
    // анімацію на сторінці події могли вже прибрати (перехід на іншу сторінку) — тоді більше не чекаємо
    if (!host.isConnected) { stop(); return; }
    if (document.visibilityState === 'visible' && host.getClientRects().length) attempt();
  }, RETRY_MS);
  return stop;
}

/** Вигляд мапи, збережений перед перезавантаженням, якщо маршрут той самий. Лишається в сховищі, доки його
 *  не застосують (dropSavedView): якщо мапа одразу не запуститься, наступне перезавантаження його не загубить. */
export function takeSavedView(): SavedView | null {
  try {
    const s = sessionStorage.getItem(KEY);
    if (!s) return null;
    const v = JSON.parse(s) as SavedView;
    return v.hash === location.hash && Array.isArray(v.center) && typeof v.zoom === 'number' ? v : null;
  } catch {
    return null;
  }
}

export function dropSavedView(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* приватний режим */ }
}
