"""Спільна афінна прив'язка рис. 8: лінії OSM (вода+залізниці) + опорні об'єкти Другої світової, які рисунок
мусить показувати на своїх місцях: вцілілий рів Attila III у Rákoshegy (OSM), окоп на Somlyó-hegy (стаття),
початок траси Attila II на березі Дунаю."""
import json, math
import numpy as np, cv2
from scipy.optimize import minimize
from scipy.ndimage import map_coordinates
from scipy.spatial import cKDTree
import register as R
img = cv2.cvtColor(cv2.imread('../img/ht-005-008.png'), cv2.COLOR_BGR2RGB)[:, :478]
water, gray = R.masks(img); water[:150, :130] = 0; gray[:150, :130] = 0
dw, dg = R.dtrans(water), R.dtrans(gray)
O = json.load(open('attila_osm.json')); Lw = np.array(O['water']); Lr = np.array(O['rail'])
T = json.load(open('../attila/traced.json')); rak = np.array(T['attila3-rakos']['px'])
yl = np.load('../attila/yel_lab.npy'); ys, xs = np.nonzero(yl == 5); blob = cKDTree(np.c_[xs, ys])
osm = json.load(open('../osm_lookup.json'))
ditch = np.array([p for f in osm['features'] if f['properties']['osm_id'] in (1487267062, 1487267055) for p in f['geometry']['coordinates']])
som = np.array([[19.204261, 47.631133]])
H, W = dw.shape
c0 = np.r_[Lw, Lr].mean(0)
p0 = R.load_affine('../attila/affine_settlements.json'); p0[4:] = R.proj(p0, c0[None])[0]
def P(p, ll): return R.proj(p, ll - c0)
def segd(q, line):
    best = np.full(len(q), 1e9)
    for a, b in zip(line, line[1:]):
        ab = b - a; t = np.clip(((q - a) @ ab) / (ab @ ab), 0, 1); best = np.minimum(best, np.hypot(*(a + t[:, None] * ab - q).T))
    return best
def linecost(p):
    out = 0
    for L, dt in ((Lw, dw), (Lr, dg)):
        q = P(p, L); ok = (q[:, 0] >= 0) & (q[:, 0] < W - 1) & (q[:, 1] >= 0) & (q[:, 1] < H - 1)
        out += float(np.minimum(map_coordinates(dt, [q[ok, 1], q[ok, 0]], order=1), 6).mean())
    return out
def anchors(p):
    a1 = segd(P(p, ditch), rak).mean()
    a2 = blob.query(P(p, som))[0][0]
    a3 = map_coordinates(dw, [[P(p, np.array([[0, 0]]) + c0)[0][1]], [0]], order=1)  # заглушка
    return a1, a2
def f(p, w=0.6):
    a1, a2 = anchors(p); return linecost(p) + w * (a1 + a2)
sc = np.r_[np.abs(p0[:4]) * 0.02 + 1e-9, 3.0, 3.0]
for w in (0.3, 0.6, 1.0):
    r = minimize(lambda z: f(p0 + z * sc, w), np.zeros(6), method='Powell', options={'maxiter': 20000, 'xtol': 1e-3, 'ftol': 1e-6})
    p = p0 + r.x * sc; a1, a2 = anchors(p)
    # px->lon/lat
    Minv = p[:4].reshape(2, 2); b = p[4:]; M = np.linalg.inv(Minv); t = c0 - M @ b
    KX = 111.32 * math.cos(math.radians(47.5)) * 1000; KY = 111320
    tw = cKDTree(Lw * [KX, KY])
    st = (M @ [164, 48] + t) * [KX, KY]
    print(f'w={w}: лінії {linecost(p):.3f}, рів Rákoshegy {a1:.2f} px, Somlyó {a2:.2f} px, старт Attila II до води {tw.query(st)[0]:.0f} м')
    json.dump({'cx': [M[0, 0], M[0, 1], t[0]], 'cy': [M[1, 0], M[1, 1], t[1]]}, open(f'../attila/affine_joint_{w}.json', 'w'))
