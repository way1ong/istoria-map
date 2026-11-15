import './style.css';
import { histMaps, placeById, places, routesForEvent } from './data';
import { mountAnimation, type AnimHandle } from './anim';
import { mountCompare, type CompareHandle } from './compare';
import { getLang, lt, setLang, t } from './i18n';
import { createMap, type MapController } from './map';
import { eventPage, historyIndex, periodPage, placePage } from './pages/history';
import { navigate, onRoute, type Route } from './router';
import { placeCard } from './ui/render';
import { renderTimeline } from './ui/timeline';

setLang(getLang());

const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="topbar">
    <h1 id="title"></h1>
    <nav class="tabs"><button id="tab-map"></button><button id="tab-history"></button><button id="tab-compare"></button></nav>
    <div class="lang"><button data-lang="uk">UK</button><button data-lang="hu">HU</button></div>
  </header>
  <main>
    <section id="view-map" class="view">
      <div id="map"></div>
      <div id="overlay-ctl" class="overlay-ctl" hidden>
        <select id="overlay-select"></select>
        <input id="overlay-opacity" type="range" min="0" max="1" step="0.05" value="0.7" />
      </div>
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

function ensureMap(): MapController {
  if (!mapCtl) {
    mapCtl = createMap($('map'), (id) => {
      navigate(id ? `#/map?${state.period ? `period=${state.period}&` : ''}place=${id}` : `#/map${state.period ? `?period=${state.period}` : ''}`);
    });
    mapCtl.setOverlayOpacity(0.7);
  }
  return mapCtl;
}

function renderChrome() {
  $('title').textContent = t('appTitle');
  $('tab-map').textContent = t('tabMap');
  $('tab-history').textContent = t('tabHistory');
  $('tab-compare').textContent = t('tabCompare');
  document.querySelectorAll<HTMLButtonElement>('.lang button').forEach((b) => b.classList.toggle('active', b.dataset.lang === getLang()));
  $('tab-map').classList.toggle('active', route.page === 'map');
  $('tab-history').classList.toggle('active', route.page !== 'map' && route.page !== 'compare');
  $('tab-compare').classList.toggle('active', route.page === 'compare');
}

function renderOverlayCtl(ctl: MapController) {
  const box = $('overlay-ctl');
  const sel = $<HTMLSelectElement>('overlay-select');
  const visible = histMaps.filter((m) => !state.period || !m.periods || m.periods.includes(state.period));
  box.hidden = visible.length === 0;
  const prev = sel.value;
  sel.innerHTML = `<option value="">${t('noOverlay')}</option>` + visible.map((m) => `<option value="${m.id}">${lt(m.title)} (${m.year})</option>`).join('');
  sel.value = visible.some((m) => m.id === prev) ? prev : '';
  ctl.setOverlay(sel.value || null);
}

function renderMapView() {
  const ctl = ensureMap();
  ctl.setPeriod(state.period);
  ctl.setSelected(state.place);
  renderTimeline($('timeline'), state.period, (id) => navigate(`#/map${id ? `?period=${id}` : ''}`));
  renderOverlayCtl(ctl);
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
    case 'place': page.innerHTML = placePage(route.id); break;
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

$('tab-map').onclick = () => navigate(`#/map${state.period ? `?period=${state.period}` : ''}`);
$('tab-history').onclick = () => navigate('#/history');
$('tab-compare').onclick = () => navigate(`#/compare${state.period ? `?period=${state.period}` : ''}`);
document.querySelectorAll<HTMLButtonElement>('.lang button').forEach((b) => {
  b.onclick = () => {
    setLang(b.dataset.lang as 'uk' | 'hu');
    mapCtl?.refreshLabels();
    render();
  };
});
$('sheet').querySelector<HTMLButtonElement>('.close')!.onclick = () => navigate(`#/map${state.period ? `?period=${state.period}` : ''}`);
$<HTMLSelectElement>('overlay-select').onchange = (e) => mapCtl?.setOverlay((e.target as HTMLSelectElement).value || null);
$<HTMLInputElement>('overlay-opacity').oninput = (e) => mapCtl?.setOverlayOpacity(Number((e.target as HTMLInputElement).value));

onRoute((r) => {
  route = r;
  render();
});
