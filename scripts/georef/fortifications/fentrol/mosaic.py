"""Огляд: кадри fentrol.hu (WMS, приблизне розміщення сайту) на одному полотні Web Mercator + траси з шару укріплень.
Запуск: mosaic.py <w,s,e,n> <м_на_px_Меркатора> <роки через кому, від пріоритетного> <вихід.png> [--lines]"""
import json, math, os, subprocess, sys, time
from PIL import Image, ImageDraw
from query import merc

def wms(p, W, H, path, bbox=None):
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return Image.open(path)
    x0, y0, x1, y1 = bbox or [float(p[k]) for k in ('mbr_xmin', 'mbr_ymin', 'mbr_xmax', 'mbr_ymax')]
    url = (f"https://www.fentrol.hu/cgi-bin/mapserv.fcgi?map={p['mapfilepath']}&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap"
           f"&LAYERS={p['layername']}&SRS=EPSG:3857&BBOX={x0},{y0},{x1},{y1}&WIDTH={W}&HEIGHT={H}&FORMAT=image/png&TRANSPARENT=true&STYLES=")
    for _ in range(3):
        subprocess.run(['curl', '-sS', '-m', '180', '-o', path, url], check=False)
        if os.path.exists(path) and os.path.getsize(path) > 1000:
            break
        time.sleep(5)
    time.sleep(0.5)
    return Image.open(path)

if __name__ == '__main__':
    w, s, e, n = map(float, sys.argv[1].split(','))
    res = float(sys.argv[2]); years = sys.argv[3].split(','); out = sys.argv[4]
    P = json.load(open('props.json'))
    X0, Y0 = merc(w, s); X1, Y1 = merc(e, n)
    CW, CH = int((X1 - X0) / res), int((Y1 - Y0) / res)
    canvas = Image.new('RGBA', (CW, CH), (255, 255, 255, 255))
    os.makedirs('wms', exist_ok=True)
    order = []
    for yr in reversed(years):  # пізніші спершу, ранні зверху
        fr = [(g, p) for g, p in P.items() if p.get('success') and (p.get('filmszam') or '').startswith(yr)]
        fr = [(g, p) for g, p in fr if float(p['mbr_xmax']) > X0 and float(p['mbr_xmin']) < X1 and float(p['mbr_ymax']) > Y0 and float(p['mbr_ymin']) < Y1]
        order += sorted(fr, key=lambda t: t[1]['layername'])
    used = []
    for g, p in order:
        x0, y0, x1, y1 = [float(p[k]) for k in ('mbr_xmin', 'mbr_ymin', 'mbr_xmax', 'mbr_ymax')]
        W, H = max(64, int((x1 - x0) / res)), max(64, int((y1 - y0) / res))
        im = wms(p, W, H, f"wms/{p['layername']}_{int(res)}.png").convert('RGBA')
        # рамку знімка (чорні поля, годинники) прибираємо: прозорі майже чорні краї
        px = im.load()
        canvas.alpha_composite(im, (int((x0 - X0) / res), int((Y1 - y1) / res)))
        used.append(p['layername'])
    if '--lines' in sys.argv:
        G = json.load(open('/home/user/istoria-map/data/fortifications/fortifications-1914-1944.geojson'))
        d = ImageDraw.Draw(canvas, 'RGBA')
        for f in G['features']:
            gt = f['geometry']['type']; k = f['properties']['kind']
            if gt == 'LineString':
                pts = [((merc(*c)[0] - X0) / res, (Y1 - merc(*c)[1]) / res) for c in f['geometry']['coordinates']]
                d.line(pts, fill=(255, 0, 0, 150) if k != 'trench' else (255, 120, 0, 150), width=2)
            elif gt == 'Polygon':
                pts = [((merc(*c)[0] - X0) / res, (Y1 - merc(*c)[1]) / res) for c in f['geometry']['coordinates'][0]]
                d.line(pts + [pts[0]], fill=(255, 200, 0, 170), width=2)
    canvas.convert('RGB').save(out, quality=88)
    print(out, canvas.size, 'кадрів', len(used))
