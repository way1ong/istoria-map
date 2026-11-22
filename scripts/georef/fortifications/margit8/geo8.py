"""Пікселі правої частини рис. 8 → lon/lat (aff1.json), порівняння з окопами рис. 2, які вже є в шарі,
і прибирання повторів: окопи з рис. 8, що йдуть уздовж уже нанесених окопів рис. 2 (детальніших), не беруться.
Результат — margit8_lines.json: {ditch, trench, described: [{coords, chain?}]}.
Запуск з цієї теки після extract8.py: python3 geo8.py"""
import json, math, os, sys, numpy as np
from shapely.geometry import LineString, Point
from shapely.ops import unary_union
HERE = os.path.dirname(os.path.abspath(__file__))
LAYER = os.path.join(HERE, '..', '..', '..', '..', 'data', 'fortifications', 'fortifications-1914-1944.geojson')
A = json.load(open('aff1.json')); cx, cy = np.array(A['cx']), np.array(A['cy'])
def ll(P):
    P = np.asarray(P, float) + 0.5          # центр пікселя
    return np.c_[P @ cx[:2] + cx[2], P @ cy[:2] + cy[2]]
L = json.load(open('lines8_px.json'))
KX = 111320 * math.cos(math.radians(47.2)); KY = 111320
def to_m(c): c = np.asarray(c, float); return np.c_[c[:, 0] * KX, c[:, 1] * KY]
def length(c): m = to_m(c); return float(np.hypot(*np.diff(m, axis=0).T).sum())
def dens(c, step=30):
    m = to_m(c); res = []
    for a, b in zip(m, m[1:]):
        n = max(1, int(np.hypot(*(b - a)) / step))
        for i in range(n): res.append(a + (b - a) * i / n)
    res.append(m[-1]); return np.array(res)
out = {k: [{'coords': ll(o['px']).round(5).tolist(), **({'chain': o['chain']} if 'chain' in o else {})} for o in v] for k, v in L.items()}
d = json.load(open(LAYER))
old = [f['geometry']['coordinates'] for f in d['features'] if f['properties']['kind'] == 'trench']
oldm = unary_union([LineString(to_m(c)) for c in old if len(c) > 1])
ob = np.array([p for c in old for p in c]); bb = (ob[:, 0].min(), ob[:, 1].min(), 18.746, 47.277)
def inbb(p): return bb[0] * KX <= p[0] <= bb[2] * KX and bb[1] * KY <= p[1] <= bb[3] * KY
# незалежна перевірка прив'язки: окопи рис. 8 проти окопів рис. 2 у спільній ділянці
newm = unary_union([LineString(to_m(o['coords'])) for o in out['trench']])
dn = np.array([oldm.distance(Point(p)) for o in out['trench'] for p in dens(o['coords']) if inbb(p)])
do = np.array([newm.distance(Point(p)) for c in old if len(c) > 1 for p in dens(c) if inbb(p)])
for name, x in (('рис. 8 → рис. 2', dn), ('рис. 2 → рис. 8', do)):
    print(name, 'точок', len(x), 'медіана м', int(np.median(x)), '75 %', int(np.percentile(x, 75)), '90 %', int(np.percentile(x, 90)), '≤100 м', round(float((x <= 100).mean()), 2), '≤200 м', round(float((x <= 200).mean()), 2))
keep = []; dropped = 0; dropped_km = 0.0
for o in out['trench']:
    P = dens(o['coords']); near = np.array([oldm.distance(Point(p)) <= 150 for p in P])
    if near.mean() >= 0.6: dropped += 1; dropped_km += length(o['coords']) / 1000; continue
    keep.append(o)
print('окопів прибрано як повтор рис. 2:', dropped, f'({dropped_km:.1f} км), лишилось', len(keep))
out['trench'] = keep
for k, v in out.items(): print(k, len(v), 'ламаних,', round(sum(length(o['coords']) for o in v) / 1000, 1), 'км,', sum(len(o['coords']) for o in v), 'вершин')
json.dump(out, open('margit8_lines.json', 'w'), ensure_ascii=False)
