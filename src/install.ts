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

/**
 * Де відкрито сторінку — від цього залежить підказка, як встановити застосунок. На iPhone й iPad браузер сам
 * встановлення не пропонує (події beforeinstallprompt там немає): сайт додають на початковий екран через «Поділитися».
 * iPad з iPadOS 13+ називає себе комп'ютером Mac, тому його впізнаємо за сенсорним екраном.
 */
export function installPlatform(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  return /Android/.test(ua) ? 'android' : 'desktop';
}

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
