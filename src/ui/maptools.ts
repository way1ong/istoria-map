import { Marker, type IControl } from 'maplibre-gl';
import { events, periodById, places } from '../data';
import { getLang, lt, t, type Key } from '../i18n';
import { placeVisible, type MapController, type PlaceFilter } from '../map';
import type { PlaceType } from '../types';
import { eventDate } from './render';
import { renderOffline } from './offlinepanel';

/** Порядок фішок у фільтрі. */
export const TYPES: PlaceType[] = ['castle', 'military', 'church', 'archaeological', 'monument', 'settlement', 'nature', 'farmstead', 'inn', 'mill', 'other'];
const LS_KEY = 'istoria.placeFilter';

export function loadFilter(): PlaceFilter {
  try {
    const f = JSON.parse(localStorage.getItem(LS_KEY) ?? '') as PlaceFilter;
    return { types: (f.types ?? []).filter((x) => TYPES.includes(x)), vanishedOnly: !!f.vanishedOnly };
  } catch {
    return { types: [], vanishedOnly: false };
  }
}
function saveFilter(f: PlaceFilter) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(f)); } catch { /* приватний режим — просто не пам'ятаємо */ }
}
export const filterActive = (f: PlaceFilter) => f.types.length > 0 || f.vanishedOnly;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
/** Нормалізація для пошуку: без діакритики й апострофів; ґ, г і х рівнозначні (угорське h передають то «г», то «х»: Могач/Мохач, Гатван/Хатван). */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ґх]/g, 'г').replace(/[’'ʼ`«»"]/g, '');
const typeLabel = (x: PlaceType) => t(`tp_${x}` as Key);

const ICON = {
  search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>',
  filter: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M3 5h18l-7 8.5V20l-4-2v-4.5z"/></svg>',
  nearby: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1.4" fill="currentColor"/><circle cx="4" cy="12" r="1.4" fill="currentColor"/><circle cx="4" cy="18" r="1.4" fill="currentColor"/></svg>',
  offline: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/></svg>',
};
type Mode = keyof typeof ICON;
const MODES: Mode[] = ['search', 'filter', 'nearby', 'offline'];

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
function fmtDist(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} ${t('unitM')}`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} ${t('unitKm')}`;
}

interface Opts {
  /** Поточний період (null = усі). */
  getPeriod(): string | null;
  /** Перейти до місця: картка й політ мапи. keepPeriod — лишити вибраний період. */
  openPlace(id: string, keepPeriod: boolean): void;
  openEvent(id: string): void;
  /** Змінився фільтр типів (для підпису на мапі). */
  onFilter(f: PlaceFilter): void;
  /** Мапу з пристрою завантажено, оновлено чи видалено. */
  onOfflineMap(): void;
}

/** Кнопки «Пошук», «Типи місць», «Що поруч», «Без інтернету» у правому стовпчику мапи і панель для них. */
export function mountMapTools(ctl: MapController, host: HTMLElement, opts: Opts) {
  let filter = loadFilter();
  ctl.setPlaceFilter(filter);
  opts.onFilter(filter);

  const panel = document.createElement('div');
  panel.className = 'mtool';
  panel.hidden = true;
  panel.innerHTML = '<div class="mtool-head"><b class="mtool-title"></b><button class="mtool-close" type="button">×</button></div><div class="mtool-body"></div>';
  host.appendChild(panel);
  const title = panel.querySelector<HTMLElement>('.mtool-title')!;
  const body = panel.querySelector<HTMLElement>('.mtool-body')!;
  const closeBtn = panel.querySelector<HTMLButtonElement>('.mtool-close')!;
  let mode: Mode | null = null;
  let me: Marker | null = null;
  // панель «Без інтернету» оновлюється сама під час завантаження; при закритті відписуємо її
  let stopOffline: (() => void) | null = null;

  const buttons: Record<Mode, HTMLButtonElement> = {} as never;
  const control: IControl = {
    onAdd() {
      const div = document.createElement('div');
      div.className = 'maplibregl-ctrl maplibregl-ctrl-group mtool-ctrl';
      for (const k of MODES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `mtool-btn mtool-${k}`;
        b.innerHTML = ICON[k];
        b.onclick = () => (mode === k ? close() : open(k));
        buttons[k] = b;
        div.appendChild(b);
      }
      return div;
    },
    onRemove() { /* мапа живе весь час */ },
  };
  ctl.map.addControl(control, 'top-right');

  function labels() {
    buttons.search.title = buttons.search.ariaLabel = t('search');
    buttons.filter.title = buttons.filter.ariaLabel = t('filterTitle');
    buttons.nearby.title = buttons.nearby.ariaLabel = t('nearby');
    buttons.offline.title = buttons.offline.ariaLabel = t('offline');
    buttons.filter.classList.toggle('on', filterActive(filter));
    closeBtn.ariaLabel = t('close');
  }

  function close() {
    stopOffline?.();
    stopOffline = null;
    mode = null;
    panel.hidden = true;
    Object.values(buttons).forEach((b) => b.classList.remove('open'));
  }
  closeBtn.onclick = close;

  function open(k: Mode) {
    stopOffline?.();
    stopOffline = null;
    mode = k;
    panel.hidden = false;
    Object.entries(buttons).forEach(([n, b]) => b.classList.toggle('open', n === k));
    if (k === 'search') { body.innerHTML = ''; renderSearch(true); }
    else if (k === 'filter') renderFilter();
    else if (k === 'nearby') renderNearby();
    else renderOfflinePanel();
  }

  // ---------- без інтернету ----------
  function renderOfflinePanel() {
    title.textContent = t('offline');
    stopOffline?.();
    stopOffline = renderOffline(body, opts.onOfflineMap);
  }

  // ---------- пошук ----------
  type Hit = { kind: 'place' | 'event'; id: string; label: string; sub: string; color: string; text: string; words: string[]; nlabel: string };
  let index: Hit[] = [];
  let indexLang = '';
  function buildIndex() {
    if (indexLang === getLang()) return;
    indexLang = getLang();
    index = [
      ...places.map((p) => {
        const per = periodById(p.periods[0]);
        const text = norm(`${p.name.uk} ${p.name.hu ?? ''} ${p.id.replace(/-/g, ' ')}`);
        return { kind: 'place' as const, id: p.id, label: lt(p.name), nlabel: norm(lt(p.name)), sub: `${typeLabel(p.type)} · ${lt(per?.name)}`, color: per?.color ?? '#6b7280', text, words: text.split(/[^\p{L}\p{N}]+/u) };
      }),
      ...events.map((e) => {
        const per = periodById(e.period);
        const text = norm(`${e.title.uk} ${e.title.hu ?? ''} ${e.id.replace(/-/g, ' ')}`);
        return { kind: 'event' as const, id: e.id, label: lt(e.title), nlabel: norm(lt(e.title)), sub: `${eventDate(e)} · ${lt(per?.name)}`, color: per?.color ?? '#6b7280', text, words: text.split(/[^\p{L}\p{N}]+/u) };
      }),
    ];
  }
  function search(q: string): Hit[] {
    const toks = norm(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (!toks.length) return [];
    const scored: [number, Hit][] = [];
    for (const h of index) {
      let score = 0;
      for (const tk of toks) {
        if (!h.text.includes(tk)) { score = -1; break; }
        score += h.words.some((w) => w.startsWith(tk)) ? 3 : 1;
      }
      if (score < 0) continue;
      if (h.nlabel.startsWith(toks[0])) score += 5;
      if (h.kind === 'place') score += 0.5;
      scored.push([score, h]);
    }
    return scored.sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label)).slice(0, 40).map((x) => x[1]);
  }
  function renderSearch(focus = false) {
    // при перемальовуванні (зміна мови чи періоду) зберігаємо вже набраний запит
    const prevQ = body.querySelector<HTMLInputElement>('.mtool-input')?.value ?? '';
    buildIndex();
    title.textContent = t('search');
    body.innerHTML = `<input class="mtool-input" type="search" enterkeyhint="search" autocomplete="off" placeholder="${esc(t('searchPlaceholder'))}" aria-label="${esc(t('search'))}"><p class="mtool-note">${esc(t('searchHint'))}</p><ul class="mtool-list"></ul>`;
    const input = body.querySelector<HTMLInputElement>('input')!;
    const list = body.querySelector<HTMLUListElement>('ul')!;
    const note = body.querySelector<HTMLElement>('.mtool-note')!;
    const draw = () => {
      const q = input.value.trim();
      const hits = search(q);
      note.hidden = q.length > 0;
      list.innerHTML = q && !hits.length ? `<li class="mtool-empty">${esc(t('searchEmpty'))}</li>` : hits.map((h) => `
        <li><button type="button" data-kind="${h.kind}" data-id="${h.id}">
          <span class="dot ${h.kind}" style="--c:${h.color}"></span>
          <span class="txt"><span class="nm">${esc(h.label)}</span><span class="sub">${h.kind === 'event' ? `${esc(t('events'))}: ` : ''}${esc(h.sub)}</span></span>
        </button></li>`).join('');
    };
    input.value = prevQ;
    input.oninput = draw;
    list.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
      if (!b) return;
      close();
      if (b.dataset.kind === 'event') opts.openEvent(b.dataset.id!);
      else {
        const p = places.find((x) => x.id === b.dataset.id);
        const per = opts.getPeriod();
        opts.openPlace(b.dataset.id!, !!per && !!p?.periods.includes(per));
      }
    };
    draw();
    if (focus) setTimeout(() => input.focus(), 50);
  }

  // ---------- фільтр типів ----------
  function setFilter(f: PlaceFilter) {
    filter = f;
    saveFilter(f);
    ctl.setPlaceFilter(f);
    opts.onFilter(f);
    labels();
  }
  function renderFilter() {
    title.textContent = t('filterTitle');
    const per = opts.getPeriod();
    const inPeriod = places.filter((p) => !per || p.periods.includes(per));
    const count = (x: PlaceType) => inPeriod.filter((p) => p.type === x && (!filter.vanishedOnly || p.vanished)).length;
    body.innerHTML = `
      <div class="chips">${TYPES.map((x) => `<button type="button" class="chip ${filter.types.includes(x) ? 'on' : ''}" data-type="${x}">${esc(typeLabel(x))} <span class="cnt">${count(x)}</span></button>`).join('')}</div>
      <label class="mtool-check"><input type="checkbox" ${filter.vanishedOnly ? 'checked' : ''}> ${esc(t('filterVanished'))}</label>
      <button type="button" class="mtool-reset" ${filterActive(filter) ? '' : 'disabled'}>${esc(t('filterAll'))}</button>`;
    body.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => {
      b.onclick = () => {
        const x = b.dataset.type as PlaceType;
        const types = filter.types.includes(x) ? filter.types.filter((y) => y !== x) : [...filter.types, x];
        setFilter({ ...filter, types });
        renderFilter();
      };
    });
    body.querySelector<HTMLInputElement>('.mtool-check input')!.onchange = (e) => { setFilter({ ...filter, vanishedOnly: (e.target as HTMLInputElement).checked }); renderFilter(); };
    body.querySelector<HTMLButtonElement>('.mtool-reset')!.onclick = () => { setFilter({ types: [], vanishedOnly: false }); renderFilter(); };
  }

  // ---------- що поруч ----------
  let origin: { at: [number, number]; fromMe: boolean; note?: string } | null = null;
  function drawNearby() {
    if (mode !== 'nearby' || !origin) return;
    const per = opts.getPeriod();
    const only = ctl.overlayPlaceTypes();
    const list = places.filter((p) => placeVisible(p, per, filter, only))
      .map((p) => ({ p, d: haversine(origin!.at, p.coords), b: bearing(origin!.at, p.coords) }))
      .sort((a, b) => a.d - b.d).slice(0, 40);
    const dirs = t('dirs').split(',');
    const notes = [origin.note, per || filterActive(filter) ? t('nearbyFilters') : '', only ? t('overlayOnlyNearby') : ''].filter(Boolean);
    body.innerHTML = `
      <div class="mtool-seg"><button type="button" data-from="me" class="${origin.fromMe ? 'on' : ''}">${esc(t('nearbyFromMe'))}</button><button type="button" data-from="center" class="${origin.fromMe ? '' : 'on'}">${esc(t('nearbyFromCenter'))}</button></div>
      ${notes.map((n) => `<p class="mtool-note">${esc(n!)}</p>`).join('')}
      <ul class="mtool-list">${list.map(({ p, d, b }) => {
        const c = periodById(p.periods[0])?.color ?? '#6b7280';
        return `<li><button type="button" data-id="${p.id}">
          <span class="dot ${p.vanished ? 'vanished' : ''}" style="--c:${c}"></span>
          <span class="txt"><span class="nm">${esc(lt(p.name))}</span><span class="sub">${esc(typeLabel(p.type))}</span></span>
          <span class="dist">${fmtDist(d)}<span class="dir"><span class="arr" style="transform:rotate(${Math.round(b)}deg)">↑</span>${dirs[Math.round(b / 45) % 8]}</span></span>
        </button></li>`;
      }).join('')}</ul>`;
    body.querySelector<HTMLElement>('.mtool-seg')!.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-from]');
      if (b?.dataset.from === 'me') locate();
      else if (b) fromCenter();
    };
    body.querySelector<HTMLElement>('.mtool-list')!.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
      if (!b) return;
      close();
      opts.openPlace(b.dataset.id!, true);
    };
  }
  function fromCenter(note?: string) {
    const c = ctl.map.getCenter();
    origin = { at: [c.lng, c.lat], fromMe: false, note };
    me?.remove(); me = null;
    drawNearby();
  }
  function locate() {
    body.innerHTML = `<p class="mtool-note">${esc(t('nearbyLocating'))}</p>`;
    if (!('geolocation' in navigator)) { fromCenter(t('nearbyNoGps')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        origin = { at: [pos.coords.longitude, pos.coords.latitude], fromMe: true };
        if (!me) {
          const el = document.createElement('div');
          el.className = 'me-dot';
          me = new Marker({ element: el });
        }
        me.setLngLat(origin.at).addTo(ctl.map);
        drawNearby();
      },
      () => fromCenter(t('nearbyNoGps')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }
  function renderNearby() {
    title.textContent = t('nearby');
    // при кожному відкритті — свіжа точка відліку: центр мапи міг зсунутися, людина — перейти
    if (origin && !origin.fromMe) fromCenter();
    else locate();
  }

  labels();
  return {
    /** Після зміни мови чи періоду — перемалювати відкриту панель. */
    refresh() {
      labels();
      if (mode === 'search') renderSearch();
      else if (mode === 'filter') renderFilter();
      else if (mode === 'nearby') { title.textContent = t('nearby'); drawNearby(); }
      else if (mode === 'offline') renderOfflinePanel();
    },
    close,
    open,
    isOpen: () => mode !== null,
    clearFilter() { setFilter({ types: [], vanishedOnly: false }); if (mode === 'filter') renderFilter(); },
  };
}
