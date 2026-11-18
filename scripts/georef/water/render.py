#!/usr/bin/env python3 -I
import json, math, sys
import numpy as np, cv2
src = sys.argv[1]; out = sys.argv[2]
crop = [float(v) for v in sys.argv[3].split(',')] if len(sys.argv) > 3 else None   # lon0,lat0,lon1,lat1
m = json.load(open('../../../data/maps/lipszky-1806.json'))
im = cv2.imread('../../../public/maps/lipszky-1806.jpg')
(W, N), (E, _), (_, S), _ = m['coordinates']
merc = lambda la: math.log(math.tan(math.pi / 4 + math.radians(la) / 2))
def px(lon, lat):
    return ((lon - W) / (E - W) * im.shape[1], (merc(N) - merc(lat)) / (merc(N) - merc(S)) * im.shape[0])
d = json.load(open(src))
ov = im.copy()
for f in d['features']:
    g = f['geometry']
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    for poly in polys:
        ring = np.array([px(*p) for p in poly[0]], np.int32)
        cv2.fillPoly(ov, [ring], (255, 80, 0))
        for h in poly[1:]:
            cv2.fillPoly(ov, [np.array([px(*p) for p in h], np.int32)], (0, 255, 255))
res = cv2.addWeighted(ov, 0.45, im, 0.55, 0)
if crop:
    x0, y0 = px(crop[0], crop[3]); x1, y1 = px(crop[2], crop[1])
    res = res[int(y0):int(y1), int(x0):int(x1)]
cv2.imwrite(out, res)
