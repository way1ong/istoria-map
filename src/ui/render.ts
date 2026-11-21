import { marked } from 'marked';
import { periodById } from '../data';
import { formatYear, getLang, lt, t } from '../i18n';
import type { CoordsPrecision, DatePrecision, HistEvent, Photo, Place, Source } from '../types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Адреси у виносках: відкривати в новій вкладці, показувати без %-кодування. */
function footnoteHtml(text: string): string {
  return (marked.parseInline(text, { async: false }) as string).replace(
    /<a href="(https?:\/\/[^"]+)">([^<]*)<\/a>/g,
    (_, href: string, label: string) => {
      let shown = label;
      if (label === href) { try { shown = esc(decodeURI(href.replace(/&amp;/g, '&'))); } catch { /* лишити як є */ } }
      return `<a href="${href}" target="_blank" rel="noopener">${shown}</a>`;
    },
  );
}

/**
 * Markdown → HTML. Підтримує прості виноски: посилання `[^1]` чи `[^rk]` у тексті
 * та визначення `[^1]: ...` на окремих рядках (виносяться в список унизу).
 * Виноски нумеруються за першою появою в тексті, як на GitHub; кліки обробляє main.ts.
 * Перший заголовок `# ...` відкидається, бо сторінка вже має заголовок.
 */
export function md(text: string | undefined): string {
  if (!text) return '';
  const defs = new Map<string, string>();
  const order: string[] = [];
  const num = (id: string) => {
    if (!order.includes(id)) order.push(id);
    return order.indexOf(id) + 1;
  };
  const body = text
    .replace(/^# .*\n?/, '')
    .split('\n')
    .filter((line) => {
      const m = line.match(/^\[\^(\w+)\]:\s*(.*)$/);
      if (m) { defs.set(m[1], m[2]); return false; }
      return true;
    })
    .join('\n')
    // Кілька виносок поспіль ([^a][^b]) стають одним верхнім індексом «1, 2».
    .replace(/(?:\[\^\w+\])+/g, (group: string) => {
      const links = [...group.matchAll(/\[\^(\w+)\]/g)].map(([, id]) => `<a href="#fn-${id}">${num(id)}</a>`);
      return `<sup class="fnref">${links.join(', ')}</sup>`;
    });
  const html = marked.parse(body, { async: false }) as string;
  for (const id of defs.keys()) num(id);
  const notes = order
    .filter((id) => defs.has(id))
    .map((id) => `<li id="fn-${id}" value="${order.indexOf(id) + 1}">${footnoteHtml(defs.get(id) ?? '')} <a class="fn-back" href="#fn-back" title="${t('back')}">↑</a></li>`);
  return notes.length ? `${html}<hr /><ol class="sources footnotes">${notes.join('')}</ol>` : html;
}

export function precisionLabel(p: CoordsPrecision | DatePrecision): string {
  switch (p) {
    case 'exact': return t('precisionExact');
    case 'approximate': return t('precisionApproximate');
    case 'settlement': return t('precisionSettlement');
    case 'tradition': return t('precisionTradition');
  }
}

export function periodBadges(ids: string[]): string {
  return ids
    .map((id) => periodById(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => `<a class="badge" style="--c:${p.color}" href="#/period/${p.id}">${esc(lt(p.name))} · ${formatYear(p.from)}–${formatYear(p.to)}</a>`)
    .join(' ');
}

export function sourcesList(sources: Source[]): string {
  if (!sources?.length) return '';
  const items = sources
    .map((s) => {
      const title = s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title);
      return `<li>${title}${s.note ? ` — ${esc(s.note)}` : ''}</li>`;
    })
    .join('');
  return `<h2>${t('sources')}</h2><ol class="sources">${items}</ol>`;
}

// Оригінали з Commons бувають по кілька мегабайтів, а сервер оригіналів обмежує запити.
// Показуємо стандартну мініатюру 960 px (як у статтях Вікіпедії); якщо її немає
// (оригінал вужчий за 960 px), браузер підставляє оригінал з data-orig.
const COMMONS_ORIG = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)$/;
/**
 * Мініатюри вантажаться з CORS (crossorigin), щоб service worker міг зберегти їх для роботи без інтернету
 * (сервер мініатюр це дозволяє). Якщо мініатюри немає, беремо оригінал уже без CORS.
 */
export const IMG_FALLBACK = "this.onerror=null;this.removeAttribute('crossorigin');this.src=this.dataset.orig";

export function thumbUrl(url: string, width = 960): string {
  const m = COMMONS_ORIG.exec(url);
  if (!m) return url;
  const [, a, ab, name] = m;
  const lower = name.toLowerCase();
  const file = /\.tiff?$/.test(lower)
    ? `lossy-page1-${width}px-${name}.jpg`
    : lower.endsWith('.svg')
      ? `${width}px-${name}.png`
      : `${width}px-${name}`;
  return `https://thumb.wikimedia.org/wikipedia/commons/thumb/${a}/${ab}/${name}/${file}`;
}

/** Підпис фото для перегляду на весь екран: опис, автор, ліцензія. */
const photoCredit = (p: Photo) => `${lt(p.caption) ? `${lt(p.caption)}. ` : ''}${t('photoBy')}: ${p.author}, ${t('license')}: ${p.license}`;
/** Атрибути, за якими фото відкривається на весь екран (src/ui/lightbox.ts); group — фото однієї картки. */
const lbAttrs = (p: Photo, group: string) =>
  `data-lb="${esc(group)}" data-lb-cap="${esc(photoCredit(p))}" data-lb-src="${esc(p.source)}" tabindex="0" role="button"`;

export function photos(list: Photo[] | undefined, group = 'page'): string {
  if (!list?.length) return '';
  return list
    .map(
      (p) => `<figure><img crossorigin="anonymous" src="${esc(thumbUrl(p.url))}" data-orig="${esc(p.url)}" onerror="${IMG_FALLBACK}" alt="${esc(lt(p.caption) || '')}" loading="lazy" ${lbAttrs(p, group)} />
      <figcaption>${lt(p.caption) ? esc(lt(p.caption)) + '. ' : ''}${t('photoBy')}: ${esc(p.author)}, ${t('license')}: ${
        p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${esc(p.license)}</a>` : esc(p.license)
      } (<a href="${esc(p.source)}" target="_blank" rel="noopener">${t('photoSource')}</a>)</figcaption></figure>`,
    )
    .join('');
}

export function coordsLine(coords: [number, number], precision: CoordsPrecision): string {
  const [lon, lat] = coords;
  return `${t('coords')}: ${lat.toFixed(precision === 'exact' ? 5 : 3)}, ${lon.toFixed(precision === 'exact' ? 5 : 3)} (${precisionLabel(precision)})`;
}

/** Фото в картці на мапі: стрічка мініатюр, натискання відкриває фото на весь екран. */
function photoStrip(list: Photo[], group: string): string {
  return `<div class="ph-strip">${list.map((p) => `<img class="ph-thumb" crossorigin="anonymous" src="${esc(thumbUrl(p.url))}" data-orig="${esc(p.url)}" onerror="${IMG_FALLBACK}" alt="${esc(lt(p.caption) || '')}" loading="lazy" ${lbAttrs(p, group)} />`).join('')}</div>`;
}

export function placeCard(p: Place, full: boolean): string {
  return `
    <h2>${esc(lt(p.name))}</h2>
    <div class="meta">${p.vanished ? `<span class="badge badge-vanished">${t('vanished')}</span> ` : ''}${periodBadges(p.periods)}</div>
    ${!full && p.photos?.length ? photoStrip(p.photos, `place-${p.id}`) : ''}
    <p>${esc(lt(p.summary))}</p>
    ${full ? `<div class="prose">${md(lt(p.description))}</div>${photos(p.photos, `place-${p.id}`)}` : ''}
    <p class="meta">${coordsLine(p.coords, p.coordsPrecision)}</p>
    ${full ? sourcesList(p.sources) : `<a class="btn" href="#/place/${p.id}">${t('openCard')}</a>`}
  `;
}

// Дата у форматі YYYY[-MM[-DD]] або -YYYY (до н. е.); рік без провідних нулів, до н. е. словами
function fmtDate(s: string): string {
  const m = /^(-?)(\d{1,4})(.*)$/.exec(s);
  if (!m) return s;
  const year = String(Number(m[2]));
  if (!m[1]) return `${year}${m[3]}`;
  return getLang() === 'hu' ? `${t('bce')} ${year}${m[3]}` : `${year}${m[3]} ${t('bce')}`;
}

export function eventDate(e: HistEvent): string {
  const d = e.date;
  return `${fmtDate(d.from)}${d.to ? `–${fmtDate(d.to)}` : ''} (${precisionLabel(d.precision)})`;
}

export function eventCard(e: HistEvent): string {
  return `
    <h2>${esc(lt(e.title))}</h2>
    <div class="meta"><span>${t('date')}: ${esc(eventDate(e))}</span>${periodBadges([e.period])}</div>
    <p>${esc(lt(e.summary))}</p>
    <div class="prose">${md(lt(e.description))}</div>
    ${photos(e.photos)}
    ${sourcesList(e.sources)}
  `;
}
