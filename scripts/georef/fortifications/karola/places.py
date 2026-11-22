"""Координати населених пунктів з Nominatim (1 запит/с, загальний User-Agent), кеш places_osm.json."""
import json, os, subprocess, time, urllib.parse
NAMES = ['Heréd', 'Kartal', 'Hatvan', 'Kerekharaszt', 'Bag', 'Hévízgyörk', 'Galgahévíz', 'Aszód', 'Hort', 'Gyöngyössolymos', 'Gyöngyöspata',
         'Gyöngyöstarján', 'Szűcsi', 'Apc', 'Rózsaszentmárton', 'Gyöngyös', 'Zagyvaszántó', 'Nagyréde', 'Petőfibánya', 'Gyöngyöshalász',
         'Lőrinci', 'Ecséd', 'Atkár', 'Vámosgyörk', 'Tura', 'Verseg', 'Csány', 'Boldog', 'Jászfényszaru']
fn = 'places_osm.json'
C = json.load(open(fn)) if os.path.exists(fn) else {}
for n in NAMES:
    if n in C: continue
    url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=hu&q=' + urllib.parse.quote(n)
    r = subprocess.run(['curl', '-s', '-m', '40', '-A', 'istoria-map-qa/1.0', url], capture_output=True, text=True)
    d = json.loads(r.stdout or '[]')
    d = [x for x in d if x.get('category') in ('boundary', 'place')]
    if d: C[n] = {'lon': float(d[0]['lon']), 'lat': float(d[0]['lat']), 'type': d[0]['type'], 'name': d[0]['display_name'][:60], 'bbox': d[0]['boundingbox']}
    else: print('немає', n)
    json.dump(C, open(fn, 'w'), ensure_ascii=False, indent=1)
    time.sleep(1.1)
for n in NAMES:
    if n in C: print(n, C[n]['lon'], C[n]['lat'], C[n]['type'], '|', C[n]['name'])
