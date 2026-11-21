"""Обведення окопу на вирізці geocrop.py: найдешевший шлях між опорними точками по темній лінії (окоп темніший за
сусідні пікселі; світлі бровки по боках дорожчі), згладжування, спрощення, перерахунок у lon/lat.
Використання з Python: trace(шлях_вирізки, [[x, y], ...], dark=True) -> список [lon, lat]."""
import heapq, json
import numpy as np, cv2
from PIL import Image
import geocrop

def cost_map(img, dark=True):
    g = np.asarray(Image.fromarray(img).convert('L')).astype(np.float32)
    g = cv2.GaussianBlur(g, (0, 0), 0.8)
    loc = cv2.GaussianBlur(g, (0, 0), 6)
    diff = (g - loc) if dark else (loc - g)          # від'ємне там, де піксель темніший (світліший) за околицю
    return 0.4 + np.clip((diff + 4) / 16, 0, 2.5) * 4

def path(cost, a, b, margin=12):
    (ax, ay), (bx, by) = map(lambda t: (int(round(t[0])), int(round(t[1]))), (a, b))
    H, W = cost.shape
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
                if not dx and not dy: continue
                vy, vx = uy + dy, ux + dx
                if not (y0 <= vy <= y1 and x0 <= vx <= x1): continue
                nd = d + (cost[uy, ux] + cost[vy, vx]) / 2 * (1.4142 if dx and dy else 1.0)
                if nd < dist.get((vy, vx), 1e18):
                    dist[(vy, vx)] = nd; prev[(vy, vx)] = u; heapq.heappush(pq, (nd, (vy, vx)))
    out = [goal]
    while out[-1] != start: out.append(prev[out[-1]])
    return [(x, y) for y, x in reversed(out)]

def dp(pts, eps):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float); ab = b - a; L = float(np.hypot(*ab))
    dd = [abs(ab[0] * (a[1] - p[1]) - ab[1] * (a[0] - p[0])) / L if L else float(np.hypot(*(np.array(p) - a))) for p in pts[1:-1]]
    i = int(np.argmax(dd)) + 1
    if dd[i - 1] <= eps: return [pts[0], pts[-1]]
    return dp(pts[:i + 1], eps)[:-1] + dp(pts[i:], eps)

def trace(crop_png, wps, dark=True, eps=0.9):
    img = np.asarray(Image.open(crop_png).convert('RGB'))
    info = json.load(open(crop_png.rsplit('.', 1)[0] + '.json'))
    cost = cost_map(img, dark)
    full = [tuple(wps[0])]
    for a, b in zip(wps, wps[1:]): full += path(cost, a, b)[1:]
    arr = np.array(full, float)
    if len(arr) > 5:
        sm = arr.copy()
        for i in range(2, len(arr) - 2): sm[i] = arr[i - 2:i + 3].mean(0)
        arr = sm
    simp = dp([tuple(p) for p in arr], eps)
    ll = [[round(v, 6) for v in geocrop.px2ll(info, x + 0.5, y + 0.5)] for x, y in simp]
    return ll, simp
