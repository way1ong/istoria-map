"""Уточнення афінної прив'язки рисунка за лініями OSM (вода, залізниці, дороги): мінімізація середньої
обрізаної відстані від спроєктованих зразків OSM до відповідних пікселів рисунка (карта відстаней)."""
import json, sys, math
import numpy as np, cv2
from scipy.optimize import minimize
from scipy.ndimage import map_coordinates

def masks(img, x1=None):
    a = img.astype(int); R, G, B = a[..., 0], a[..., 1], a[..., 2]
    water = ((B > R + 25) & (B > 140)).astype(np.uint8)
    v = a.max(2); sat = a.max(2) - a.min(2)
    gray = ((v > 45) & (v < 175) & (sat < 30)).astype(np.uint8)
    if x1 is not None: water[:, x1:] = 0; gray[:, x1:] = 0
    return water, gray

def dtrans(m):
    return cv2.distanceTransform((1 - m).astype(np.uint8), cv2.DIST_L2, 3)

def load_affine(path):
    A = json.load(open(path)); cx, cy = np.array(A['cx']), np.array(A['cy'])
    M = np.array([[cx[0], cx[1]], [cy[0], cy[1]]]); t = np.array([cx[2], cy[2]])
    Minv = np.linalg.inv(M); return np.r_[Minv.ravel(), -Minv @ t]   # px = Minv @ ll + b

def proj(p, ll):
    Minv = p[:4].reshape(2, 2); b = p[4:]
    return ll @ Minv.T + b

def run(fig_path, aff_path, osm_path, out_path, x1=None, trunc=6.0, w_water=1.0, w_gray=1.0, exclude=None):
    img = cv2.cvtColor(cv2.imread(fig_path), cv2.COLOR_BGR2RGB)
    if x1: img = img[:, :x1]
    water, gray = masks(img)
    if exclude is not None:
        for (a, b, c, d) in exclude: water[b:d, a:c] = 0; gray[b:d, a:c] = 0
    dw, dg = dtrans(water), dtrans(gray)
    O = json.load(open(osm_path)); Lw = np.array(O['water']); Lg = np.array(O['rail'] + O['road'])
    # центруємо lon/lat для числової стійкості
    c0 = np.r_[Lw, Lg].mean(0); Lw0, Lg0 = Lw - c0, Lg - c0
    p0 = load_affine(aff_path); p0c = p0.copy(); p0c[4:] = proj(p0, c0[None])[0]
    H, W = dw.shape
    def f(p):
        qw = proj(p, Lw0); qg = proj(p, Lg0)
        def cost(q, dt):
            ok = (q[:, 0] >= 0) & (q[:, 0] < W - 1) & (q[:, 1] >= 0) & (q[:, 1] < H - 1)
            if ok.sum() < 50: return trunc
            d = map_coordinates(dt, [q[ok, 1], q[ok, 0]], order=1)
            return float(np.minimum(d, trunc).mean())
        return w_water * cost(qw, dw) + w_gray * cost(qg, dg)
    scale = np.r_[np.abs(p0c[:4]) * 0.02 + 1e-9, 3.0, 3.0]
    g = lambda z: f(p0c + z * scale)
    print('до', round(f(p0c), 3))
    best = minimize(g, np.zeros(6), method='Powell', options={'maxiter': 20000, 'xtol': 1e-3, 'ftol': 1e-5})
    p = p0c + best.x * scale
    print('після', round(f(p), 3))
    Minv = p[:4].reshape(2, 2); b = p[4:]
    M = np.linalg.inv(Minv); t = c0 - M @ b   # ll = M @ px + t
    json.dump({'cx': [M[0, 0], M[0, 1], t[0]], 'cy': [M[1, 0], M[1, 1], t[1]]}, open(out_path, 'w'))
    # зсув порівняно з початковою прив'язкою в кутах і центрі
    KX = 111.32 * math.cos(math.radians(c0[1])) * 1000; KY = 111320
    A0 = json.load(open(aff_path)); cx0, cy0 = np.array(A0['cx']), np.array(A0['cy'])
    for (x, y) in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1), (W / 2, H / 2)]:
        l0 = np.array([cx0 @ [x, y, 1], cy0 @ [x, y, 1]]); l1 = M @ [x, y] + t
        print('  точка', (int(x), int(y)), 'зсув, м', round(math.hypot((l1[0] - l0[0]) * KX, (l1[1] - l0[1]) * KY)))
    return M, t

if __name__ == '__main__':
    fig, aff, osm, out = sys.argv[1:5]
    x1 = int(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] != '-' else None
    run(fig, aff, osm, out, x1=x1)
