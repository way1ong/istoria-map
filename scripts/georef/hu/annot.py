#!/usr/bin/env python3 -I
"""Злиття: наявні 10 аркушів довкола Göd (public/georef/spezialkarte-75000.json) + аркуші всієї Угорщини
з gcps.json -> нова Georeference AnnotationPage (TPS за 8 точками: кути й середини сторін)."""
import json, os
S = os.environ.get('HU_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')) + '/'
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..') + '/'
ROM = {14: 'XIV', 15: 'XV', 16: 'XVI', 17: 'XVII', 18: 'XVIII', 19: 'XIX', 20: 'XX', 21: 'XXI', 22: 'XXII', 23: 'XXIII', 24: 'XXIV', 25: 'XXV', 26: 'XXVI', 27: 'XXVII', 28: 'XXVIII'}
page = json.load(open(R + 'public/georef/spezialkarte-75000.json'))
old = page['items']
have = {it['id'].split('#')[1] for it in old}
g = json.load(open(S + 'gcps.json'))
items = list(old)
for k, v in sorted(g.items(), key=lambda kv: tuple(map(int, kv[0].split('-')))):
    if v['status'] == 'FAIL': continue
    z, c = map(int, k.split('-'))
    sid = f'{z}-{ROM[c]}'
    if sid in have: continue
    pts = v['gcps']
    poly = ' '.join(f"{round(p['px'][0])},{round(p['px'][1])}" for p in pts)
    items.append({
        'type': 'Annotation',
        '@context': ['http://iiif.io/api/extension/georef/1/context.json', 'http://iiif.io/api/presentation/3/context.json'],
        'id': f'https://way1ong.github.io/istoria-map/georef/spezialkarte-75000.json#{sid}',
        'motivation': 'georeferencing',
        'target': {'type': 'SpecificResource',
                   'source': {'id': v['service'], 'type': 'ImageService2', 'height': v['height'], 'width': v['width']},
                   'selector': {'type': 'SvgSelector', 'value': f'<svg width="{v["width"]}" height="{v["height"]}"><polygon points="{poly}" /></svg>'}},
        'body': {'type': 'FeatureCollection', 'transformation': {'type': 'thinPlateSpline'},
                 'features': [{'type': 'Feature', 'properties': {'resourceCoords': p['px']},
                               'geometry': {'type': 'Point', 'coordinates': p['geo']}} for p in pts]}})
page['items'] = items
json.dump(page, open(R + 'public/georef/spezialkarte-75000.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(old), '->', len(items))
