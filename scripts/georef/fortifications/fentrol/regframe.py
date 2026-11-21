"""Уточнення розміщення кадру fentrol.hu за OSM: зображення WMS (уже в EPSG:3857 за наближеною прив'язкою сайту)
додатково перетворюється афінно так, щоб головні дороги, колії й вода OSM лягли на краї знімка (зрізана відстань
до найближчого краю Canny, мінімізація Powell, грубо-точно). Результат: affine у пікселях WMS -> пікселі WMS.
Запуск: regframe.py <film_frame> [W]"""
import json, sys, math
import numpy as np, cv2
from scipy.optimize import minimize
from scipy.ndimage import map_coordinates
from query import merc
from mosaic import wms

def load(nm, W):
    P = json.load(open('props.json'))
    g, p = next((g, p) for g, p in P.items() if p.get('success') and (p['filmszam'] + '_' + str(p['kepszam'])) == nm)
    x0, y0, x1, y1 = [float(p[k]) for k in ('mbr_xmin', 'mbr_ymin', 'mbr_xmax', 'mbr_ymax')]
    H = int(W * (y1 - y0) / (x1 - x0)); res = (x1 - x0) / W
    im = np.asarray(wms(p, W, H, f'wms/{p["layername"]}_w{W}.png').convert('RGBA')).astype(np.float32)
    return p, (x0, y0, x1, y1), res, im

def osm_px(bbox, res, kinds=('road', 'rail', 'water'), src='osm_god_main.json'):
    x0, y0, x1, y1 = bbox
    O = json.load(open(src)); out = {}
    for k in kinds:
        pts = []
        for lon, lat in O[k]:
            X, Y = merc(lon, lat); pts.append(((X - x0) / res, (y1 - Y) / res))
        out[k] = np.array(pts, np.float32)
    return out

def run(nm, W=1500, verbose=True):
    p, bbox, res, im = load(nm, W)
    gray = im[..., :3].mean(2); alpha = im[..., 3]
    valid = (alpha > 200) & (gray > 12)
    valid = cv2.erode(valid.astype(np.uint8), np.ones((25, 25), np.uint8)) > 0   # без рамки й чорного тла
    g8 = cv2.GaussianBlur(gray, (0, 0), 1.2).astype(np.uint8)
    edges = cv2.Canny(g8, 20, 60) > 0
    edges &= valid
    dt = cv2.distanceTransform((~edges).astype(np.uint8), cv2.DIST_L2, 3)
    H, Wd = dt.shape
    O = osm_px(bbox, res)
    L = np.vstack([O['road'], O['rail']] + ([O['water']] if len(O['water']) else []))
    inside = (L[:, 0] > 0) & (L[:, 0] < Wd - 1) & (L[:, 1] > 0) & (L[:, 1] < H - 1)
    inside &= valid[np.clip(L[:, 1].astype(int), 0, H - 1), np.clip(L[:, 0].astype(int), 0, Wd - 1)]
    L = L[inside]
    if len(L) < 50:
        print(nm, 'замало ліній OSM у кадрі', len(L)); return None
    c = np.array([Wd / 2, H / 2])
    def apply(par, pts):
        tx, ty, rot, s, sh = par
        s = max(-0.2, min(0.2, s)); sh = max(-0.2, min(0.2, sh))
        a = math.radians(rot); S = math.exp(s)
        R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]]) * S
        R = R @ np.array([[1, sh], [0, 1]])
        return (pts - c) @ R.T + c + [tx, ty]
    def cost(par, trunc):
        if abs(par[3]) > 0.15 or abs(par[4]) > 0.15 or abs(par[2]) > 12: return trunc
        q = apply(par, L)
        ok = (q[:, 0] >= 0) & (q[:, 0] < Wd - 1) & (q[:, 1] >= 0) & (q[:, 1] < H - 1)
        if ok.sum() < 0.5 * len(L): return trunc
        d = map_coordinates(dt, [q[ok, 1], q[ok, 0]], order=1)
        return float(np.minimum(d, trunc).mean())
    best = None
    # грубий перебір зсуву (до ±150 px ≈ ±300 м Меркатора при W=1500) і повороту
    for rot in (-4, -2, 0, 2, 4):
        for tx in range(-150, 151, 15):
            for ty in range(-150, 151, 15):
                v = cost((tx, ty, rot, 0, 0), 12)
                if best is None or v < best[0]: best = (v, (tx, ty, rot, 0, 0))
    par = np.array(best[1], float)
    for trunc in (12, 6, 3):
        r = minimize(lambda z: cost(z, trunc), par, method='Powell', options={'xtol': 1e-3, 'ftol': 1e-5, 'maxiter': 6000})
        par = r.x
    final = cost(par, 3)
    base = cost((0, 0, 0, 0, 0), 3)
    shift_m = math.hypot(par[0], par[1]) * res * math.cos(math.radians(47.66))
    if verbose: print(nm, f'ліній OSM {len(L)}; зрізана відстань {base:.2f} -> {final:.2f} px; зсув {par[0]:.0f},{par[1]:.0f} px (~{shift_m:.0f} м), поворот {par[2]:.2f}°, масштаб {math.exp(par[3]):.4f}, зсув кутів {par[4]:.4f}')
    return {'nm': nm, 'W': W, 'par': par.tolist(), 'center': c.tolist(), 'bbox': list(bbox), 'res': res, 'cost': final, 'cost0': base, 'n': int(len(L))}

if __name__ == '__main__':
    out = {}
    try: out = json.load(open('regs.json'))
    except Exception: pass
    for nm in sys.argv[1].split(','):
        r = run(nm, int(sys.argv[2]) if len(sys.argv) > 2 else 1500)
        if r: out[nm] = r
        json.dump(out, open('regs.json', 'w'), indent=1)
