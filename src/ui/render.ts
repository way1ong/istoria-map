import { marked } from 'marked';
import { periodById } from '../data';
import { formatYear, lt, t } from '../i18n';
import type { CoordsPrecision, DatePrecision, HistEvent, Photo, Place, Source } from '../types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/**
 * Markdown → HTML. Підтримує прості виноски: посилання `[^1]` у тексті
 * та визначення `[^1]: ...` на окремих рядках (виносяться в список унизу).
 * Перший заголовок `# ...` відкидається, бо сторінка вже має заголовок.
 */
export function md(text: string | undefined): string {
  if (!text) return '';
  const notes: string[] = [];
  const body = text
    .replace(/^# .*\n?/, '')
    .split('\n')
    .filter((line) => {
      const m = line.match(/^\[\^(\w+)\]:\s*(.*)$/);
      if (m) { notes.push(`<li id="fn-${m[1]}">${m[2]}</li>`); return false; }
      return true;
    })
    .join('\n')
    .replace(/\[\^(\w+)\]/g, '<sup><a href="#fn-$1">$1</a></sup>');
  const html = marked.parse(body, { async: false }) as string;
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

export function photos(list: Photo[] | undefined): string {
  if (!list?.length) return '';
  return list
    .map(
      (p) => `<figure><img src="${esc(p.url)}" alt="${esc(lt(p.caption) || '')}" loading="lazy" />
      <figcaption>${lt(p.caption) ? esc(lt(p.caption)) + '. ' : ''}${t('photoBy')}: ${esc(p.author)}, ${t('license')}: ${
        p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${esc(p.license)}</a>` : esc(p.license)
      } (<a href="${esc(p.source)}" target="_blank" rel="noopener">source</a>)</figcaption></figure>`,
    )
    .join('');
}

export function coordsLine(coords: [number, number], precision: CoordsPrecision): string {
  const [lon, lat] = coords;
  return `${t('coords')}: ${lat.toFixed(precision === 'exact' ? 5 : 3)}, ${lon.toFixed(precision === 'exact' ? 5 : 3)} (${precisionLabel(precision)})`;
}

export function placeCard(p: Place, full: boolean): string {
  return `
    <h2>${esc(lt(p.name))}</h2>
    <div class="meta">${periodBadges(p.periods)}</div>
    <p>${esc(lt(p.summary))}</p>
    ${full ? `<div class="prose">${md(lt(p.description))}</div>${photos(p.photos)}` : ''}
    <p class="meta">${coordsLine(p.coords, p.coordsPrecision)}</p>
    ${full ? sourcesList(p.sources) : `<a class="btn" href="#/place/${p.id}">${t('openCard')}</a>`}
  `;
}

export function eventDate(e: HistEvent): string {
  const d = e.date;
  return `${d.from}${d.to ? `–${d.to}` : ''} (${precisionLabel(d.precision)})`;
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
