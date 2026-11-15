import './style.css';
import { histMaps, placeById, places, routesForEvent } from './data';
import { mountAnimation, type AnimHandle } from './anim';
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
    <nav class="tabs"><button id="tab-map"></button><button id="tab-history"></button></nav>
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
  </main>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let state: { period: string | null; place: string | null } = { period: null, place: null };
let mapCtl: MapController | null = null;
let route: Route = { page: 'map' };
let anims: AnimHandle[] = [];

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
  document.querySelectorAll<HTMLButtonElement>('.lang button').forEach((b) => b.classList.toggle('active', b.dataset.lang === getLang()));
  const isMap = route.page === 'map';
  $('tab-map').classList.toggle('active', isMap);
  $('tab-history').classList.toggle('active', !isMap);
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
  $('view-map').classList.toggle('active', isMap);
  $('view-page').classList.toggle('active', !isMap);
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
