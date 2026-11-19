"""Вирізки мапи Ліпскі навколо місць, куди нинішня прив'язка ставить справжні координати міст.
Для кожного міста — аркуш, де точка найглибше всередині рамки; вирізка 360×360 px повної роздільності,
показ ×1,5 з сіткою кожні 20 px скана (тонкі лінії) і хрестиком у передбаченій точці.
Запуск: crops.py <аркуш_вихід_префікс> <місто,місто,...>   (міста з towns_osm.json)"""
import json, sys, subprocess, time, os, re
import numpy as np
from scipy.interpolate import RBFInterpolator
from PIL import Image, ImageDraw, ImageFont

P = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'public', 'georef', 'lipszky-1806.json')))
T = json.load(open('towns_osm.json'))
SHEETS = []
for it in P['items']:
    src = it['target']['source']; f = it['body']['features']
    geo = np.array([x['geometry']['coordinates'] for x in f]); px = np.array([x['properties']['resourceCoords'] for x in f])
    poly = np.array([list(map(float, q.split(','))) for q in re.search(r'points="([^"]+)"', it['target']['selector']['value']).group(1).split()])
    SHEETS.append({'id': src['id'], 'inv': RBFInterpolator(geo, px, kernel='thin_plate_spline'), 'poly': poly,
                   'x0': poly[:, 0].min(), 'x1': poly[:, 0].max(), 'y0': poly[:, 1].min(), 'y1': poly[:, 1].max()})


def locate(lon, lat):
    best = None
    for i, s in enumerate(SHEETS):
        x, y = s['inv']([[lon, lat]])[0]
        d = min(x - s['x0'], s['x1'] - x, y - s['y0'], s['y1'] - y)
        if best is None or d > best[0]: best = (d, i, x, y)
    return best


if __name__ == '__main__':
    tag, names = sys.argv[1], sys.argv[2].split(',')
    R, Z = 180, 1.5; S = int(2 * R * Z)
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
    os.makedirs('tc', exist_ok=True)
    tiles, meta = [], {}
    for n in names:
        t = T[n]; d, i, x, y = locate(t['lon'], t['lat'])
        s = SHEETS[i]; fn = f'tc/{n}.jpg'
        if not (os.path.exists(fn) and os.path.getsize(fn) > 500):
            subprocess.run(['curl', '-sS', '--max-time', '120', '-o', fn, f"{s['id']}/{int(round(x - R))},{int(round(y - R))},{2 * R},{2 * R}/full/0/default.jpg"], check=False); time.sleep(0.3)
        im = Image.open(fn).convert('RGB').resize((S, S), Image.LANCZOS); dr = ImageDraw.Draw(im, 'RGBA')
        for k in range(0, 2 * R + 1, 20):   # сітка кожні 20 px скана; точка — у центрі (R, R)
            v = k * Z
            col = (0, 90, 255, 150) if (k - R) % 100 == 0 else (0, 90, 255, 45)
            dr.line((v, 0, v, S), fill=col, width=1); dr.line((0, v, S, v), fill=col, width=1)
        c = R * Z
        dr.line((c - 14, c, c + 14, c), fill=(255, 0, 0, 255), width=2); dr.line((c, c - 14, c, c + 14), fill=(255, 0, 0, 255), width=2)
        dr.text((6, 4), n, fill=(220, 0, 0, 255), font=font)
        tiles.append(im); meta[n] = {'sheet': i, 'x': float(x), 'y': float(y), 'depth': float(d)}
    cols = 4
    out = Image.new('RGB', (cols * (S + 6), ((len(tiles) + cols - 1) // cols) * (S + 6)), 'white')
    for k, t in enumerate(tiles): out.paste(t, ((k % cols) * (S + 6), (k // cols) * (S + 6)))
    out.save(f'tc_{tag}.png')
    old = json.load(open('pred.json')) if os.path.exists('pred.json') else {}
    old.update(meta); json.dump(old, open('pred.json', 'w'), indent=1)
    print(tag, out.size, {n: (meta[n]['sheet'], round(meta[n]['depth'])) for n in names})
