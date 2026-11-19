#!/usr/bin/env python3
"""Generalkarte 1:200 000 -> один набір тайлів XYZ 512 px (Web Mercator), зуми ZMIN–ZMAX, AVIF.

Покриття — прямокутник усіх аркушів (межі як у MapLibre: x від floor(X(захід)) до ceil(X(схід)) не включно,
так само y), тому сервер ніколи не відповідає 404; тайли без жодного аркуша записуються прозорими.
Піксель тайла ZMAX -> lon/lat -> аркуш -> піксель скану через TPS за 8 точками рамки (gk_det.json),
з поправкою зсуву старої геодезичної основи. Нижчі зуми — зменшення 4 дочірніх тайлів у пам'яті
(обхід у глибину від тайлів зуму SPLIT, без повторного стиснення).

Різкість (2026-11-19, користувач: «не додавати нове, тільки покращити різкість»): перерахунок фільтром
Ланцоша замість білінійного і нерізке маскування яскравості (сигма 1 px, сила 1, поріг 5 рівнів — зерно
паперу не підсилюється). Це лише підсилює краї, які вже є на скані, нічого не домальовує (на відміну від
ШІ-збільшення, яке вигадує літери). На телефоні тайл зуму 11 розтягується втричі, тому без цього підписи
розмиті. Якість AVIF 45: з різкістю на вигляд не гірше за 50, а разом ~100 МБ.

Запуск (з теки скрипта): python3 -I gktiles.py ../../../public/tiles/generalkarte [--zmax 11] [--zmin 5] [--q 45]
        [--usm 1.0,1.0,5] [--interp lanczos] [--speed 6] [--jobs 4]
        python3 -I gktiles.py <тека> --one z/x/y   (один тайл без стиснення, PNG, для перевірки)
Вихід: <out>/{z}/{x}/{y}.avif; межі й зуми друкуються наприкінці (поля bounds, minzoom, maxzoom
у data/maps/generalkarte-1910.json)."""
import argparse, json, math, os, sys
from multiprocessing import Pool
import numpy as np, cv2
from PIL import Image
from scipy.interpolate import RBFInterpolator

Image.MAX_IMAGE_PIXELS = None
B = os.environ.get('GK_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')) + '/'
SHIFT = (-0.000965, -0.00074)
T = 512
PAPER = (232, 226, 210)  # колір під прозорими пікселями, щоб стиснення не давало темної облямівки

ap = argparse.ArgumentParser()
ap.add_argument('out'); ap.add_argument('--zmax', type=int, default=11); ap.add_argument('--zmin', type=int, default=5)
ap.add_argument('--split', type=int, default=9); ap.add_argument('--q', type=int, default=45)
ap.add_argument('--speed', type=int, default=6); ap.add_argument('--jobs', type=int, default=4)
ap.add_argument('--one'); ap.add_argument('--fmt', default='avif')
ap.add_argument('--interp', default='lanczos', choices=['linear', 'cubic', 'lanczos'])
ap.add_argument('--usm', default='1.0,1.0,5', help='підвищення різкості «сигма,сила,поріг» (нерізке маскування яскравості), 0 — без нього')
A = ap.parse_args()
INTERP = {'linear': cv2.INTER_LINEAR, 'cubic': cv2.INTER_CUBIC, 'lanczos': cv2.INTER_LANCZOS4}[A.interp]
USM = tuple(float(v) for v in A.usm.split(',')) if A.usm != '0' else None

det = json.load(open(B + 'r3300/gk_det.json'))
SHEETS = {tuple(map(int, k.split('-'))): k for k in det}
def west(L): return L - 0.5 - 17 - 40 / 60 + SHIFT[0]
def north(P): return P + 0.5 + SHIFT[1]
Ls = [L for L, _ in SHEETS]; Ps = [P for _, P in SHEETS]
BOUNDS = [west(min(Ls)), north(min(Ps)) - 1, west(max(Ls)) + 1, north(max(Ps))]  # w, s, e, n

def mx(lon, z): return (lon + 180) / 360 * 2 ** z
def my(lat, z): return (1 - math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) / math.pi) / 2 * 2 ** z
def cover(z):
    w, s, e, n = BOUNDS
    return (math.floor(mx(w, z)), math.ceil(mx(e, z)), math.floor(my(n, z)), math.ceil(my(s, z)))  # x0, x1(excl), y0, y1(excl)

_cache = {}
def sheet(LP):
    if LP in _cache: return _cache[LP]
    if len(_cache) >= 6: _cache.pop(next(iter(_cache)))
    k = SHEETS[LP]; d = det[k]; L, P = LP
    c, m = d['corners'], d['mids']
    src = cv2.imread(B + f'orig/{k}.jpg', cv2.IMREAD_COLOR)
    sc = src.shape[1] / d['size'][0]
    px = (np.array([c['nw'], m['n'], c['ne'], m['e'], c['se'], m['s'], c['sw'], m['w']], float) + 0.5) * sc - 0.5
    W0, N0 = west(L), north(P)
    geo = np.array([[W0, N0], [W0 + .5, N0], [W0 + 1, N0], [W0 + 1, N0 - .5], [W0 + 1, N0 - 1], [W0 + .5, N0 - 1], [W0, N0 - 1], [W0, N0 - .5]])
    _cache[LP] = (src, RBFInterpolator(geo, px, kernel='thin_plate_spline'))
    return _cache[LP]

def sharpen(bgr):
    """Нерізке маскування лише яскравості: підсилює наявні краї ліній і літер, кольори не чіпає.
    Поріг гасить підсилення дрібного зерна паперу (різниця з розмитою копією менша за поріг)."""
    sigma, amount, thr = USM
    ycc = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb).astype(np.float32)
    Y = ycc[..., 0]
    d = Y - cv2.GaussianBlur(Y, (0, 0), sigma)
    if thr > 0: d *= np.clip((np.abs(d) - thr) / thr, 0, 1)
    ycc[..., 0] = Y + amount * d
    return cv2.cvtColor(np.clip(np.rint(ycc), 0, 255).astype(np.uint8), cv2.COLOR_YCrCb2BGR)

def render(z, x, y):
    """RGBA uint8 (T, T, 4) тайла найбільшого зуму."""
    gx = (x + (np.arange(T) + 0.5) / T) / 2 ** z * 360 - 180
    yy = (y + (np.arange(T) + 0.5) / T) / 2 ** z
    gy = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * yy))))
    LON, LAT = np.meshgrid(gx, gy)
    Lidx = np.floor(LON - west(0)).astype(int)
    Pidx = np.ceil(LAT - north(0)).astype(int)
    out = np.zeros((T, T, 4), np.uint8)
    for L, P in set(zip(Lidx.ravel().tolist(), Pidx.ravel().tolist())):
        if (L, P) not in SHEETS: continue
        sel = (Lidx == L) & (Pidx == P)
        src, f = sheet((L, P))
        # весь тайл з цього аркуша (за рамкою — поля аркуша), щоб різкість біля межі рахувалася за сусідніми
        # пікселями скана, а не за прозорими; далі беремо лише пікселі всередині рамки
        pp = f(np.stack([LON.ravel(), LAT.ravel()], 1)).astype(np.float32)
        samp = cv2.remap(src, pp[:, 0].reshape(T, T), pp[:, 1].reshape(T, T), INTERP, borderMode=cv2.BORDER_REPLICATE)
        if USM: samp = sharpen(samp)
        out[sel, :3] = samp[sel][:, ::-1]; out[sel, 3] = 255
    return out

def save(arr, z, x, y):
    d = f'{A.out}/{z}/{x}'; os.makedirs(d, exist_ok=True)
    a = arr[..., 3]
    if a.min() == 255:
        im = Image.fromarray(arr[..., :3], 'RGB')
    else:
        arr = arr.copy(); arr[a == 0, :3] = PAPER
        im = Image.fromarray(arr, 'RGBA')
    if A.fmt == 'avif': im.save(f'{d}/{y}.avif', 'AVIF', quality=A.q, speed=A.speed)
    elif A.fmt == 'webp': im.save(f'{d}/{y}.webp', 'WEBP', quality=A.q, method=6)
    else: im.save(f'{d}/{y}.png', 'PNG')

def inside(z, x, y):
    x0, x1, y0, y1 = cover(z)
    return x0 <= x < x1 and y0 <= y < y1

def down(children):
    """4 дочірні RGBA (або None) -> батьківський RGBA, зменшення з урахуванням прозорості."""
    can = np.zeros((2 * T, 2 * T, 4), np.uint8)
    for (dx, dy), c in children.items():
        if c is not None: can[dy * T:(dy + 1) * T, dx * T:(dx + 1) * T] = c
    im = Image.fromarray(can, 'RGBA').resize((T, T), Image.LANCZOS)  # Pillow зменшує RGBA з premultiplied alpha
    return np.asarray(im).copy()

def tree(zxy):
    z, x, y = zxy
    if not inside(z, x, y): return None
    if z == A.zmax:
        arr = render(z, x, y)
    else:
        arr = down({(dx, dy): tree((z + 1, 2 * x + dx, 2 * y + dy)) for dx in (0, 1) for dy in (0, 1)})
    save(arr, z, x, y)
    return arr

if __name__ == '__main__':
    if A.one:
        z, x, y = map(int, A.one.split('/'))
        os.makedirs(A.out, exist_ok=True)
        Image.fromarray(render(z, x, y), 'RGBA').save(f'{A.out}/{z}-{x}-{y}.png')
        sys.exit()
    x0, x1, y0, y1 = cover(A.split)
    jobs = [(A.split, x, y) for y in range(y0, y1) for x in range(x0, x1)]
    print('bounds', [round(v, 6) for v in BOUNDS], 'split tiles', len(jobs), flush=True)
    res = {}
    with Pool(A.jobs) as pool:
        for i, arr in enumerate(pool.imap(tree, jobs)):
            res[jobs[i][1:]] = arr
            if i % 10 == 0: print('split', i, '/', len(jobs), flush=True)
    for z in range(A.split - 1, A.zmin - 1, -1):
        nxt = {}
        x0, x1, y0, y1 = cover(z)
        for x in range(x0, x1):
            for y in range(y0, y1):
                arr = down({(dx, dy): res.get((2 * x + dx, 2 * y + dy)) for dx in (0, 1) for dy in (0, 1)})
                save(arr, z, x, y); nxt[(x, y)] = arr
        res = nxt
        print('z', z, 'tiles', len(nxt), flush=True)
    print(json.dumps({'bounds': [round(v, 6) for v in BOUNDS], 'minzoom': A.zmin, 'maxzoom': A.zmax, 'tileSize': T}))
