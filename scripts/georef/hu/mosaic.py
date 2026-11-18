#!/usr/bin/env python3 -I
"""Оглядова мозаїка Spezialkarte на всю Угорщину (Web Mercator, сірий тон, альфа поза аркушами).
Аркуші з gcps.json перетворюються TPS за 8 опорними точками зі зменшених копій (raw/, raw_n/);
наявна мозаїка 10 аркушів довкола Göd накладається зверху. Вихід: public/maps/spezialkarte-hu-overview.webp"""
import json, os, math, sys
import numpy as np, cv2
from PIL import Image
from scipy.interpolate import RBFInterpolator
S = os.environ.get('HU_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')) + '/'
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..') + '/'
Z = float(sys.argv[1]) if len(sys.argv) > 1 else 9.2
g = json.load(open(S + 'gcps.json'))
def mx(lon): return (lon + 180) / 360 * 256 * 2 ** Z
def my(lat): return (1 - math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) / math.pi) / 2 * 256 * 2 ** Z
lons = [p['geo'][0] for v in g.values() if v['status'] != 'FAIL' for p in v['gcps']]
lats = [p['geo'][1] for v in g.values() if v['status'] != 'FAIL' for p in v['gcps']]
W0, E0, S0, N0 = min(lons), max(lons), min(lats), max(lats)
X0, X1, Y0, Y1 = mx(W0), mx(E0), my(N0), my(S0)
Wc, Hc = int(math.ceil(X1 - X0)), int(math.ceil(Y1 - Y0))
print('canvas', Wc, Hc, 'bounds', W0, E0, S0, N0)
gray = np.zeros((Hc, Wc), np.float32); alpha = np.zeros((Hc, Wc), np.uint8)
def tone(img):
    lo, hi = np.percentile(img, 1), np.percentile(img, 99.5)
    return np.clip((img - lo) / max(hi - lo, 1) * (238 - 25) + 25, 0, 255)
for k, v in sorted(g.items()):
    if v['status'] == 'FAIL': continue
    path = (S + 'raw/' if v['which'] == 'main' else S + 'raw_n/') + k + '.jpg'
    im = cv2.imread(path, cv2.IMREAD_GRAYSCALE).astype(np.float32)
    sx, sy = v['scale']
    src = np.array([[p['px'][0] / sx - 0.5, p['px'][1] / sy - 0.5] for p in v['gcps']])
    dst = np.array([[mx(p['geo'][0]) - X0, my(p['geo'][1]) - Y0] for p in v['gcps']])
    # межі аркуша на полотні
    x0, y0 = np.floor(dst.min(axis=0)).astype(int); x1, y1 = np.ceil(dst.max(axis=0)).astype(int)
    x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, Wc - 1), min(y1, Hc - 1)
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1, dtype=np.float64), np.arange(y0, y1 + 1, dtype=np.float64))
    pts = np.stack([gx.ravel(), gy.ravel()], axis=1)
    f = RBFInterpolator(dst, src, kernel='thin_plate_spline')
    m = f(pts).astype(np.float32)
    mapx = m[:, 0].reshape(gx.shape); mapy = m[:, 1].reshape(gx.shape)
    # маска: полігон 8 точок
    mask = np.zeros(gx.shape, np.uint8)
    cv2.fillPoly(mask, [np.round(dst - [x0, y0]).astype(np.int32)], 1)
    fw_src = np.hypot(*(src[2] - src[0])); fw_dst = np.hypot(*(dst[2] - dst[0]))   # nw -> ne
    sc = max(1, int(round(fw_src / fw_dst / 1.5)))
    small = cv2.resize(im, None, fx=1 / sc, fy=1 / sc, interpolation=cv2.INTER_AREA)   # згладжування перед зменшенням
    samp = cv2.remap(small, (mapx + 0.5) / sc - 0.5, (mapy + 0.5) / sc - 0.5, cv2.INTER_LINEAR, borderValue=255)
    samp = tone(samp[mask > 0]) if False else samp
    sub = samp[mask > 0]
    lo, hi = np.percentile(sub, 1), np.percentile(sub, 99.5)
    samp = np.clip((samp - lo) / max(hi - lo, 1) * (238 - 25) + 25, 0, 255)
    reg = (slice(y0, y1 + 1), slice(x0, x1 + 1))
    gray[reg][mask > 0] = samp[mask > 0]
    alpha[reg][mask > 0] = 255
# 10 аркушів довкола Göd: вирівняні копії з public/maps (кути з data/maps/*.json, проєктивне перетворення)
import glob
for f in sorted(glob.glob(R + 'data/maps/*.json')):
    m = json.load(open(f))
    if m.get('series') != 'spezialkarte-75000': continue
    im = cv2.imread(R + 'public/' + m['url'], cv2.IMREAD_GRAYSCALE).astype(np.float32)
    h, w = im.shape
    co = m['coordinates']   # TL, TR, BR, BL
    dst = np.array([[mx(c[0]) - X0, my(c[1]) - Y0] for c in co], np.float32)
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    Hm = cv2.getPerspectiveTransform(dst, src)
    x0, y0 = np.floor(dst.min(axis=0)).astype(int); x1, y1 = np.ceil(dst.max(axis=0)).astype(int)
    x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, Wc - 1), min(y1, Hc - 1)
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1, dtype=np.float32), np.arange(y0, y1 + 1, dtype=np.float32))
    P = np.stack([gx, gy, np.ones_like(gx)], axis=-1) @ Hm.T
    mapx = (P[..., 0] / P[..., 2]).astype(np.float32); mapy = (P[..., 1] / P[..., 2]).astype(np.float32)
    sc = max(1, int(round(w / (dst[1][0] - dst[0][0]) / 1.5)))
    small = cv2.resize(im, None, fx=1 / sc, fy=1 / sc, interpolation=cv2.INTER_AREA)
    samp = cv2.remap(small, (mapx + 0.5) / sc - 0.5, (mapy + 0.5) / sc - 0.5, cv2.INTER_LINEAR, borderValue=255)
    mask = np.zeros(gx.shape, np.uint8)
    cv2.fillPoly(mask, [np.round(dst - [x0, y0]).astype(np.int32)], 1)
    mask &= ((mapx > 8) & (mapx < w - 9) & (mapy > 8) & (mapy < h - 9)).astype(np.uint8)   # світла смужка на краях копій
    sub = samp[mask > 0]
    lo, hi = np.percentile(sub, 1), np.percentile(sub, 99.5)
    samp = np.clip((samp - lo) / max(hi - lo, 1) * (238 - 25) + 25, 0, 255)
    reg = (slice(y0, y1 + 1), slice(x0, x1 + 1))
    gray[reg][mask > 0] = samp[mask > 0]
    alpha[reg][mask > 0] = 255
    print('local sheet', m['id'])
# заповнити шви в 1–2 px між аркушами: найближчий сусід усередині області аркушів
hole = (alpha == 0).astype(np.uint8)
dil = cv2.dilate(255 - hole * 255, np.ones((5, 5), np.uint8))
fillm = (hole > 0) & (dil > 0)
blur = cv2.dilate(np.where(alpha > 0, gray, 0).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32)
# лише вузькі шви: пікселі без альфи, у яких з обох боків (по горизонталі або вертикалі) є аркуш у межах 2 px
a0 = alpha > 0
def sh(a, dy, dx):
    return np.roll(np.roll(a, dy, 0), dx, 1)
seam = (~a0) & ((sh(a0, 0, 2) & sh(a0, 0, -2)) | (sh(a0, 0, 1) & sh(a0, 0, -1)) | (sh(a0, 2, 0) & sh(a0, -2, 0)) | (sh(a0, 1, 0) & sh(a0, -1, 0)))
gray[seam] = blur[seam]; alpha[seam] = 255
out = np.dstack([gray, gray, gray, alpha]).astype(np.uint8)
Image.fromarray(out, 'RGBA').save(R + 'public/maps/spezialkarte-hu-overview.webp', 'WEBP', quality=int(sys.argv[2]) if len(sys.argv) > 2 else 62, method=6)
coords = [[round(W0, 6), round(N0, 6)], [round(E0, 6), round(N0, 6)], [round(E0, 6), round(S0, 6)], [round(W0, 6), round(S0, 6)]]
print(json.dumps(coords))
json.dump(coords, open(S + 'overview_coords.json', 'w'))
