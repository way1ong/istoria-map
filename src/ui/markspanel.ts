// Панель «Мої мітки»: власні прапорці людини на мапі (src/marks.ts). Список міток і редагування однієї:
// назва, нотатка, колір, маршрут, перенесення, видалення; вивантаження у файл GeoJSON і завантаження з файлу.
import type { Map as MLMap } from 'maplibre-gl';
import { fmtDateTime, t, type Key } from '../i18n';
import { addMark, deleteMark, exportMarks, flagSvg, importMarks, MARK_COLORS, markById, marks, onMarksChange, updateMark, type Mark } from '../marks';
import { routeAttrs } from './render';
import { toast } from './toast';
import { canShareFile, download, shareFile } from './files';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const fmtWhen = fmtDateTime;
const coordsText = (m: Mark) => `${m.lat.toFixed(5)}, ${m.lon.toFixed(5)}`;

function fileName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `istoria-mitky-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.geojson`;
}
const exportFile = () => new File([exportMarks()], fileName(), { type: 'application/geo+json' });

export interface MarksPanel {
  /** Відкрити редагування мітки. */
  edit(id: string): void;
  /** Перемалювати (змінилась мова). */
  refresh(): void;
  dispose(): void;
}

export function renderMarks(body: HTMLElement, opts: { map: MLMap; setTitle(s: string): void; editId?: string | null }): MarksPanel {
  const { map } = opts;
  let editing: string | null = opts.editId ?? null;
  let locating = false;

  const flyTo = (m: Mark) => map.flyTo({ center: [m.lon, m.lat], zoom: Math.max(map.getZoom(), 15), duration: 700 });

  const drawList = () => {
    opts.setTitle(t('marks'));
    const list = marks();
    body.innerHTML = `
      <div class="off-btns mk-add">
        <button type="button" class="off-btn primary" data-act="here" ${locating ? 'disabled' : ''}>${flagSvg('red', 16)} ${esc(t(locating ? 'markLocating' : 'markHere'))}</button>
        <button type="button" class="off-btn" data-act="center">${esc(t('markCenter'))}</button>
      </div>
      <p class="mtool-note">${esc(t('markHint'))}</p>
      ${list.length ? `<ul class="mtool-list">${list.map((m) => `
        <li><button type="button" data-id="${esc(m.id)}">
          ${flagSvg(m.color, 20)}
          <span class="txt"><span class="nm">${esc(m.name || t('markDefault'))}</span><span class="sub">${esc([fmtWhen(m.created), m.note.replace(/\s+/g, ' ').slice(0, 60)].filter(Boolean).join(' · '))}</span></span>
        </button></li>`).join('')}</ul>` : `<p class="mtool-empty">${esc(t('markEmpty'))}</p>`}
      <div class="off-btns mk-file">
        <button type="button" class="off-btn" data-act="export" ${list.length ? '' : 'disabled'}>${esc(t('markExport'))}</button>
        ${list.length && canShareFile(exportFile()) ? `<button type="button" class="off-btn" data-act="share">${esc(t('markShare'))}</button>` : ''}
        <button type="button" class="off-btn" data-act="import">${esc(t('markImport'))}</button>
        <input type="file" class="mk-file-input" accept=".geojson,.json,application/geo+json,application/json" hidden />
      </div>
      ${list.length ? `<p class="mtool-note">${esc(t('markCount').replace('{n}', String(list.length)))}</p>` : ''}`;
    body.querySelector<HTMLInputElement>('.mk-file-input')!.onchange = (e) => {
      const input = e.target as HTMLInputElement;
      const f = input.files?.[0];
      input.value = '';
      if (!f) return;
      void f.text().then((text) => {
        try {
          const r = importMarks(text);
          toast(t('markImported').replace('{n}', String(r.added)).replace('{m}', String(r.skipped)), { ms: 6000 });
        } catch {
          toast(t('markImportBad'), { ms: 6000 });
        }
      });
    };
  };

  const drawEdit = (m: Mark) => {
    opts.setTitle(t('marks'));
    body.innerHTML = `
      <button type="button" class="mk-back" data-act="back">‹ ${esc(t('markAll'))}</button>
      <label class="mk-field"><span>${esc(t('markName'))}</span><input class="mtool-input mk-name" type="text" maxlength="120" autocomplete="off" value="${esc(m.name)}" /></label>
      <label class="mk-field"><span>${esc(t('markNote'))}</span><textarea class="mtool-input mk-note" rows="3" maxlength="4000" placeholder="${esc(t('markNotePh'))}">${esc(m.note)}</textarea></label>
      <div class="mk-colors" role="group" aria-label="${esc(t('markColor'))}">${MARK_COLORS.map((c) => `<button type="button" class="mk-color ${c === m.color ? 'on' : ''}" data-color="${c}" aria-label="${esc(t(`markColor_${c}` as Key))}" aria-pressed="${c === m.color}">${flagSvg(c, 24)}</button>`).join('')}</div>
      <p class="mtool-note mk-info">${esc(coordsText(m))} · ${esc(fmtWhen(m.created))}${m.acc !== undefined ? ` · ${esc(t('markAcc').replace('{n}', String(m.acc)))}` : ''}</p>
      <div class="off-btns">
        <button type="button" class="off-btn" data-act="show">${esc(t('markShow'))}</button>
        <a class="off-btn mk-route" ${routeAttrs(m.lat, m.lon, m.name)}>${esc(t('routeHere'))}</a>
        <button type="button" class="off-btn" data-act="move">${esc(t('markMove'))}</button>
        <button type="button" class="off-btn mk-del" data-act="delete">${esc(t('markDelete'))}</button>
      </div>`;
    // назва й нотатка зберігаються під час набирання: кнопки «Зберегти» немає
    const name = body.querySelector<HTMLInputElement>('.mk-name')!;
    const note = body.querySelector<HTMLTextAreaElement>('.mk-note')!;
    name.oninput = () => updateMark(m.id, { name: name.value });
    note.oninput = () => updateMark(m.id, { note: note.value });
  };

  const draw = () => {
    const m = editing ? markById(editing) : undefined;
    if (editing && !m) editing = null;
    if (m) drawEdit(m); else drawList();
  };

  body.onclick = (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLButtonElement>('.mtool-list button[data-id]');
    if (item) {
      editing = item.dataset.id!;
      const m = markById(editing);
      if (m) flyTo(m);
      draw();
      return;
    }
    const color = target.closest<HTMLButtonElement>('.mk-color');
    if (color && editing) { updateMark(editing, { color: color.dataset.color as Mark['color'] }); draw(); return; }
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    const m = editing ? markById(editing) : undefined;
    if (act === 'back') { editing = null; draw(); }
    else if (act === 'center') { const c = map.getCenter(); editing = addMark([c.lng, c.lat]).id; draw(); }
    else if (act === 'here') {
      if (!('geolocation' in navigator)) { toast(t('markNoGps'), { ms: 6000 }); return; }
      locating = true;
      draw();
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          locating = false;
          const mk = addMark([pos.coords.longitude, pos.coords.latitude], { acc: pos.coords.accuracy });
          editing = mk.id;
          flyTo(mk);
          draw();
        },
        () => { locating = false; toast(t('markNoGps'), { ms: 6000 }); draw(); },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 },
      );
    }
    else if (act === 'export') download(exportFile());
    else if (act === 'share') shareFile(exportFile(), t('marks'));
    else if (act === 'import') body.querySelector<HTMLInputElement>('.mk-file-input')?.click();
    else if (m && act === 'show') flyTo(m);
    else if (m && act === 'move') { const c = map.getCenter(); updateMark(m.id, { lon: c.lng, lat: c.lat, acc: undefined }); draw(); }
    else if (m && act === 'delete') {
      if (!confirm(t('markConfirmDelete').replace('{name}', m.name || t('markDefault')))) return;
      editing = null;
      deleteMark(m.id);
      draw();
    }
  };

  // список оновлюється сам (нова мітка довгим натисканням, файл); під час редагування поля не чіпаємо
  const off = onMarksChange(() => { if (!editing || !markById(editing)) draw(); });
  draw();
  return {
    edit(id) { editing = id; draw(); },
    refresh: draw,
    dispose() { off(); body.onclick = null; },
  };
}
