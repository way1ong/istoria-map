"""Потоншення маски (Zhang–Suen) і розкладання кістяка на ламані між кінцями й розгалуженнями."""
import numpy as np

def thin(mask):
    img = (mask > 0).astype(np.uint8).copy()
    img = np.pad(img, 1)
    changed = True
    while changed:
        changed = False
        for step in (0, 1):
            P2 = img[:-2, 1:-1]; P3 = img[:-2, 2:]; P4 = img[1:-1, 2:]; P5 = img[2:, 2:]
            P6 = img[2:, 1:-1]; P7 = img[2:, :-2]; P8 = img[1:-1, :-2]; P9 = img[:-2, :-2]
            C = img[1:-1, 1:-1]
            nb = [P2, P3, P4, P5, P6, P7, P8, P9]
            B = sum(nb)
            A = sum(((nb[i] == 0) & (nb[(i + 1) % 8] == 1)).astype(np.uint8) for i in range(8))
            if step == 0:
                c1 = (P2 * P4 * P6 == 0) & (P4 * P6 * P8 == 0)
            else:
                c1 = (P2 * P4 * P8 == 0) & (P2 * P6 * P8 == 0)
            rm = (C == 1) & (B >= 2) & (B <= 6) & (A == 1) & c1
            if rm.any():
                img[1:-1, 1:-1][rm] = 0; changed = True
    return img[1:-1, 1:-1]

N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

def paths(sk, min_len=3.0):
    """Ламані кістяка: список масивів [(x, y), …]."""
    H, W = sk.shape
    pts = {(int(y), int(x)) for y, x in zip(*np.nonzero(sk))}
    def nbrs(p):
        y, x = p
        out = [(y + dy, x + dx) for dy, dx in N8 if (y + dy, x + dx) in pts]
        # не ходити по діагоналі там, де є прямий сусід (щоб не було зайвих трикутників)
        res = []
        for q in out:
            dy, dx = q[0] - y, q[1] - x
            if dy != 0 and dx != 0 and ((y + dy, x) in pts or (y, x + dx) in pts):
                continue
            res.append(q)
        return res
    deg = {p: len(nbrs(p)) for p in pts}
    nodes = {p for p, d in deg.items() if d != 2}
    seen = set(); out = []
    def walk(a, b):
        path = [a, b]; prev, cur = a, b
        while cur not in nodes:
            nx = [q for q in nbrs(cur) if q != prev]
            if not nx: break
            prev, cur = cur, nx[0]; path.append(cur)
        return path
    for n in nodes:
        for q in nbrs(n):
            if (n, q) in seen: continue
            p = walk(n, q)
            seen.add((n, q)); seen.add((p[-1], p[-2]))
            out.append(p)
    # замкнені контури без вузлів
    used = {p for path in out for p in path}
    rest = pts - used
    while rest:
        s = rest.pop(); path = [s]; prev = None; cur = s
        while True:
            nx = [q for q in nbrs(cur) if q != prev and q in rest]
            if not nx: break
            prev, cur = cur, nx[0]; rest.discard(cur); path.append(cur)
        if len(path) > 2: out.append(path)
    res = []
    for p in out:
        a = np.array([(x, y) for y, x in p], float)
        L = float(np.hypot(*np.diff(a, axis=0).T).sum()) if len(a) > 1 else 0
        if L >= min_len: res.append(a)
    return res

def rdp(P, eps):
    """Дуглас–Пекер."""
    P = np.asarray(P, float)
    if len(P) < 3: return P
    a, b = P[0], P[-1]; ab = b - a; n = np.hypot(*ab)
    d = np.abs(ab[0] * (P[:, 1] - a[1]) - ab[1] * (P[:, 0] - a[0])) / n if n > 0 else np.hypot(*(P - a).T)
    i = int(d.argmax())
    if d[i] > eps:
        return np.vstack([rdp(P[:i + 1], eps)[:-1], rdp(P[i:], eps)])
    return np.vstack([a, b])

def smooth(P, k=2):
    """Ковзне середнє вздовж ламаної (кінці лишаються на місці)."""
    P = np.asarray(P, float)
    if len(P) < 2 * k + 1: return P
    Q = P.copy()
    for i in range(1, len(P) - 1):
        a = max(0, i - k); b = min(len(P), i + k + 1)
        Q[i] = P[a:b].mean(0)
    return Q
