#!/usr/bin/env python3 -I
"""Клітинки Spezialkarte (зона, колона), що перетинають сучасну Угорщину (з буфером) + місця проєкту поза нею."""
import json, os, glob, math, sys
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..') + '/'
g = json.load(open(R + 'data/borders/modern.geojson'))
hu = [f for f in g['features'] if f['properties']['id'] == 'hungary'][0]['geometry']['coordinates'][0]

def pip(x, y, poly):
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c

def cell_bounds(z, col):
    n = 48.75 - (z - 11) * 0.25
    w = 18.3333333 + (col - 19) * 0.5
    return w, w + 0.5, n - 0.25, n

def frac_in(z, col, k=24):
    w, e, s, n = cell_bounds(z, col)
    cnt = 0
    for i in range(k):
        for j in range(k):
            x = w + (i + 0.5) / k * (e - w); y = s + (j + 0.5) / k * (n - s)
            cnt += pip(x, y, hu)
    return cnt / (k * k)

places = []
for f in glob.glob(R + 'data/places/*.json'):
    p = json.load(open(f))
    c = p.get('coords')
    if c:
        places.append((p['id'], c[0], c[1]))
out = {}
for z in range(10, 25):
    for col in range(13, 30):
        fr = frac_in(z, col)
        w, e, s, n = cell_bounds(z, col)
        pl = [pid for pid, x, y in places if w <= x < e and s <= y < n]
        if fr > 0 or pl:
            out[f'{z}-{col}'] = {'frac': round(fr, 3), 'places': len(pl), 'outside_places': [pid for pid, x, y in places if w <= x < e and s <= y < n and not pip(x, y, hu)]}
json.dump(out, open(sys.argv[1], 'w'), indent=1)
print(len(out), 'cells;', sum(1 for v in out.values() if v['frac'] > 0), 'intersect HU;', sum(1 for v in out.values() if v['frac'] == 0), 'only places')
for k, v in out.items():
    if v['frac'] == 0: print(k, v['outside_places'])
