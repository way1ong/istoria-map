"""Квадратична прив'язка рисунка (lon/lat -> px, 12 параметрів) за лініями OSM, старт з афінної.
Перевірка незалежними точками (вцілілі рови з OSM, окоп на Somlyó-hegy) робиться окремо."""
import json, sys, math
import numpy as np, cv2
from scipy.optimize import minimize
from scipy.ndimage import map_coordinates
import register as R

def terms(ll):
    x, y = ll[:, 0], ll[:, 1]
    return np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], 1)

def run(fig_path, aff_path, osm_path, out_path, x1=None, exclude=None, trunc=6.0, use=('water', 'rail', 'road')):
    img = cv2.cvtColor(cv2.imread(fig_path), cv2.COLOR_BGR2RGB)
    if x1: img = img[:, :x1]
    water, gray = R.masks(img)
    for (a, b, c, d) in (exclude or []): water[b:d, a:c] = 0; gray[b:d, a:c] = 0
    dw, dg = R.dtrans(water), R.dtrans(gray)
    O = json.load(open(osm_path))
    Lw = np.array(O['water']); Lg = np.array(sum((O[k] for k in use if k != 'water'), []))
    c0 = np.r_[Lw, Lg].mean(0); s0 = np.r_[Lw, Lg].std(0)
    nw, ng = (Lw - c0) / s0, (Lg - c0) / s0
    A = json.load(open(aff_path)); cx, cy = np.array(A['cx']), np.array(A['cy'])
    M = np.array([[cx[0], cx[1]], [cy[0], cy[1]]]); t = np.array([cx[2], cy[2]]); Mi = np.linalg.inv(M)
    # початкові коефіцієнти: px = Mi (c0 + s0*n - t)
    base = Mi @ (c0 - t); lin = Mi * s0[None, :]
    p0 = np.zeros(12); p0[0], p0[1], p0[2] = base[0], lin[0, 0], lin[0, 1]; p0[6], p0[7], p0[8] = base[1], lin[1, 0], lin[1, 1]
    H, W = dw.shape
    def proj(p, n):
        T = terms(n); return np.stack([T @ p[:6], T @ p[6:]], 1)
    def cost(q, dt):
        ok = (q[:, 0] >= 0) & (q[:, 0] < W - 1) & (q[:, 1] >= 0) & (q[:, 1] < H - 1)
        if ok.sum() < 50: return trunc
        return float(np.minimum(map_coordinates(dt, [q[ok, 1], q[ok, 0]], order=1), trunc).mean())
    f = lambda p: cost(proj(p, nw), dw) + cost(proj(p, ng), dg)
    sc = np.r_[3, np.abs(p0[1:3]) * 0.01, 1, 1, 1, 3, np.abs(p0[7:9]) * 0.01, 1, 1, 1]
    g = lambda z: f(p0 + z * sc)
    print('до', round(f(p0), 3))
    r = minimize(g, np.zeros(12), method='Powell', options={'maxiter': 40000, 'xtol': 1e-3, 'ftol': 1e-6})
    p = p0 + r.x * sc
    print('після', round(f(p), 3))
    json.dump({'model': 'quad', 'c0': c0.tolist(), 's0': s0.tolist(), 'p': p.tolist()}, open(out_path, 'w'))
    return p, c0, s0

def make_inverse(path, W, H):
    """lon/lat->px квадратична модель; обернення px->lon/lat — апроксимацією на сітці (кубічний поліном)."""
    Q = json.load(open(path)); c0, s0, p = np.array(Q['c0']), np.array(Q['s0']), np.array(Q['p'])
    fwd = lambda ll: (lambda T: np.stack([T @ p[:6], T @ p[6:]], 1))(terms((np.atleast_2d(ll) - c0) / s0))
    # сітка в lon/lat, що покриває рисунок
    g = np.stack(np.meshgrid(np.linspace(-2.2, 2.2, 80), np.linspace(-2.2, 2.2, 80)), -1).reshape(-1, 2) * s0 + c0
    px = fwd(g); ok = (px[:, 0] > -60) & (px[:, 0] < W + 60) & (px[:, 1] > -60) & (px[:, 1] < H + 60)
    def T3(q):
        x, y = q[:, 0] / 1000, q[:, 1] / 1000
        return np.stack([x ** i * y ** j for i in range(4) for j in range(4 - i)], 1)
    A = T3(px[ok]); clon, *_ = np.linalg.lstsq(A, g[ok, 0], rcond=None); clat, *_ = np.linalg.lstsq(A, g[ok, 1], rcond=None)
    inv = lambda q: np.stack([T3(np.atleast_2d(np.array(q, float))) @ clon, T3(np.atleast_2d(np.array(q, float))) @ clat], 1)
    back = fwd(inv(px[ok])); err = np.hypot(*(back - px[ok]).T)
    print('похибка обернення, px: макс', round(float(err.max()), 3))
    return fwd, inv

if __name__ == '__main__':
    pass
