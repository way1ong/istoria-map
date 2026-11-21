// Перегляд фото на весь екран: натискання на фото з атрибутом data-lb (стрічка в картці на мапі, фото на сторінках
// місць і подій). Фото однієї картки (однаковий data-lb) гортаються стрілками, свайпом чи клавішами ← →;
// закривається хрестиком, натисканням на тло, Esc або кнопкою «Назад» телефона.
import { t } from '../i18n';

interface Item { src: string; orig: string; cap: string; page: string }
let box: HTMLElement | null = null;
let items: Item[] = [];
let idx = 0;
let lastFocus: HTMLElement | null = null;

function ensureBox(): HTMLElement {
  if (box) return box;
  const el = document.createElement('div');
  el.className = 'lb';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<button type="button" class="lb-close">×</button>
    <button type="button" class="lb-prev">‹</button>
    <img class="lb-img" crossorigin="anonymous" alt="" />
    <button type="button" class="lb-next">›</button>
    <div class="lb-cap"><span class="lb-text"></span> <a class="lb-src" target="_blank" rel="noopener"></a> <span class="lb-count"></span></div>`;
  document.body.appendChild(el);
  el.querySelector<HTMLButtonElement>('.lb-close')!.onclick = () => close();
  el.querySelector<HTMLButtonElement>('.lb-prev')!.onclick = (e) => { e.stopPropagation(); show(idx - 1); };
  el.querySelector<HTMLButtonElement>('.lb-next')!.onclick = (e) => { e.stopPropagation(); show(idx + 1); };
  // натискання на темне тло (не на фото, підпис чи кнопки) закриває перегляд
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  // свайп ліворуч / праворуч
  let x0: number | null = null;
  el.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  el.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50 && items.length > 1) show(idx + (dx < 0 ? 1 : -1));
  });
  const img = el.querySelector<HTMLImageElement>('.lb-img')!;
  img.onerror = () => {
    // мініатюри немає — оригінал без CORS
    const it = items[idx];
    if (it && img.src !== it.orig) { img.removeAttribute('crossorigin'); img.src = it.orig; }
  };
  box = el;
  return el;
}

function show(i: number) {
  const el = ensureBox();
  idx = (i + items.length) % items.length;
  const it = items[idx];
  const img = el.querySelector<HTMLImageElement>('.lb-img')!;
  img.setAttribute('crossorigin', 'anonymous');
  img.src = it.src;
  img.alt = it.cap;
  el.querySelector('.lb-text')!.textContent = it.cap;
  const a = el.querySelector<HTMLAnchorElement>('.lb-src')!;
  a.textContent = t('photoSource');
  a.hidden = !it.page;
  if (it.page) a.href = it.page;
  el.querySelector('.lb-count')!.textContent = items.length > 1 ? `${idx + 1} / ${items.length}` : '';
  for (const b of el.querySelectorAll<HTMLElement>('.lb-prev, .lb-next')) b.hidden = items.length < 2;
}

function open(target: HTMLImageElement) {
  const group = target.dataset.lb!;
  // фото тієї самої картки в тому самому блоці (картка на мапі чи сторінка), у порядку на екрані
  const scope = target.closest('#sheet, #page, .anim, main') ?? document;
  const list = [...scope.querySelectorAll<HTMLImageElement>('img[data-lb]')].filter((x) => x.dataset.lb === group);
  items = list.map((x) => ({ src: x.currentSrc || x.getAttribute('src') || '', orig: x.dataset.orig ?? '', cap: x.dataset.lbCap ?? '', page: x.dataset.lbSrc ?? '' }));
  const el = ensureBox();
  el.querySelector<HTMLButtonElement>('.lb-close')!.ariaLabel = t('close');
  el.querySelector<HTMLButtonElement>('.lb-prev')!.ariaLabel = t('lbPrev');
  el.querySelector<HTMLButtonElement>('.lb-next')!.ariaLabel = t('lbNext');
  lastFocus = target;
  show(Math.max(0, list.indexOf(target)));
  el.hidden = false;
  // кнопка «Назад» телефона закриває перегляд, а не сторінку
  history.pushState({ lb: true }, '');
  el.querySelector<HTMLButtonElement>('.lb-close')!.focus();
}

function close(fromHistory = false) {
  if (!box || box.hidden) return;
  box.hidden = true;
  if (!fromHistory && (history.state as { lb?: boolean } | null)?.lb) history.back();
  lastFocus?.focus();
}

document.addEventListener('click', (e) => {
  const img = (e.target as HTMLElement).closest<HTMLImageElement>('img[data-lb]');
  if (img) { e.preventDefault(); open(img); }
});
document.addEventListener('keydown', (e) => {
  if (box && !box.hidden) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') show(idx - 1);
    else if (e.key === 'ArrowRight') show(idx + 1);
    return;
  }
  const img = (e.target as HTMLElement).closest?.<HTMLImageElement>('img[data-lb]');
  if (img && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(img); }
});
window.addEventListener('popstate', () => close(true));
