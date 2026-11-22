import { events, periodById, periods, placeById } from '../data';
import { formatYear, formatYearRange, getLang, lt, t } from '../i18n';
import { precisionLabel } from '../ui/render';
import type { HistEvent } from '../types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Числовий ключ дати «рік-місяць-день» (рік може бути від'ємним і без нулів попереду: «-0400», «324», «1241-04-11»). */
export function dateKey(s: string): number {
  const m = /^(-?)(\d{1,6})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(s.trim());
  if (!m) return Number.POSITIVE_INFINITY;
  const y = Number(m[2]) * (m[1] ? -1 : 1);
  const mo = m[3] ? Number(m[3]) : 0;
  const d = m[4] ? Number(m[4]) : 0;
  return y + (mo ? (mo - 1) / 12 : 0) + (d ? (d - 1) / 372 : 0);
}

/** Рік з дати події числом («-0400» → −400). */
function yearNum(s: string): number | null {
  const m = /^(-?)(\d{1,6})/.exec(s);
  return m ? Number(m[2]) * (m[1] ? -1 : 1) : null;
}

/** Рік для лівої колонки: «1241», «1526–1541», «400 до н. е.», «5480–5000 до н. е.». */
function yearLabel(e: HistEvent): string {
  const from = yearNum(e.date.from);
  if (from === null) return e.date.from;
  return formatYearRange(from, e.date.to ? yearNum(e.date.to) : null);
}

/** Повна дата з днем і місяцем, якщо вона відома (для підпису під назвою). */
function fullDate(s: string): string | null {
  const m = /^(-?)(\d{1,6})-(\d{2})(?:-(\d{2}))?/.exec(s);
  if (!m) return null;
  const i = Number(m[3]) - 1;
  if (!m[4]) return t('monthsNom').split(',')[i] ?? null;
  const day = Number(m[4]);
  const month = t('monthsGen').split(',')[i];
  if (!month) return null;
  return getLang() === 'hu' ? `${month} ${day}.` : `${day} ${month}`;
}

export function sortedEvents(list: HistEvent[] = events): HistEvent[] {
  return [...list].sort((a, b) => dateKey(a.date.from) - dateKey(b.date.from) || lt(a.title).localeCompare(lt(b.title)));
}

export function chronologyPage(periodId?: string): string {
  const all = sortedEvents();
  const period = periodId ? periodById(periodId) : undefined;
  const shown = period ? all.filter((e) => e.period === period.id) : all;
  const count = (id: string) => all.filter((e) => e.period === id).length;
  const chips = [`<a class="chip${period ? '' : ' active'}" href="#/chronology">${t('chronoAll')} (${all.length})</a>`]
    .concat(
      periods
        .filter((p) => count(p.id) > 0)
        .map((p) => `<a class="chip chip-period${period?.id === p.id ? ' active' : ''}" style="--c:${p.color}" href="#/chronology?period=${p.id}">${esc(lt(p.name))} (${count(p.id)})</a>`),
    )
    .join('');
  // межі переліку: рік початку першої події й найпізніший рік кінця
  const firstYear = shown.length ? yearNum(shown[0].date.from) : null;
  const lastYear = shown.reduce<number | null>((mx, e) => {
    const y = yearNum(e.date.to ?? e.date.from);
    return y !== null && (mx === null || y > mx) ? y : mx;
  }, null);
  const lead = shown.length && firstYear !== null && lastYear !== null
    ? t('chronoLead').replace('{n}', String(shown.length)).replace('{from}', formatYear(firstYear)).replace('{to}', formatYear(lastYear)).replace('..', '.')
    : t('chronoEmpty');

  const item = (e: HistEvent) => {
    const p = periodById(e.period);
    const pl = e.places.map((id) => placeById(id)).filter((x) => !!x);
    const day = fullDate(e.date.from);
    const prec = e.date.precision === 'exact' ? '' : `<span class="chrono-prec">${precisionLabel(e.date.precision)}</span>`;
    const where = pl.length
      ? `<a class="chrono-map" href="#/map?period=${e.period}&place=${pl[0]!.id}">📍 ${esc(lt(pl[0]!.name))}${pl.length > 1 ? ` +${pl.length - 1}` : ''}</a>`
      : '';
    return `<li class="chrono-item" style="--c:${p?.color ?? 'var(--muted)'}">
      <div class="chrono-year${/\d\u202f\d/.test(yearLabel(e)) ? ' long' : ''}">${esc(yearLabel(e))}</div>
      <div class="chrono-body">
        <a class="chrono-title" href="#/event/${e.id}">${esc(lt(e.title))}</a>
        <div class="chrono-meta">${day ? `<span>${esc(day)}</span>` : ''}${prec}${where}</div>
        <p>${esc(lt(e.summary))}</p>
      </div>
    </li>`;
  };

  // Без фільтра — групи за періодами (у порядку періодів), усередині — за датою.
  const groups = period
    ? [{ p: period, list: shown }]
    : periods.map((p) => ({ p, list: shown.filter((e) => e.period === p.id) })).filter((g) => g.list.length);
  const body = groups
    .map(
      (g) => `<section class="chrono-group" style="--c:${g.p.color}">
        ${period ? '' : `<h2><a href="#/chronology?period=${g.p.id}">${esc(lt(g.p.name))}</a></h2>`}
        <ol class="chrono">${g.list.map(item).join('')}</ol>
      </section>`,
    )
    .join('');

  return `
    <a class="back" href="#/history">← ${t('tabHistory')}</a>
    <h1>${t('chronology')}</h1>
    <p class="lead">${esc(lead)}</p>
    <nav class="chips chrono-filter" aria-label="${t('chronoFilter')}">${chips}</nav>
    ${period ? `<p class="chrono-period-link"><a href="#/period/${period.id}">${t('chronoPeriodText')}: ${esc(lt(period.name))} →</a></p>` : ''}
    ${body || `<p class="empty">${t('chronoEmpty')}</p>`}
  `;
}
