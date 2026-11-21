"""Вирізка кадру fentrol.hu у правильному розміщенні (прив'язка regframe.py: розміщення сайту + афінна поправка за OSM),
північ угорі, сітка Web Mercator з заданою роздільністю на місцевості. Дані знімка беруться з WMS сайту для
потрібного прямокутника (у розміщенні сайту) з потрібною детальністю.
Запуск: geocrop.py <film_frame> <lon> <lat> <півсторона_м> <м_на_px> <вихід.png> [--overlay]
Вихідна вирізка: піксель (i, j) ↔ X = Xc − half + (i + 0.5)·r, Y = Yc + half − (j + 0.5)·r (Меркатор)."""
import json, math, os, subprocess, sys, time
import numpy as np, cv2
from PIL import Image, ImageDraw
from query import merc, unmerc

P = json.load(open('props.json'))

def frame(nm):
    return next((g, p) for g, p in P.items() if p.get('success') and (p['filmszam'] + '_' + str(p['kepszam'])) == nm)

def reg(nm):
    R = json.load(open('regs.json')) if os.path.exists('regs.json') else {}
    if nm not in R:
        import regframe
        r = regframe.run(nm)
        if r is None: raise RuntimeError('прив\'язка не вдалася: ' + nm)
        R = json.load(open('regs.json')) if os.path.exists('regs.json') else {}
        R[nm] = r; json.dump(R, open('regs.json', 'w'), indent=1)
    return R[nm]

def wms_bbox(p, bbox, W, H, path):
    if not (os.path.exists(path) and os.path.getsize(path) > 1000):
        x0, y0, x1, y1 = bbox
        url = (f"https://www.fentrol.hu/cgi-bin/mapserv.fcgi?map={p['mapfilepath']}&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap"
               f"&LAYERS={p['layername']}&SRS=EPSG:3857&BBOX={x0},{y0},{x1},{y1}&WIDTH={W}&HEIGHT={H}&FORMAT=image/png&TRANSPARENT=true&STYLES=")
        for _ in range(3):
            subprocess.run(['curl', '-sS', '-m', '180', '-o', path, url], check=False)
            if os.path.exists(path) and os.path.getsize(path) > 1000: break
            time.sleep(5)
        time.sleep(0.4)
    return np.asarray(Image.open(path).convert('RGBA'))

def crop(nm, lon, lat, half_m, mpp, out=None):
    g, p = frame(nm); r = reg(nm)
    fx0, fy0, fx1, fy1 = r['bbox']; res = r['res']                    # розміщення сайту; пікселі W=1500
    tx, ty, rot, s, sh = r['par']; c = np.array(r['center'])
    a = math.radians(rot); S = math.exp(s)
    A = (np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]]) * S) @ np.array([[1, sh], [0, 1]])
    k = 1 / math.cos(math.radians(lat)); half = half_m * k; rM = mpp * k
    Xc, Yc = merc(lon, lat)
    n = int(round(2 * half / rM))
    ii, jj = np.meshgrid(np.arange(n) + 0.5, np.arange(n) + 0.5)
    X = Xc - half + ii * rM; Y = Yc + half - jj * rM                    # справжні координати пікселів вирізки
    q = np.stack([(X - fx0) / res, (fy1 - Y) / res], -1)               # у пікселях W=1500 розміщення сайту (як OSM)
    pp = (q - c) @ A.T + c + [tx, ty]                                  # піксель знімка в розміщенні сайту
    Xf = fx0 + pp[..., 0] * res; Yf = fy1 - pp[..., 1] * res
    bx0, bx1 = Xf.min() - 20 * rM, Xf.max() + 20 * rM; by0, by1 = Yf.min() - 20 * rM, Yf.max() + 20 * rM
    W = int((bx1 - bx0) / rM); H = int((by1 - by0) / rM)
    src = wms_bbox(p, (bx0, by0, bx1, by1), W, H, f"wms/{p['layername']}_{int(bx0)}_{int(by1)}_{W}.png")
    mx = ((Xf - bx0) / rM - 0.5).astype(np.float32); my = ((by1 - Yf) / rM - 0.5).astype(np.float32)
    img = cv2.remap(src, mx, my, cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
    info = {'nm': nm, 'gid': g, 'Xc': Xc, 'Yc': Yc, 'half': half, 'rM': rM, 'n': n, 'mpp': mpp}
    if out:
        Image.fromarray(img).convert('RGB').save(out)
        json.dump(info, open(out.rsplit('.', 1)[0] + '.json', 'w'))
    return img, info

def px2ll(info, i, j):
    X = info['Xc'] - info['half'] + i * info['rM']; Y = info['Yc'] + info['half'] - j * info['rM']
    return unmerc(X, Y)

def ll2px(info, lon, lat):
    X, Y = merc(lon, lat)
    return (X - (info['Xc'] - info['half'])) / info['rM'], ((info['Yc'] + info['half']) - Y) / info['rM']

def overlay(path, info, grid=50):
    """Сітка (кожні grid px, підписи) і реконструкція поверх вирізки — для читання координат вершин."""
    from PIL import ImageFont
    im = Image.open(path).convert('RGB'); d = ImageDraw.Draw(im, 'RGBA')
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 12)
    n = info['n']
    for v in range(0, n, grid):
        d.line((v, 0, v, n), fill=(0, 120, 255, 70)); d.line((0, v, n, v), fill=(0, 120, 255, 70))
        d.text((v + 2, 2), str(v), fill=(0, 90, 255, 255), font=font); d.text((2, v + 2), str(v), fill=(0, 90, 255, 255), font=font)
    G = json.load(open('/home/user/istoria-map/data/fortifications/fortifications-1914-1944.geojson'))
    for f in G['features']:
        gt = f['geometry']['type']; kd = f['properties']['kind']
        if gt == 'LineString' and kd in ('ditch', 'ditch_assumed', 'course_assumed', 'remains'):
            pts = [ll2px(info, *q) for q in f['geometry']['coordinates']]
            d.line(pts, fill=(255, 60, 0, 110), width=1)
        elif gt == 'Polygon' and kd == 'infantry':
            pts = [ll2px(info, *q) for q in f['geometry']['coordinates'][0]]
            d.line(pts + [pts[0]], fill=(255, 200, 0, 140), width=1)
        elif gt == 'Point':
            x, y = ll2px(info, *f['geometry']['coordinates'])
            d.ellipse((x - 4, y - 4, x + 4, y + 4), outline=(0, 0, 255, 200))
    O = json.load(open('osm_god_main.json'))
    for kk, col in (('road', (255, 0, 255, 120)), ('rail', (255, 0, 0, 140))):
        for lon, lat in O[kk]:
            x, y = ll2px(info, lon, lat)
            if 0 <= x < n and 0 <= y < n: d.point((x, y), fill=col)
    out = path.rsplit('.', 1)[0] + '_g.jpg'
    im.save(out, quality=90)
    return out

if __name__ == '__main__':
    nm, lon, lat, half, mpp, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
    img, info = crop(nm, lon, lat, half, mpp, out)
    if '--overlay' in sys.argv: print(overlay(out, info))
    print(nm, info['n'], 'px')
