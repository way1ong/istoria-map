"""Додає (замінює) у data/fortifications/fortifications-1914-1944.geojson:
  - лінію «Маргіт» довкола Velencei-tó з правої частини рис. 8 Juhász–Balogh 2025 (margit8/margit8_lines.json):
    протитанкові рови (margit_ditch), окопи (margit_trench), трасу за описами (margit_described);
  - позиції лінії «Карола» між Aszód, Hatvan і Gyöngyös з рис. 8, 12, 14 Ádám 2022 (karola/karola_ll.json): вид karola.
Наявні об'єкти не змінюються. Умовні знаки цих видів — у legend запису data/maps/fortifications-1914-1944.json.
Запуск з кореня репозиторію: python3 scripts/georef/fortifications/add_margit8_karola.py"""
import json, os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', '..', '..', 'data', 'fortifications', 'fortifications-1914-1944.geojson')
NEW_KINDS = ('margit_ditch', 'margit_trench', 'margit_described', 'karola')

# Назви трьох відтинків траси за описами: які це лінії, видно з рис. 2 тієї самої статті (підписи «A» і «B»).
DESCRIBED = {
    'sw': {'uk': 'На південний захід від Velencei-tó', 'hu': 'A Velencei-tótól délnyugatra'},
    'ne_a': {'uk': 'Перша лінія головної смуги оборони («A» на рис. 2 статті)', 'hu': 'A fő ellenállási öv 1. vonala (a cikk 2. ábráján „A”)'},
    'ne_b': {'uk': 'Друга лінія («B» на рис. 2 статті)', 'hu': 'A 2. vonal (a cikk 2. ábráján „B”)'},
}

G = json.load(open(DATA, encoding='utf-8'))
old = [f for f in G['features'] if f['properties'].get('kind') not in NEW_KINDS]
before = json.dumps(old, ensure_ascii=False, sort_keys=True)
new = []

M = json.load(open(os.path.join(HERE, 'margit8', 'margit8_lines.json'), encoding='utf-8'))
for o in M['ditch']:
    new.append({'type': 'Feature', 'properties': {'kind': 'margit_ditch', 'era': 1944}, 'geometry': {'type': 'LineString', 'coordinates': o['coords']}})
for o in M['trench']:
    new.append({'type': 'Feature', 'properties': {'kind': 'margit_trench', 'era': 1944}, 'geometry': {'type': 'LineString', 'coordinates': o['coords']}})
for o in M['described']:
    new.append({'type': 'Feature', 'properties': {'kind': 'margit_described', 'era': 1944, 'name': DESCRIBED[o['chain']]},
                'geometry': {'type': 'LineString', 'coordinates': o['coords']}})

K = json.load(open(os.path.join(HERE, 'karola', 'karola_ll.json'), encoding='utf-8'))
for o in K:
    new.append({'type': 'Feature', 'properties': {'kind': 'karola', 'era': 1944}, 'geometry': {'type': 'LineString', 'coordinates': o['coords']}})

G['features'] = old + new
assert json.dumps(G['features'][:len(old)], ensure_ascii=False, sort_keys=True) == before
G['license'] = ('Траси й точки знято з рисунків статей Juhász–Balogh 2025, Kulcsár 2025 і Ádám 2022 (дані про розташування з посиланням на джерело); '
                'вцілілі ділянки рову — OpenStreetMap, ODbL; окопи 1963 року обведено на аерофото fentrol.hu (Lechner Tudásközpont), самі знімки не публікуються')
G['attribution'] = ('Juhász A., Balogh Á. 2025 (Haditechnika); Kulcsár V. 2025 (Hadtudományi Szemle); Ádám B. 2022 (Hadtudományi Szemle); '
                    '© учасники OpenStreetMap (ODbL); аерофото fentrol.hu (Lechner Tudásközpont)')
json.dump(G, open(DATA, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
c = Counter(f['properties']['kind'] for f in new)
print('додано:', dict(c), '| усього об\'єктів', len(G['features']))
