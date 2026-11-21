// Панель «Без інтернету» на мапі: пакети для роботи без мережі (src/offline.ts), місце на пристрої, встановлення застосунку.
import { getLang, t, type Key } from '../i18n';
import { canInstall, isStandalone, onInstallChange, promptInstall } from '../install';
import {
  currentJob, deletePack, downloadPack, installed, loadManifest, offlineSupported, onOfflineChange, PACK_IDS, pending,
  photosManifest, stopDownload, storageInfo, type DownloadResult, type PackId, type PackManifest, type PacksManifest,
} from '../offline';

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

/** Останній результат завантаження кожного пакета — показується під ним, доки не почнеться нове. */
const lastResult: Partial<Record<PackId, { res: DownloadResult; failed: number }>> = {};

/**
 * Намалювати панель у body і оновлювати її під час завантаження. onBasemap — мапу з пристрою встановлено,
 * оновлено чи видалено (треба перевибрати підкладку). Повертає функцію, що відписує панель від змін.
 */
export function renderOffline(body: HTMLElement, onBasemap: () => void): () => void {
  let manifest: PacksManifest | null = null;
  let seq = 0;

  const draw = async () => {
    const my = ++seq;
    if (!manifest) manifest = await loadManifest().catch(() => null);
    const st = await storageInfo();
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
      return `<li class="off-pack" ${running ? `data-running="${id}"` : ''}>
        <div class="off-head"><b>${esc(t(`pack_${id}` as Key))}</b>${size ? `<span class="off-size">${size}</span>` : ''}</div>
        <p class="off-note">${esc(note)}</p>
        ${state ? `<div class="off-state">${state}</div>` : ''}
        ${msg ? `<p class="off-err">${esc(msg)}</p>` : ''}
        <div class="off-btns">${buttons}</div>
      </li>`;
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
  };
  /** Хід завантаження оновлюємо на місці, щоб натискання «Зупинити» не губилося через перемальовування. */
  const progress = (): boolean => {
    const job = currentJob();
    const li = job && body.querySelector<HTMLElement>(`.off-pack[data-running="${job.id}"]`);
    if (!job || !li) return false;
    const f = job.total ? job.done / job.total : 0;
    li.querySelector('progress')!.value = f;
    li.querySelector('.off-pct')!.textContent = `${pct(f)}${job.byCount ? '' : ` · ${fmtBytes(job.done)} / ${fmtBytes(job.total)}`}`;
    return true;
  };

  body.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!b || b.disabled) return;
    const id = b.dataset.id as PackId;
    const act = b.dataset.act;
    if (act === 'install') { void promptInstall().then(draw); return; }
    if (act === 'stop') { stopDownload(); return; }
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

  const off1 = onOfflineChange(() => { if (!progress()) void draw(); });
  const off2 = onInstallChange(() => void draw());
  const net = () => void draw();
  window.addEventListener('online', net);
  window.addEventListener('offline', net);
  void draw();
  return () => {
    seq++;
    off1();
    off2();
    window.removeEventListener('online', net);
    window.removeEventListener('offline', net);
    body.onclick = null;
  };
}
