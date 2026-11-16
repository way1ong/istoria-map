import type { Lang, LText } from './types';

const dict = {
  uk: {
    appTitle: 'Історія околиць Göd',
    tabMap: 'Мапа',
    tabHistory: 'Історія',
    allPeriods: 'Усі періоди',
    places: 'Місця',
    events: 'Події',
    sources: 'Джерела',
    openCard: 'Докладніше',
    back: 'Назад',
    oldMaps: 'Старі мапи',
    noOverlay: 'Без накладання',
    opacity: 'Прозорість',
    period: 'Період',
    date: 'Дата',
    coords: 'Координати',
    precisionExact: 'точно',
    precisionApproximate: 'приблизно',
    precisionSettlement: 'центр населеного пункту',
    precisionTradition: 'за переказом',
    showOnMap: 'Показати на мапі',
    photoBy: 'Фото',
    license: 'ліцензія',
    noText: 'Текст для цього періоду ще не написано.',
    toPresent: 'дотепер',
    bce: 'до н. е.',
    notFound: 'Запис не знайдено.',
    noPlaces: 'У цьому періоді ще немає міток.',
    play: 'Відтворити',
    pause: 'Пауза',
    animation: 'Анімована мапа',
    animations: 'Анімовані мапи',
    reconstruction: 'Лінії проведено між пунктами, названими в джерелах. Це реконструкція, а не точні маршрути.',
    legend: 'Умовні позначення',
    tabCompare: 'Порівняти',
    oldMap: 'Стара мапа',
    modernMap: 'Сучасна',
    vanished: 'Нині не існує',
    compareHint: 'Рухайте будь-яку з мап: друга йде за нею. Хрестик посередині показує ту саму точку на обох.',
    bordersNote: 'Кордони бл. {year} р. (приблизно; пунктир = сучасні межі).',
    typeFarmstead: 'хутір, майор',
    typeInn: 'корчма',
    typeMill: 'млин',
  },
  hu: {
    appTitle: 'Göd környékének története',
    tabMap: 'Térkép',
    tabHistory: 'Történelem',
    allPeriods: 'Minden korszak',
    places: 'Helyek',
    events: 'Események',
    sources: 'Források',
    openCard: 'Részletek',
    back: 'Vissza',
    oldMaps: 'Régi térképek',
    noOverlay: 'Nincs rávetítés',
    opacity: 'Átlátszóság',
    period: 'Korszak',
    date: 'Dátum',
    coords: 'Koordináták',
    precisionExact: 'pontos',
    precisionApproximate: 'hozzávetőleges',
    precisionSettlement: 'a település központja',
    precisionTradition: 'a hagyomány szerint',
    showOnMap: 'Mutasd a térképen',
    photoBy: 'Fotó',
    license: 'licenc',
    noText: 'Ehhez a korszakhoz még nincs szöveg.',
    toPresent: 'napjainkig',
    bce: 'i. e.',
    notFound: 'A bejegyzés nem található.',
    noPlaces: 'Ebben a korszakban még nincsenek jelölők.',
    play: 'Lejátszás',
    pause: 'Szünet',
    animation: 'Animált térkép',
    animations: 'Animált térképek',
    reconstruction: 'A vonalak a forrásokban megnevezett pontok között húzódnak. Rekonstrukció, nem pontos útvonal.',
    legend: 'Jelmagyarázat',
    tabCompare: 'Összevetés',
    oldMap: 'Régi térkép',
    modernMap: 'Mai',
    vanished: 'Ma már nem létezik',
    compareHint: 'Mozgassa bármelyik térképet: a másik követi. A középső kereszt ugyanazt a pontot mutatja mindkettőn.',
    bordersNote: 'Határok kb. {year} körül (hozzávetőleges; szaggatott = mai határok).',
    typeFarmstead: 'major, tanya',
    typeInn: 'csárda',
    typeMill: 'malom',
  },
} satisfies Record<Lang, Record<string, string>>;

export type Key = keyof typeof dict.uk;

const STORAGE_KEY = 'istoria-lang';

export function getLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'uk' || v === 'hu') return v;
  } catch {
    /* приватний режим */
  }
  return 'uk';
}

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
}

export function t(key: Key): string {
  return dict[getLang()][key] ?? dict.uk[key];
}

/** Локалізований текст із відкатом на українську. */
export function lt(text: LText | undefined): string {
  if (!text) return '';
  const lang = getLang();
  return (lang === 'hu' && text.hu) || text.uk;
}

export function formatYear(year: number | null): string {
  if (year === null) return t('toPresent');
  if (year < 0) return `${-year} ${t('bce')}`;
  return String(year);
}
