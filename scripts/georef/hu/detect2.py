#!/usr/bin/env python3 -I
"""Кути географічної рамки аркуша Spezialkarte, версія 2.

Рамка: зовнішня лінія — поле з підписами — смуга поділок хвилин (дві лінії на відстані 4–13 px
при ширині копії ~3300 px, між ними сіро-білі поділки) — карта. Межа карти = центр внутрішньої
лінії смуги. Тло скану поза папером (темне) вилучається. Для кожної сторони: смуга 25 % краю
зображення, кут нахилу — за найгострішим профілем, далі три відрізки вздовж сторони; у профілі
кожного відрізка шукаємо пару піків «лінія–заповнення–лінія» з порожнішим полем ззовні.
"""
import json, os, sys
import numpy as np, cv2

def load(path):
    g = cv2.imread(path, cv2.IMREAD_GRAYSCALE).astype(np.float32)
    H, W = g.shape
    c = g[int(H * .2):int(H * .8), int(W * .2):int(W * .8)]
    paper = float(np.percentile(c, 80))
    D = np.clip((paper - g) / (0.75 * paper), 0, 1)
    bg = (g < 0.40 * paper).astype(np.uint8)
    bg = cv2.morphologyEx(bg, cv2.MORPH_OPEN, np.ones((31, 31), np.uint8))
    # лише темні плями, що торкаються краю зображення
    n, lab = cv2.connectedComponents(bg)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    m = np.isin(lab, list(edge)).astype(np.uint8)
    m = cv2.dilate(m, np.ones((9, 9), np.uint8))
    D[m > 0] = 0
    return D, paper, float(m.mean())

def prof(Dt, a, b, r0, r1, ang, mid):
    xs = np.arange(a, b, dtype=np.float32)
    ys = np.arange(r0, r1, dtype=np.float32)
    t = np.tan(np.radians(ang))
    mapx = np.ascontiguousarray(np.broadcast_to(xs, (len(ys), len(xs))), dtype=np.float32)
    mapy = (ys[:, None] + (xs[None, :] - mid) * t).astype(np.float32)
    r = cv2.remap(Dt, mapx, mapy, cv2.INTER_LINEAR, borderValue=0)
    return r.mean(axis=1)

def parab(p, i):
    if 0 < i < len(p) - 1:
        a, b, c = float(p[i - 1]), float(p[i]), float(p[i + 1])
        d = a - 2 * b + c
        if d < 0: return float(i + 0.5 * (a - c) / d)
    return float(i)

def peaks(p, thr=0.10):
    out = []
    for i in range(2, len(p) - 2):
        if p[i] >= thr and p[i] >= p[i - 1] and p[i] > p[i + 1] and p[i] >= p[i - 2] and p[i] >= p[i + 2]:
            out.append(i)
    return out

def find_band(p, smin, smax):
    """p — профіль від краю зображення всередину.
    1) поле: найближчий до карти відрізок «порожніх» значень (>= 5 px) — шукаємо зсередини назовні;
    2) зовнішній край смуги x1 — кінець поля (перехід через поріг, субпіксельно);
    3) внутрішня лінія смуги — пік у [x1+smin, x1+smax]; якщо піка немає — найкрутіший підйом там же."""
    n = len(p)
    blank = float(np.percentile(p[: int(n * 0.6)], 20))
    mapl = float(np.percentile(p[int(n * 0.55):], 75))
    if mapl - blank < 0.03:
        return None, {'why': 'low contrast', 'blank': round(blank, 3), 'map': round(mapl, 3)}
    thr = blank + max(0.015, 0.25 * (mapl - blank))
    below = p < thr
    i = n - 1
    run = 0; x_end = None
    while i >= 0:
        if below[i]:
            run += 1
            if run >= 5:
                x_end = i + run
                break
        else:
            run = 0
        i -= 1
    if x_end is None or x_end >= n - 10:
        return None, {'why': 'no margin', 'blank': round(blank, 3), 'map': round(mapl, 3)}
    # ширина поля: скільки підряд «порожніх» значень назовні від x_end (допускаючи поодинокі викиди)
    j = x_end - 1; miss = 0; width = 0
    while j >= 0 and miss <= 2:
        if below[j]: width += 1; miss = 0
        else: miss += 1
        j -= 1
    if width < 12:
        return None, {'why': 'narrow margin %d' % width, 'blank': round(blank, 3), 'map': round(mapl, 3)}
    # субпіксельний перехід через поріг між x_end-1 і x_end
    a, b = float(p[x_end - 1]), float(p[x_end])
    x1 = (x_end - 1) + ((thr - a) / (b - a) if b != a else 0.5)
    lo, hi = int(np.floor(x1 + smin)), int(np.ceil(x1 + smax))
    if hi + 2 >= n:
        return None, {'why': 'edge'}
    seg = p[lo:hi + 1]
    k = lo + int(np.argmax(seg))
    prom = float(p[k] - min(p[k - 2], p[min(k + 3, n - 1)]))
    fill = float(p[int(np.ceil(x1)) + 1: max(int(np.ceil(x1)) + 2, k - 1)].mean())
    if 0 < k - lo < len(seg) - 1 and p[k] > fill + 0.02 and prom > 0.015:
        x2, how = parab(p, k), 'peak'
    else:
        sm = np.convolve(p, np.ones(3) / 3, mode='same')
        d = np.diff(sm[lo - 1:hi + 2])
        j = int(np.argmax(d))
        x2, how = lo - 1 + j + 0.5, 'rise'
    return x2, {'x1': round(x1, 2), 'x2': round(float(x2), 2), 'w': round(float(x2 - x1), 2), 'how': how,
                'blank': round(blank, 3), 'map': round(mapl, 3), 'pk': round(float(p[k]), 2), 'fill': round(fill, 2)}

def find_band_b(p, sc):
    """Від зовнішньої рамки: сильний пік (> 0.18), за ним усередину порожня смуга підписів 20–40 px
    (у масштабі ширини 3300 px), далі смуга поділок; межа — внутрішня лінія смуги."""
    n = len(p)
    blank = float(np.percentile(p[: int(n * 0.6)], 20))
    thr = blank + 0.03
    best = None
    for i in range(2, n - 60):
        if p[i] < 0.18 or not (p[i] >= p[i - 1] and p[i] >= p[i + 1]): continue
        j = i + 1
        while j < n and p[j] >= thr and j - i < 6: j += 1      # хвіст лінії
        k = j
        while k < n and p[k] < thr: k += 1                       # порожня смуга
        L = k - j
        if not (20 * sc <= L <= 42 * sc) or k >= n - 20: continue
        # заповнення смуги й карта далі не порожні
        if p[k:k + int(14 * sc)].mean() < thr + 0.02: continue
        cand = (abs(L - 30 * sc), i, k)
        if best is None or cand < best: best = cand
    if best is None:
        return None, {'why': 'no border'}
    _, ib, k = best
    a, b = float(p[k - 1]), float(p[k])
    x1 = (k - 1) + ((thr - a) / (b - a) if b != a else 0.5)
    lo, hi = int(np.floor(x1 + 5.5 * sc)), int(np.ceil(x1 + 12.5 * sc))
    if hi + 3 >= n: return None, {'why': 'edge'}
    seg = p[lo:hi + 1]
    kk = lo + int(np.argmax(seg))
    fill = float(p[int(np.ceil(x1)) + 1: max(int(np.ceil(x1)) + 2, kk - 1)].mean())
    prom = float(p[kk] - min(p[kk - 2], p[kk + 3]))
    if 0 < kk - lo < len(seg) - 1 and p[kk] > fill + 0.015 and prom > 0.012:
        x2, how = parab(p, kk), 'peak'
    else:
        sm = np.convolve(p, np.ones(3) / 3, mode='same')
        dd = np.diff(sm[lo - 1:hi + 2])
        x2, how = lo - 1 + int(np.argmax(dd)) + 0.5, 'rise'
    return x2, {'x1': round(x1, 2), 'x2': round(float(x2), 2), 'w': round(float(x2 - x1), 2), 'how': how, 'border': ib,
                'strip': round(x1 - ib, 1), 'pk': round(float(p[kk]), 2), 'fill': round(fill, 2), 'm': 'b'}

def side_scan(D, side, ang_range=None):
    H, W = D.shape
    if side in ('top', 'bottom'):
        Dt = D; N, M = H, W
    else:
        Dt = np.ascontiguousarray(D.T); N, M = W, H
    depth = int(0.25 * N); edge = int(0.015 * N)
    r0, r1 = (edge, depth) if side in ('top', 'left') else (N - depth, N - edge)
    A, B = int(0.12 * M), int(0.88 * M)
    mid = (A + B) / 2
    def score(ang):
        pp = prof(Dt, A, B, r0, r1, ang, mid)
        return float(np.sort(pp)[-4:].sum() + 5 * np.abs(np.diff(pp)).max())
    lo, hi = ang_range if ang_range else (-3.0, 3.0)
    angs = np.arange(lo, hi + 1e-4, 0.1)
    sc = [score(a) for a in angs]
    a0 = float(angs[int(np.argmax(sc))])
    fine = np.arange(a0 - 0.1, a0 + 0.1001, 0.01)
    sc = [score(a) for a in fine]
    ang = float(fine[int(np.argmax(sc))])
    segs = []
    NS = 8
    for i in range(NS):
        f0, f1 = i / NS + 0.005, (i + 1) / NS - 0.005
        a, b = int(A + f0 * (B - A)), int(A + f1 * (B - A))
        pp = prof(Dt, a, b, r0, r1, ang, mid)
        inward = side in ('top', 'left')
        q = pp if inward else pp[::-1]
        pos, info = find_band_b(q, W / 3300.0)
        if pos is None:
            pos, info = find_band(q, 4.5 * W / 3300.0, 11.0 * W / 3300.0)
            info['m'] = 'i'
        if pos is None:
            continue
        e = (r0 + pos) if inward else (r1 - 1 - pos)
        t = (a + b) / 2
        segs.append({'t': t, 'e': float(e + (t - mid) * np.tan(np.radians(ang))), **info})
    return ang, segs

def fit_side(segs, wmed):
    c = [s for s in segs if abs(s['w'] - wmed) < 1.3]
    pk = [s for s in c if s['how'] == 'peak']
    if len(pk) >= 3: c = pk
    if len(c) < 3: return None
    t = np.array([s['t'] for s in c]); e = np.array([s['e'] for s in c])
    best = None
    for i in range(len(c)):
        for j in range(i + 1, len(c)):
            k = (e[j] - e[i]) / (t[j] - t[i]); b0 = e[i] - k * t[i]
            inl = np.abs(e - (k * t + b0)) < 1.0
            if best is None or inl.sum() > best.sum() or (inl.sum() == best.sum() and (t[inl].max() - t[inl].min()) > (t[best].max() - t[best].min())):
                best = inl
    if best.sum() < 3: return None
    k, b0 = np.polyfit(t[best], e[best], 1)
    res = e[best] - (k * t[best] + b0)
    return float(k), float(b0), int(best.sum()), round(float(np.sqrt((res ** 2).mean())), 2), round(float(t[best].max() - t[best].min()), 1)

def detect(path):
    D, paper, bgfrac = load(path)
    H, W = D.shape
    out = {'size': [W, H], 'paper': round(paper, 1), 'bg': round(bgfrac, 3), 'sides': {}}
    scans = {s: side_scan(D, s) for s in ('top', 'bottom', 'left', 'right')}
    # узгодити кути: поворот з верхньої/нижньої сторін; бокові — у вузькому вікні
    rot = (scans['top'][0] + scans['bottom'][0]) / 2
    if abs(scans['top'][0] - scans['bottom'][0]) > 0.3:
        rot = scans['top'][0] if len(scans['top'][1]) >= len(scans['bottom'][1]) else scans['bottom'][0]
        for s in ('top', 'bottom'):
            if abs(scans[s][0] - rot) > 0.3: scans[s] = side_scan(D, s, (rot - 0.3, rot + 0.3))
    for s in ('left', 'right'):
        if abs(scans[s][0] + rot) > 0.45:
            scans[s] = side_scan(D, s, (-rot - 0.4, -rot + 0.4))
    ws = [g['w'] for s in scans.values() for g in s[1] if g['how'] == 'peak' and g.get('m') == 'b'] or [g['w'] for s in scans.values() for g in s[1] if g['how'] == 'peak']
    wmed = float(np.median(ws)) if ws else 9.5 * W / 3300.0
    out['wmed'] = round(wmed, 2)
    lines = {}
    for side, (ang, segs) in scans.items():
        f = fit_side(segs, wmed)
        out['sides'][side] = {'ang': round(ang, 3), 'n': len(segs), 'fit': None if f is None else {'inliers': f[2], 'rms': f[3], 'span': f[4]},
                              'segs': [[round(g['t'], 1), round(g['e'], 2), g['w'], g['how'], g.get('m')] for g in segs]}
        lines[side] = None if f is None else (f[0], f[1])
    if any(lines[s] is None for s in lines):
        out['corners'] = None
        return out
    def inter(h, v):
        kh, ch = lines[h]; kv, cv = lines[v]
        y = (kh * cv + ch) / (1 - kh * kv); x = kv * y + cv
        return [round(x, 2), round(y, 2)]
    out['corners'] = {'nw': inter('top', 'left'), 'ne': inter('top', 'right'), 'sw': inter('bottom', 'left'), 'se': inter('bottom', 'right')}
    return out

if __name__ == '__main__':
    res = {}
    for p in sys.argv[1:]:
        k = p.rsplit('/', 1)[-1].rsplit('.', 1)[0]
        try:
            res[k] = detect(p)
        except Exception as ex:
            res[k] = {'error': repr(ex)}
        print(k, json.dumps(res[k].get('corners')), flush=True, file=sys.stderr)
    print(json.dumps(res, default=float))
