import { marked } from 'marked';
import { illustrationById, periodById, placeById } from '../data';
import { formatYear, formatYearRange, getLang, groupYear, lt, t, type Key } from '../i18n';
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

/**
 * Слово перед іменем автора: «Фото» для світлин з мережі, «Автор» для власних зображень з public/photos/
 * (це вирізки старих мап, а не світлини).
 */
const byLabel = (p: Photo) => (/^https?:/.test(p.url) ? t('photoBy') : t('illBy'));
/** Підпис фото для перегляду на весь екран: опис, автор, ліцензія (by — «Фото» чи «Автор» для малюнків і мап). */
const photoCredit = (p: Photo, by = byLabel(p)) => `${lt(p.caption) ? `${lt(p.caption)}. ` : ''}${by}: ${p.author}, ${t('license')}: ${p.license}`;
/** Атрибути, за якими фото відкривається на весь екран (src/ui/lightbox.ts); group — фото однієї картки. */
const lbAttrs = (p: Photo, group: string, by?: string) =>
  `data-lb="${esc(group)}" data-lb-cap="${esc(photoCredit(p, by))}" data-lb-src="${esc(p.source)}" tabindex="0" role="button"`;

/** Фото з підписом, автором і ліцензією; натискання відкриває перегляд на весь екран (група group). */
function figure(p: Photo, group: string, cls = '', by = byLabel(p)): string {
  return `<figure${cls ? ` class="${cls}"` : ''}><img crossorigin="anonymous" src="${esc(thumbUrl(p.url))}" data-orig="${esc(p.url)}" onerror="${IMG_FALLBACK}" alt="${esc(lt(p.caption) || '')}" loading="lazy" ${lbAttrs(p, group, by)} />
      <figcaption>${lt(p.caption) ? esc(lt(p.caption)) + '. ' : ''}${esc(by)}: ${esc(p.author)}, ${t('license')}: ${
        p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${esc(p.license)}</a>` : esc(p.license)
      } (<a href="${esc(p.source)}" target="_blank" rel="noopener">${t('photoSource')}</a>)</figcaption></figure>`;
}

export function photos(list: Photo[] | undefined, group = 'page'): string {
  if (!list?.length) return '';
  return list.map((p) => figure(p, group)).join('');
}

/**
 * Ілюстрації в текстах (розділи «Історія» й «Ландшафт»): рядок `![](id)` з id з data/illustrations.json стає
 * фото чи малюнком з підписом, автором і ліцензією. Підпис — з опису ілюстрації мовою інтерфейсу, або текст у
 * квадратних дужках, якщо його вписано: `![Інший підпис](id)`. Усі ілюстрації сторінки гортаються разом.
 */
marked.use({
  renderer: {
    image({ href, text }) {
      const ill = illustrationById(href);
      if (!ill) return false;
      const p: Photo = { ...ill, author: typeof ill.author === 'string' ? ill.author : lt(ill.author) };
      // серед ілюстрацій є малюнки й старі мапи, тож підпис «Автор», а не «Фото»
      return figure(text.trim() ? { ...p, caption: { uk: text.trim() } } : p, 'text', 'txt-fig', t('illBy'));
    },
    paragraph({ tokens }) {
      // абзац лише з ілюстрацій — без <p>: <figure> усередині абзацу не допускається
      const only = tokens.length > 0 && tokens.every((x) => (x.type === 'image' && !!illustrationById(x.href)) || ((x.type === 'text' || x.type === 'br') && !x.raw.trim()));
      return only ? this.parser.parseInline(tokens) : false;
    },
  },
});

/**
 * Посилання «Маршрут сюди». На Android — адреса geo:, яку відкриває встановлений навігатор на вибір людини
 * (зокрема ті, що працюють без інтернету); деінде — маршрут у веб-мапах.
 */
export function routeHref(lat: number, lon: number, label = ''): string {
  const at = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  if (/Android/i.test(navigator.userAgent)) return `geo:${at}?q=${at}${label ? `(${encodeURIComponent(label.replace(/[()]/g, ' '))})` : ''}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${at}`;
}
/**
 * Атрибути посилання «Маршрут сюди»: веб-мапи відкриваються в новій вкладці, а адресу geo: телефон передає
 * навігаторові сам (нова вкладка тут лишалася б порожньою).
 */
export function routeAttrs(lat: number, lon: number, label = ''): string {
  const href = routeHref(lat, lon, label);
  return `href="${esc(href)}"${href.startsWith('geo:') ? '' : ' target="_blank" rel="noopener"'}`;
}

export function coordsLine(coords: [number, number], precision: CoordsPrecision): string {
  const [lon, lat] = coords;
  return `${t('coords')}: ${lat.toFixed(precision === 'exact' ? 5 : 3)}, ${lon.toFixed(precision === 'exact' ? 5 : 3)} (${precisionLabel(precision)})`;
}

/** Фото в картці на мапі: стрічка мініатюр, натискання відкриває фото на весь екран. */
function photoStrip(list: Photo[], group: string): string {
  return `<div class="ph-strip">${list.map((p) => `<img class="ph-thumb" crossorigin="anonymous" src="${esc(thumbUrl(p.url))}" data-orig="${esc(p.url)}" onerror="${IMG_FALLBACK}" alt="${esc(lt(p.caption) || '')}" loading="lazy" ${lbAttrs(p, group)} />`).join('')}</div>`;
}

/** Дата словами: «1799», «березень 1926», «5 березня 1971»; угорською «1971. március 5.». */
export function niceDate(s: string): string {
  const m = /^(-?)(\d{1,6})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(s);
  if (!m) return s;
  const year = m[1] ? formatYear(-Number(m[2])) : groupYear(Number(m[2]));
  if (!m[3]) return year;
  const i = Number(m[3]) - 1;
  const hu = getLang() === 'hu';
  if (!m[4]) {
    const mon = t('monthsNom').split(',')[i] ?? m[3];
    return hu ? `${year}. ${mon}` : `${mon} ${year}`;
  }
  const mon = t('monthsGen').split(',')[i] ?? m[3];
  return hu ? `${year}. ${mon} ${Number(m[4])}.` : `${Number(m[4])} ${mon} ${year}`;
}

/**
 * Відомості про знахідку (блок find у data/finds/*.json): коли і як знайдено, де зберігається, що означає мітка на мапі.
 * Мітка знахідки здебільшого стоїть у центрі населеного пункту — про це сказано словами, без числових координат.
 */
export function findFacts(p: Place): string {
  const f = p.find;
  if (!f) return '';
  const d = f.found;
  // «1799, випадково: копаючи рів» — рік, спосіб і примітка; чого джерела не кажуть, того в рядку немає
  const when = d.date ? `${niceDate(d.date)}${d.to ? `–${niceDate(d.to)}` : ''}${!d.precision || d.precision === 'exact' ? '' : ` (${precisionLabel(d.precision)})`}` : '';
  const head = [when, d.how ? t(`fh_${d.how}` as Key) : ''].filter(Boolean).join(', ');
  const found = [head, lt(d.note)].filter(Boolean).join(': ');
  const keepers = (f.keptAt ?? []).map((k) => {
    const link = k.place && placeById(k.place)
      ? `<a href="#/map?place=${esc(k.place)}">${t('findMuseumOnMap')}</a>`
      : k.coords ? `<a ${routeAttrs(k.coords[1], k.coords[0], lt(k.name))}>${t('findRouteMuseum')}</a>` : '';
    return `${esc(lt(k.name))}${lt(k.note) ? ` — ${esc(lt(k.note))}` : ''}${link ? ` (${link})` : ''}`;
  });
  const spot = `${t(`findSpot_${p.coordsPrecision}` as Key)}${lt(f.spotNote) ? `. ${lt(f.spotNote)}` : ''}`;
  const row = (dt: string, dd: string) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`;
  return `<dl class="find-facts">
    ${row(t('findFound'), esc(found))}
    ${keepers.length ? row(t('findKept'), keepers.length === 1 ? keepers[0] : `<ul>${keepers.map((k) => `<li>${k}</li>`).join('')}</ul>`) : ''}
    ${lt(f.fate) ? row(t('findFate'), esc(lt(f.fate))) : ''}
    ${!keepers.length && !lt(f.fate) ? row(t('findKept'), t('findKeptUnknown')) : ''}
    ${row(t('findSpot'), esc(spot))}
  </dl>`;
}

/**
 * Позначки знахідки поруч з періодом: вид (скарб, поховання…), «металошукач + музей» для знахідок пошуковців,
 * які працювали разом з музеєм, і «нині за кордоном» (short — коротко, для карток переліку).
 */
export function findBadges(p: Place, short = false): string {
  const f = p.find;
  if (!f) return '';
  return `<span class="badge cat-badge">${t(`fk1_${f.kind}` as Key)}</span> ${f.found.how === 'detector' ? `<span class="badge badge-det">${t('findDet')}</span> ` : ''}${
    f.abroad ? `<span class="badge badge-abroad">${t(short ? 'findAbroadShort' : 'findAbroad')}</span> ` : ''}`;
}

export function placeCard(p: Place, full: boolean): string {
  const f = p.find;
  // Знахідка: замість числових координат — пояснення, що означає мітка; «Маршрут сюди» лише тоді, коли місце
  // загальновідоме й відкрите (музей, пам'ятка): мітка в центрі села — це не місце знахідки.
  const exact = p.coordsPrecision === 'exact';
  return `
    <h2>${esc(lt(p.name))}</h2>
    <div class="meta">${p.vanished ? `<span class="badge badge-vanished">${t('vanished')}</span> ` : ''}${findBadges(p)}${periodBadges(p.periods)}</div>
    ${!full && p.photos?.length ? photoStrip(p.photos, `place-${p.id}`) : ''}
    <p>${esc(lt(p.summary))}</p>
    ${full ? `<div class="prose">${md(lt(p.description))}</div>${photos(p.photos, `place-${p.id}`)}` : ''}
    ${f ? findFacts(p) : ''}
    ${!f || exact ? `<p class="meta">${coordsLine(p.coords, p.coordsPrecision)}</p>` : ''}
    <div class="card-btns">${full ? '' : `<a class="btn" href="#/${f ? 'find' : 'place'}/${p.id}">${t('openCard')}</a>`}${!f || exact ? `<a class="btn btn-alt" ${routeAttrs(p.coords[1], p.coords[0], lt(p.name))}>${t('routeHere')}</a>` : ''}</div>
    ${full ? sourcesList(p.sources) : ''}
  `;
}

// Дата у форматі YYYY[-MM[-DD]] або -YYYY (до н. е.); рік без провідних нулів, до н. е. словами
function fmtDate(s: string): string {
  const m = /^(-?)(\d{1,6})(.*)$/.exec(s);
  if (!m) return s;
  const year = groupYear(Number(m[2]));
  if (!m[1]) return `${year}${m[3]}`;
  return getLang() === 'hu' ? `${t('bce')} ${year}${m[3]}` : `${year}${m[3]} ${t('bce')}`;
}

export function eventDate(e: HistEvent): string {
  const d = e.date;
  // обидва роки до н. е. без місяця й дня: позначка один раз («5480–5000 до н. е.»)
  const bare = /^-\d{1,6}$/;
  const range = d.to && bare.test(d.from) && bare.test(d.to) ? formatYearRange(Number(d.from), Number(d.to)) : `${fmtDate(d.from)}${d.to ? `–${fmtDate(d.to)}` : ''}`;
  return `${range} (${precisionLabel(d.precision)})`;
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
