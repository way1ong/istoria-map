"""Межі з OpenStreetMap (Nominatim, polygon_geojson; 1 запит на 2 с, загальний User-Agent): комітати Heves і Nógrád,
райони Hatvani і Gyöngyösi járás → cty_*.json, jar_*.json; спільна межа двох районів → shared_hatvan_gyongyos.json."""
import json, math, os, subprocess, time, urllib.parse
import numpy as np
from shapely.geometry import shape, Point
Q = {'cty_heves.json': 'Heves vármegye', 'cty_nograd.json': 'Nógrád vármegye', 'jar_hatvani.json': 'Hatvani járás', 'jar_gyongyosi.json': 'Gyöngyösi járás'}
for fn, q in Q.items():
    if os.path.exists(fn): continue
    url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=hu&polygon_geojson=1&polygon_threshold=0.0002&q=' + urllib.parse.quote(q)
    r = subprocess.run(['curl', '-s', '-m', '60', '-A', 'istoria-map-qa/1.0', url], capture_output=True, text=True)
    d = json.loads(r.stdout); assert d and d[0]['geojson']['type'] in ('Polygon', 'MultiPolygon'), (q, r.stdout[:200])
    json.dump(d, open(fn, 'w')); print(q, d[0]['display_name'][:50]); time.sleep(2)
H = shape(json.load(open('jar_hatvani.json'))[0]['geojson']); G = shape(json.load(open('jar_gyongyosi.json'))[0]['geojson'])
gb = G.boundary; pts = []; c = np.array(H.exterior.coords)
for a, b in zip(c, c[1:]):
    k = max(1, int(math.hypot((b[0] - a[0]) * 75000, (b[1] - a[1]) * 111320) / 25))
    for i in range(k):
        p = a + (b - a) * i / k
        if gb.distance(Point(p)) < 0.0005: pts.append([round(float(p[0]), 6), round(float(p[1]), 6)])
json.dump(pts, open('shared_hatvan_gyongyos.json', 'w')); print('спільна межа районів: точок', len(pts))
