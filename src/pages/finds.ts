import { findById, finds, findsDoc, periodById, periods } from '../data';
import { formatYear, lt, t, type Key } from '../i18n';
import { FIND_KINDS } from '../router';
import { shapeSvg } from '../shapes';
import type { Find, FindHow, FindKind } from '../types';
import { coordsLine, findBadges, findFacts, IMG_FALLBACK, md, periodBadges, photos, routeAttrs, sourcesList, thumbUrl } from '../ui/render';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

// Прев'ю в списку: стандартна мініатюра 330 px; якщо її немає, браузер бере оригінал.
// Знахідка без фото — значок мітки (косий хрест) кольором її періоду, як на мапі.
function thumb(x: Find): string {
  const ph = x.photos?.[0];
  if (!ph) {
    const c = periodById(x.periods[0])?.color ?? '#6b7280';
    return `<div class="tool-thumb find-thumb-empty" style="--c:${c}" aria-hidden="true">${shapeSvg('xmark', c, false, 46)}</div>`;
  }
  return `<img class="tool-thumb" crossorigin="anonymous" src="${esc(thumbUrl(ph.url, 330))}" data-orig="${esc(ph.url)}" onerror="${IMG_FALLBACK}" alt="${esc(lt(ph.caption) || lt(x.name))}" loading="lazy" />`;
}

const href = (kind?: FindKind, period?: string, how?: FindHow) => {
  const q = [kind ? `kind=${kind}` : '', period ? `period=${period}` : '', how ? `how=${how}` : ''].filter(Boolean).join('&');
  return `#/finds${q ? `?${q}` : ''}`;
};

/** Вступ: перший абзац видно одразу, решта (про мітки на мапі й правила) розгортається — на телефоні перелік ближче. */
function intro(): string {
  const [head, ...rest] = lt(findsDoc.intro).split(/\n\s*\n/);
  return `<div class="prose finds-intro">${md(head)}${rest.length ? `<details><summary>${t('findsMore')}</summary>${md(rest.join('\n\n'))}</details>` : ''}</div>`;
}

/** #/finds, #/finds?kind=hoard|coins|burial|ritual|object|remains&period=<id>&how=detector */
export function findsIndex(kind?: FindKind, periodId?: string, how?: FindHow): string {
  const period = periodId ? periodById(periodId) : undefined;
  const inPeriod = (x: Find) => !period || x.periods.includes(period.id);
  const ofKind = (x: Find) => !kind || x.find.kind === kind;
  const byHow = (x: Find) => !how || x.find.found.how === how;
  const shown = finds.filter((x) => inPeriod(x) && ofKind(x) && byHow(x));
  const n = (f: (x: Find) => boolean) => finds.filter(f).length;

  // Фішки показують лише те, чим можна скористатися: види й періоди, для яких за рештою умов є хоч одна знахідка
  // (і ту, що вже вибрана, — щоб її можна було зняти); число — скільки знахідок вона дасть.
  const chip = (cls: string, active: boolean, to: string, label: string, count: number, style = '') =>
    count > 0 || active ? `<a class="chip${cls}${active ? ' active' : ''}"${style} href="${to}">${esc(label)} (${count})</a>` : '';
  const kindChips = `<a class="chip${kind ? '' : ' active'}" href="${href(undefined, period?.id, how)}">${t('toolsAll')} (${n((x) => inPeriod(x) && byHow(x))})</a>`
    + FIND_KINDS.map((k) => chip('', kind === k, href(k, period?.id, how), t(`fk_${k}` as Key), n((x) => x.find.kind === k && inPeriod(x) && byHow(x)))).join('');
  // окрема фішка-перемикач: знахідки пошуковців з металошукачем, які працювали разом з музеєм
  const detChip = chip(' chip-det', how === 'detector', href(kind, period?.id, how === 'detector' ? undefined : 'detector'), t('findsDetChip'),
    n((x) => x.find.found.how === 'detector' && inPeriod(x) && ofKind(x)));
  const periodChips = `<a class="chip${period ? '' : ' active'}" href="${href(kind, undefined, how)}">${t('chronoAll')}</a>`
    + periods.map((p) => chip(' chip-period', period?.id === p.id, href(kind, p.id, how), lt(p.name), n((x) => x.periods.includes(p.id) && ofKind(x) && byHow(x)), ` style="--c:${p.color}"`)).join('');

  const card = (x: Find) => `<a class="tool-card" href="#/find/${x.id}">${thumb(x)}<div class="tool-body">
    <strong>${esc(lt(x.name))}</strong><p>${esc(lt(x.summary))}</p><div class="who-row">${findBadges(x, true)}</div></div></a>`;
  // Групи за періодом знахідки (першим у переліку periods), у порядку періодів; з вибраним періодом — одна група.
  const groups = (period ? [period] : periods)
    .map((p) => ({ p, list: shown.filter((x) => (period ? true : x.periods[0] === p.id)) }))
    .filter((g) => g.list.length);
  const body = groups
    .map((g) => `<h2 class="find-period" style="--c:${g.p.color}">${esc(lt(g.p.name))} <span>${formatYear(g.p.from)} – ${formatYear(g.p.to)}</span></h2><div class="tool-grid">${g.list.map(card).join('')}</div>`)
    .join('');

  return `<h1>${t('tabFinds')}</h1>
    ${intro()}
    <nav class="chips finds-kinds" aria-label="${t('findsKindLabel')}">${kindChips}${detChip}</nav>
    <nav class="chips chrono-filter finds-periods" aria-label="${t('findsPeriodLabel')}">${periodChips}</nav>
    <p class="lead">${esc(t('findsCount').replace('{n}', String(shown.length)))}</p>
    ${body || `<p class="empty">${t('findsEmpty')}</p>`}`;
}

/** #/find/:id */
export function findPage(id: string): string {
  const x = findById(id);
  if (!x) return `<p class="empty">${t('notFound')}</p>`;
  const i = finds.indexOf(x);
  const prev = finds[i - 1];
  const next = finds[i + 1];
  const nav = `<div class="tool-nav">${prev ? `<a href="#/find/${prev.id}">← ${esc(lt(prev.name))}</a>` : '<span></span>'}${
    next ? `<a href="#/find/${next.id}">${esc(lt(next.name))} →</a>` : ''
  }</div>`;
  const exact = x.coordsPrecision === 'exact';
  return `<a class="back" href="#/finds">← ${t('tabFinds')}</a>
    <h1>${esc(lt(x.name))}</h1>
    <div class="meta">${findBadges(x)}${periodBadges(x.periods)}</div>
    <p class="lead">${esc(lt(x.summary))}</p>
    ${photos(x.photos, `place-${x.id}`)}
    ${findFacts(x)}
    ${exact ? `<p class="meta">${coordsLine(x.coords, x.coordsPrecision)}</p>` : ''}
    <div class="card-btns"><a class="btn" href="#/map?period=${x.periods[0]}&place=${x.id}">${t('showOnMap')}</a>${exact ? `<a class="btn btn-alt" ${routeAttrs(x.coords[1], x.coords[0], lt(x.name))}>${t('routeHere')}</a>` : ''}</div>
    ${x.description ? `<div class="prose">${md(lt(x.description))}</div>` : ''}
    ${sourcesList(x.sources)}
    ${nav}`;
}
