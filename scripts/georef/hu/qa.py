#!/usr/bin/env python3 -I
"""Перевірка кутів: пропорції рамки проти очікуваних для зони і контактні аркуші з вирізками кутів.
python3 -I qa.py det.json out_prefix"""
import json, os, math, sys
from PIL import Image, ImageDraw
det = json.load(open(sys.argv[1])); pref = sys.argv[2]
A = 6377397.155; F = 1 / 299.1528128; E2 = F * (2 - F)   # еліпсоїд Бесселя
def Nr(p): return A / math.sqrt(1 - E2 * math.sin(p) ** 2)
def Mr(p): return A * (1 - E2) / (1 - E2 * math.sin(p) ** 2) ** 1.5
def expected(z):
    pn = math.radians(48.75 - (z - 11) * 0.25); ps = pn - math.radians(0.25)
    top = math.radians(0.5) * Nr(pn) * math.cos(pn); bot = math.radians(0.5) * Nr(ps) * math.cos(ps)
    h = math.radians(0.25) * Mr((pn + ps) / 2)
    return (top + bot) / 2 / h, top / bot
def dist(a, b): return math.hypot(a[0] - b[0], a[1] - b[1])
rows = []
for k, v in sorted(det.items(), key=lambda kv: tuple(map(int, kv[0].split('-')))):
    c = v.get('corners')
    if not c:
        rows.append((k, None)); continue
    z = int(k.split('-')[0])
    ae, re_ = expected(z)
    top, bot = dist(c['nw'], c['ne']), dist(c['sw'], c['se'])
    lef, rig = dist(c['nw'], c['sw']), dist(c['ne'], c['se'])
    am = (top + bot) / (lef + rig)
    rows.append((k, {'aspect_dev_pct': round((am / ae - 1) * 100, 2), 'tb_dev_pct': round((top / bot / re_ - 1) * 100, 2),
                     'lr_dev_pct': round((lef / rig - 1) * 100, 2), 'width': round((top + bot) / 2, 1),
                     'rms': {s: (v['sides'][s].get('fit') or {}).get('rms') for s in v['sides']}, 'inl': {s: (v['sides'][s].get('fit') or {}).get('inliers') for s in v['sides']}}))
for k, r in rows:
    flag = ''
    if r is None: flag = 'FAIL'
    elif not (-2.6 < r['aspect_dev_pct'] < 1.2) or abs(r['tb_dev_pct']) > 0.8 or abs(r['lr_dev_pct']) > 1.0 or max(x or 9 for x in r['rms'].values()) > 0.8: flag = 'CHECK'
    print(k, flag, r)
json.dump(dict(rows), open(pref + '_qa.json', 'w'), indent=1)
# контактні аркуші
ok = [(k, det[k]) for k, r in rows if r is not None]
per = 32; T = 120; H = 50
for pi in range(0, len(ok), per):
    chunk = ok[pi:pi + per]
    img = Image.new('RGB', (8 * (2 * T + 10), 4 * (2 * T + 22)), 'white')
    d = ImageDraw.Draw(img)
    for i, (k, v) in enumerate(chunk):
        im = Image.open(f'raw/{k}.jpg').convert('RGB')
        ox, oy = (i % 8) * (2 * T + 10), (i // 8) * (2 * T + 22)
        d.text((ox + 2, oy + 2), k, fill='blue')
        for j, cn in enumerate(('nw', 'ne', 'sw', 'se')):
            x, y = v['corners'][cn]
            cr = im.crop((int(x) - H // 2, int(y) - H // 2, int(x) - H // 2 + H, int(y) - H // 2 + H)).resize((T, T), Image.NEAREST)
            dd = ImageDraw.Draw(cr)
            cx = (x - (int(x) - H // 2)) * T / H; cy = (y - (int(y) - H // 2)) * T / H
            dd.line((cx - 30, cy, cx - 6, cy), fill='red'); dd.line((cx + 6, cy, cx + 30, cy), fill='red')
            dd.line((cx, cy - 30, cx, cy - 6), fill='red'); dd.line((cx, cy + 6, cx, cy + 30), fill='red')
            img.paste(cr, (ox + (j % 2) * T, oy + 14 + (j // 2) * T))
    img.save(f'{pref}_contact{pi // per + 1}.png')
print('contact sheets:', (len(ok) + per - 1) // per)
