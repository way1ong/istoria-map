import type { Lang, LText } from './types';

const dict = {
  uk: {
    appTitle: 'Історія Угорщини на мапі',
    tabMap: 'Мапа',
    tabHistory: 'Історія',
    allPeriods: 'Усі періоди',
    places: 'Місця',
    events: 'Події',
    sources: 'Джерела',
    photoSource: 'джерело',
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
    chronology: 'Хронологія',
    chronoLink: 'Хронологія: усі події за роками',
    chronoAll: 'Усі',
    chronoLead: '{n} подій від {from} до {to}. Фішки нижче звужують перелік до одного періоду.',
    chronoEmpty: 'Подій не знайдено.',
    chronoFilter: 'Період',
    chronoPeriodText: 'Текст про період',
    monthsGen: 'січня,лютого,березня,квітня,травня,червня,липня,серпня,вересня,жовтня,листопада,грудня',
    monthsNom: 'січень,лютий,березень,квітень,травень,червень,липень,серпень,вересень,жовтень,листопад,грудень',
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
    bordersNoteBce: 'Кордони бл. {year} р. до н. е. (приблизно; пунктир = сучасні межі).',
    typeFarmstead: 'хутір, майор',
    typeInn: 'корчма',
    typeMill: 'млин',
    tabTools: 'Інструменти',
    tabLandscape: 'Ландшафт',
    navLabel: 'Розділ',
    landscapeJump: 'Перейти до',
    toolsAll: 'Усі',
    forDetectorist: 'Пошуковцям',
    forArchaeologist: 'Археологам',
    search: 'Пошук',
    searchPlaceholder: 'Назва місця чи події',
    searchEmpty: 'Нічого не знайдено.',
    searchHint: 'Можна писати без діакритики: god, szod, vac.',
    filterTitle: 'Типи місць',
    filterAll: 'Усі типи',
    filterVanished: 'Лише зниклі',
    filterActive: 'Діє фільтр типів',
    nearby: 'Що поруч',
    nearbyLocating: 'Визначаю, де ви…',
    nearbyFromMe: 'Від мене',
    nearbyFromCenter: 'Від центру мапи',
    nearbyNoGps: 'Не вдалося визначити, де ви, тому відстані рахую від центру мапи.',
    nearbyFilters: 'Враховано вибраний період і фільтр типів.',
    close: 'Закрити',
    unitM: 'м',
    unitKm: 'км',
    dirs: 'Пн,ПнСх,Сх,ПдСх,Пд,ПдЗх,Зх,ПнЗх',
    tp_castle: 'Замки й фортеці',
    tp_church: 'Церкви й монастирі',
    tp_archaeological: 'Археологічні пам\'ятки',
    tp_monument: 'Будівлі й пам\'ятники',
    tp_settlement: 'Міста й села',
    tp_nature: 'Природа',
    tp_farmstead: 'Хутори й пусти',
    tp_inn: 'Корчми',
    tp_mill: 'Млини',
    tp_military: 'Укріплення світових війн',
    tp_other: 'Інше',
    legendHint: 'Натисніть на лінію, пляму чи кружок: з\'явиться джерело й точність.',
  },
  hu: {
    appTitle: 'Magyarország története térképen',
    tabMap: 'Térkép',
    tabHistory: 'Történet',
    allPeriods: 'Minden korszak',
    places: 'Helyek',
    events: 'Események',
    sources: 'Források',
    photoSource: 'forrás',
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
    chronology: 'Időrend',
    chronoLink: 'Időrend: az összes esemény évek szerint',
    chronoAll: 'Mind',
    chronoLead: '{n} esemény {from} és {to} között. Az alábbi gombokkal egy korszakra szűkíthető a lista.',
    chronoEmpty: 'Nincs esemény.',
    chronoFilter: 'Korszak',
    chronoPeriodText: 'A korszakról szóló szöveg',
    monthsGen: 'január,február,március,április,május,június,július,augusztus,szeptember,október,november,december',
    monthsNom: 'január,február,március,április,május,június,július,augusztus,szeptember,október,november,december',
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
    bordersNoteBce: 'Határok kb. i. e. {year} körül (hozzávetőleges; szaggatott = mai határok).',
    typeFarmstead: 'major, tanya',
    typeInn: 'csárda',
    typeMill: 'malom',
    tabTools: 'Eszközök',
    tabLandscape: 'Táj',
    navLabel: 'Szakasz',
    landscapeJump: 'Ugrás ide',
    toolsAll: 'Mind',
    forDetectorist: 'Fémkeresősöknek',
    forArchaeologist: 'Régészeknek',
    search: 'Keresés',
    searchPlaceholder: 'Hely vagy esemény neve',
    searchEmpty: 'Nincs találat.',
    searchHint: 'Ékezetek nélkül is lehet: god, szod, vac.',
    filterTitle: 'Helytípusok',
    filterAll: 'Minden típus',
    filterVanished: 'Csak az eltűntek',
    filterActive: 'Típusszűrő bekapcsolva',
    nearby: 'A közelben',
    nearbyLocating: 'Helymeghatározás…',
    nearbyFromMe: 'Tőlem',
    nearbyFromCenter: 'A térkép közepétől',
    nearbyNoGps: 'Nem sikerült meghatározni a helyzetét, ezért a térkép közepétől mérek.',
    nearbyFilters: 'A kiválasztott korszak és típusszűrő érvényes.',
    close: 'Bezárás',
    unitM: 'm',
    unitKm: 'km',
    dirs: 'É,ÉK,K,DK,D,DNy,Ny,ÉNy',
    tp_castle: 'Várak, erődök',
    tp_church: 'Templomok, kolostorok',
    tp_archaeological: 'Régészeti lelőhelyek',
    tp_monument: 'Épületek, emlékművek',
    tp_settlement: 'Városok, falvak',
    tp_nature: 'Természet',
    tp_farmstead: 'Majorok, puszták',
    tp_inn: 'Csárdák',
    tp_mill: 'Malmok',
    tp_military: 'Világháborús erődítések',
    tp_other: 'Egyéb',
    legendHint: 'Koppintson egy vonalra, foltra vagy körre: megjelenik a forrás és a pontosság.',
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
  if (year < 0) return getLang() === 'hu' ? `${t('bce')} ${-year}` : `${-year} ${t('bce')}`;
  return String(year);
}
