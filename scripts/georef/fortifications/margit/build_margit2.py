"""Окопи лінії «Маргіт» з рис. 2 (Juhász–Balogh 2025): центри крапок (локальні мінімуми яскравості), без залізниць,
підписів і меж сіл; сусідні крапки (до 6,5 px) з'єднуються мінімальним кістяковим деревом у ламані."""
import json, numpy as np, cv2
from PIL import Image, ImageDraw
from scipy.spatial import cKDTree
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import minimum_spanning_tree
a = np.asarray(Image.open('../img/ht-002-001.png').convert('RGB')).astype(int)
H, W = a.shape[:2]
v = a.max(2).astype(np.float32); sat = a.max(2) - a.min(2)
A = json.load(open('affine_f2_reg.json')); cx, cy = np.array(A['cx']), np.array(A['cy'])
M = np.array([[cx[0], cx[1]], [cy[0], cy[1]]]); t = np.array([cx[2], cy[2]]); Mi = np.linalg.inv(M)
ll = lambda p: [round(float(cx @ [p[0], p[1], 1]), 5), round(float(cy @ [p[0], p[1], 1]), 5)]
excl = np.zeros((H, W), np.uint8)
O = json.load(open('../reg/margit_osm.json'))
for x, y in (np.array(O['rail']) - t) @ Mi.T:
    if 0 <= x < W and 0 <= y < H: cv2.circle(excl, (int(round(x)), int(round(y))), 3, 1, -1)
R_, G_, B_ = a[..., 0], a[..., 1], a[..., 2]
beige = ((R_ > 235) & (G_ > 205) & (G_ < 240) & (B_ > 140) & (B_ < 200)).astype(np.uint8)
beige = cv2.morphologyEx(beige, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
excl |= (cv2.dilate(beige, np.ones((7, 7), np.uint8)) > 0).astype(np.uint8)
LABELS = [(20, 44, 67, 56), (210, 18, 236, 47), (352, 62, 402, 73), (451, 43, 478, 74), (566, 113, 614, 125), (48, 275, 116, 287),
          (70, 336, 107, 347), (110, 455, 135, 484), (491, 370, 513, 394), (458, 485, 493, 497), (548, 510, 590, 522), (735, 200, 768, 270)]
for (x0, y0, x1, y1) in LABELS: excl[y0:y1, x0:x1] = 1
# дороги: довгі тонкі темні компоненти (поріг м'якший, ніж для крапок)
road = ((v < 150) & (sat < 40)).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(road, connectivity=8)
roadmask = np.zeros_like(road)
for i in range(1, n):
    x, y, w, h, area = st[i]
    if max(w, h) > 14 and area / max(w, h) < 2.2: roadmask[lab == i] = 1
excl |= cv2.dilate(roadmask, np.ones((3, 3), np.uint8))
# центри крапок
mn = cv2.erode(v, np.ones((3, 3), np.uint8))
cand = np.argwhere((v <= mn + 1e-3) & (v <= 60) & (sat < 60) & (excl == 0))
pts = []
for y, x in sorted(cand.tolist(), key=lambda p: v[p[0], p[1]]):
    if all((x - px) ** 2 + (y - py) ** 2 > 2.2 ** 2 for px, py in pts[-200:]): pts.append((x, y))
P = np.array(pts, float)
# підпіксельне уточнення: зважений центр 3x3
ref = []
for x, y in P.astype(int):
    y0_, y1_, x0_, x1_ = max(0, y - 1), min(H, y + 2), max(0, x - 1), min(W, x + 2)
    w = 255 - v[y0_:y1_, x0_:x1_]
    yy, xx = np.mgrid[y0_:y1_, x0_:x1_]
    ref.append(((w * xx).sum() / w.sum(), (w * yy).sum() / w.sum()))
P = np.array(ref)
tree = cKDTree(P); pairs = np.array(sorted(tree.query_pairs(6.5)))
d = np.hypot(*(P[pairs[:, 0]] - P[pairs[:, 1]]).T)
G = coo_matrix((d, (pairs[:, 0], pairs[:, 1])), shape=(len(P), len(P)))
T = minimum_spanning_tree(G).tocoo()
adj = {i: [] for i in range(len(P))}
for i, j in zip(T.row, T.col): adj[i].append(j); adj[j].append(i)
# компоненти, малі — геть
seen = set(); comps = []
for s in range(len(P)):
    if s in seen or not adj[s]: continue
    stack = [s]; c = []
    while stack:
        u = stack.pop()
        if u in seen: continue
        seen.add(u); c.append(u); stack += adj[u]
    if len(c) >= 5: comps.append(set(c))
keep = set().union(*comps) if comps else set()
nodes = {i for i in keep if len(adj[i]) != 2}
used = set(); lines = []
for a0 in nodes:
    for b in adj[a0]:
        e = (min(a0, b), max(a0, b))
        if e in used or b not in keep: continue
        used.add(e); line = [a0, b]; prev, cur = a0, b
        while cur not in nodes:
            nxt = [q for q in adj[cur] if q != prev]
            if not nxt: break
            used.add((min(cur, nxt[0]), max(cur, nxt[0]))); prev, cur = cur, nxt[0]; line.append(cur)
        lines.append(line)
def dp(pts, eps):
    if len(pts) < 3: return pts
    a_, b_ = np.array(pts[0]), np.array(pts[-1]); ab = b_ - a_; L = np.hypot(*ab)
    dd = [abs(ab[0] * (a_[1] - p[1]) - ab[1] * (a_[0] - p[0])) / L if L else np.hypot(*(np.array(p) - a_)) for p in pts[1:-1]]
    i = int(np.argmax(dd)) + 1
    if dd[i - 1] <= eps: return [pts[0], pts[-1]]
    return dp(pts[:i + 1], eps)[:-1] + dp(pts[i:], eps)
feats = []
for L in lines:
    if len(L) < 2: continue
    s = dp([tuple(P[i]) for i in L], 0.8)
    feats.append({'type': 'Feature', 'properties': {'kind': 'trench'}, 'geometry': {'type': 'LineString', 'coordinates': [ll(p) for p in s]}})
json.dump({'type': 'FeatureCollection', 'features': feats}, open('margit.geojson', 'w'), ensure_ascii=False)
print('крапок', len(P), 'у лініях', len(keep), 'ламаних', len(feats))
im = Image.open('../img/ht-002-001.png').convert('RGB').resize((W * 2, H * 2), Image.LANCZOS); dr = ImageDraw.Draw(im)
for L in lines:
    dr.line([tuple(P[i] * 2) for i in L], fill=(255, 0, 180), width=2)
im.save('margit_check.png')
for k, box in {'mc_a': (0, 0, 800, 560), 'mc_c': (0, 480, 800, 1064), 'mc_d': (700, 480, 1536, 1064), 'mc_b': (700, 0, 1536, 560)}.items():
    im.crop(box).save(k + '.png')
