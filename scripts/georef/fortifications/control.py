"""Контрольний рисунок: об'єкти шару укріплень поверх ліній OpenStreetMap (вода, дороги, залізниці).
python3 control.py <w,s,e,n> <osm.json з reg/osmtiles.py> <вихід.png> [ширина px] [види через кому]
Приклад: python3 control.py 18.24,46.99,18.77,47.30 margit8/m8_osm.json control_margit8.png 2400"""
import json, math, os, sys
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__))
COL = {  # BGR
    'margit_ditch': (28, 28, 183), 'margit_trench': (0, 108, 239), 'margit_described': (65, 76, 109), 'karola': (147, 53, 40),
    'trench': (120, 170, 255), 'ditch': (28, 28, 183), 'ditch_assumed': (53, 57, 229), 'course_assumed': (53, 57, 229),
    'photo_trench': (154, 27, 106), 'remains': (32, 94, 27), 'infantry': (37, 168, 249), 'strongpoint_1914': (138, 58, 30),
}
def main():
    w, s, e, n = map(float, sys.argv[1].split(',')); osm = json.load(open(sys.argv[2])); out = sys.argv[3]
    W = int(sys.argv[4]) if len(sys.argv) > 4 else 2400
    kinds = set(sys.argv[5].split(',')) if len(sys.argv) > 5 else None
    kx = math.cos(math.radians((s + n) / 2)); H = int(W * (n - s) / ((e - w) * kx))
    def px(c): c = np.asarray(c, float); return np.c_[(c[:, 0] - w) / (e - w) * W, (n - c[:, 1]) / (n - s) * H]
    img = np.full((H, W, 3), 255, np.uint8)
    for k, col, r in (('road', (200, 200, 200), 1), ('water', (235, 190, 120), 1), ('rail', (90, 90, 90), 1)):
        P = px(osm[k]); ok = (P[:, 0] >= 0) & (P[:, 0] < W) & (P[:, 1] >= 0) & (P[:, 1] < H)
        for x, y in P[ok].astype(int): cv2.circle(img, (x, y), r, col, -1)
    G = json.load(open(os.path.join(HERE, '..', '..', '..', 'data', 'fortifications', 'fortifications-1914-1944.geojson'), encoding='utf-8'))
    for f in G['features']:
        k = f['properties']['kind']; g = f['geometry']
        if kinds and k not in kinds: continue
        col = COL.get(k, (0, 0, 0))
        if g['type'] == 'LineString':
            P = px(g['coordinates']).astype(np.int32).reshape(-1, 1, 2)
            if k in ('margit_described', 'ditch_assumed', 'course_assumed'):
                q = px(g['coordinates'])
                for a, b in zip(q, q[1:]):
                    L = np.hypot(*(b - a)); m = max(1, int(L / 14))
                    for i in range(m):
                        if i % 2 == 0: cv2.line(img, tuple((a + (b - a) * i / m).astype(int)), tuple((a + (b - a) * (i + 1) / m).astype(int)), col, 3, cv2.LINE_AA)
            else: cv2.polylines(img, [P], False, col, 3 if k in ('margit_ditch', 'ditch') else 2, cv2.LINE_AA)
        elif g['type'] == 'Point':
            x, y = px([g['coordinates']])[0].astype(int); cv2.circle(img, (x, y), 4, col, -1)
        elif g['type'] == 'Polygon':
            cv2.polylines(img, [px(g['coordinates'][0]).astype(np.int32).reshape(-1, 1, 2)], True, col, 1, cv2.LINE_AA)
    cv2.imwrite(out, img); print(out, W, H)
if __name__ == '__main__': main()
