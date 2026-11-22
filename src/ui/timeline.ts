import { periods } from '../data';
import { formatYear, lt, t } from '../i18n';

/** Кроків повзунка на один період: кожен період займає однакову ширину незалежно від тривалості. */
const STEPS = 100;
const NOW = new Date().getFullYear();

let position = 0; // положення повзунка між перемальовуваннями

function yearAt(pos: number): { periodIndex: number; year: number } {
  const i = Math.min(periods.length - 1, Math.floor(pos / STEPS));
  const p = periods[i];
  const to = p.to ?? NOW;
  const frac = (pos - i * STEPS) / STEPS;
  return { periodIndex: i, year: Math.round(p.from + (to - p.from) * frac) };
}

/**
 * Повзунок за роками: назва періоду з роком і сам повзунок; ліворуч кнопка «Усі періоди» — лише коли
 * період вибрано (повернутися до всіх). Поки показано всі періоди, замість назви періоду стоїть підказка.
 * Переміщення в межах періоду змінює лише рік у підписі; перехід межі періоду перемикає період.
 */
/** Поточний рік повзунка (для шару кордонів). */
export function currentYear(): number {
  return yearAt(position).year;
}

export function renderTimeline(el: HTMLElement, current: string | null, onChange: (id: string | null) => void, onYear?: (year: number) => void): void {
  const idx = current ? periods.findIndex((p) => p.id === current) : -1;
  if (idx >= 0 && Math.floor(position / STEPS) !== idx) position = idx * STEPS + STEPS / 2;
  const max = periods.length * STEPS - 1;
  el.innerHTML = `
    ${current === null ? '' : `<button class="tl-all">${t('allPeriods')}</button>`}
    <div class="tl-main">
      <div class="tl-label"></div>
      <input class="tl-range" type="range" min="0" max="${max}" step="1" value="${current === null ? 0 : Math.round(position)}" aria-label="timeline" />
      <div class="tl-ticks">${periods.map((p) => `<span style="--c:${p.color}" title="${lt(p.name)}"></span>`).join('')}</div>
    </div>`;
  const label = el.querySelector<HTMLElement>('.tl-label')!;
  const range = el.querySelector<HTMLInputElement>('.tl-range')!;
  const all = el.querySelector<HTMLButtonElement>('.tl-all');

  const paint = (pos: number) => {
    const { periodIndex, year } = yearAt(pos);
    const p = periods[periodIndex];
    label.innerHTML = `<span class="dot" style="background:${p.color}"></span><b>${lt(p.name)}</b> <span class="yr">${formatYear(year)}</span>`;
    el.style.setProperty('--c', p.color);
    range.style.setProperty('--c', p.color);
  };
  if (current === null) {
    // показано всі періоди: рік і назва періоду тут лише збивали б з пантелику, тому й бігунок стоїть на початку
    label.innerHTML = `<b>${t('allPeriods')}</b> <span class="yr">· ${t('tlHint')}</span>`;
    el.style.removeProperty('--c');
    range.style.removeProperty('--c');
  } else {
    paint(position);
  }
  el.classList.toggle('tl-all-mode', current === null);

  range.oninput = () => {
    position = Number(range.value);
    paint(position);
    const { periodIndex, year } = yearAt(position);
    const id = periods[periodIndex].id;
    if (id !== current) onChange(id);
    else onYear?.(year);
  };
  if (all) all.onclick = () => onChange(null);
}
