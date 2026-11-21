// Коротке повідомлення внизу екрана (мережа зникла чи з'явилася, є нова версія застосунку).
let el: HTMLElement | null = null;
let timer = 0;
let seq = 0;

/** Показує повідомлення; повертає його номер для hideToast. */
export function toast(msg: string, opts: { action?: string; onAction?: () => void; ms?: number } = {}): number {
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.hidden = true;
    document.body.appendChild(el);
  }
  const box = el;
  clearTimeout(timer);
  box.replaceChildren();
  const text = document.createElement('span');
  text.textContent = msg;
  box.appendChild(text);
  if (opts.action && opts.onAction) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-act';
    b.textContent = opts.action;
    b.onclick = () => { box.hidden = true; opts.onAction!(); };
    box.appendChild(b);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'toast-close';
  x.textContent = '×';
  x.ariaLabel = '×';
  x.onclick = () => { box.hidden = true; };
  box.appendChild(x);
  box.hidden = false;
  // ms: 0 — висить, доки не закриють
  const ms = opts.ms ?? 4000;
  if (ms > 0) timer = window.setTimeout(() => { box.hidden = true; }, ms);
  return ++seq;
}

/** Сховати повідомлення з цим номером, якщо його ще не замінило інше. */
export function hideToast(id: number): void {
  if (el && id === seq) { clearTimeout(timer); el.hidden = true; }
}
