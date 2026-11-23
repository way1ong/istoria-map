// Самовідновлення кешу самого застосунку.
//
// Файли застосунку (код, дані, тексти) service worker тримає в Cache Storage. Це сховище спільне для всіх сайтів
// з однієї адреси: на GitHub Pages — для всіх сайтів одного власника (way1ong.github.io/…). Якщо сусідній сайт
// стирає «чужі» кеші (поширена вада саморобних service worker), наш service worker лишається встановленим, але без
// файлів: з інтернетом усе працює, а без нього застосунок не відкриється аж до наступної версії — сам Workbox
// такий кеш не відновлює. Тому, коли сторінкою керує service worker, а головної сторінки в його кеші немає,
// знімаємо його й перезавантажуємо сторінку: він ставиться заново й завантажує файли.
// Лише з інтернетом і не частіше ніж раз за сеанс вкладки.
const HEAL_KEY = 'istoria.swHeal';

/** Повертає true, якщо сторінка зараз перезавантажиться (тоді решту запуску можна не робити). */
export async function healAppCache(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || typeof caches === 'undefined') return false;
    if (!navigator.serviceWorker.controller || !navigator.onLine) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.active) return false;
    // кеш Workbox називається <префікс>-precache-<версія>-<адреса застосунку> (типово workbox-precache-v2-…);
    // сторінка в ньому лежить з позначкою версії в адресі, тому шукаємо без урахування параметрів
    const index = new URL('index.html', reg.scope).href;
    for (const name of await caches.keys()) {
      if (!name.includes('-precache-') || !name.endsWith(reg.scope)) continue;
      if (await (await caches.open(name)).match(index, { ignoreSearch: true })) {
        sessionStorage.removeItem(HEAL_KEY);
        return false;
      }
    }
    if (sessionStorage.getItem(HEAL_KEY)) return false;
    sessionStorage.setItem(HEAL_KEY, '1');
    await reg.unregister();
    location.reload();
    return true;
  } catch {
    return false;
  }
}
