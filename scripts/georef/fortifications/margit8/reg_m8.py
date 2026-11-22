"""Прив'язка правої частини рис. 8 (Juhász–Balogh 2025: лінія «Маргіт» довкола Velencei-tó) за лініями OSM.
Як reg/register.py, але з масками під цей рисунок: вода — сині лінії й озеро, дороги й залізниці — чорні лінії
(разом з чорно-жовтою автомагістраллю). Афінне перетворення; кілька стартів зі зсувом.
Запуск з цієї теки: python3 reg_m8.py aff0.json m8_osm.json aff1.json
(m8_osm.json — python3 ../reg/osmtiles.py 18.24,46.99,18.77,47.30 m8_osm.json).
Перевірка: python3 reg_m8.py check — окремо за водою й окремо за дорогами (розбіжність у кутах і центрі)."""
import json, sys, math, io, contextlib
import numpy as np, cv2
import fig8
from scipy.optimize import minimize
from scipy.ndimage import map_coordinates

def masks(img):
    a = img.astype(int); R, G, B = a[..., 0], a[..., 1], a[..., 2]
    water = ((B > R + 45) & (B > 150) & (B >= G)).astype(np.uint8)
    v = a.max(2); sat = v - a.min(2)
    dark = ((v < 95) & (sat < 60)).astype(np.uint8)
    return water, dark

def dtrans(m):
    return cv2.distanceTransform((1 - m).astype(np.uint8), cv2.DIST_L2, 3)

def load_affine(path):
    A = json.load(open(path)); cx, cy = np.array(A['cx']), np.array(A['cy'])
    M = np.array([[cx[0], cx[1]], [cy[0], cy[1]]]); t = np.array([cx[2], cy[2]])
    Minv = np.linalg.inv(M); return np.r_[Minv.ravel(), -Minv @ t]

def proj(p, ll):
    return ll @ p[:4].reshape(2, 2).T + p[4:]

def run(aff, osm, out, trunc=5.0, w_water=1.0, w_dark=1.0, legend=fig8.LEGEND):
    img = cv2.cvtColor(fig8.load(), cv2.COLOR_BGR2RGB)
    water, dark = masks(img)
    a, b, c, d = legend; water[b:d, a:c] = 0; dark[b:d, a:c] = 0
    dw, dg = dtrans(water), dtrans(dark)
    O = json.load(open(osm)); Lw = np.array(O['water']); Lg = np.array(O['rail'] + O['road'])
    c0 = np.r_[Lw, Lg].mean(0); Lw0, Lg0 = Lw - c0, Lg - c0
    p0 = load_affine(aff); p0c = p0.copy(); p0c[4:] = proj(p0, c0[None])[0]
    H, W = dw.shape
    def inside(q):
        ok = (q[:, 0] >= 0) & (q[:, 0] < W - 1) & (q[:, 1] >= 0) & (q[:, 1] < H - 1)
        return ok & ~((q[:, 0] >= a) & (q[:, 1] >= b))
    def cost(q, dt):
        ok = inside(q)
        if ok.sum() < 50: return trunc
        dd = map_coordinates(dt, [q[ok, 1], q[ok, 0]], order=1)
        return float(np.minimum(dd, trunc).mean())
    def f(p):
        return w_water * cost(proj(p, Lw0), dw) + w_dark * cost(proj(p, Lg0), dg)
    scale = np.r_[np.abs(p0c[:4]) * 0.02 + 30.0, 3.0, 3.0]
    g = lambda z: f(p0c + z * scale)
    print('до', round(f(p0c), 3))
    best = None
    # кілька стартів зі зсувом, щоб не застрягти
    for dx in (-4, 0, 4):
        for dy in (-4, 0, 4):
            z0 = np.zeros(6); z0[4] = dx / 3.0; z0[5] = dy / 3.0
            r = minimize(g, z0, method='Powell', options={'maxiter': 20000, 'xtol': 1e-3, 'ftol': 1e-6})
            if best is None or r.fun < best.fun: best = r
    p = p0c + best.x * scale
    print('після', round(f(p), 3))
    Minv = p[:4].reshape(2, 2); bb = p[4:]
    M = np.linalg.inv(Minv); t = c0 - M @ bb
    json.dump({'cx': [M[0, 0], M[0, 1], t[0]], 'cy': [M[1, 0], M[1, 1], t[1]]}, open(out, 'w'))
    KX = 111.32 * math.cos(math.radians(c0[1])) * 1000; KY = 111320
    print('масштаб, м/px: x', round(math.hypot(M[0, 0] * KX, M[1, 0] * KY), 2), 'y', round(math.hypot(M[0, 1] * KX, M[1, 1] * KY), 2),
          'поворот, °', round(math.degrees(math.atan2(-M[1, 0] * KY, M[0, 0] * KX)), 2))
    # залишки: частка зразків OSM у межах 1, 2, 3 px від відповідних пікселів рисунка
    for name, L0, dt in (('вода', Lw0, dw), ('дороги й залізниці', Lg0, dg)):
        q = proj(p, L0); ok = inside(q); dd = map_coordinates(dt, [q[ok, 1], q[ok, 0]], order=1)
        print(' ', name, 'зразків', int(ok.sum()), 'медіана px', round(float(np.median(dd)), 2), '≤1px', round(float((dd <= 1).mean()), 2), '≤2px', round(float((dd <= 2).mean()), 2), '≤3px', round(float((dd <= 3).mean()), 2))
    return M, t

def check(aff0='aff0.json', osm='m8_osm.json', ref='aff1.json'):
    """Незалежні прив'язки лише за водою й лише за дорогами: наскільки вони розходяться зі спільною."""
    def corners(a):
        A = json.load(open(a)); cx, cy = np.array(A['cx']), np.array(A['cy'])
        return np.array([[cx @ [x, y, 1], cy @ [x, y, 1]] for x, y in [(0, 0), (601, 0), (0, 473), (601, 473), (300, 237)]])
    with contextlib.redirect_stdout(io.StringIO()):
        run(aff0, osm, 'aff_w.json', w_water=1.0, w_dark=0.0); run(aff0, osm, 'aff_d.json', w_water=0.0, w_dark=1.0)
    c1, cw, cd = corners(ref), corners('aff_w.json'), corners('aff_d.json')
    KX = 111320 * math.cos(math.radians(47.15)); KY = 111320
    for name, c in (('лише вода', cw), ('лише дороги й залізниці', cd)):
        print(name, '— зсув від спільної прив\'язки в кутах і центрі, м:', [int(round(x)) for x in np.hypot((c[:, 0] - c1[:, 0]) * KX, (c[:, 1] - c1[:, 1]) * KY)])
    print('вода проти доріг, м:', [int(round(x)) for x in np.hypot((cw[:, 0] - cd[:, 0]) * KX, (cw[:, 1] - cd[:, 1]) * KY)])

if __name__ == '__main__':
    if sys.argv[1:2] == ['check']: check()
    else: run(*sys.argv[1:4])
