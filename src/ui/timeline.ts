import { periods } from '../data';
import { formatYear, lt, t } from '../i18n';

/** Горизонтальна шкала періодів у вигляді «чипів». */
export function renderTimeline(el: HTMLElement, current: string | null, onChange: (id: string | null) => void): void {
  el.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'chip' + (current === null ? ' active' : '');
  all.textContent = t('allPeriods');
  all.onclick = () => onChange(null);
  el.append(all);
  for (const p of periods) {
    const b = document.createElement('button');
    b.className = 'chip' + (current === p.id ? ' active' : '');
    b.style.setProperty('--c', p.color);
    b.innerHTML = `<span class="dot"></span><span>${lt(p.name)}</span><small>${formatYear(p.from)}–${formatYear(p.to)}</small>`;
    b.onclick = () => onChange(p.id);
    el.append(b);
  }
  el.querySelector('.chip.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}
