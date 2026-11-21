"""Збирає data/fortifications/fortifications-1914-1944.geojson."""
import json
out = []
NAMES = {'attila1': ('Аттіла I', 'Attila I'), 'attila2': ('Аттіла II', 'Attila II'), 'attila3': ('Аттіла III', 'Attila III')}
A = json.load(open('attila/attila.geojson'))
for f in A['features']:
    p = f['properties']; pid = p.get('id', '')
    props = {'kind': p['kind'], 'era': 1944}
    for k, (uk, hu) in NAMES.items():
        if pid.startswith(k): props['name'] = {'uk': uk, 'hu': hu}
    out.append({'type': 'Feature', 'properties': props, 'geometry': f['geometry']})
M = json.load(open('margit/margit.geojson'))
for f in M['features']:
    out.append({'type': 'Feature', 'properties': {'kind': 'trench', 'era': 1944}, 'geometry': f['geometry']})
D = json.load(open('k1914/dots_ll.json'))
for d in D:
    props = {'kind': 'strongpoint_1914', 'era': 1914}
    if d['n'] == 25: props['name'] = {'uk': '«Hármas»', 'hu': '„Hármas”'}
    out.append({'type': 'Feature', 'properties': props, 'geometry': {'type': 'Point', 'coordinates': [d['lon'], d['lat']]}})
O = json.load(open('osm_lookup.json'))
for f in O['features']:
    p = f['properties']
    if p.get('osm_type') == 'way' and 'Attila III' in (p.get('name') or ''):
        out.append({'type': 'Feature', 'properties': {'kind': 'remains', 'era': 1944, 'name': {'uk': 'Аттіла III', 'hu': 'Attila III'},
                    'url': f"https://www.openstreetmap.org/way/{p['osm_id']}"},
                    'geometry': {'type': 'LineString', 'coordinates': [[round(x, 6), round(y, 6)] for x, y in f['geometry']['coordinates']]}})
fc = {'type': 'FeatureCollection',
      'license': 'Траси й точки знято з рисунків статей Juhász–Balogh 2025 і Kulcsár 2025 (дані про розташування з посиланням на джерело); вцілілі ділянки рову — OpenStreetMap, ODbL',
      'attribution': 'Juhász A., Balogh Á. 2025 (Haditechnika); Kulcsár V. 2025 (Hadtudományi Szemle); © учасники OpenStreetMap (ODbL)',
      'features': out}
json.dump(fc, open('/home/user/istoria-map/data/fortifications/fortifications-1914-1944.geojson', 'w'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
print(Counter(f['properties']['kind'] for f in out), len(out))
