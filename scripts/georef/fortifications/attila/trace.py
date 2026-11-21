"""Траси з рис. 8 (Juhász–Balogh 2025): найдешевший шлях по червоних пікселях між опорними точками,
спрощення (Дуглас–Пекер), перерахунок у lon/lat афінною прив'язкою (affine.json)."""
import json, heapq, math
import numpy as np
from PIL import Image

im = np.asarray(Image.open('left.png').convert('RGB')).astype(int)
R, G, B = im[..., 0], im[..., 1], im[..., 2]
rs = R - G
cost = np.where(rs > 60, 1.0, np.where(rs > 40, 1.5, np.where(rs > 25, 4.0, 18.0)))
H, W = cost.shape

def path(a, b, margin=8):
    (ax, ay), (bx, by) = a, b
    x0, x1 = max(0, min(ax, bx) - margin), min(W - 1, max(ax, bx) + margin)
    y0, y1 = max(0, min(ay, by) - margin), min(H - 1, max(ay, by) + margin)
    start, goal = (ay, ax), (by, bx)
    dist = {start: 0.0}; prev = {}; pq = [(0.0, start)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == goal: break
        if d > dist.get(u, 1e18): continue
        uy, ux = u
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0: continue
                vy, vx = uy + dy, ux + dx
                if not (y0 <= vy <= y1 and x0 <= vx <= x1): continue
                w = (cost[uy, ux] + cost[vy, vx]) / 2 * (1.4142 if dx and dy else 1.0)
                nd = d + w
                if nd < dist.get((vy, vx), 1e18):
                    dist[(vy, vx)] = nd; prev[(vy, vx)] = u; heapq.heappush(pq, (nd, (vy, vx)))
    out = [goal]
    while out[-1] != start: out.append(prev[out[-1]])
    return [(x, y) for y, x in reversed(out)]

def dp(pts, eps):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float)
    ab = b - a; L = np.hypot(*ab)
    best, bi = -1, 0
    for i in range(1, len(pts) - 1):
        p = np.array(pts[i], float)
        d = abs(ab[0] * (a[1] - p[1]) - ab[1] * (a[0] - p[0])) / L if L else np.hypot(*(p - a))
        if d > best: best, bi = d, i
    if best <= eps: return [pts[0], pts[-1]]
    return dp(pts[:bi + 1], eps)[:-1] + dp(pts[bi:], eps)

A = json.load(open('affine.json'))
cx, cy = np.array(A['cx']), np.array(A['cy'])
def ll(p):
    x, y = p
    return [round(float(cx[0] * x + cx[1] * y + cx[2]), 5), round(float(cy[0] * x + cy[1] * y + cy[2]), 5)]

def trace(wps):
    full = [tuple(wps[0])]
    for a, b in zip(wps, wps[1:]):
        full += path(tuple(a), tuple(b))[1:]
    # згладжування: ковзне середнє по 5 точках (прибирає піксельні «сходинки»), кінці лишаються
    arr = np.array(full, float)
    if len(arr) > 6:
        k = 2; sm = arr.copy()
        for i in range(k, len(arr) - k): sm[i] = arr[i - k:i + k + 1].mean(0)
        arr = sm
    simp = dp([tuple(p) for p in arr], 0.7)
    return simp

if __name__ == '__main__':
    lines = json.load(open('waypoints.json'))
    out = {}
    for name, rec in lines.items():
        s = trace(rec['wps'])
        out[name] = {'kind': rec['kind'], 'px': [[round(x, 1), round(y, 1)] for x, y in s], 'll': [ll(p) for p in s]}
        print(name, rec['kind'], len(rec['wps']), '->', len(s))
    json.dump(out, open('traced.json', 'w'), ensure_ascii=False)
