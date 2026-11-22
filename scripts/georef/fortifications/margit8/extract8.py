"""Права частина рис. 8 (Juhász–Balogh 2025): траси лінії «Маргіт» довкола Velencei-tó.
Червоні суцільні лінії — протитанкові рови, помаранчеві — окопи, червоний пунктир — лінія за описами.
Результат: lines8_px.json (ламані в пікселях правої частини рисунка) і dbg8_*.png (контроль).
Запуск з цієї теки: python3 extract8.py"""
import json, numpy as np, cv2
import fig8, skel

bgr = fig8.load(); hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(int)
H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
red = (((H <= 8) | (H >= 170)) & (S >= 110) & (V >= 120)).astype(np.uint8)
orange = ((((H >= 9) & (H <= 23) & (S >= 120)) | ((H >= 24) & (H <= 25) & (S >= 190))) & (V >= 180)).astype(np.uint8)
for m in (red, orange): m[fig8.LEGEND[1]:, fig8.LEGEND[0]:] = 0          # легенда

def comps(m, min_area):
    n, lab, st, cen = cv2.connectedComponentsWithStats(m, 8)
    return [(i, lab == i, st[i], cen[i]) for i in range(1, n) if st[i, 4] >= min_area]

# --- пунктир «лінія за описами»: коридори трьох ланцюгів (пікселі правої частини рисунка)
CHAINS = {
    'sw': [(0, 456), (33, 441), (76, 421), (94, 406), (110, 392), (127, 378), (149, 373), (194, 370), (218, 364), (262, 349), (293, 339), (306, 328)],
    'ne_a': [(498, 94), (519, 80), (557, 54), (600, 24)],
    'ne_b': [(462, 31), (491, 17), (511, 8), (530, 0)],
}
def dist_to_polyline(p, L):
    best = 1e9
    for a, b in zip(L, L[1:]):
        a = np.array(a, float); b = np.array(b, float); ab = b - a
        t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1); best = min(best, float(np.hypot(*(p - (a + t * ab)))))
    return best
def along(p, L):
    best = (1e9, 0); acc = 0
    for a, b in zip(L, L[1:]):
        a = np.array(a, float); b = np.array(b, float); ab = b - a; n = np.hypot(*ab)
        t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1); d = float(np.hypot(*(p - (a + t * ab))))
        if d < best[0]: best = (d, acc + t * n)
        acc += n
    return best[1]

dashed = {k: [] for k in CHAINS}; solid = np.zeros_like(red); skipped = []
HOLLOW = [(282.0, 120.3), (284.6, 128.8), (272.4, 126.1), (228.9, 172.0)]   # порожнисті червоні значки біля Székesfehérvár — не лінії
NOT_DASH = [(275.2, 342.2), (293.3, 339.0)]   # короткий суцільний відрізок упоперек пунктиру (не штрихи)
for i, mk, st, cen in comps(red, 6):
    ys, xs = np.nonzero(mk); P = np.c_[xs, ys].astype(float); c = P.mean(0)
    if any(np.hypot(c[0] - hx, c[1] - hy) < 2.5 for hx, hy in HOLLOW): skipped.append((i, 'значок')); continue
    u, s, vt = np.linalg.svd(P - c, full_matrices=False)
    t = (P - c) @ vt[0]; L = t.max() - t.min() + 1; Wd = np.ptp((P - c) @ vt[1]) + 1
    chain = None
    for k, line in CHAINS.items():
        if dist_to_polyline(c, line) <= 4.0 and 6 <= L <= 30 and Wd <= 12: chain = k
    if any(np.hypot(c[0] - hx, c[1] - hy) < 2.5 for hx, hy in NOT_DASH): chain = None
    if chain:
        e0 = c + vt[0] * t.min(); e1 = c + vt[0] * t.max()
        dashed[chain].append((along(c, CHAINS[chain]), e0, e1, i))
    elif st[4] >= 20: solid[mk] = 1
    else: skipped.append((i, 'дрібний'))

out = {'described': [], 'ditch': [], 'trench': []}
for k, items in dashed.items():
    items.sort(key=lambda x: x[0]); pts = []
    line = CHAINS[k]
    for _, e0, e1, i in items:
        if along(e0, line) > along(e1, line): e0, e1 = e1, e0
        pts += [e0, e1]
    P = skel.rdp(np.array(pts), 1.0)
    out['described'].append({'chain': k, 'px': P.round(2).tolist(), 'dashes': [it[3] for it in items]})
    print('пунктир', k, 'штрихів', len(items), 'точок', len(P))

# --- суцільні червоні — рови
sk = skel.thin(solid)
for P in skel.paths(sk, min_len=4.0):
    Q = skel.rdp(skel.smooth(P, 2), 0.7)
    out['ditch'].append({'px': Q.round(2).tolist()})
print('рови:', len(out['ditch']), 'ламаних')

# --- помаранчеві — окопи (без пікселів упритул до червоних ліній)
near_red = cv2.dilate(red, np.ones((3, 3), np.uint8))
org = (orange & (1 - near_red)).astype(np.uint8)
org = cv2.morphologyEx(org, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
keep = np.zeros_like(org)
for i, mk, st, cen in comps(org, 8): keep[mk] = 1
sko = skel.thin(keep)
for P in skel.paths(sko, min_len=4.0):
    Q = skel.rdp(skel.smooth(P, 2), 0.7)
    out['trench'].append({'px': Q.round(2).tolist()})
print('окопи:', len(out['trench']), 'ламаних')
print('пропущено червоних компонентів:', skipped)
json.dump(out, open('lines8_px.json', 'w'))

# --- контрольний рисунок
S_ = 4
big = cv2.resize(bgr, None, fx=S_, fy=S_, interpolation=cv2.INTER_CUBIC)
big = (big * 0.55 + 255 * 0.45).astype(np.uint8)
def draw(P, col, th=2):
    q = (np.array(P) * S_ + S_ / 2).astype(np.int32).reshape(-1, 1, 2)
    cv2.polylines(big, [q], False, col, th, cv2.LINE_AA)
for o in out['trench']: draw(o['px'], (0, 90, 200))
for o in out['ditch']: draw(o['px'], (0, 0, 160), 3)
for o in out['described']: draw(o['px'], (160, 0, 160), 2)
Hh, Ww = big.shape[:2]
for i in range(2):
    for j in range(2):
        cv2.imwrite(f'dbg8_{i}{j}.png', big[j * Hh // 2:(j + 1) * Hh // 2, i * Ww // 2:(i + 1) * Ww // 2])
