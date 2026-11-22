"""Маски рисунків Ádám 2022: сині лінії позицій, світлі лінії меж комітатів, бірюзова межа районів (járás) на рис. 14."""
import numpy as np, cv2
import figs

def masks(fig):
    a = cv2.cvtColor(cv2.imread(figs.path(fig)), cv2.COLOR_BGR2RGB).astype(int); R, G, B = a[..., 0], a[..., 1], a[..., 2]
    blue = ((B >= 120) & (R <= 95) & (G <= 125) & (B - R >= 60) & (B - G >= 35)).astype(np.uint8)
    lav = ((B >= 165) & (R >= 115) & (G >= 115) & (B - R >= 22) & (B - G >= 22) & (abs(R - G) <= 30)).astype(np.uint8)
    return blue, lav

def teal14():
    """Тонка бірюзова лінія на рис. 14 — межа районів Hatvani і Gyöngyösi járás."""
    bgr = cv2.imread(figs.path('013')); a = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(int); R, G, B = a[..., 0], a[..., 1], a[..., 2]
    Gm = cv2.medianBlur(bgr, 11).astype(int)[..., 1]
    m = ((G >= 120) & (G - R >= 30) & (G - B >= 8) & (G - Gm >= 22)).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8); o = np.zeros_like(m)
    for i in range(1, n):
        if st[i, 4] >= 12 and max(st[i, 2], st[i, 3]) >= 12: o[lab == i] = 1
    return o

def boundary_mask(fig):
    return teal14() if fig == '013' else masks(fig)[1]
