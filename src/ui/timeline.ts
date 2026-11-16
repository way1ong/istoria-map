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
 * Повзунок за роками: ліворуч кнопка «Усі», далі назва періоду з роком і сам повзунок.
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
    <button class="tl-all ${current === null ? 'active' : ''}">${t('allPeriods')}</button>
    <div class="tl-main">
      <div class="tl-label"></div>
      <input class="tl-range" type="range" min="0" max="${max}" step="1" value="${Math.round(position)}" aria-label="timeline" />
      <div class="tl-ticks">${periods.map((p) => `<span style="--c:${p.color}" title="${lt(p.name)}"></span>`).join('')}</div>
    </div>`;
  const label = el.querySelector<HTMLElement>('.tl-label')!;
  const range = el.querySelector<HTMLInputElement>('.tl-range')!;
  const all = el.querySelector<HTMLButtonElement>('.tl-all')!;

  const paint = (pos: number) => {
    const { periodIndex, year } = yearAt(pos);
    const p = periods[periodIndex];
    label.innerHTML = `<span class="dot" style="background:${p.color}"></span><b>${lt(p.name)}</b> <span class="yr">${formatYear(year)}</span>`;
    el.style.setProperty('--c', p.color);
    range.style.setProperty('--c', p.color);
  };
  paint(position);
  if (current === null) el.classList.add('tl-all-mode'); else el.classList.remove('tl-all-mode');

  range.oninput = () => {
    position = Number(range.value);
    paint(position);
    const { periodIndex, year } = yearAt(position);
    const id = periods[periodIndex].id;
    if (id !== current) onChange(id);
    else onYear?.(year);
  };
  all.onclick = () => onChange(null);
}
