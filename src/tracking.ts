// Стеження за місцем людини на мапі (кнопка місця MapLibre з trackUserLocation): поки воно ввімкнене,
// екран не гасне (Screen Wake Lock), щоб телефон можна було нести в руці й дивитися, де стоїш на старій мапі.
import type { GeolocateControl, Map as MLMap } from 'maplibre-gl';
import { t } from './i18n';
import { toast } from './ui/toast';

// ---------- екран не гасне ----------
type Sentinel = { release(): Promise<void>; addEventListener(type: 'release', cb: () => void): void };
let sentinel: Sentinel | null = null;
/** Скільки мап зараз стежать за місцем (основна, «Порівняти»). */
let holders = 0;

async function acquire(): Promise<void> {
  const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock;
  if (!wl || holders <= 0 || sentinel || document.visibilityState !== 'visible') return;
  try {
    const s = await wl.request('screen');
    s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
    sentinel = s;
    // поки чекали на дозвіл, стеження могли вимкнути
    if (holders <= 0) { sentinel = null; void s.release(); }
  } catch { /* браузер відмовив (наприклад, режим заощадження заряду) — екран гаснутиме як звичайно */ }
}
function hold(delta: number): void {
  holders = Math.max(0, holders + delta);
  if (holders > 0) void acquire();
  else if (sentinel) { const s = sentinel; sentinel = null; void s.release().catch(() => undefined); }
}
// браузер сам знімає блокування, коли вкладку сховано: після повернення беремо його знову
document.addEventListener('visibilitychange', () => void acquire());

let told = false;

/**
 * Стежить за станом кнопки місця. Стеження вважається ввімкненим, поки кнопка активна (мапа йде за людиною),
 * у фоновому стані (точка рухається, мапу людина зсунула сама) або чекає на перші координати.
 * onPosition — координати при кожному оновленні й null, коли стеження вимкнено (для точки на другій мапі).
 */
export function watchTracking(map: MLMap, ctl: GeolocateControl, onPosition?: (at: [number, number] | null) => void): void {
  let on = false;
  const check = () => {
    const btn = map.getContainer().querySelector('.maplibregl-ctrl-geolocate');
    const now = !!btn && /maplibregl-ctrl-geolocate-(active|background|waiting)/.test(btn.className);
    if (now === on) return;
    on = now;
    hold(on ? 1 : -1);
    if (on && !told) { told = true; toast(t('trackOn'), { ms: 5000 }); }
    if (!on) onPosition?.(null);
  };
  const later = () => window.setTimeout(check, 60);
  // стан кнопки змінюється на події стеження, на помилку і на натискання (вимкнення подію не дає)
  for (const ev of ['trackuserlocationstart', 'trackuserlocationend', 'userlocationfocus', 'userlocationlostfocus', 'error'] as const) ctl.on(ev, later);
  ctl.on('geolocate', (e: { coords?: { longitude: number; latitude: number } }) => {
    if (e.coords) onPosition?.([e.coords.longitude, e.coords.latitude]);
    later();
  });
  const onClick = (e: Event) => { if ((e.target as HTMLElement).closest?.('.maplibregl-ctrl-geolocate')) later(); };
  map.getContainer().addEventListener('click', onClick);
  map.once('remove', () => { if (on) { on = false; hold(-1); } });
}
