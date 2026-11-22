"""Рис. 14 (Ádám 2022): проміжне уточнення перед спільним (joint.py). Опора: межа районів Hatvani і Gyöngyösi járás
і ті самі сині лінії, уже прив'язані за рис. 8 і 12 (aff_b_007, aff_b_011), плюс слабка опора на значки → aff_c_013.json."""
import json, math, numpy as np, cv2
from scipy.optimize import minimize
from scipy.ndimage import map_coordinates
import masks, lines
from fitplaces import FIG, C
fig = '013'
blue = lines.blue_mask(fig); H, W = blue.shape
teal = cv2.dilate(masks.teal14(), np.ones((2, 2), np.uint8))
dt_b = cv2.distanceTransform((1 - teal).astype(np.uint8), cv2.DIST_L2, 3)
dt_l = cv2.distanceTransform((1 - masks.masks(fig)[0]).astype(np.uint8), cv2.DIST_L2, 3)
Sb = np.array(json.load(open('shared_hatvan_gyongyos.json')))
def ll_lines(f):
    A = json.load(open(f'aff_b_{f}.json')); cx, cy = np.array(A['cx']), np.array(A['cy']); out = []
    for p in lines.extract(f)[0]:
        c = np.c_[(p + 0.5) @ cx[:2] + cx[2], (p + 0.5) @ cy[:2] + cy[2]].round(6)
        for a, b in zip(c, c[1:]):
            n = max(1, int(np.hypot(*(b - a)) / 0.0003))
            for i in range(n): out.append(a + (b - a) * i / n)
    return out
Sl = np.array(ll_lines('007') + ll_lines('011'))
A0 = json.load(open(f'aff_b_{fig}.json')); cx, cy = np.array(A0['cx']), np.array(A0['cy'])
M = np.array([[cx[0], cx[1]], [cy[0], cy[1]]]); t = np.array([cx[2], cy[2]])
c0 = M @ np.array([W / 2, H / 2]) + t; Minv = np.linalg.inv(M); p0 = np.r_[Minv.ravel(), Minv @ (c0 - t)]
names = list(FIG[fig]); Pm = np.array([FIG[fig][n] for n in names]); Lm = np.array([[C[n]['lon'], C[n]['lat']] for n in names])
def proj(p, ll): return (ll - c0) @ p[:4].reshape(2, 2).T + p[4:]
def term(p, S, dt, trunc=10):
    q = proj(p, S); ok = (q[:, 0] >= 6) & (q[:, 0] < W - 7) & (q[:, 1] >= 6) & (q[:, 1] < H - 7)
    if ok.sum() < 30: return trunc
    return float(np.minimum(map_coordinates(dt, [q[ok, 1], q[ok, 0]], order=1), trunc).mean())
def f(p): return term(p, Sb, dt_b) + term(p, Sl, dt_l) + 0.02 * float((np.hypot(*(proj(p, Lm) - Pm).T) ** 2).mean()) / 100
scale = np.r_[np.abs(p0[:4]) * 0.02 + 50.0, 4.0, 4.0]; best = None
for dx in (-6, 0, 6):
    for dy in (-6, 0, 6):
        z0 = np.zeros(6); z0[4] = dx / 4.0; z0[5] = dy / 4.0
        r = minimize(lambda z: f(p0 + z * scale), z0, method='Powell', options={'maxiter': 30000, 'xtol': 1e-3, 'ftol': 1e-7})
        if best is None or r.fun < best.fun: best = r
p = p0 + best.x * scale; Mi = p[:4].reshape(2, 2); b = p[4:]; M2 = np.linalg.inv(Mi); t2 = c0 - M2 @ b
KY = 111320; KX = KY * math.cos(math.radians(c0[1]))
print('рис. 14: м/px', round(math.hypot(M2[0, 0] * KX, M2[1, 0] * KY), 2), round(math.hypot(M2[0, 1] * KX, M2[1, 1] * KY), 2), 'вартість', round(best.fun, 3))
json.dump({'cx': [M2[0, 0], M2[0, 1], t2[0]], 'cy': [M2[1, 0], M2[1, 1], t2[1]]}, open('aff_c_013.json', 'w'))
