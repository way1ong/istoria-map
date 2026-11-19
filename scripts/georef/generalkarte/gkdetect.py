#!/usr/bin/env python3 -I
"""Рамка аркуша Generalkarte 1:200 000 (скани ELTE на Commons, обрізані впритул до рамки).
Профіль від краю зображення: зовнішня лінія (пік ≥ 0.5) → смуга підписів (низькі значення, ≥ 20 px)
→ смуга поділок: зовнішня лінія → заповнення → внутрішня лінія (межа карти) → карта.
8 відрізків на сторону, кут нахилу за найгострішим профілем, RANSAC/квадратична крива.
"""
import json, sys
import numpy as np, cv2
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from detect2 import load, prof, parab

def band(p):
    n = len(p)
    # 1) зовнішня лінія рамки: перший сильний пік у перших 160 px
    lim = min(420, n - 60)
    ib = None
    for i in range(1, lim):
        if p[i] >= 0.45 and p[i] >= p[i - 1] and p[i] >= p[i + 1]:
            ib = i; break
    if ib is None: return None, {'why': 'no border'}
    j = ib
    while j < n - 1 and p[j] > 0.25: j += 1          # кінець товстої лінії
    # 2) смуга підписів: значення нижчі за 0.22 щонайменше 18 px
    k = j
    while k < n and p[k] < 0.22: k += 1
    L = k - j
    if L < 18 or L > 70 or k >= n - 30: return None, {'why': f'strip {L}'}
    # 3) зовнішня лінія смуги поділок
    o = k + int(np.argmax(p[k:k + 4]))
    if p[o] < 0.3: return None, {'why': 'weak outer'}
    # 4) внутрішня лінія: пік у [o+6, o+15]
    lo, hi = o + 6, o + 16
    q = p[lo:hi]
    ii = lo + int(np.argmax(q))
    fill = float(p[o + 2:ii - 1].mean()) if ii - 1 > o + 2 else 0.0
    if not (0 < ii - lo < len(q) - 1) or p[ii] < fill + 0.12:
        return None, {'why': 'no inner', 'o': o, 'ii': ii}
    return parab(p, ii), {'border': ib, 'strip': L, 'outer': o, 'w': round(parab(p, ii) - o, 2), 'fill': round(fill, 2), 'pk': round(float(p[ii]), 2)}

def scan(D, side):
    H, W = D.shape
    if side in ('top', 'bottom'): Dt = D; N, M = H, W
    else: Dt = np.ascontiguousarray(D.T); N, M = W, H
    depth = 560
    r0, r1 = (0, depth) if side in ('top', 'left') else (N - depth, N)
    A, B = int(0.08 * M), int(0.92 * M); mid = (A + B) / 2
    def score(a):
        pp = prof(Dt, A, B, r0, r1, a, mid)
        return float(np.sort(pp)[-6:].sum())
    angs = np.arange(-2.0, 2.0001, 0.05); s = [score(a) for a in angs]
    a0 = float(angs[int(np.argmax(s))])
    fine = np.arange(a0 - 0.05, a0 + 0.0501, 0.005); s = [score(a) for a in fine]
    ang = float(fine[int(np.argmax(s))])
    segs = []
    NS = 10
    for i in range(NS):
        a, b = int(A + (i / NS + 0.005) * (B - A)), int(A + ((i + 1) / NS - 0.005) * (B - A))
        pp = prof(Dt, a, b, r0, r1, ang, mid)
        q = pp if side in ('top', 'left') else pp[::-1]
        pos, info = band(q)
        if pos is None: continue
        e = (r0 + pos) if side in ('top', 'left') else (r1 - 1 - pos)
        t = (a + b) / 2
        segs.append([t, float(e + (t - mid) * np.tan(np.radians(ang))), info])
    return ang, segs

def fitcurve(segs):
    if len(segs) < 3: return None
    t = np.array([s[0] for s in segs]); e = np.array([s[1] for s in segs])
    import itertools
    best = None
    deg = 2 if len(segs) >= 5 else 1
    for comb in itertools.combinations(range(len(t)), deg + 1):
        co = np.polyfit(t[list(comb)], e[list(comb)], deg)
        inl = np.abs(e - np.polyval(co, t)) < 1.5
        key = (inl.sum(), -np.abs(e[inl] - np.polyval(co, t[inl])).sum())
        if best is None or key > best[0]: best = (key, inl)
    inl = best[1]
    if inl.sum() < 3: return None
    d = 2 if inl.sum() >= 5 else 1
    co = np.polyfit(t[inl], e[inl], d)
    if d == 2 and abs(co[0]) * ((t.max() - t.min()) / 2) ** 2 > 15: co = np.polyfit(t[inl], e[inl], 1); d = 1
    res = e[inl] - np.polyval(co, t[inl])
    return {'co': co.tolist(), 'deg': d, 'n': int(inl.sum()), 'rms': round(float(np.sqrt((res ** 2).mean())), 2)}

def detect(path):
    D, paper, bg = load(path)
    out = {'size': [D.shape[1], D.shape[0]], 'sides': {}}
    cur = {}
    for side in ('top', 'bottom', 'left', 'right'):
        ang, segs = scan(D, side)
        f = fitcurve(segs)
        out['sides'][side] = {'ang': round(ang, 3), 'segs': [[round(s[0], 1), round(s[1], 2), s[2]] for s in segs], 'fit': f}
        cur[side] = f
    if any(v is None for v in cur.values()):
        out['corners'] = None; return out
    fv = lambda s, t: float(np.polyval(cur[s]['co'], t))
    def corner(h, v):
        y = fv(h, fv(v, 0.0)); x = 0.0
        for _ in range(30): x = fv(v, y); y = fv(h, x)
        return [round(x, 2), round(y, 2)]
    c = {'nw': corner('top', 'left'), 'ne': corner('top', 'right'), 'sw': corner('bottom', 'left'), 'se': corner('bottom', 'right')}
    xm_t = (c['nw'][0] + c['ne'][0]) / 2; xm_b = (c['sw'][0] + c['se'][0]) / 2
    ym_l = (c['nw'][1] + c['sw'][1]) / 2; ym_r = (c['ne'][1] + c['se'][1]) / 2
    out['corners'] = c
    out['mids'] = {'n': [xm_t, fv('top', xm_t)], 's': [xm_b, fv('bottom', xm_b)], 'w': [fv('left', ym_l), ym_l], 'e': [fv('right', ym_r), ym_r]}
    return out

if __name__ == '__main__':
    res = {}
    for p in sys.argv[1:]:
        k = p.rsplit('/', 1)[-1].rsplit('.', 1)[0]
        res[k] = detect(p)
        r = res[k]
        print(k, 'OK' if r['corners'] else 'FAIL', {s: (x['fit'] or {}).get('n') for s, x in r['sides'].items()}, {s: (x['fit'] or {}).get('rms') for s, x in r['sides'].items()}, flush=True)
    json.dump(res, open('gk_det.json', 'w'), default=float)
