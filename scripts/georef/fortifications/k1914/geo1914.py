import json, math, numpy as np, cv2
from scipy.interpolate import RBFInterpolator
P = json.load(open('/home/user/istoria-map/public/georef/spezialkarte-75000.json'))
items = {it['id'].split('#')[-1]: it for it in P['items']}
def georef(sid):
    it = items[sid]; f = it['body']['features']
    px = np.array([x['properties']['resourceCoords'] for x in f], float); geo = np.array([x['geometry']['coordinates'] for x in f], float)
    if it['body']['transformation']['type'] == 'projective':
        Hm = cv2.getPerspectiveTransform(px[:4].astype(np.float32), geo[:4].astype(np.float32))
        return lambda q: cv2.perspectiveTransform(np.float32(q).reshape(-1, 1, 2), Hm).reshape(-1, 2).astype(float), it
    tps = RBFInterpolator(px, geo, kernel='thin_plate_spline')
    return lambda q: tps(np.array(q, float)), it
M = json.load(open('match.json'))
F15, it15 = georef('15-XX'); F16, it16 = georef('16-XX')
sc15 = it15['target']['source']['width'] / 1500.0; sc16 = it16['target']['source']['width'] / 1500.0
# точніше за гомографію: квадратичний поліном фігура -> аркуш за всіма парами RANSAC
def polyfit(pa, pb):
    def terms(p): x, y = p[:, 0] / 1000, p[:, 1] / 1000; return np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], 1)
    keep = np.ones(len(pa), bool)
    for _ in range(5):
        A = terms(pa[keep]); cx, *_ = np.linalg.lstsq(A, pb[keep, 0], rcond=None); cy, *_ = np.linalg.lstsq(A, pb[keep, 1], rcond=None)
        r = np.hypot(terms(pa) @ cx - pb[:, 0], terms(pa) @ cy - pb[:, 1]); keep = r < max(2.0, 3 * np.median(r[keep]))
    print('  пар', int(keep.sum()), 'залишок (px аркуша 1500)', round(float(np.median(r[keep])), 2))
    return lambda q: np.stack([terms(np.atleast_2d(q)) @ cx, terms(np.atleast_2d(q)) @ cy], 1)
f15 = polyfit(np.array(M['s15']['pa']), np.array(M['s15']['pb'])); f16 = polyfit(np.array(M['s16']['pa']), np.array(M['s16']['pb']))
poly15 = np.array([list(map(float, q.split(','))) for q in it15['target']['selector']['value'].split('points="')[1].split('"')[0].split()])
y15max = poly15[:, 1].max()
def fig2ll(p):
    q = f15(p)[0] * sc15
    if q[1] <= y15max: return F15([q])[0], '15-XX'
    q = f16(p)[0] * sc16
    return F16([q])[0], '16-XX'
if __name__ == '__main__':
    dots = json.load(open('dots_tm.json'))
    bad = {62, 63, 64, 65}
    out = []
    for i, (x, y, s) in enumerate(dots):
        if i in bad: continue
        ll, sh = fig2ll((x, y)); out.append({'n': i, 'fig': [x, y], 'lon': round(float(ll[0]), 5), 'lat': round(float(ll[1]), 5), 'sheet': sh})
    json.dump(out, open('dots_ll.json', 'w'), indent=1)
    print(len(out), 'пунктів')
    KX = 111.32 * math.cos(math.radians(47.55)) * 1000; KY = 111320
    for name, (lat, lon) in {'szilas1': (47.556757, 19.147068), 'szilas2': (47.558275, 19.144857)}.items():
        d = sorted((math.hypot((o['lon'] - lon) * KX, (o['lat'] - lat) * KY), o['n']) for o in out)[:2]
        print(name, 'найближчі кружки (м, №):', [(round(a), b) for a, b in d])
