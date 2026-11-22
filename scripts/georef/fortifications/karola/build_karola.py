"""Зведення синіх ліній позицій з рисунків 8, 12, 14 (Ádám 2022) в один набір без повторів → karola_ll.json.
Прив'язка — aff_j_<рис>.json (joint.py). У спільних ділянках береться детальніший рисунок: 12, далі 8, далі 14.
Наприкінці перевірка: ті самі лінії на різних рисунках у спільних ділянках (відстані в метрах)."""
import json, math, numpy as np, cv2
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union
import figs, lines

ORDER = ['011', '007', '013']
KY = 111320.0; KX = KY * math.cos(math.radians(47.7))
def to_ll(fig, P):
    A = json.load(open(f'aff_j_{fig}.json')); cx, cy = np.array(A['cx']), np.array(A['cy']); P = np.asarray(P, float) + 0.5
    return np.c_[P @ cx[:2] + cx[2], P @ cy[:2] + cy[2]]
def m(c): c = np.asarray(c, float); return np.c_[c[:, 0] * KX, c[:, 1] * KY]
foot = {}; raw = {}
for fig in ORDER:
    H, W = cv2.imread(figs.path(fig)).shape[:2]; mg = 3
    foot[fig] = Polygon(to_ll(fig, [(mg, mg), (W - mg, mg), (W - mg, H - mg), (mg, H - mg)]))
    polys, joins, sk = lines.extract(fig); raw[fig] = [to_ll(fig, p) for p in polys + joins if len(p) > 1]
out = []; stats = {}
for i, fig in enumerate(ORDER):
    higher = unary_union([foot[f] for f in ORDER[:i]]) if i else None
    n = 0; length = 0.0
    for ll in raw[fig]:
        g = LineString(ll)
        if higher is not None: g = g.difference(higher)
        for q in ([g] if g.geom_type == 'LineString' else list(getattr(g, 'geoms', []))):
            if q.is_empty or q.geom_type != 'LineString': continue
            c = np.array(q.coords); d = float(np.hypot(*np.diff(m(c), axis=0).T).sum())
            if d < 60: continue
            out.append({'fig': fig, 'coords': c.round(5).tolist()}); n += 1; length += d
    stats[fig] = (n, round(length / 1000, 1))
print('ламаних і км за рисунками (без повторів):', stats, '| разом', len(out), 'ламаних,', round(sum(v[1] for v in stats.values()), 1), 'км,', sum(len(o['coords']) for o in out), 'вершин')
json.dump(out, open('karola_ll.json', 'w'))
# перевірка узгодженості рисунків
U = {f: unary_union([LineString(m(c)) for c in raw[f]]) for f in ORDER}
def dens(c, step=20):
    mm = m(c); res = []
    for a, b in zip(mm, mm[1:]):
        k = max(1, int(np.hypot(*(b - a)) / step))
        for j in range(k): res.append(a + (b - a) * j / k)
    return res
for a in ORDER:
    for b in ORDER:
        if a == b: continue
        fa = Polygon(m(np.array(foot[a].exterior.coords))).buffer(-150); fb = Polygon(m(np.array(foot[b].exterior.coords))).buffer(-150); inter = fa.intersection(fb)
        d = np.array([U[b].distance(Point(p)) for c in raw[a] for p in dens(c) if inter.contains(Point(p))])
        if len(d): print(f'  рис. {a} → рис. {b}: точок {len(d)}, медіана {np.median(d):.0f} м, 90 % {np.percentile(d, 90):.0f} м, 95 % {np.percentile(d, 95):.0f} м')
