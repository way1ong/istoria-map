"""Спільне уточнення прив'язки рисунків 8, 12, 14 (Ádám 2022) → aff_j_<рис>.json.
Опори: (1) межі комітатів Heves і Nógrád (рис. 8, 12) та спільна межа районів Hatvani і Gyöngyösi járás (рис. 14)
з OpenStreetMap проти відповідних ліній на знімку Google Earth; (2) ті самі сині лінії позицій на різних рисунках
мають збігатися; (3) слабка опора на значки населених пунктів. Афінне перетворення для кожного рисунка (18 параметрів),
метод Пауелла. Початок: aff_b_007, aff_b_011 (regb.py), aff_c_013 (reg14.py)."""
import json, math, numpy as np, cv2
from scipy.optimize import minimize
from scipy.ndimage import map_coordinates
import masks, lines, skel, regb
from fitplaces import FIG, C

FIGS = ['007', '011', '013']
INIT = {'007': 'aff_b_007.json', '011': 'aff_b_011.json', '013': 'aff_c_013.json'}
TR = 10.0
D = {}
for f in FIGS:
    blue = masks.masks(f)[0]; H, W = blue.shape
    bmask = cv2.dilate(masks.boundary_mask(f).astype(np.uint8), np.ones((2, 2), np.uint8))
    bl = cv2.morphologyEx(blue, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    ys, xs = np.nonzero(skel.thin(bl)); pts = np.c_[xs, ys].astype(float)[::3]
    names = list(FIG[f])
    D[f] = dict(W=W, H=H, dt_b=cv2.distanceTransform((1 - bmask).astype(np.uint8), cv2.DIST_L2, 3),
                dt_l=cv2.distanceTransform((1 - bl).astype(np.uint8), cv2.DIST_L2, 3), pts=pts, S=regb.samples_for(f),
                Pm=np.array([FIG[f][n] for n in names]), Lm=np.array([[C[n]['lon'], C[n]['lat']] for n in names]), ctr=np.array([W / 2, H / 2]))
def load(fn, f):
    A = json.load(open(fn)); cx, cy = np.array(A['cx']), np.array(A['cy'])
    M = np.array([[cx[0], cx[1]], [cy[0], cy[1]]]); t = np.array([cx[2], cy[2]])
    return np.r_[M.ravel(), M @ D[f]['ctr'] + t]           # ll = c + M (px − ctr)
def fwd(p, f, px): return (px - D[f]['ctr']) @ p[:4].reshape(2, 2).T + p[4:]
def inv(p, f, ll): return (ll - p[4:]) @ np.linalg.inv(p[:4].reshape(2, 2)).T + D[f]['ctr']
def sample(dt, q, W, H, trunc, mg=6):
    ok = (q[:, 0] >= mg) & (q[:, 0] < W - mg - 1) & (q[:, 1] >= mg) & (q[:, 1] < H - mg - 1)
    if ok.sum() < 20: return None
    return np.minimum(map_coordinates(dt, [q[ok, 1], q[ok, 0]], order=1), trunc)
def terms(P):
    p = {f: P[6 * i:6 * i + 6] for i, f in enumerate(FIGS)}; out = {}
    for f in FIGS:
        out['b' + f] = sample(D[f]['dt_b'], inv(p[f], f, D[f]['S']), D[f]['W'], D[f]['H'], TR)
        out['m' + f] = np.hypot(*(inv(p[f], f, D[f]['Lm']) - D[f]['Pm']).T)
    for a in FIGS:
        for b in FIGS:
            if a != b: out[f'l{a}>{b}'] = sample(D[b]['dt_l'], inv(p[b], b, fwd(p[a], a, D[a]['pts'])), D[b]['W'], D[b]['H'], TR)
    return out
def cost(P, wb=1.0, wl=1.0, wm=0.02):
    c = 0.0
    for k, v in terms(P).items():
        if k[0] == 'm': c += wm * float((v ** 2).mean()) / 100
        elif v is None: c += TR
        else: c += (wb if k[0] == 'b' else wl * 0.5) * float(v.mean())
    return c
SC = np.tile(np.r_[np.full(4, 2e-6), 1.5e-4, 1.0e-4], 3)
def solve(P0):
    r = minimize(lambda z: cost(P0 + z * SC), np.zeros(18), method='Powell', options={'maxiter': 200000, 'xtol': 1e-3, 'ftol': 1e-8})
    return P0 + r.x * SC
def report(P, title):
    t = terms(P); print(title, 'вартість', round(cost(P), 3))
    for i, f in enumerate(FIGS):
        p = P[6 * i:6 * i + 6]; M = p[:4].reshape(2, 2); KY = 111320; KX = KY * math.cos(math.radians(p[5]))
        sx = math.hypot(M[0, 0] * KX, M[1, 0] * KY); sy = math.hypot(M[0, 1] * KX, M[1, 1] * KY); b = t['b' + f]
        print(f'  рис. {f}: м/px {sx:.2f} × {sy:.2f}, поворот {math.degrees(math.atan2(-M[1, 0] * KY, M[0, 0] * KX)):.2f}°, межа: медіана {np.median(b):.2f} px, ≤2 px {np.mean(b <= 2):.2f}; значки: медіана {np.median(t["m" + f]) * sx:.0f} м')
    for k, v in t.items():
        if k[0] == 'l' and v is not None:
            a, b = k[1:].split('>'); i = FIGS.index(b); p = P[6 * i:6 * i + 6]; M = p[:4].reshape(2, 2); s = math.hypot(M[0, 0] * 111320 * math.cos(math.radians(p[5])), M[1, 0] * 111320)
            print(f'  лінії рис. {a} на рис. {b}: точок {len(v)}, медіана {np.median(v) * s:.0f} м, 90 % {np.percentile(v, 90) * s:.0f} м, ≤2 px {np.mean(v <= 2):.2f}')
if __name__ == '__main__':
    P0 = np.concatenate([load(INIT[f], f) for f in FIGS])
    report(P0, 'початок:')
    P = solve(solve(P0))
    report(P, 'після спільного уточнення:')
    for i, f in enumerate(FIGS):
        p = P[6 * i:6 * i + 6]; M = p[:4].reshape(2, 2); t = p[4:] - M @ D[f]['ctr']
        json.dump({'cx': [M[0, 0], M[0, 1], t[0]], 'cy': [M[1, 0], M[1, 1], t[1]]}, open(f'aff_j_{f}.json', 'w'))
