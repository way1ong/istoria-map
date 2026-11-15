import { eventById, events, periodById, periodText, periods, placeById, places, routes, routesForEvent } from '../data';
import { formatYear, getLang, lt, t } from '../i18n';
import { eventCard, md, placeCard } from '../ui/render';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export function historyIndex(): string {
  const cards = periods
    .map(
      (p) => `<a href="#/period/${p.id}" style="--c:${p.color}">
        <strong>${esc(lt(p.name))}</strong><div class="years">${formatYear(p.from)} – ${formatYear(p.to)}</div>
        <p>${esc(lt(p.summary))}</p></a>`,
    )
    .join('');
  return `<h1>${t('tabHistory')}</h1><div class="card-list">${cards}</div>`;
}

export function periodPage(id: string): string {
  const p = periodById(id);
  if (!p) return `<p class="empty">${t('notFound')}</p>`;
  const text = periodText(id, getLang());
  const pl = places.filter((x) => x.periods.includes(id));
  const ev = events.filter((x) => x.period === id);
  const an = routes.filter((r) => r.animation?.event && r.features.some((f) => f.properties.period === id));
  const list = (items: { href: string; title: string; sub: string }[]) =>
    items.length
      ? `<div class="card-list">${items.map((i) => `<a href="${i.href}" style="--c:${p.color}"><strong>${esc(i.title)}</strong><p>${esc(i.sub)}</p></a>`).join('')}</div>`
      : '';
  return `
    <a class="back" href="#/history">← ${t('back')}</a>
    <h1>${esc(lt(p.name))}</h1>
    <div class="meta"><span class="badge" style="--c:${p.color}">${formatYear(p.from)} – ${formatYear(p.to)}</span></div>
    <p>${esc(lt(p.summary))}</p>
    <a class="btn" href="#/map?period=${p.id}">${t('showOnMap')}</a>
    <div class="prose">${text ? md(text) : `<p class="empty">${t('noText')}</p>`}</div>
    ${pl.length ? `<h2>${t('places')}</h2>` : ''}${list(pl.map((x) => ({ href: `#/place/${x.id}`, title: lt(x.name), sub: lt(x.summary) })))}
    ${ev.length ? `<h2>${t('events')}</h2>` : ''}${list(ev.map((x) => ({ href: `#/event/${x.id}`, title: lt(x.title), sub: lt(x.summary) })))}
    ${an.length ? `<h2>${t('animations')}</h2>` : ''}${list(an.map((x) => ({ href: `#/event/${x.animation!.event}`, title: lt(x.animation!.title), sub: lt(x.animation!.note) })))}
  `;
}

export function placePage(id: string): string {
  const p = placeById(id);
  if (!p) return `<p class="empty">${t('notFound')}</p>`;
  return `<a class="back" href="#/map?period=${p.periods[0]}&place=${p.id}">← ${t('showOnMap')}</a>${placeCard(p, true)}`;
}

export function eventPage(id: string): string {
  const e = eventById(id);
  if (!e) return `<p class="empty">${t('notFound')}</p>`;
  const back = e.places[0] ? `#/map?period=${e.period}&place=${e.places[0]}` : `#/map?period=${e.period}`;
  const anims = routesForEvent(id)
    .map((r, i) => `<section class="anim" data-anim="${i}"><h2>${t('animation')}: ${esc(lt(r.animation!.title))}</h2>${r.animation?.note ? `<p class="meta">${esc(lt(r.animation.note))}</p>` : ''}<div class="anim-host"></div>${r.features.some((f) => f.geometry.type === 'LineString') ? `<p class="meta">${t('reconstruction')}</p>` : ''}</section>`)
    .join('');
  return `<a class="back" href="${back}">← ${t('showOnMap')}</a>${eventCard(e)}${anims}`;
}
