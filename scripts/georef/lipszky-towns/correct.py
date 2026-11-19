"""Прив'язка мапи Ліпскі 1806 за містами (поверх моделі сітки градусів).

Для кожного міста: значок на скані S (передбачена точка + зчитаний зсув), його положення за нинішньою прив'язкою
g_old = F_old(S) і справжні координати G (OpenStreetMap). Зсуви D = G − g_old (км) задають поле поправок C:
тонкопластинний сплайн точно через міста, а далі ніж 40 км від найближчого міста поправка плавно згасає до нуля
на 80 км (там лишається модель сітки, бо відомостей немає).
Для кожного аркуша нові опорні точки: сітка всередині (крок ~1300 px), точки на рамці (крок ~650 px, щоб стики
сусідніх аркушів брали ту саму поправку) і самі міста; геокоординати = g_old + C(g_old).

Запуск: correct.py <старий georef> <новий georef> [болота_старі.geojson болота_нові.geojson]"""
import json, math, re, sys
import numpy as np
from scipy.interpolate import RBFInterpolator
from scipy.spatial import cKDTree

KX = 111.32 * math.cos(math.radians(47.0)); KY = 111.32
D0, D1 = 40.0, 80.0


def load(path):
    P = json.load(open(path)); sheets = []
    for it in P['items']:
        f = it['body']['features']
        geo = np.array([x['geometry']['coordinates'] for x in f]); px = np.array([x['properties']['resourceCoords'] for x in f])
        poly = np.array([list(map(float, q.split(','))) for q in re.search(r'points="([^"]+)"', it['target']['selector']['value']).group(1).split()])
        sheets.append({'F': RBFInterpolator(px, geo, kernel='thin_plate_spline'), 'I': RBFInterpolator(geo, px, kernel='thin_plate_spline'),
                       'x0': poly[:, 0].min(), 'x1': poly[:, 0].max(), 'y0': poly[:, 1].min(), 'y1': poly[:, 1].max()})
    return P, sheets


def field(towns_old, disp_km):
    X = towns_old * [KX, KY]
    tps = RBFInterpolator(X, disp_km, kernel='thin_plate_spline')
    tree = cKDTree(X)
    def C(lonlat):
        q = np.atleast_2d(lonlat) * [KX, KY]
        d, _ = tree.query(q)
        w = np.clip((D1 - d) / (D1 - D0), 0, 1)[:, None]
        return w * tps(q) / [KX, KY]
    return C


def main():
    old_path, new_path = sys.argv[1], sys.argv[2]
    P, S = load(old_path)
    T = json.load(open('towns_osm.json')); pred = json.load(open('pred.json')); rd = json.load(open('readings.json'))
    names = list(rd); sym, g_old, G = [], [], []
    for n in names:
        p = pred[n]; s = p['sheet']; px = np.array([p['x'] + rd[n][0], p['y'] + rd[n][1]])
        sym.append((s, px)); g_old.append(S[s]['F']([px])[0]); G.append([T[n]['lon'], T[n]['lat']])
    g_old, G = np.array(g_old), np.array(G)
    C = field(g_old, (G - g_old) * [KX, KY])
    for i, (it, sh) in enumerate(zip(P['items'], S)):
        x0, x1, y0, y1 = sh['x0'], sh['x1'], sh['y0'], sh['y1']
        nx = int(round((x1 - x0) / 1300)); ny = int(round((y1 - y0) / 1300))
        pts = [(x, y) for x in np.linspace(x0, x1, nx + 1) for y in np.linspace(y0, y1, ny + 1)]
        ex = int(round((x1 - x0) / 650)); ey = int(round((y1 - y0) / 650))
        for x in np.linspace(x0, x1, ex + 1): pts += [(x, y0), (x, y1)]
        for y in np.linspace(y0, y1, ey + 1): pts += [(x0, y), (x1, y)]
        pts = np.unique(np.round(np.array(pts), 1), axis=0)
        # міста всередині рамки цього аркуша (точка значка, перенесена старою прив'язкою)
        tp = sh['I'](g_old)
        inside = (tp[:, 0] > x0 + 5) & (tp[:, 0] < x1 - 5) & (tp[:, 1] > y0 + 5) & (tp[:, 1] < y1 - 5)
        # прибрати точки сітки, ближчі за 300 px до міста (щоб не тягнули в різні боки)
        if inside.any():
            dmin = np.min(np.hypot(pts[:, None, 0] - tp[inside][None, :, 0], pts[:, None, 1] - tp[inside][None, :, 1]), axis=1)
            pts = pts[dmin > 300]
        geo_old = sh['F'](pts); geo_new = geo_old + C(geo_old)
        feats = [{'type': 'Feature', 'properties': {'resourceCoords': [round(float(p[0]), 1), round(float(p[1]), 1)]},
                  'geometry': {'type': 'Point', 'coordinates': [round(float(g[0]), 6), round(float(g[1]), 6)]}} for p, g in zip(pts, geo_new)]
        for k in np.nonzero(inside)[0]:
            feats.append({'type': 'Feature', 'properties': {'resourceCoords': [round(float(tp[k][0]), 1), round(float(tp[k][1]), 1)]},
                          'geometry': {'type': 'Point', 'coordinates': [round(float(G[k][0]), 6), round(float(G[k][1]), 6)]}})
        it['body']['features'] = feats
        print('аркуш', i, 'опорних точок', len(feats), 'з них міст', int(inside.sum()))
    json.dump(P, open(new_path, 'w'), ensure_ascii=False, separators=(',', ':'))
    # перевірка: міста після поправки і стики аркушів
    _, N = load(new_path)
    err = [np.hypot(*((N[s]['F']([px])[0] - G[k]) * [KX, KY])) for k, (s, px) in enumerate(sym)]
    print('міста після поправки, км: макс', round(max(err), 3))
    seam = []
    for a in range(len(S)):
        for b in range(len(S)):
            if a == b: continue
            sa = S[a]
            for x in np.linspace(sa['x0'], sa['x1'], 40):
                for y in (sa['y0'], sa['y1']):
                    g = sa['F']([[x, y]])[0]; pb = S[b]['I']([g])[0]
                    if S[b]['x0'] <= pb[0] <= S[b]['x1'] and S[b]['y0'] - 2 <= pb[1] <= S[b]['y1'] + 2:
                        seam.append(np.hypot(*((N[a]['F']([[x, y]])[0] - N[b]['F']([pb])[0]) * [KX, KY])))
            for y in np.linspace(sa['y0'], sa['y1'], 30):
                for x in (sa['x0'], sa['x1']):
                    g = sa['F']([[x, y]])[0]; pb = S[b]['I']([g])[0]
                    if S[b]['x0'] - 2 <= pb[0] <= S[b]['x1'] + 2 and S[b]['y0'] <= pb[1] <= S[b]['y1']:
                        seam.append(np.hypot(*((N[a]['F']([[x, y]])[0] - N[b]['F']([pb])[0]) * [KX, KY])))
    if seam: print('стики аркушів після поправки, м: медіана', round(float(np.median(seam)) * 1000), 'макс', round(float(max(seam)) * 1000), 'точок', len(seam))
    if len(sys.argv) > 4:
        gj = json.load(open(sys.argv[3])); n = 0
        def mv(coords):
            nonlocal n
            a = np.array(coords, float); a2 = a + C(a); n += len(a)
            return [[round(float(x), 6), round(float(y), 6)] for x, y in a2]
        for f in gj['features']:
            g = f['geometry']
            if g['type'] == 'Polygon': g['coordinates'] = [mv(r) for r in g['coordinates']]
            elif g['type'] == 'MultiPolygon': g['coordinates'] = [[mv(r) for r in poly] for poly in g['coordinates']]
            elif g['type'] == 'LineString': g['coordinates'] = mv(g['coordinates'])
            elif g['type'] == 'MultiLineString': g['coordinates'] = [mv(l) for l in g['coordinates']]
        json.dump(gj, open(sys.argv[4], 'w'), ensure_ascii=False, separators=(',', ':'))
        print('болота: вершин перераховано', n)
    # поправка біля Göd для звіту
    for name, ll in (('Göd', (19.14, 47.69)), ('Будапешт', (19.05, 47.50)), ('Сегед', (20.15, 46.25)), ('Шопрон', (16.60, 47.68))):
        c = C(np.array([ll]))[0] * [KX, KY] * 1000
        print('поправка', name, 'м (схід, північ):', [round(float(v)) for v in c])


if __name__ == '__main__':
    main()
