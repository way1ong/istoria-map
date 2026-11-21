import { toolById, tools, toolsDoc } from '../data';
import { lt, t } from '../i18n';
import type { Tool, ToolUser } from '../types';
import { IMG_FALLBACK, md, photos, sourcesList, thumbUrl } from '../ui/render';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const userLabel = (u: ToolUser) => t(u === 'detectorist' ? 'forDetectorist' : 'forArchaeologist');
const userBadges = (users: ToolUser[]) => users.map((u) => `<span class="who who-${u}">${esc(userLabel(u))}</span>`).join('');

// Прев'ю в списку: стандартна мініатюра 330 px; якщо її немає, браузер бере оригінал.
function thumb(x: Tool): string {
  const ph = x.photos?.[0];
  if (!ph) return '<div class="tool-thumb tool-thumb-empty" aria-hidden="true"></div>';
  return `<img class="tool-thumb" crossorigin="anonymous" src="${esc(thumbUrl(ph.url, 330))}" data-orig="${esc(ph.url)}" onerror="${IMG_FALLBACK}" alt="${esc(lt(ph.caption) || lt(x.name))}" loading="lazy" />`;
}

/** #/tools і #/tools?for=detectorist|archaeologist */
export function toolsIndex(audience?: ToolUser): string {
  const chip = (a: ToolUser | undefined, label: string) =>
    `<a class="chip${a === audience ? ' active' : ''}" href="#/tools${a ? `?for=${a}` : ''}">${esc(label)}</a>`;
  const sections = toolsDoc.categories
    .map((c, i) => {
      const list = tools.filter((x) => x.category === c.id && (!audience || x.users.includes(audience)));
      if (!list.length) return '';
      const cards = list
        .map(
          (x) => `<a class="tool-card" href="#/tool/${x.id}">${thumb(x)}<div class="tool-body">
            <strong>${esc(lt(x.name))}</strong><p>${esc(lt(x.summary))}</p><div class="who-row">${userBadges(x.users)}</div></div></a>`,
        )
        .join('');
      return `<h2>${i + 1}. ${esc(lt(c.name))}</h2><p class="cat-summary">${esc(lt(c.summary))}</p><div class="tool-grid">${cards}</div>`;
    })
    .join('');
  return `<h1>${t('tabTools')}</h1><p>${esc(lt(toolsDoc.intro))}</p>
    <div class="chips">${chip(undefined, t('toolsAll'))}${chip('detectorist', t('forDetectorist'))}${chip('archaeologist', t('forArchaeologist'))}</div>
    ${sections}`;
}

/** #/tool/:id */
export function toolPage(id: string): string {
  const x = toolById(id);
  if (!x) return `<p class="empty">${t('notFound')}</p>`;
  const ci = toolsDoc.categories.findIndex((c) => c.id === x.category);
  const cat = toolsDoc.categories[ci];
  const i = tools.indexOf(x);
  const prev = tools[i - 1];
  const next = tools[i + 1];
  const nav = `<div class="tool-nav">${prev ? `<a href="#/tool/${prev.id}">← ${esc(lt(prev.name))}</a>` : '<span></span>'}${
    next ? `<a href="#/tool/${next.id}">${esc(lt(next.name))} →</a>` : ''
  }</div>`;
  return `<a class="back" href="#/tools">← ${t('tabTools')}</a>
    <h1>${esc(lt(x.name))}</h1>
    <div class="meta">${cat ? `<span class="badge cat-badge">${ci + 1}. ${esc(lt(cat.name))}</span>` : ''}${userBadges(x.users)}</div>
    <p class="lead">${esc(lt(x.summary))}</p>
    ${x.description ? `<div class="prose">${md(lt(x.description))}</div>` : ''}
    ${photos(x.photos)}
    ${sourcesList(x.sources)}
    ${nav}`;
}
