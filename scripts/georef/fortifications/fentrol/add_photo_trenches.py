"""Додає (замінює) у data/fortifications/fortifications-1914-1944.geojson окопи, обведені на аерофото fentrol.hu
(photo_trenches.json: id, frame, gid, coords). Вид об'єктів — photo_trench; посилання — сторінка знімка на fentrol.hu.
Запуск з кореня репозиторію: python3 scripts/georef/fortifications/fentrol/add_photo_trenches.py"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', '..', '..', '..', 'data', 'fortifications', 'fortifications-1914-1944.geojson')
NOTES = {
    'somlyo': {
        'uk': 'Окоп, який Juhász і Balogh (2025) відносять до лінії «Аттіла». Обведено на знімку {frame} (18 вересня 1963 року).',
        'hu': 'Juhász és Balogh (2025) szerint az Attila-vonalhoz tartozó lövészárok. A {frame} jelű felvételen rajzolva (1963. szeptember 18.).',
    },
    'fot': {
        'uk': 'Окоп з мережі південніше Somlyó-hegy, у межах позицій піхоти лінії «Аттіла» за реконструкцією Juhász–Balogh. Обведено на знімку {frame} (18 вересня 1963 року); на знімку 1960 року частина цих окопів має вигляд свіжовикопаних, тож їх могли копати й після війни.',
        'hu': 'A Somlyó-hegytől délre húzódó árokhálózat része, Juhász és Balogh rekonstrukciója szerint az Attila-vonal gyalogsági állásainak területén. A {frame} jelű felvételen rajzolva (1963. szeptember 18.); az 1960-as felvételen az árkok egy része frissen ásottnak látszik, így a háború után is áshatták őket.',
    },
}
T = json.load(open(os.path.join(HERE, 'photo_trenches.json')))
G = json.load(open(DATA))
G['features'] = [f for f in G['features'] if f['properties'].get('kind') != 'photo_trench']
for t in T:
    grp = t['id'].split('-')[0]
    note = {k: v.format(frame=t['frame']) for k, v in NOTES[grp].items()}
    G['features'].append({'type': 'Feature',
                          'properties': {'kind': 'photo_trench', 'era': 1944, 'note': note,
                                         'url': f"https://www.fentrol.hu/hu/legifoto/{t['gid']}"},
                          'geometry': {'type': 'LineString', 'coordinates': t['coords']}})
G['license'] = ('Траси й точки знято з рисунків статей Juhász–Balogh 2025 і Kulcsár 2025 (дані про розташування з посиланням на джерело); '
                'вцілілі ділянки рову — OpenStreetMap, ODbL; окопи 1963 року обведено на аерофото fentrol.hu (Lechner Tudásközpont), самі знімки не публікуються')
G['attribution'] = 'Juhász A., Balogh Á. 2025 (Haditechnika); Kulcsár V. 2025 (Hadtudományi Szemle); © учасники OpenStreetMap (ODbL); аерофото fentrol.hu (Lechner Tudásközpont)'
json.dump(G, open(DATA, 'w'), ensure_ascii=False, separators=(',', ':'))
print('photo_trench:', len(T), 'усього об\'єктів', len(G['features']))
