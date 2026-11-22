"""Сині лінії позицій з рисунків 8, 12, 14 (Ádám 2022) → ламані в пікселях: маска, кістяк, ламані між вузлами,
з'єднання коротких розривів під підписами."""
import numpy as np, cv2
import figs, masks, skel

def blue_mask(fig):
    blue = cv2.morphologyEx(masks.masks(fig)[0], cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(blue, 8); m = np.zeros_like(blue)
    for i in range(1, n):
        if st[i, 4] >= 12: m[lab == i] = 1
    return m

def extract(fig, min_len=8.0, join_px=24.0):
    sk = skel.thin(blue_mask(fig))
    P = [p for p in skel.paths(sk, min_len=3.0)]
    ends = []
    for i, p in enumerate(P):
        if len(p) < 4: continue
        for e in (0, -1):
            a = p[e]; b = p[min(len(p) - 1, 6)] if e == 0 else p[max(0, len(p) - 7)]
            d = a - b; nrm = np.hypot(*d)
            if nrm > 0: ends.append((i, e, a, d / nrm))
    def free(a, i):          # вільний кінець, а не розгалуження
        for j, q in enumerate(P):
            if j != i and np.hypot(*(q - a).T).min() < 1.6: return False
        return True
    ends = [e for e in ends if free(e[2], e[0])]
    cand = []
    for x in range(len(ends)):
        for y in range(x + 1, len(ends)):
            i, ei, a, da = ends[x]; j, ej, b, db = ends[y]
            if i == j: continue
            v = b - a; dist = np.hypot(*v)
            if dist < 2 or dist > join_px: continue
            v = v / dist
            if da @ v > 0.82 and db @ (-v) > 0.82: cand.append((dist, x, y))
    joins = []; used = set()
    for dist, x, y in sorted(cand):
        if x in used or y in used: continue
        used.add(x); used.add(y); joins.append(np.array([ends[x][2], ends[y][2]]))
    out = [skel.rdp(skel.smooth(p, 2), 0.6) for p in P if float(np.hypot(*np.diff(p, axis=0).T).sum()) >= min_len]
    return out, joins, sk
