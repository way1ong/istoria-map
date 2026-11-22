"""Уточнення прив'язки рисунків Ádám 2022 за межами з OpenStreetMap: світла лінія меж комітатів Heves і Nógrád
(рис. 8 і 12) або бірюзова межа районів Hatvani і Gyöngyösi járás (рис. 14) на знімку Google Earth, зі слабкою опорою
на значки населених пунктів. Запуск: python3 regb.py 007 011 013 → aff_b_<рис>.json (потрібні boundaries.py, fitplaces.py)."""
import json, math, sys, numpy as np, cv2
from scipy.optimize import minimize
from scipy.ndimage import map_coordinates
import masks
from fitplaces import FIG, C

COUNTIES = ('cty_heves.json', 'cty_nograd.json')

def boundary_samples(files=COUNTIES, step_m=25):
    out = []
    for f in files:
        g = json.load(open(f))[0]['geojson']; rings = g['coordinates'] if g['type'] == 'Polygon' else [r for p in g['coordinates'] for r in p]
        for r in rings:
            r = np.array(r)
            for a, b in zip(r, r[1:]):
                d = math.hypot((b[0] - a[0]) * 75000, (b[1] - a[1]) * 111320); k = max(1, int(d / step_m))
                for i in range(k): out.append(a + (b - a) * i / k)
    return np.array(out)

def samples_for(fig):
    return np.array(json.load(open('shared_hatvan_gyongyos.json'))) if fig == '013' else boundary_samples()

def run(fig, w_mark=0.02, trunc=12.0):
    bm = cv2.dilate(masks.boundary_mask(fig), np.ones((2, 2), np.uint8)); H, W = bm.shape
    dt = cv2.distanceTransform((1 - bm).astype(np.uint8), cv2.DIST_L2, 3)
    A0 = json.load(open(f'aff_places_{fig}.json')); cx, cy = np.array(A0['cx']), np.array(A0['cy'])
    M = np.array([[cx[0], cx[1]], [cy[0], cy[1]]]); t = np.array([cx[2], cy[2]])
    c0 = M @ np.array([W / 2, H / 2]) + t
    S = samples_for(fig); S = S[(abs(S[:, 0] - c0[0]) < 0.25) & (abs(S[:, 1] - c0[1]) < 0.15)]
    names = list(FIG[fig]); Pm = np.array([FIG[fig][n] for n in names]); Lm = np.array([[C[n]['lon'], C[n]['lat']] for n in names])
    Minv = np.linalg.inv(M); p0 = np.r_[Minv.ravel(), Minv @ (c0 - t)]      # px = Minv @ (ll - c0) + b
    def proj(p, ll): return (ll - c0) @ p[:4].reshape(2, 2).T + p[4:]
    def parts(p):
        q = proj(p, S); ok = (q[:, 0] >= 1) & (q[:, 0] < W - 2) & (q[:, 1] >= 1) & (q[:, 1] < H - 2)
        if ok.sum() < 30: return trunc, np.array([]), 1e9
        d = map_coordinates(dt, [q[ok, 1], q[ok, 0]], order=1)
        return float(np.minimum(d, trunc).mean()), d, float((np.hypot(*(proj(p, Lm) - Pm).T) ** 2).mean())
    def f(p):
        a, d, m = parts(p); return a + w_mark * m / 100.0
    scale = np.r_[np.abs(p0[:4]) * 0.02 + 50.0, 4.0, 4.0]; best = None
    for dx in (-12, 0, 12):
        for dy in (-12, 0, 12):
            z0 = np.zeros(6); z0[4] = dx / 4.0; z0[5] = dy / 4.0
            r = minimize(lambda z: f(p0 + z * scale), z0, method='Powell', options={'maxiter': 30000, 'xtol': 1e-3, 'ftol': 1e-7})
            if best is None or r.fun < best.fun: best = r
    p = p0 + best.x * scale
    Mi = p[:4].reshape(2, 2); b = p[4:]; M2 = np.linalg.inv(Mi); t2 = c0 - M2 @ b
    KY = 111320; KX = KY * math.cos(math.radians(c0[1])); a1, d, m1 = parts(p)
    print(fig, 'межа: зразків', len(d), 'медіана px', round(float(np.median(d)), 2), '≤2px', round(float((d <= 2).mean()), 2),
          '| м/px', round(math.hypot(M2[0, 0] * KX, M2[1, 0] * KY), 2), round(math.hypot(M2[0, 1] * KX, M2[1, 1] * KY), 2),
          'поворот °', round(math.degrees(math.atan2(-M2[1, 0] * KY, M2[0, 0] * KX)), 2))
    return {'cx': [M2[0, 0], M2[0, 1], t2[0]], 'cy': [M2[1, 0], M2[1, 1], t2[1]]}

if __name__ == '__main__':
    for fig in sys.argv[1:]:
        json.dump(run(fig), open(f'aff_b_{fig}.json', 'w'))
