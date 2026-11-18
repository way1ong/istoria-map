#!/usr/bin/env python3
"""Перебудовує оглядову мозаїку серії старих мап (data/map-series.json → overview).

Бере всі аркуші серії з data/maps/*.json (поле series), їхні зображення з public/
і межі coordinates, і складає їх у WebP з прозорістю в проєкції Web Mercator
(рядки рівномірні за меркаторною координатою, тож MapLibre кладе мозаїку без викривлень).
Межі й файл беруться з overview у data/map-series.json; роздільність — 1500 px на градус довготи.

Запуск: python3 scripts/build-overview.py spezialkarte-75000
Потрібні Pillow і numpy.
"""
import glob, json, math, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sid = sys.argv[1] if len(sys.argv) > 1 else 'spezialkarte-75000'
series = next(s for s in json.load(open(os.path.join(ROOT, 'data', 'map-series.json')))['series'] if s['id'] == sid)
ov = series['overview']
(LON0, LAT1), (LON1, _), (_, LAT0), _ = ov['coordinates']
PPD = 1500
W = round((LON1 - LON0) * PPD)
merc = lambda lat: math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
y0, y1 = merc(LAT1), merc(LAT0)
H = round((y0 - y1) / math.radians(LON1 - LON0) * W)
lons = LON0 + (np.arange(W) + 0.5) / W * (LON1 - LON0)
lats = np.degrees(2 * np.arctan(np.exp(y0 - (np.arange(H) + 0.5) / H * (y0 - y1))) - np.pi / 2)
out = np.zeros((H, W), np.float32); alpha = np.zeros((H, W), np.uint8)
n = 0
for f in sorted(glob.glob(os.path.join(ROOT, 'data', 'maps', '*.json'))):
    m = json.load(open(f, encoding='utf-8'))
    if m.get('series') != sid:
        continue
    arr = np.asarray(Image.open(os.path.join(ROOT, 'public', m['url'])).convert('L'), dtype=np.float32)
    (lw, ln), (le, _), (_, ls), _ = m['coordinates']
    h, w = arr.shape
    ix = np.where((lons >= lw) & (lons < le))[0]; iy = np.where((lats <= ln) & (lats > ls))[0]
    if not len(ix) or not len(iy):
        continue
    X, Y = np.meshgrid((lons[ix] - lw) / (le - lw) * w - 0.5, (ln - lats[iy]) / (ln - ls) * h - 0.5)
    x0 = np.clip(np.floor(X).astype(int), 0, w - 2); yy = np.clip(np.floor(Y).astype(int), 0, h - 2)
    dx = np.clip(X - x0, 0, 1); dy = np.clip(Y - yy, 0, 1)
    out[np.ix_(iy, ix)] = (arr[yy, x0] * (1 - dx) * (1 - dy) + arr[yy, x0 + 1] * dx * (1 - dy)
                           + arr[yy + 1, x0] * (1 - dx) * dy + arr[yy + 1, x0 + 1] * dx * dy)
    alpha[np.ix_(iy, ix)] = 255
    n += 1
img = Image.fromarray(np.dstack([out, out, out, alpha]).astype(np.uint8), 'RGBA')
dst = os.path.join(ROOT, 'public', ov['url'])
img.save(dst, quality=70, method=6)
print(f'{n} аркушів → {dst} ({W}×{H}, {os.path.getsize(dst) / 1e6:.2f} МБ)')
