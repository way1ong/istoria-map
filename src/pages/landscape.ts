import { landscapeText } from '../data';
import { getLang, t } from '../i18n';
import { md } from '../ui/render';

/** Розділ «Ландшафт»: текст data/landscape/<lang>.md. Перший рядок «# …» стає заголовком сторінки. */
export function landscapePage(): string {
  const text = landscapeText(getLang()) ?? '';
  const m = /^# (.*)\n?/.exec(text);
  const title = m ? m[1] : t('tabLandscape');
  return `
    <h1>${title}</h1>
    <label class="jump"><span>${t('landscapeJump')}:</span> <select class="jump-select"></select></label>
    <div class="prose landscape">${md(text)}</div>`;
}

/** Поле «Перейти до» з підзаголовків тексту: вибір прокручує сторінку до розділу. */
export function mountLandscape(page: HTMLElement): void {
  const heads = [...page.querySelectorAll<HTMLHeadingElement>('.landscape h2')];
  const sel = page.querySelector<HTMLSelectElement>('.jump-select');
  const box = page.querySelector<HTMLElement>('.jump');
  if (!sel || !box) return;
  if (heads.length < 2) { box.hidden = true; return; }
  heads.forEach((h, i) => { h.id = `sec-${i}`; });
  sel.innerHTML = heads.map((h, i) => `<option value="${i}">${h.textContent ?? ''}</option>`).join('');
  sel.onchange = () => heads[Number(sel.value)]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
