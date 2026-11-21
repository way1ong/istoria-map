// Панель «Без інтернету» на мапі: пакети для роботи без мережі (src/offline.ts), ділянки старих мап у повній якості
// (src/offlineareas.ts), місце на пристрої, встановлення застосунку.
import type { Map as MLMap } from 'maplibre-gl';
import { getLang, lt, t, type Key } from '../i18n';
import { canInstall, isStandalone, onInstallChange, promptInstall } from '../install';
import {
  currentJob, deletePack, downloadPack, installed, loadManifest, offlineSupported, onOfflineChange, PACK_IDS, pending,
  photosManifest, stopDownload, storageInfo, type DownloadResult, type PackId, type PackManifest, type PacksManifest,
} from '../offline';
import { areaKm, areasGeoJSON, areasStorage, deleteArea, downloadArea, nearestPlace, planArea, savedAreas, type AreaPlan } from '../offlineareas';
import type { GeoJSONSource } from 'maplibre-gl';
import { placeById } from '../data';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Розмір для людей: 310 МБ, 1,2 ГБ, 540 КБ (десяткові одиниці, кома). */
export function fmtBytes(n: number): string {
  const num = (x: number, d: number) => x.toFixed(d).replace('.', ',');
  if (n >= 1e9) return `${num(n / 1e9, 1)} ${t('unitGB')}`;
  if (n >= 1e6) return `${num(n / 1e6, n >= 1e7 ? 0 : 1)} ${t('unitMB')}`;
  return `${Math.max(1, Math.round(n / 1e3))} ${t('unitKB')}`;
}
const pct = (x: number) => `${Math.floor(Math.max(0, Math.min(1, x)) * 100)} %`;
/** 2026-11-20 → 20.11.2026 (угорською 2026. 11. 20.) */
function fmtDate(d: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? '');
  if (!m) return d ?? '';
  return getLang() === 'hu' ? `${m[1]}. ${m[2]}. ${m[3]}.` : `${m[3]}.${m[2]}.${m[1]}`;
}
const km = (x: number) => (x < 10 ? x.toFixed(1).replace('.', ',') : String(Math.round(x)));

/** Список збережених ділянок типово згорнутий; розгорнутий чи ні — пам'ятається на пристрої. */
const AREAS_OPEN_KEY = 'istoria.offline.areasOpen';
let areasOpen = (() => {
  try { return localStorage.getItem(AREAS_OPEN_KEY) === '1'; } catch { return false; }
})();

/** «біля Göd»: назва з підписів мапи, інакше найближче населене місце з карток (без пояснення після коми). */
function areaName(label: string | undefined, placeId: string | undefined): string {
  const p = placeId ? placeById(placeId) : undefined;
  const name = label || (p ? lt(p.name).split(',')[0].trim() : '');
  return name ? t('offAreaNear').replace('{name}', name) : '';
}

/**
 * Найближчий до центру ділянки населений пункт серед даних підкладки (OpenMapTiles: шар place, Protomaps: places),
 * місцевою мовою. Беремо дані завантажених тайлів, а не лише видимі підписи: центр міста може бути поза екраном.
 */
function mapPlaceName(map: MLMap, bbox: [number, number, number, number]): string | undefined {
  const c = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  const kx = Math.cos(c[1] * Math.PI / 180);
  const towns = ['city', 'town', 'village'];
  let best: { name: string; r: number; d: number } | undefined;
  for (const [id, src] of Object.entries(map.getStyle()?.sources ?? {})) {
    if (src.type !== 'vector') continue;
    for (const sourceLayer of ['place', 'places']) {
      let feats: ReturnType<MLMap['querySourceFeatures']> = [];
      try { feats = map.querySourceFeatures(id, { sourceLayer }); } catch { continue; }
      for (const f of feats) {
        const p = f.properties ?? {};
        const name = p.name;
        if (typeof name !== 'string' || !name || f.geometry.type !== 'Point') continue;
        // OpenMapTiles: class = city/town/village/…; Protomaps: kind = locality, kind_detail = city/town/village/…
        const cls = String(p.class ?? p.kind_detail ?? '');
        if (p.kind && p.kind !== 'locality') continue;
        const r = towns.includes(cls) ? 0 : ['suburb', 'hamlet', 'neighbourhood', 'quarter'].includes(cls) ? 1 : 2;
        if (r === 2) continue;
        const [x, y] = f.geometry.coordinates;
        const d = ((x - c[0]) * kx) ** 2 + (y - c[1]) ** 2;
        if (!best || r < best.r || (r === best.r && d < best.d)) best = { name, r, d };
      }
    }
  }
  return best?.name;
}

/** Останній результат завантаження кожного пакета (і ділянки) — показується під ним, доки не почнеться нове. */
const lastResult: Partial<Record<PackId | 'area', { res: DownloadResult; failed: number }>> = {};
/** Ділянка, більша за це (за оцінкою), не зберігається: на телефоні це вже забагато. */
const AREA_MAX_BYTES = 400e6;
/** Дрібніше за цей зум видима частина мапи завелика для збереження ділянки. */
const AREA_MIN_ZOOM = 9;

/**
 * Намалювати панель у body і оновлювати її під час завантаження й руху мапи. onBasemap — мапу з пристрою
 * встановлено, оновлено чи видалено (треба перевибрати підкладку). Повертає функцію, що відписує панель від змін.
 */
export function renderOffline(body: HTMLElement, opts: { map: MLMap; onBasemap(): void; close(): void }): () => void {
  const { map, onBasemap } = opts;
  let manifest: PacksManifest | null = null;
  let seq = 0;
  // оцінка видимої ділянки: рахується після зупинки мапи (потрібні info.json аркушів з мережі)
  let view: { key: string; state: 'zoom' | 'loading' | 'ready' | 'error'; plan?: AreaPlan } = { key: '', state: 'loading' };
  let planSeq = 0;

  const viewBox = (): [number, number, number, number] => {
    const b = map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  };
  const updatePlan = () => {
    const bbox = viewBox();
    const key = bbox.map((x) => x.toFixed(4)).join(',');
    if (map.getZoom() < AREA_MIN_ZOOM) { view = { key, state: 'zoom' }; void draw(); return; }
    if (key === view.key && view.state !== 'error') return;
    const my = ++planSeq;
    view = { key, state: 'loading' };
    void draw();
    planArea(bbox).then((plan) => {
      if (my !== planSeq) return;
      view = { key, state: 'ready', plan };
      void draw();
    }, () => {
      if (my !== planSeq) return;
      view = { key, state: 'error' };
      void draw();
    });
  };

  const areaSection = (online: boolean, job: ReturnType<typeof currentJob>, total: number): string => {
    const running = job?.id === 'area';
    let state = '';
    let canSave = false;
    if (running) state = `<progress max="1" value="0"></progress><span class="off-pct"></span>`;
    else if (view.state === 'zoom') state = esc(t('offAreaZoom'));
    else if (view.state === 'loading') state = esc(t('offAreaCounting'));
    else if (view.state === 'error' || !online) state = esc(t('offNeedNet'));
    else if (view.plan) {
      const plan = view.plan;
      const [w, h] = areaKm(plan.bbox);
      const sub = (k: Key, size = plan.estBytes) => t(k).replace('{w}', km(w)).replace('{h}', km(h)).replace('{size}', fmtBytes(size)).replace('{new}', fmtBytes(plan.newBytes));
      if (!plan.tiles.length) state = esc(t('offAreaEmpty'));
      // уже збережене (іншими ділянками) вдруге не завантажується, тож межа й підтвердження — за новою частиною
      else if (!plan.newTiles) state = esc(sub('offAreaHave'));
      else if (plan.newBytes > AREA_MAX_BYTES) state = esc(sub('offAreaTooBig', plan.newBytes));
      else if (plan.newTiles < plan.tiles.length) { state = esc(sub('offAreaViewPart')); canSave = true; }
      else { state = esc(sub('offAreaView')); canSave = true; }
    }
    const busy = !!job && !running;
    const r = !running ? lastResult.area : undefined;
    const msg = r && r.res !== 'ok' && r.res !== 'aborted' ? t(r.res === 'quota' ? 'offErrQuota' : r.res === 'net' ? 'offErrNet' : 'offErr') : '';
    const button = running
      ? `<button type="button" class="off-btn" data-act="stop">${esc(t('offStop'))}</button>`
      : `<button type="button" class="off-btn primary" data-act="area-save" ${canSave && online && !busy ? '' : 'disabled'} ${busy ? `title="${esc(t('offBusy'))}"` : ''}>${esc(t('offAreaSave'))}</button>`;
    const list = savedAreas().map((a) => {
      const [w, h] = areaKm(a.bbox);
      const name = areaName(a.label, a.placeId) || `${km(w)} × ${km(h)} ${t('unitKm')}`;
      return `<li><span class="off-area-name"><b>${esc(name)}</b><span>${km(w)} × ${km(h)} ${esc(t('unitKm'))} · ${fmtBytes(a.bytes)} · ${fmtDate(a.date)}</span></span>
        <button type="button" class="off-btn" data-act="area-show" data-id="${a.id}">${esc(t('offAreaShow'))}</button>
        <button type="button" class="off-btn" data-act="area-del" data-id="${a.id}">${esc(t('offDelete'))}</button></li>`;
    }).join('');
    return `<li class="off-pack off-areas" ${running ? 'data-running="area"' : ''}>
      <div class="off-head"><b>${esc(t('offAreas'))}</b></div>
      <p class="off-note">${esc(t('offAreasNote'))}</p>
      <div class="off-state">${state}</div>
      ${msg ? `<p class="off-err">${esc(msg)}</p>` : ''}
      <div class="off-btns">${button}</div>
      ${list ? `<details class="off-saved" ${areasOpen ? 'open' : ''}>
        <summary><span class="off-saved-t">${esc(t('offAreaSaved').replace('{n}', String(savedAreas().length)))}</span><span class="off-size">${esc(t('offAreasSum').replace('{size}', fmtBytes(total)))}</span></summary>
        <ul class="off-area-list">${list}</ul>
        <p class="off-note">${esc(t('offAreasShared'))}</p>
      </details>` : ''}
    </li>`;
  };

  const draw = async () => {
    const my = ++seq;
    if (!manifest) manifest = await loadManifest().catch(() => null);
    const st = await storageInfo();
    const total = savedAreas().length ? await areasStorage() : 0;
    if (my !== seq) return;
    const online = navigator.onLine !== false;
    const job = currentJob();
    const photos = photosManifest();
    const meta = (id: PackId): PackManifest | null => (id === 'photos' ? photos : manifest?.[id] ?? null);

    const packs = PACK_IDS.map((id) => {
      const m = meta(id);
      const inst = installed(id);
      const pend = pending(id);
      const running = job?.id === id;
      const size = id === 'photos' ? '' : m ? fmtBytes(m.bytes) : inst ? fmtBytes(inst.bytes) : '';
      const note = t(`packNote_${id}` as Key).replace('{date}', fmtDate(m?.date ?? inst?.date)).replace('{n}', String(photos.files.length));
      const canDl = online && !!m && !job;
      const dlTitle = !online ? t('offNeedNet') : job && !running ? t('offBusy') : '';
      const btn = (act: string, label: string, enabled = true, title = '') =>
        `<button type="button" class="off-btn ${act === 'dl' ? 'primary' : ''}" data-act="${act}" data-id="${id}" ${enabled ? '' : 'disabled'} ${title ? `title="${esc(title)}"` : ''}>${esc(label)}</button>`;
      let state = '';
      let buttons = '';
      if (running && job) {
        state = `<progress max="1" value="0"></progress><span class="off-pct"></span>`;
        buttons = btn('stop', t('offStop'));
      } else if (inst && m && inst.version !== m.version) {
        state = `<span class="off-ok">${esc(t('offOutdated'))}</span> · ${fmtBytes(inst.bytes)}`;
        buttons = btn('dl', t('offUpdate'), canDl, dlTitle) + btn('del', t('offDelete'));
      } else if (inst) {
        state = `<span class="off-ok">✓ ${esc(t('offReady'))}</span> · ${fmtBytes(inst.bytes)}`;
        buttons = btn('del', t('offDelete'));
      } else if (pend && (!m || pend.version === m.version)) {
        state = esc(t('offPaused').replace('{pct}', pct(pend.total ? pend.done / pend.total : 0)));
        buttons = btn('dl', t('offResume'), canDl, dlTitle) + btn('del', t('offDelete'));
      } else {
        buttons = btn('dl', t('offDownload'), canDl, dlTitle);
      }
      const r = !running ? lastResult[id] : undefined;
      const msg = r && r.res !== 'ok' && r.res !== 'aborted'
        ? t(r.res === 'quota' ? 'offErrQuota' : r.res === 'net' ? 'offErrNet' : 'offErr')
        : r?.failed ? t('offPhotosFailed').replace('{n}', String(r.failed)) : '';
      const li = `<li class="off-pack" ${running ? `data-running="${id}"` : ''}>
        <div class="off-head"><b>${esc(t(`pack_${id}` as Key))}</b>${size ? `<span class="off-size">${size}</span>` : ''}</div>
        <p class="off-note">${esc(note)}</p>
        ${state ? `<div class="off-state">${state}</div>` : ''}
        ${msg ? `<p class="off-err">${esc(msg)}</p>` : ''}
        <div class="off-btns">${buttons}</div>
      </li>`;
      // ділянки в повній якості — одразу після огляду старих мап
      return id === 'oldmaps' ? li + areaSection(online, job, total) : li;
    }).join('');

    const storage = st.usage !== undefined && st.quota
      ? `<p class="mtool-note">${esc(t('offStorage').replace('{used}', fmtBytes(st.usage)).replace('{quota}', fmtBytes(st.quota)))} ${esc(t(st.persisted ? 'offPersistYes' : 'offPersistNo'))}</p>`
      : '';
    const install = isStandalone()
      ? `<p class="mtool-note">✓ ${esc(t('installed'))}</p>`
      : canInstall()
        ? `<button type="button" class="off-btn primary off-install" data-act="install">${esc(t('install'))}</button>`
        : `<p class="mtool-note">${esc(t('installHint'))}</p>`;

    body.innerHTML = `
      <p class="off-net ${online ? 'on' : 'off'}">${esc(t(online ? 'offOnline' : 'offOffline'))}</p>
      ${offlineSupported() ? `<p class="mtool-note">${esc(t('offIntro'))}</p><ul class="off-packs">${packs}</ul>${storage}` : `<p class="mtool-note">${esc(t('offNoSupport'))}</p>`}
      <div class="off-install-box">${install}</div>`;
    progress();
    showAreas();
  };
  /** Поки панель відкрита, збережені ділянки обведено на мапі пунктиром. */
  const AREAS_ID = 'offline-saved-areas';
  const showAreas = () => {
    try {
      const data = areasGeoJSON();
      const src = map.getSource(AREAS_ID) as GeoJSONSource | undefined;
      if (src) { src.setData(data); return; }
      map.addSource(AREAS_ID, { type: 'geojson', data });
      map.addLayer({ id: AREAS_ID, type: 'line', source: AREAS_ID, paint: { 'line-color': '#f59e0b', 'line-width': 2.5, 'line-dasharray': [3, 2] } });
    } catch { /* стиль ще вантажиться — додамо під час наступного оновлення панелі */ }
  };
  const hideAreas = () => {
    if (map.getLayer(AREAS_ID)) map.removeLayer(AREAS_ID);
    if (map.getSource(AREAS_ID)) map.removeSource(AREAS_ID);
  };
  /** Хід завантаження оновлюємо на місці, щоб натискання «Зупинити» не губилося через перемальовування. */
  const progress = (): boolean => {
    const job = currentJob();
    const li = job && body.querySelector<HTMLElement>(`.off-pack[data-running="${job.id}"]`);
    if (!job || !li) return false;
    const f = job.total ? job.done / job.total : 0;
    li.querySelector('progress')!.value = f;
    li.querySelector('.off-pct')!.textContent = job.id === 'area'
      ? `${pct(f)} · ${fmtBytes(job.bytes)}`
      : `${pct(f)}${job.byCount ? '' : ` · ${fmtBytes(job.done)} / ${fmtBytes(job.total)}`}`;
    return true;
  };

  body.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!b || b.disabled) return;
    const id = b.dataset.id as PackId;
    const act = b.dataset.act;
    if (act === 'install') { void promptInstall().then(draw); return; }
    if (act === 'stop') { stopDownload(); return; }
    if (act === 'area-save' && view.plan) {
      const plan = view.plan;
      const label = mapPlaceName(map, plan.bbox);
      const what = areaName(label, nearestPlace(plan.bbox)?.id);
      if (!confirm(t('offConfirmArea').replace('{name}', what).replace('{size}', fmtBytes(plan.newBytes)))) return;
      delete lastResult.area;
      // після збереження (чи видалення) та сама видима ділянка має нову оцінку: «уже збережена» тощо
      void downloadArea(plan, label).then((res) => { lastResult.area = { res, failed: 0 }; view.key = ''; updatePlan(); void draw(); });
      return;
    }
    if (act === 'area-show') {
      const a = savedAreas().find((x) => x.id === b.dataset.id);
      if (a) { opts.close(); map.fitBounds([[a.bbox[0], a.bbox[1]], [a.bbox[2], a.bbox[3]]], { padding: 20, duration: 800 }); }
      return;
    }
    if (act === 'area-del') {
      const a = savedAreas().find((x) => x.id === b.dataset.id);
      if (!a || !confirm(t('offConfirmDelete').replace('{name}', areaName(a.label, a.placeId) || t('offAreas')))) return;
      void deleteArea(a.id).then(() => { view.key = ''; updatePlan(); void draw(); });
      return;
    }
    const name = t(`pack_${id}` as Key);
    if (act === 'del') {
      if (!confirm(t('offConfirmDelete').replace('{name}', name))) return;
      delete lastResult[id];
      void deletePack(id).then(() => { if (id === 'basemap') onBasemap(); });
      return;
    }
    if (act === 'dl') {
      const m = id === 'photos' ? null : manifest?.[id];
      if (m && m.bytes > 50e6 && !confirm(t('offConfirmBig').replace('{size}', fmtBytes(m.bytes)))) return;
      delete lastResult[id];
      void downloadPack(id).then((res) => {
        lastResult[id] = { res, failed: 0 };
        if (id === 'photos' && res === 'ok') lastResult[id]!.failed = photosManifest().files.length - (installed('photos')?.files ?? 0);
        if (id === 'basemap' && res === 'ok') onBasemap();
        void draw();
      });
    }
  };

  // подія toggle не спливає — ловимо на етапі перехоплення; draw() перемальовує панель і бере стан звідси
  const onToggle = (e: Event) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('off-saved')) return;
    areasOpen = d.open;
    try { localStorage.setItem(AREAS_OPEN_KEY, areasOpen ? '1' : '0'); } catch { /* приватний режим */ }
  };
  body.addEventListener('toggle', onToggle, true);
  const off1 = onOfflineChange(() => { if (!progress()) void draw(); });
  const off2 = onInstallChange(() => void draw());
  const net = () => { view.key = ''; updatePlan(); };
  window.addEventListener('online', net);
  window.addEventListener('offline', net);
  let moveTimer = 0;
  const onMove = () => { clearTimeout(moveTimer); moveTimer = window.setTimeout(updatePlan, 400); };
  map.on('moveend', onMove);
  updatePlan();
  return () => {
    seq++;
    planSeq++;
    clearTimeout(moveTimer);
    off1();
    off2();
    map.off('moveend', onMove);
    hideAreas();
    window.removeEventListener('online', net);
    window.removeEventListener('offline', net);
    body.onclick = null;
    body.removeEventListener('toggle', onToggle, true);
  };
}
