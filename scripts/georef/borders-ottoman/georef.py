# Прив'язка мап-джерел за значками міст: піксель → (довгота, широта).
# Модель: поліном 1-го чи 2-го степеня від пікселів; якість — перевірка «без одного міста» (км).
import json, math
import numpy as np

def km(lon1, lat1, lon2, lat2):
    dx = (lon2 - lon1) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2)); dy = (lat2 - lat1) * 110.57
    return math.hypot(dx, dy)

def design(px, deg):
    x = np.asarray(px, float)[:, 0]; y = np.asarray(px, float)[:, 1]
    cols = [np.ones_like(x), x, y]
    if deg >= 2: cols += [x * x, x * y, y * y]
    if deg >= 3: cols += [x ** 3, x * x * y, x * y * y, y ** 3]
    return np.stack(cols, axis=1)

class Georef:
    """px → lon/lat. Координати пікселів нормуються, щоб поліном був стійким."""
    def __init__(self, px, geo, deg=2, w=None):
        px = np.asarray(px, float); geo = np.asarray(geo, float)
        self.c = px.mean(axis=0); self.s = px.std(axis=0).mean(); self.deg = deg
        A = design((px - self.c) / self.s, deg)
        if w is not None:                     # ваги точок (напр. значки міст проти точок рамки)
            sw = np.sqrt(np.asarray(w, float))[:, None]; A = A * sw; geo = geo * sw
        self.coef, *_ = np.linalg.lstsq(A, geo, rcond=None)
    def __call__(self, px):
        px = np.atleast_2d(np.asarray(px, float))
        return design((px - self.c) / self.s, self.deg) @ self.coef

def evaluate(names, px, geo, deg):
    g = Georef(px, geo, deg); pred = g(px)
    res = [km(p[0], p[1], q[0], q[1]) for p, q in zip(pred, geo)]
    loo = []
    for i in range(len(px)):
        m = [j for j in range(len(px)) if j != i]
        gi = Georef([px[j] for j in m], [geo[j] for j in m], deg); p = gi([px[i]])[0]
        loo.append(km(p[0], p[1], geo[i][0], geo[i][1]))
    return g, res, loo

def load_points(points_path, cities_path):
    """points.json: {"Назва міста": [x, y], ...}; cities.json: {"Назва": {"lon":…, "lat":…}}"""
    pts = json.load(open(points_path)); c = json.load(open(cities_path))
    names = [n for n in pts if n in c]
    return names, [pts[n] for n in names], [[c[n]['lon'], c[n]['lat']] for n in names]

if __name__ == '__main__':
    import sys
    names, px, geo = load_points(sys.argv[1], sys.argv[2])
    for deg in (1, 2):
        if len(names) < {1: 5, 2: 9}[deg]: continue
        g, res, loo = evaluate(names, px, geo, deg)
        print(f'степінь {deg}: точок {len(names)}, залишок: середній {np.mean(res):.1f} км, макс {np.max(res):.1f}; без одного: медіана {np.median(loo):.1f}, середній {np.mean(loo):.1f}, макс {np.max(loo):.1f} км')
        for n, r, l in sorted(zip(names, res, loo), key=lambda t: -t[2])[:8]: print(f'   {n:16s} залишок {r:5.1f}  без одного {l:5.1f}')
