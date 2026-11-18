#!/usr/bin/env python3 -I
"""Опорні точки для кожного аркуша: 4 кути + 4 середини сторін (сторони — квадратичні криві з
RANSAC по відрізках детектора), переведені в пікселі повного зображення IIIF.
Вибір джерела: основний скан, якщо він пройшов перевірку геометрії, інакше запасний NYPL."""
import json, os, math, itertools
import numpy as np
S = os.environ.get('HU_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')) + '/'
SHIFT = (-0.000965, -0.00074)
src = json.load(open(S + 'sources.json'))
alt = json.load(open(S + 'alt.json'))
dets = {'main': json.load(open(S + 'det_all.json')), 'alt': json.load(open(S + 'alt/det_all.json'))}

A_ = 6377397.155; F_ = 1 / 299.1528128; E2 = F_ * (2 - F_)
def expected(z):
    pn = math.radians(48.75 - (z - 11) * 0.25); ps = pn - math.radians(0.25)
    Nr = lambda p: A_ / math.sqrt(1 - E2 * math.sin(p) ** 2)
    Mr = lambda p: A_ * (1 - E2) / (1 - E2 * math.sin(p) ** 2) ** 1.5
    top = math.radians(0.5) * Nr(pn) * math.cos(pn); bot = math.radians(0.5) * Nr(ps) * math.cos(ps)
    return (top + bot) / 2 / (math.radians(0.25) * Mr((pn + ps) / 2)), top / bot

def side_curve(segs, wmed):
    c = [g for g in segs if abs(g[2] - wmed) < 1.3]
    pk = [g for g in c if g[3] == 'peak']
    if len(pk) >= 4: c = pk
    if len(c) < 3: return None
    t = np.array([g[0] for g in c]); e = np.array([g[1] for g in c])
    best = None
    deg = 2 if len(c) >= 5 else 1
    for comb in itertools.combinations(range(len(c)), deg + 1):
        co = np.polyfit(t[list(comb)], e[list(comb)], deg)
        inl = np.abs(e - np.polyval(co, t)) < 1.2
        key = (inl.sum(), -np.abs(e[inl] - np.polyval(co, t[inl])).sum())
        if best is None or key > best[0]: best = (key, inl)
    inl = best[1]
    if inl.sum() < 3: return None
    d = 2 if inl.sum() >= 5 else 1
    co = np.polyfit(t[inl], e[inl], d)
    if d == 2:
        # кривизна має бути помірною: прогин на всій довжині не більше 8 px
        L = t.max() - t.min()
        if abs(co[0]) * (L / 2) ** 2 > 14: co = np.polyfit(t[inl], e[inl], 1); d = 1
    res = e[inl] - np.polyval(co, t[inl])
    return {'co': co, 'deg': d, 'n': int(inl.sum()), 'rms': float(np.sqrt((res ** 2).mean())), 'tmin': float(t[inl].min()), 'tmax': float(t[inl].max())}

def solve(det):
    wmed = det.get('wmed') or 9.0
    cur = {s: side_curve(det['sides'][s]['segs'], wmed) for s in ('top', 'bottom', 'left', 'right')}
    if any(v is None for v in cur.values()): return None
    f = lambda s, t: float(np.polyval(cur[s]['co'], t))
    def corner(h, v):
        x, y = 0.0, 0.0
        y = f(h, f(v, 0.0))
        for _ in range(20):
            x = f(v, y); y = f(h, x)
        return [x, y]
    c = {'nw': corner('top', 'left'), 'ne': corner('top', 'right'), 'sw': corner('bottom', 'left'), 'se': corner('bottom', 'right')}
    xm_t = (c['nw'][0] + c['ne'][0]) / 2; xm_b = (c['sw'][0] + c['se'][0]) / 2
    ym_l = (c['nw'][1] + c['sw'][1]) / 2; ym_r = (c['ne'][1] + c['se'][1]) / 2
    m = {'n': [xm_t, f('top', xm_t)], 's': [xm_b, f('bottom', xm_b)], 'w': [f('left', ym_l), ym_l], 'e': [f('right', ym_r), ym_r]}
    bows = {'n': m['n'][1] - (c['nw'][1] + c['ne'][1]) / 2, 's': m['s'][1] - (c['sw'][1] + c['se'][1]) / 2,
            'w': m['w'][0] - (c['nw'][0] + c['sw'][0]) / 2, 'e': m['e'][0] - (c['ne'][0] + c['se'][0]) / 2}
    return {'corners': c, 'mids': m, 'bows': {k: round(v, 2) for k, v in bows.items()},
            'fit': {s: {'deg': v['deg'], 'n': v['n'], 'rms': round(v['rms'], 2)} for s, v in cur.items()}}

def geom(c, z):
    d = lambda a, b: math.hypot(a[0] - b[0], a[1] - b[1])
    ae, re_ = expected(z)
    top, bot = d(c['nw'], c['ne']), d(c['sw'], c['se']); lef, rig = d(c['nw'], c['sw']), d(c['ne'], c['se'])
    return {'aspect': round(((top + bot) / (lef + rig) / ae - 1) * 100, 2), 'tb': round((top / bot / re_ - 1) * 100, 2), 'lr': round((lef / rig - 1) * 100, 2)}

def ok(g, sol):
    return (-2.6 < g['aspect'] < 1.0 and abs(g['tb']) < 0.6 and abs(g['lr']) < 0.9 and max(abs(b) for b in sol["bows"].values()) < 14)

out = {}
for k in sorted(src, key=lambda k: tuple(map(int, k.split('-')))):
    z, col = map(int, k.split('-'))
    choice = None
    for which in ('main', 'alt'):
        if which == 'alt' and k not in alt: continue
        det = dets[which].get(k)
        if not det or not det.get('sides') or 'error' in det: continue
        sol = solve(det)
        if sol is None: continue
        g = geom(sol['corners'], z)
        if ok(g, sol):
            choice = (which, det, sol, g); break
        elif choice is None:
            choice = (which, det, sol, g, 'BAD')
    if choice is None:
        out[k] = {'status': 'FAIL'}; continue
    which, det, sol, g = choice[:4]
    status = 'BAD' if len(choice) > 4 else 'ok'
    if which == 'main':
        service = src[k]['service']; info = json.load(open(S + f'info/{k}.json'))
    else:
        service = f'https://iiif.nypl.org/iiif/2/{alt[k]}'; info = json.load(open(S + f'info_n/{k}.json'))
    W, H = info['width'], info['height']; w, h = det['size']
    sx, sy = W / w, H / h
    full = lambda p: [round((p[0] + 0.5) * sx, 1), round((p[1] + 0.5) * sy, 1)]
    lonW = 18.3333333333 + (col - 19) * 0.5 + SHIFT[0]; latN = 48.75 - (z - 11) * 0.25 + SHIFT[1]
    lonE, latS = lonW + 0.5, latN - 0.25
    geo = {'nw': [lonW, latN], 'ne': [lonE, latN], 'sw': [lonW, latS], 'se': [lonE, latS],
           'n': [lonW + 0.25, latN], 's': [lonW + 0.25, latS], 'w': [lonW, latN - 0.125], 'e': [lonE, latN - 0.125]}
    pts = {**sol['corners'], **sol['mids']}
    out[k] = {'status': status, 'which': which, 'service': service, 'width': W, 'height': H,
              'title': src[k]['title'] if which == 'main' else None,
              'gcps': [{'px': full(pts[n]), 'geo': [round(geo[n][0], 6), round(geo[n][1], 6)], 'name': n} for n in ('nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w')],
              'geom': g, 'bows': sol['bows'], 'fit': sol['fit'], 'scale': [round(sx, 4), round(sy, 4)]}
json.dump(out, open(S + 'gcps.json', 'w'), indent=1)
from collections import Counter
print(Counter((v['status'], v.get('which')) for v in out.values()))
for k, v in out.items():
    if v['status'] != 'ok': print(k, v['status'], v.get('which'), v.get('geom'), v.get('bows'), v.get('fit'))
big = [(k, v['bows']) for k, v in out.items() if v['status'] == 'ok' and max(abs(b) for b in v['bows'].values()) > 2]
print('bowed >2px:', len(big)); print(big[:40])
