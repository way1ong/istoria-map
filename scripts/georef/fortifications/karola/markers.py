"""Значки населених пунктів Google Earth на рисунках Ádám 2022 (темно-червоний кружок у світлому кільці):
друкує центри значків; назви до них приписано вручну за підписами (FIG у fitplaces.py)."""
import numpy as np, cv2
import figs
def find(fig):
    a = cv2.imread(figs.path(fig)).astype(int); B, G, R = a[..., 0], a[..., 1], a[..., 2]
    red = ((R >= 60) & (R <= 150) & (G < 45) & (B < 55) & (R - G > 45)).astype(np.uint8)
    white = ((R > 180) & (G > 170) & (B > 165)).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(red, 8); out = []
    for i in range(1, n):
        x, y, w, h, area = st[i]
        if not (8 <= area <= 60 and 3 <= w <= 9 and 3 <= h <= 9): continue
        if white[max(0, y - 3):y + h + 3, max(0, x - 3):x + w + 3].sum() >= 14: out.append((round(float(cen[i][0]), 1), round(float(cen[i][1]), 1)))
    return out
if __name__ == '__main__':
    for f in figs.FIGS: print(f, find(f))
