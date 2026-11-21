// Встановлення застосунку (PWA): у Chrome й Edge на телефоні та ПК браузер пропонує це подією beforeinstallprompt,
// яку ми зберігаємо для кнопки «Встановити застосунок» у панелі «Без інтернету».

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((cb) => cb());

window.addEventListener('beforeinstallprompt', (e) => {
  // власна кнопка в панелі замість стрічки браузера внизу екрана
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
  emit();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  emit();
});

/** Чи може браузер показати вікно встановлення просто зараз. */
export const canInstall = () => deferred !== null;

/** Чи відкрито сайт як встановлений застосунок (окреме вікно без адресного рядка). */
export function isStandalone(): boolean {
  return ['standalone', 'window-controls-overlay', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches)
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  await e.prompt();
  const choice = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  emit();
  return choice.outcome === 'accepted';
}

export function onInstallChange(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}
