# Значки міст на мапах-джерелах (кружок із крапкою) → координати пікселів. Назви значкам даються вручну
# за підписами на мапі; результат — points_<мапа>.json поруч.
#
#   python3 markers.py small <мапа.png> <x> <y> <вихід.png> [поріг]     мапи 1280 px: шаблон вирізається з самої мапи довкола (x, y)
#   python3 markers.py big <мапа.png> <x> <y> <вихід.png>               мапа 1572 року 3840 px: кільце r ≈ 18 px, порівняння в круглій масці
#
# Друкує номер, x, y і міру збігу; малює номери на копії мапи (<вихід.png>) і пише <вихід>.json.
import json, sys
import cv2, numpy as np

def find_small(g, seed, half=5, thr=0.72):
    x0, y0 = seed
    ys, xs = np.nonzero(g[y0 - 5:y0 + 6, x0 - 5:x0 + 6] < 90)          # центр шаблону — центр мас темних пікселів значка
    cx, cy = int(round(xs.mean())) + x0 - 5, int(round(ys.mean())) + y0 - 5
    tpl = g[cy - half:cy + half + 1, cx - half:cx + half + 1]
    res = cv2.matchTemplate(g, tpl, cv2.TM_CCOEFF_NORMED)
    pts = []
    while True:
        _, v, _, loc = cv2.minMaxLoc(res)
        if v < thr: break
        pts.append((loc[0] + half, loc[1] + half, float(v)))
        cv2.circle(res, loc, 8, -1, -1)
    out = []
    for x, y, v in pts:                                                # уточнення центру до частки пікселя
        yy, xx = np.nonzero(g[y - 6:y + 7, x - 6:x + 7] < 110)
        if len(xx) < 12: continue                                      # збіг без темних пікселів — не значок
        out.append((round(float(x - 6 + xx.mean()), 2), round(float(y - 6 + yy.mean()), 2), round(v, 3)))
    return out

def find_big(g, seed, R=19, thr=0.035):
    cx, cy = seed
    g = g.astype(np.float32)
    tpl = g[cy - R:cy + R + 1, cx - R:cx + R + 1].copy()
    yy, xx = np.mgrid[-R:R + 1, -R:R + 1]
    mask = ((xx ** 2 + yy ** 2) <= R * R).astype(np.float32)
    res = cv2.matchTemplate(g, tpl, cv2.TM_SQDIFF, mask=mask) / (mask.sum() * 255.0 ** 2)
    pts = []
    while True:
        v, _, loc, _ = cv2.minMaxLoc(res)
        if v > thr: break
        pts.append((loc[0] + R, loc[1] + R, float(v)))
        cv2.circle(res, loc, 30, 1.0, -1)
    out = []
    for x, y, v in pts:
        ys, xs = np.nonzero((g[y - R:y + R + 1, x - R:x + R + 1] < 110) & (mask > 0))
        out.append((round(float(x - R + xs.mean()), 1), round(float(y - R + ys.mean()), 1), round(v, 4)))
    return sorted(out, key=lambda p: (p[1], p[0]))

if __name__ == '__main__':
    mode, path, x, y, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
    im = cv2.imread(path, cv2.IMREAD_COLOR); g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    if mode == 'big':
        pts = find_big(g, (x, y)); k, r = 1, 30
    else:
        pts = find_small(g, (x, y), thr=float(sys.argv[6]) if len(sys.argv) > 6 else 0.72); k, r = 2, 14
    vis = cv2.resize(im, None, fx=k, fy=k, interpolation=cv2.INTER_NEAREST)
    for i, (px, py, v) in enumerate(pts):
        print(i, px, py, v)
        cv2.circle(vis, (int(px * k), int(py * k)), r, (0, 0, 255), 2)
        cv2.putText(vis, str(i), (int(px * k) + r, int(py * k) - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8 * (2 if mode == 'big' else 1), (0, 0, 255), 2)
    cv2.imwrite(out, vis)
    json.dump(pts, open(out.rsplit('.', 1)[0] + '.json', 'w'))
