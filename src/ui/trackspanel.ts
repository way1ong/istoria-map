// Панель «Шляхи» (вкладка поруч із «Мітками»): запис пройденого шляху, список шляхів, редагування одного
// (назва, колір, показ на мапі), завантаження з файлу GPX або GeoJSON, вивантаження у GPX. Дані — src/tracks.ts.
import type { Map as MLMap } from 'maplibre-gl';
import { fmtDateTime, t, type Key } from '../i18n';
import { fmtDuration, fmtLength } from '../geo';
import { MARK_COLORS, MARK_HEX, type MarkColor } from '../marks';
import {
  deleteTrack, exportGpx, importTracks, loadTracks, onTracksChange, recordingState, startRecording, stopRecording,
  trackBounds, trackById, trackPoints, tracks, tracksStorageFailed, updateTrack, type Track,
} from '../tracks';
import { asciiName, canShareFile, download, shareFile } from './files';
import { toast } from './toast';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Хвиляста лінія кольору шляху для списку й вибору кольору. */
const lineSvg = (color: MarkColor, size = 20) =>
  `<svg class="flag" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M3 17c4-10 6 3 9-4s5-7 9-5" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="M3 17c4-10 6 3 9-4s5-7 9-5" fill="none" stroke="${MARK_HEX[color]}" stroke-width="3.4" stroke-linecap="round"/></svg>`;

/** «3,42 км · 1 год 12 хв» (тривалість — лише коли в точок є час). */
const stats = (tr: Track) => [fmtLength(tr.length), tr.duration ? fmtDuration(tr.duration) : ''].filter(Boolean).join(' · ');

const gpxFile = (tr: Track) => new File([exportGpx(tr)], `${asciiName(tr.name, 'shliakh')}.gpx`, { type: 'application/gpx+xml' });

export interface TracksPanel {
  /** Перемалювати (змінилась мова). */
  refresh(): void;
  dispose(): void;
}

export function renderTracks(body: HTMLElement, opts: { map: MLMap; setTitle(s: string): void; /** Увімкнути точку місця на мапі, якщо її ще немає. */ locate(): void }): TracksPanel {
  const { map } = opts;
  let editing: string | null = null;
  /** Відбиток списку: поки він той самий, під час запису оновлюємо лише рядок стану, а не весь список. */
  let drawn = '';

  /** Показати шлях цілим на вільній від панелі частині мапи. */
  const fit = (tr: Track) => {
    const b = trackBounds(tr);
    if (!b) return;
    const m = map.getContainer().getBoundingClientRect();
    const p = body.closest('.mtool')?.getBoundingClientRect();
    const pad = { top: 60, bottom: 150, left: 40, right: 64 };
    // панель на всю ширину (телефон) закриває верх мапи, вузька (ПК) — лівий край
    if (p && p.width > m.width * 0.6) pad.top = Math.min(m.height * 0.6, p.bottom - m.top + 16);
    else if (p) pad.left = p.right - m.left + 24;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad, maxZoom: 16, duration: 700 });
  };

  const liveText = () => {
    const r = recordingState();
    if (!r) return '';
    const acc = r.accuracy === null ? t('trackWaiting') : r.weak ? t('trackWeak') : t('markAcc').replace('{n}', String(r.accuracy));
    return `${t('trackRecording')}: ${stats(r.track)} · ${acc}`;
  };
  const infoText = (tr: Track) =>
    [stats(tr), t('trackPoints').replace('{n}', String(trackPoints(tr))), fmtDateTime(tr.created), t(tr.source === 'rec' ? 'trackSrcRec' : 'trackSrcFile')].join(' · ');
  const signature = () => `${editing}|${!!recordingState()}|${tracksStorageFailed()}|${tracks().map((x) => `${x.id}:${x.name}:${x.color}:${x.hidden ? 1 : 0}:${x.recording ? 'r' : Math.round(x.length)}`).join(',')}`;

  const drawList = () => {
    const list = tracks();
    const r = recordingState();
    body.innerHTML = `
      <div class="off-btns mk-add">
        ${r
          ? `<button type="button" class="off-btn tr-stop" data-act="stop"><span class="tr-dot"></span> ${esc(t('trackStop'))}</button>`
          : `<button type="button" class="off-btn primary" data-act="rec">${esc(t('trackRec'))}</button>`}
        <button type="button" class="off-btn" data-act="import">${esc(t('markImport'))}</button>
        <input type="file" class="mk-file-input" accept=".gpx,.geojson,.json,application/gpx+xml,application/geo+json,application/json,text/xml,application/xml" multiple hidden />
      </div>
      ${r ? `<p class="mtool-note tr-live" aria-live="polite">${esc(liveText())}</p>` : ''}
      <p class="mtool-note">${esc(t('trackRecNote'))}</p>
      ${tracksStorageFailed() ? `<p class="mtool-note tr-warn">${esc(t('trackNoStorage'))}</p>` : ''}
      ${list.length ? `<ul class="mtool-list">${list.map((x) => `
        <li><button type="button" data-id="${esc(x.id)}">
          ${lineSvg(x.color)}
          <span class="txt"><span class="nm">${esc(x.name || t('trackDefault'))}</span><span class="sub">${esc([fmtDateTime(x.created), stats(x), x.hidden ? t('trackHidden') : ''].filter(Boolean).join(' · '))}</span></span>
        </button></li>`).join('')}</ul>` : `<p class="mtool-empty">${esc(t('trackEmpty'))}</p>`}`;
    body.querySelector<HTMLInputElement>('.mk-file-input')!.onchange = (e) => {
      const input = e.target as HTMLInputElement;
      const files = [...(input.files ?? [])];
      input.value = '';
      if (!files.length) return;
      void (async () => {
        let added = 0, skipped = 0, bad = 0;
        let first: Track | undefined;
        for (const f of files) {
          try {
            const res = await importTracks(await f.text(), f.name);
            added += res.added; skipped += res.skipped; first ??= res.first;
          } catch { bad++; }
        }
        if (bad && !added && !skipped) toast(t('trackImportBad'), { ms: 6000 });
        else toast(t('trackImported').replace('{n}', String(added)).replace('{m}', String(skipped + bad)), { ms: 6000 });
        if (first) fit(first);
      })();
    };
  };

  const drawEdit = (tr: Track) => {
    const file = gpxFile(tr);
    body.innerHTML = `
      <button type="button" class="mk-back" data-act="back">‹ ${esc(t('trackAll'))}</button>
      <label class="mk-field"><span>${esc(t('markName'))}</span><input class="mtool-input mk-name" type="text" maxlength="120" autocomplete="off" value="${esc(tr.name)}" /></label>
      <div class="mk-colors" role="group" aria-label="${esc(t('trackColor'))}">${MARK_COLORS.map((c) => `<button type="button" class="mk-color ${c === tr.color ? 'on' : ''}" data-color="${c}" aria-label="${esc(t(`markColor_${c}` as Key))}" aria-pressed="${c === tr.color}">${lineSvg(c, 24)}</button>`).join('')}</div>
      <p class="mtool-note mk-info tr-info">${esc(infoText(tr))}</p>
      <div class="off-btns">
        <button type="button" class="off-btn" data-act="show">${esc(t('markShow'))}</button>
        <button type="button" class="off-btn" data-act="hide">${esc(t(tr.hidden ? 'trackUnhide' : 'trackHide'))}</button>
        <button type="button" class="off-btn" data-act="export">${esc(t('trackExport'))}</button>
        ${canShareFile(file) ? `<button type="button" class="off-btn" data-act="share">${esc(t('markShare'))}</button>` : ''}
        <button type="button" class="off-btn mk-del" data-act="delete">${esc(t('markDelete'))}</button>
      </div>`;
    // назва зберігається під час набирання: кнопки «Зберегти» немає
    const name = body.querySelector<HTMLInputElement>('.mk-name')!;
    name.oninput = () => updateTrack(tr.id, { name: name.value });
  };

  const draw = () => {
    opts.setTitle(t('tracks'));
    const tr = editing ? trackById(editing) : undefined;
    if (editing && !tr) editing = null;
    if (tr) drawEdit(tr); else drawList();
    drawn = signature();
  };

  body.onclick = (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLButtonElement>('.mtool-list button[data-id]');
    if (item) {
      editing = item.dataset.id!;
      const tr = trackById(editing);
      if (tr && !tr.hidden) fit(tr);
      draw();
      return;
    }
    const color = target.closest<HTMLButtonElement>('.mk-color');
    if (color && editing) { updateTrack(editing, { color: color.dataset.color as MarkColor }); draw(); return; }
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    const tr = editing ? trackById(editing) : undefined;
    if (act === 'back') { editing = null; draw(); }
    else if (act === 'rec') {
      if (!startRecording()) { toast(t('markNoGps'), { ms: 6000 }); return; }
      opts.locate();
      draw();
    }
    else if (act === 'stop') {
      void stopRecording().then((done) => {
        toast(done ? t('trackSaved').replace('{len}', stats(done)) : t('trackTooShort'), { ms: 6000 });
        draw();
      });
    }
    else if (act === 'import') body.querySelector<HTMLInputElement>('.mk-file-input')?.click();
    else if (tr && act === 'show') { if (tr.hidden) updateTrack(tr.id, { hidden: false }); fit(tr); draw(); }
    else if (tr && act === 'hide') { updateTrack(tr.id, { hidden: !tr.hidden }); draw(); }
    else if (tr && act === 'export') download(gpxFile(tr));
    else if (tr && act === 'share') shareFile(gpxFile(tr), tr.name);
    else if (tr && act === 'delete') {
      if (!confirm(t('trackConfirmDelete').replace('{name}', tr.name || t('trackDefault')))) return;
      editing = null;
      deleteTrack(tr.id);
      draw();
    }
  };

  // Під час запису зміни приходять з кожною точкою GPS: оновлюємо лише рядок стану. Увесь список перемальовуємо,
  // коли змінився його склад; поля редагування не чіпаємо, щоб не збити набирання назви.
  const off = onTracksChange(() => {
    const live = body.querySelector<HTMLElement>('.tr-live');
    if (live) live.textContent = liveText();
    const tr = editing ? trackById(editing) : undefined;
    const info = body.querySelector<HTMLElement>('.tr-info');
    if (tr && info) info.textContent = infoText(tr);
    if (editing ? !tr : signature() !== drawn) draw();
  });
  draw();
  // перше відкриття: шляхи ще можуть читатися зі сховища — список перемалюється сам, коли прочитаються
  void loadTracks();
  return {
    refresh: draw,
    dispose() { off(); body.onclick = null; },
  };
}
