#!/usr/bin/env python3 -I
"""Маска боліт на мапі Ліпскі: горизонтальне штрихування (сильна вертикальна зміна яскравості, слабка горизонтальна)."""
import sys
import numpy as np, cv2
def marsh_mask(bgr, win=15, thr_a=2.2, thr_e=0.004):
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    # горизонтальні лінії: друга похідна по y велика, по x мала
    dy = (g[2:, 1:-1] + g[:-2, 1:-1] - 2 * g[1:-1, 1:-1]) ** 2
    dx = (g[1:-1, 2:] + g[1:-1, :-2] - 2 * g[1:-1, 1:-1]) ** 2
    ey = cv2.blur(dy, (win, win)); ex = cv2.blur(dx, (win, win))
    a = ey / (ex + 1e-4)
    m = ((a > thr_a) & (ey > thr_e)).astype(np.uint8)
    m = np.pad(m, 1)
    return m, np.pad(a, 1), np.pad(ey, 1)
if __name__ == '__main__':
    im = cv2.imread(sys.argv[1])
    if len(sys.argv) > 3: im = cv2.resize(im, None, fx=float(sys.argv[3]), fy=float(sys.argv[3]), interpolation=cv2.INTER_AREA)
    m, a, ey = marsh_mask(im)
    print('ey pct', np.percentile(ey, [50, 90, 99]).round(4), 'a pct', np.percentile(a, [50, 90, 99]).round(2))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    mc = cv2.morphologyEx(cv2.morphologyEx(m, cv2.MORPH_CLOSE, k), cv2.MORPH_OPEN, k)
    ov = im.copy(); ov[mc > 0] = (0.5 * ov[mc > 0] + 0.5 * np.array([255, 0, 0])).astype(np.uint8)
    cv2.imwrite(sys.argv[2], ov)
