import './style.css';

import { basemaps, histMaps, placeById, places, routesForEvent } from './data';
import { mountAnimation, type AnimHandle } from './anim';
import { mountCompare, type CompareHandle } from './compare';
import { getLang, lt, setLang, t } from './i18n';
import { createMap, type MapController } from './map';
import { mapChoices } from './oldmap';
import { chronologyPage } from './pages/chronology';
import { eventPage, historyIndex, periodPage, placePage } from './pages/history';
import { landscapePage, mountLandscape } from './pages/landscape';
import { toolPage, toolsIndex } from './pages/tools';
import { navigate, onRoute, type Route } from './router';
import { placeCard } from './ui/render';
import { currentYear, renderTimeline } from './ui/timeline';
import { filterActive, mountMapTools, TYPES } from './ui/maptools';
import type { PlaceFilter } from './map';

setLang(getLang());

const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="topbar">
    <h1 id="title"></h1>
    <nav class="tabs"><button id="tab-map"></button><button id="tab-history"></button><button id="tab-compare"></button><button id="tab-landscape"></button><button id="tab-tools"></button></nav>
    <select id="nav-select" class="nav-select"></select>
    <div class="lang"><button data-lang="uk">UK</button><button data-lang="hu">HU</button></div>
  </header>
  <main>
    <section id="view-map" class="view">
      <div id="map"></div>
      <select id="basemap-select" class="basemap-select" aria-label="basemap"></select>
      <div id="overlay-ctl" class="overlay-ctl" hidden>
        <select id="overlay-select"></select>
        <input id="overlay-opacity" type="range" min="0" max="1" step="0.05" value="0.7" />
        <button id="overlay-legend-btn" class="ov-legend-btn" type="button" hidden>i</button>
      </div>
      <div id="overlay-legend" class="ov-legend" hidden></div>
      <div id="filter-pill" class="filter-pill" hidden><button type="button" class="fp-open"></button><button type="button" class="fp-clear">×</button></div>
      <div id="borders-note" class="borders-note" hidden></div>
      <div id="timeline" class="timeline"></div>
      <div id="sheet" class="sheet"><div class="handle"></div><button class="close" aria-label="close">×</button><div id="sheet-body"></div></div>
    </section>
    <section id="view-page" class="view"><div id="page" class="page"></div></section>
    <section id="view-compare" class="view"><div id="compare" class="compare"></div></section>
  </main>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let state: { period: string | null; place: string | null } = { period: null, place: null };
let mapCtl: MapController | null = null;
let route: Route = { page: 'map' };
let anims: AnimHandle[] = [];
let cmp: CompareHandle | null = null;
let tools: ReturnType<typeof mountMapTools> | null = null;
let lastFilter: PlaceFilter = { types: [], vanishedOnly: false };

/** Підпис на мапі, коли діє фільтр типів: нагадування і кнопка скинути. */
function renderFilterPill(f: PlaceFilter = lastFilter) {
  lastFilter = f;
  const pill = $('filter-pill');
  pill.hidden = !filterActive(f);
  const names = TYPES.filter((x) => f.types.includes(x)).map((x) => t(`tp_${x}` as Parameters<typeof t>[0]));
  if (f.vanishedOnly) names.push(t('filterVanished'));
  pill.querySelector<HTMLButtonElement>('.fp-open')!.textContent = `${t('filterActive')}: ${names.join(', ')}`;
  pill.querySelector<HTMLButtonElement>('.fp-clear')!.ariaLabel = t('filterAll');
}

function ensureMap(): MapController {
  if (!mapCtl) {
    mapCtl = createMap($('map'), (id) => {
      navigate(id ? `#/map?${state.period ? `period=${state.period}&` : ''}place=${id}` : `#/map${state.period ? `?period=${state.period}` : ''}`);
    });
    mapCtl.setOverlayOpacity(0.7);
    tools = mountMapTools(mapCtl, $('view-map'), {
      getPeriod: () => state.period,
      openPlace: (id, keep) => navigate(`#/map?${keep && state.period ? `period=${state.period}&` : ''}place=${id}`),
      openEvent: (id) => navigate(`#/event/${id}`),
      onFilter: (f) => renderFilterPill(f),
    });
    mapCtl.onBorders((info) => {
      const el = $('borders-note');
      el.hidden = !info;
      if (info) el.innerHTML = `${(info.year < 0 ? t('bordersNoteBce') : t('bordersNote')).replace('{year}', String(Math.abs(info.year)))} <span class="attr">${info.attribution}</span>`;
    });
  }
  return mapCtl;
}

type Section = 'map' | 'history' | 'compare' | 'landscape' | 'tools';
const SECTIONS: Section[] = ['map', 'history', 'compare', 'landscape', 'tools'];
const sectionLabel: Record<Section, () => string> = {
  map: () => t('tabMap'), history: () => t('tabHistory'), compare: () => t('tabCompare'), landscape: () => t('tabLandscape'), tools: () => t('tabTools'),
};
function currentSection(): Section {
  if (route.page === 'map' || route.page === 'compare' || route.page === 'landscape') return route.page;
  if (route.page === 'tools' || route.page === 'tool') return 'tools';
  return 'history';
}
function goSection(s: Section) {
  const q = state.period ? `?period=${state.period}` : '';
  navigate({ map: `#/map${q}`, history: '#/history', compare: `#/compare${q}`, landscape: '#/landscape', tools: '#/tools' }[s]);
}

function renderChrome() {
  $('title').textContent = t('appTitle');
  document.title = t('appTitle');
  const cur = currentSection();
  for (const s of SECTIONS) {
    const b = $(`tab-${s}`);
    b.textContent = sectionLabel[s]();
    b.classList.toggle('active', s === cur);
  }
  const sel = $<HTMLSelectElement>('nav-select');
  sel.setAttribute('aria-label', t('navLabel'));
  sel.innerHTML = SECTIONS.map((s) => `<option value="${s}">${sectionLabel[s]()}</option>`).join('');
  sel.value = cur;
  document.querySelectorAll<HTMLButtonElement>('.lang button').forEach((b) => b.classList.toggle('active', b.dataset.lang === getLang()));
}

function renderBasemapCtl(ctl: MapController) {
  const sel = $<HTMLSelectElement>('basemap-select');
  sel.innerHTML = basemaps.map((b) => `<option value="${b.id}">${lt(b.title)}</option>`).join('');
  sel.value = ctl.currentBasemap();
  sel.onchange = () => ctl.setBasemap(sel.value);
}

function renderOverlayCtl(ctl: MapController) {
  const box = $('overlay-ctl');
  const sel = $<HTMLSelectElement>('overlay-select');
  const visible = histMaps.filter((m) => !state.period || !m.periods || m.periods.includes(state.period));
  box.hidden = visible.length === 0;
  const prev = sel.value;
  const choices = mapChoices(visible, prev);
  sel.innerHTML = `<option value="">${t('noOverlay')}</option>` + choices.map((c) => `<option value="${c.value}">${c.label}</option>`).join('');
  sel.value = choices.some((c) => c.value === prev) ? prev : '';
  ctl.setOverlay(sel.value || null);
  renderOverlayLegend(sel.value || null, sel.value !== prev);
}

/** Умовні позначки векторної накладки (поле legend у data/maps/*.json): кнопка «i» біля списку мап і панель під ним. */
const swatch = (style: string, color: string) => `<span class="sw sw-${style}" style="--c:${color}"></span>`;
function renderOverlayLegend(mapId: string | null, open: boolean) {
  const m = mapId ? histMaps.find((x) => x.id === mapId) : undefined;
  const btn = $<HTMLButtonElement>('overlay-legend-btn');
  const box = $('overlay-legend');
  btn.hidden = !m?.legend?.length;
  btn.setAttribute('aria-label', t('legend'));
  btn.title = t('legend');
  if (!m?.legend?.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.innerHTML = `<div class="ov-legend-head"><strong>${t('legend')}</strong><button type="button" class="ov-legend-close" aria-label="${t('close')}">×</button></div>`
    + `<ul>${m.legend.map((it) => `<li>${swatch(it.style, it.color)}<span>${lt(it.label)}</span></li>`).join('')}</ul>`
    + `<p class="ov-legend-hint">${t('legendHint')}</p>`;
  box.querySelector<HTMLButtonElement>('.ov-legend-close')!.onclick = () => { box.hidden = true; };
  if (open) box.hidden = false;
}

function renderMapView() {
  const ctl = ensureMap();
  ctl.setPeriod(state.period);
  ctl.setSelected(state.place);
  renderTimeline($('timeline'), state.period, (id) => navigate(`#/map${id ? `?period=${id}` : ''}`), (year) => ctl.setYear(year));
  ctl.setYear(state.period ? currentYear() : null);
  renderBasemapCtl(ctl);
  renderOverlayCtl(ctl);
  renderFilterPill();
  tools?.refresh();
  const sheet = $('sheet');
  const place = state.place ? placeById(state.place) : undefined;
  if (place) {
    $('sheet-body').innerHTML = placeCard(place, false);
    sheet.classList.add('open');
    ctl.flyTo(place);
  } else {
    sheet.classList.remove('open');
  }
  if (state.period && !state.place && places.every((p) => !p.periods.includes(state.period!))) {
    $('sheet-body').innerHTML = `<p class="empty">${t('noPlaces')}</p>`;
    sheet.classList.add('open');
  }
  setTimeout(() => ctl.map.resize(), 0);
}

function render() {
  renderChrome();
  const isMap = route.page === 'map';
  const isCmp = route.page === 'compare';
  $('view-map').classList.toggle('active', isMap);
  $('view-page').classList.toggle('active', !isMap && !isCmp);
  $('view-compare').classList.toggle('active', isCmp);
  if (!isCmp && cmp) { cmp.destroy(); cmp = null; }
  if (isCmp) {
    const r = route as Extract<Route, { page: 'compare' }>;
    cmp?.destroy();
    cmp = mountCompare($('compare'), {
      mapId: r.map, periodId: r.period ?? state.period, baseId: r.base,
      onChange: (q) => navigate(`#/compare?map=${q.map}&base=${q.base}${r.period ? `&period=${r.period}` : ''}`),
      onPlace: (id) => navigate(`#/place/${id}`),
    });
    return;
  }
  if (route.page === 'map') {
    state = { period: route.period ?? null, place: route.place ?? null };
    renderMapView();
    return;
  }
  const page = $('page');
  page.scrollTop = 0;
  anims.forEach((a) => a.destroy());
  anims = [];
  switch (route.page) {
    case 'history': page.innerHTML = historyIndex(); break;
    case 'period': page.innerHTML = periodPage(route.id); break;
    case 'chronology': page.innerHTML = chronologyPage(route.period); break;
    case 'place': page.innerHTML = placePage(route.id); break;
    case 'tools': page.innerHTML = toolsIndex(route.audience); break;
    case 'tool': page.innerHTML = toolPage(route.id); break;
    case 'landscape': page.innerHTML = landscapePage(); mountLandscape(page); break;
    case 'event': {
      page.innerHTML = eventPage(route.id);
      const rs = routesForEvent(route.id);
      page.querySelectorAll<HTMLElement>('.anim-host').forEach((host, i) => {
        if (rs[i]) anims.push(mountAnimation(host, rs[i]));
      });
      break;
    }
  }
}

for (const s of SECTIONS) $(`tab-${s}`).onclick = () => goSection(s);
$<HTMLSelectElement>('nav-select').onchange = (e) => goSection((e.target as HTMLSelectElement).value as Section);
document.querySelectorAll<HTMLButtonElement>('.lang button').forEach((b) => {
  b.onclick = () => {
    setLang(b.dataset.lang as 'uk' | 'hu');
    mapCtl?.refreshLabels();
    render();
  };
});
$('filter-pill').querySelector<HTMLButtonElement>('.fp-clear')!.onclick = () => tools?.clearFilter();
$('filter-pill').querySelector<HTMLButtonElement>('.fp-open')!.onclick = () => tools?.open('filter');
$('sheet').querySelector<HTMLButtonElement>('.close')!.onclick = () => navigate(`#/map${state.period ? `?period=${state.period}` : ''}`);
$<HTMLSelectElement>('overlay-select').onchange = (e) => {
  const v = (e.target as HTMLSelectElement).value || null;
  mapCtl?.setOverlay(v);
  renderOverlayLegend(v, true);
};
$('overlay-legend-btn').onclick = () => { const box = $('overlay-legend'); box.hidden = !box.hidden; };
$<HTMLInputElement>('overlay-opacity').oninput = (e) => mapCtl?.setOverlayOpacity(Number((e.target as HTMLInputElement).value));

// Виноски в текстах: посилання #fn-… не змінюють маршрут, а прокручують до джерела і назад.
let lastFnRef: HTMLElement | null = null;
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#fn-"]');
  if (!a) return;
  e.preventDefault();
  const back = a.getAttribute('href') === '#fn-back';
  const li = a.closest('li');
  const target = back
    ? (lastFnRef?.getAttribute('href') === `#${li?.id}` ? lastFnRef : document.querySelector<HTMLElement>(`.fnref a[href="#${li?.id}"]`))
    : document.getElementById(a.getAttribute('href')!.slice(1));
  if (a.closest('.fnref')) lastFnRef = a;
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('fn-hl');
  setTimeout(() => target.classList.remove('fn-hl'), 1600);
});

onRoute((r) => {
  route = r;
  lastFnRef = null;
  render();
});
