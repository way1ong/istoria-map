"""Вирізки в правильному розміщенні довкола кожної плями позицій піхоти «Аттіла» біля Göd (пляма + 250 м),
з найкращого кадру: пріоритет 1960_0704 (23.08.1960, висота 1300 м), 1963_0139, 1961, 1965, 1966."""
import json, math, sys
from query import merc
import geocrop

PRI = ['1960_0704', '1963_0139', '1961_0823', '1961_0819', '1963_0129', '1963_0127', '1965_0516', '1965_0512', '1965_0494', '1965_0523', '1966_0550', '1961_0887']
G = json.load(open('/home/user/istoria-map/data/fortifications/fortifications-1914-1944.geojson'))
P = geocrop.P
AOI = (19.08, 47.58, 19.33, 47.71)

def best_frame(lon, lat, w_m, h_m):
    X, Y = merc(lon, lat); k = 1 / math.cos(math.radians(lat))
    cands = []
    for g, p in P.items():
        if not p.get('success'): continue
        x0, y0, x1, y1 = [float(p[q]) for q in ('mbr_xmin', 'mbr_ymin', 'mbr_xmax', 'mbr_ymax')]
        if not (x0 < X < x1 and y0 < Y < y1): continue
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        off = max(abs(X - cx) / ((x1 - x0) / 2), abs(Y - cy) / ((y1 - y0) / 2))
        film = p['filmszam']
        pr = PRI.index(film) if film in PRI else 99
        cands.append((off > 0.75, pr, off, film + '_' + p['kepszam']))
    cands.sort()
    return [c[3] for c in cands]

if __name__ == '__main__':
    only = set(map(int, sys.argv[1].split(','))) if len(sys.argv) > 1 else None
    out = {}
    for i, f in enumerate(G['features']):
        if f['properties']['kind'] != 'infantry': continue
        ring = f['geometry']['coordinates'][0]
        lo = [p[0] for p in ring]; la = [p[1] for p in ring]
        cx, cy = (min(lo) + max(lo)) / 2, (min(la) + max(la)) / 2
        if not (AOI[0] <= cx <= AOI[2] and AOI[1] <= cy <= AOI[3]): continue
        if only and i not in only: continue
        w = (max(lo) - min(lo)) * 111320 * math.cos(math.radians(cy)); h = (max(la) - min(la)) * 111320
        half = min(max(w, h) / 2 + 250, 600)
        fr = best_frame(cx, cy, w, h)
        if not fr:
            print(i, 'немає кадру'); continue
        nm = None
        for cand in fr[:4]:
            try:
                path = f'gc/inf{i}_{cand}.png'
                img, info = geocrop.crop(cand, cx, cy, half, 0.9, path); nm = cand; break
            except Exception as ex:
                print(i, cand, 'не вдалося:', repr(ex)[:80])
        if not nm: continue
        g = geocrop.overlay(path, info)
        out[i] = {'frame': nm, 'alts': fr[1:6], 'png': path, 'grid': g, 'lon': cx, 'lat': cy, 'half': half}
        print(i, nm, 'alts', fr[1:4], g)
        json.dump(out, open('gc/polycrops.json', 'w'), indent=1)
