#!/usr/bin/env python3 -I
"""Болота з мапи Ліпскі 1806: маска горизонтального штрихування на копіях 1/4 (dr/<i>.jpg),
очищення, контури -> lon/lat через TPS з public/georef/lipszky-1806.json, обрізка рамкою аркуша."""
import json, re, sys
import numpy as np, cv2
from scipy.interpolate import RBFInterpolator
sys.path.insert(0, '.')
from marsh import marsh_mask
A = json.load(open('../../../public/georef/lipszky-1806.json'))
REGION = (15.5, 23.5, 45.3, 49.2)
feats = []
dbg = {}
_g = json.load(open('../../../data/borders/modern.geojson'))
HU = [f for f in _g['features'] if f['properties']['id'] == 'hungary'][0]['geometry']['coordinates'][0]
def pip(x, y, poly):
    c = False; j = len(poly) - 1
    for i2 in range(len(poly)):
        xi, yi = poly[i2]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
        j = i2
    return c
for i, it in enumerate(A['items']):
    im = cv2.imread(f'dr4/{i}.jpg')
    W, H = it['target']['source']['width'], it['target']['source']['height']
    s = im.shape[1] / W
    m, a, ey = marsh_mask(im)
    # тон: штрихування дає середньо-сіру ділянку; папір світліший
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
    mean = cv2.blur(g, (21, 21))
    paper = np.percentile(g, 75)
    m &= (mean < paper - 12).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((17, 1), np.uint8))      # горизонтальні лінії нижче 17 px заввишки геть
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (35, 35)))
    # рамка аркуша
    poly = re.search(r'points="([^"]+)"', it['target']['selector']['value']).group(1)
    pts = np.array([[float(v) for v in p.split(',')] for p in poly.split()]) * s
    frame = np.zeros(m.shape, np.uint8); cv2.fillPoly(frame, [np.round(pts).astype(np.int32)], 1)
    frame = cv2.erode(frame, np.ones((41, 41), np.uint8))
    m &= frame
    # прибрати дрібне (< 900 px при 1/4) і тонкі смуги (лінії сітки, рамка, підписи): товщина < 16 px
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros(n, bool)
    for j in range(1, n):
        if st[j, cv2.CC_STAT_AREA] < 1200 or st[j, cv2.CC_STAT_HEIGHT] < 26: continue
        comp = (lab[st[j, 1]:st[j, 1] + st[j, 3], st[j, 0]:st[j, 0] + st[j, 2]] == j).astype(np.uint8)
        # товщина: максимум відстані до краю (півтовщини) усередині плями
        dt = cv2.distanceTransform(comp, cv2.DIST_L2, 3)
        if dt.max() < 10: continue
        # горизонтальні смуги (рамка аркуша, лінії сітки, рядки підписів): видовжені й майже горизонтальні
        ys, xs = np.nonzero(comp)
        (cx, cy), (rw, rh), ang = cv2.minAreaRect(np.stack([xs, ys], 1).astype(np.float32))
        lo, hi = min(rw, rh), max(rw, rh)
        horiz = (rw >= rh and (abs(ang) < 12 or abs(ang) > 78)) or (rh > rw and 78 > abs(ang) > 0 and abs(abs(ang) - 90) < 12)
        if hi / max(lo, 1) > 4.5 and lo < 50 and (st[j, 3] < 0.25 * st[j, 2]): continue
        keep[j] = True
    m = keep[lab].astype(np.uint8)
    dbg[i] = m
    cv2.imwrite(f'mask_{i}.png', m * 255)
    gc = np.array([f['properties']['resourceCoords'] for f in it['body']['features']]) * s
    geo = np.array([f['geometry']['coordinates'] for f in it['body']['features']])
    tps = RBFInterpolator(gc, geo, kernel='thin_plate_spline')
    cs, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hier is None:
        print(i, 'no contours', flush=True); continue
    hier = hier[0]
    for ci, c in enumerate(cs):
        if hier[ci][3] != -1: continue           # лише зовнішні; дірки нижче
        c = cv2.approxPolyDP(c, 2.0, True)
        if len(c) < 4: continue
        rings = [c[:, 0, :].astype(float)]
        ch = hier[ci][2]
        while ch != -1:
            h = cv2.approxPolyDP(cs[ch], 2.0, True)
            if len(h) >= 4 and cv2.contourArea(h) >= 300: rings.append(h[:, 0, :].astype(float))
            ch = hier[ch][0]
        grings = []
        for r in rings:
            gg = tps(r)
            gg = [[round(float(x), 5), round(float(y), 5)] for x, y in gg]
            gg.append(gg[0])
            grings.append(gg)
        lon = np.array([p[0] for p in grings[0]]); lat = np.array([p[1] for p in grings[0]])
        if lon.max() < REGION[0] or lon.min() > REGION[1] or lat.max() < REGION[2] or lat.min() > REGION[3]: continue
        if not any(pip(x, y, HU) for x, y in grings[0][::max(1, len(grings[0]) // 40)]): continue   # лише ті, що заходять в Угорщину
        feats.append({'type': 'Feature', 'properties': {'kind': 'marsh', 'sheet': i, 'area_px': int(cv2.contourArea(c))}, 'geometry': {'type': 'Polygon', 'coordinates': grings}})
    print(i, 'polygons so far', len(feats), flush=True)
json.dump({'type': 'FeatureCollection', 'features': feats}, open('marsh_raw.geojson', 'w'))
