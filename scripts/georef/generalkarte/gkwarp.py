#!/usr/bin/env python3 -I
"""Аркуші Generalkarte -> зображення в проєкції Web Mercator точно на межах аркуша (1°×1°, Ферро − 17°40′,
поправка зсуву старої геодезичної основи −0,000965° / −0,00074° як у Spezialkarte), TPS за 8 точками
(кути й середини сторін рамки з gkdetect.py). Вихід: public/maps/generalkarte/<lon>-<lat>.webp і
оглядова мозаїка public/maps/generalkarte-overview.webp; межі -> warp.json."""
import json, math, os, sys
import numpy as np, cv2
from PIL import Image
from scipy.interpolate import RBFInterpolator
Image.MAX_IMAGE_PIXELS = None
B = os.environ.get('GK_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')) + '/'
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..') + '/'
SHIFT = (-0.000965, -0.00074)
HOUT = int(sys.argv[1]) if len(sys.argv) > 1 else 2400
det = json.load(open(B + 'r3300/gk_det.json'))
merc = lambda la: math.log(math.tan(math.pi / 4 + math.radians(la) / 2))
out = {}
for k, d in sorted(det.items()):
    L, P = map(int, k.split('-'))
    W0 = L - 0.5 - 17 - 40 / 60 + SHIFT[0]; E0 = W0 + 1
    N0 = P + 0.5 + SHIFT[1]; S0 = N0 - 1
    src = cv2.imread(B + f'orig/{k}.jpg', cv2.IMREAD_COLOR)
    sc = src.shape[1] / d['size'][0]                     # 3840 / 3300
    c, m = d['corners'], d['mids']
    px = np.array([c['nw'], m['n'], c['ne'], m['e'], c['se'], m['s'], c['sw'], m['w']], float)
    px = (px + 0.5) * sc - 0.5                           # центри пікселів у копії 3840
    geo = np.array([[W0, N0], [W0 + 0.5, N0], [E0, N0], [E0, N0 - 0.5], [E0, S0], [W0 + 0.5, S0], [W0, S0], [W0, N0 - 0.5]])
    # вихідна сітка: рядки рівномірні за меркаторною y
    ymN, ymS = merc(N0), merc(S0)
    wout = round(HOUT * math.radians(1) / (ymN - ymS))
    xs = W0 + (np.arange(wout) + 0.5) / wout * 1.0
    ys = np.degrees(2 * np.arctan(np.exp(ymN - (np.arange(HOUT) + 0.5) / HOUT * (ymN - ymS))) - np.pi / 2)
    gx, gy = np.meshgrid(xs, ys)
    f = RBFInterpolator(geo, px, kernel='thin_plate_spline')
    mp = f(np.stack([gx.ravel(), gy.ravel()], 1)).astype(np.float32)
    # згладити джерело перед зменшенням (~2×)
    frame_h = np.hypot(*(px[6] - px[0]))
    s2 = max(1.0, frame_h / HOUT / 1.2)
    small = cv2.resize(src, None, fx=1 / s2, fy=1 / s2, interpolation=cv2.INTER_AREA) if s2 > 1.01 else src
    mx = (mp[:, 0].reshape(gx.shape) + 0.5) / s2 - 0.5; my = (mp[:, 1].reshape(gx.shape) + 0.5) / s2 - 0.5
    img = cv2.remap(small, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    Image.fromarray(rgb).save(R + f'public/maps/generalkarte/{k}.webp', 'WEBP', quality=72, method=6)
    out[k] = {'coordinates': [[round(W0, 6), round(N0, 6)], [round(E0, 6), round(N0, 6)], [round(E0, 6), round(S0, 6)], [round(W0, 6), round(S0, 6)]], 'size': [wout, HOUT]}
    print(k, wout, HOUT, flush=True)
json.dump(out, open(B + 'warp.json', 'w'), indent=1)
# оглядова мозаїка (зум ~8.6)
Z = 8.6
mxf = lambda lon: (lon + 180) / 360 * 256 * 2 ** Z
myf = lambda lat: (1 - merc(lat) / math.pi) / 2 * 256 * 2 ** Z
lons = [p[0] for v in out.values() for p in v['coordinates']]; lats = [p[1] for v in out.values() for p in v['coordinates']]
X0, X1, Y0, Y1 = mxf(min(lons)), mxf(max(lons)), myf(max(lats)), myf(min(lats))
Wc, Hc = round(X1 - X0), round(Y1 - Y0)
can = Image.new('RGBA', (Wc, Hc), (0, 0, 0, 0))
for k, v in out.items():
    (w, n), (e, _), (_, s), _ = v['coordinates']
    x0, y0, x1, y1 = mxf(w) - X0, myf(n) - Y0, mxf(e) - X0, myf(s) - Y0
    im = Image.open(R + f'public/maps/generalkarte/{k}.webp').convert('RGBA').resize((max(1, round(x1) - round(x0)), max(1, round(y1) - round(y0))), Image.LANCZOS)
    can.alpha_composite(im, (round(x0), round(y0)))
can.save(R + 'public/maps/generalkarte-overview.webp', 'WEBP', quality=72, method=6)
ov = [[round(min(lons), 6), round(max(lats), 6)], [round(max(lons), 6), round(max(lats), 6)], [round(max(lons), 6), round(min(lats), 6)], [round(min(lons), 6), round(min(lats), 6)]]
json.dump({'overview': ov, 'size': [Wc, Hc]}, open(B + 'overview.json', 'w'))
print('overview', Wc, Hc, ov)
