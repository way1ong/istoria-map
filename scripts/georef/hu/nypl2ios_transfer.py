"""Перенесення опорних точок аркуша Spezialkarte зі скану NYPL (уже прив'язаного) на скан IOS того самого аркуша.

Для кожної клітинки: ORB-ознаки на копіях !3300,3300 обох сканів, пари за тестом відношення, RANSAC-гомографія,
далі кубічний поліном NYPL → IOS за всіма вцілілими парами (ітеративно без викидів > 3 px) — він враховує різну
усадку паперу й вигин сканів. 8 опорних точок (кути й середини сторін рамки) з елемента прив'язки NYPL переводяться
в пікселі повного скану IOS. Якщо рамка виходить за межі скану IOS (скан обрізаний), клітинку позначаємо як «обрізану».

Запуск: nypl2ios_transfer.py <out.json> <клітинка>[,<клітинка>...]
Потрібні: hu/raw/<k>.jpg (IOS !3300), hu/raw_n/<k>.jpg (NYPL !3300), hu/info/<k>.json, hu/info_n/<k>.json,
public/georef/spezialkarte-75000.json (елемент NYPL з 8 або 4 точками)."""
import json, sys, math, os
import numpy as np, cv2

HU = os.environ.get('HU_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')) + '/'
GEO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'public', 'georef', 'spezialkarte-75000.json')
ROM = {14: 'XIV', 15: 'XV', 16: 'XVI', 17: 'XVII', 18: 'XVIII', 19: 'XIX', 20: 'XX', 21: 'XXI', 22: 'XXII', 23: 'XXIII',
       24: 'XXIV', 25: 'XXV', 26: 'XXVI', 27: 'XXVII', 28: 'XXVIII'}
SHIFT = (-0.000965, -0.00074)
NAMES = ('nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w')
# клітинки поза hu/sources.json (давні аркуші довкола Göd): сервіс IOS
SRC = {'15-21': 'https://iiif.ios-regensburg.de/iiif/2/BV035904986.tif', '16-19': 'https://iiif.ios-regensburg.de/iiif/2/BV043869596.tif'}


def geo_points(z, col):
    lonW = 18.3333333333 + (col - 19) * 0.5 + SHIFT[0]; latN = 48.75 - (z - 11) * 0.25 + SHIFT[1]
    lonE, latS = lonW + 0.5, latN - 0.25
    return {'nw': [lonW, latN], 'n': [lonW + 0.25, latN], 'ne': [lonE, latN], 'e': [lonE, latN - 0.125],
            'se': [lonE, latS], 's': [lonW + 0.25, latS], 'sw': [lonW, latS], 'w': [lonW, latN - 0.125]}


def nypl_gcps(item, z, col):
    """8 точок рамки в пікселях повного скану NYPL. Для старих елементів з 4 кутами (projective) середини сторін
    беремо з тієї самої проєктивної моделі."""
    feats = item['body']['features']
    px = np.array([f['properties']['resourceCoords'] for f in feats], float)
    geo = np.array([f['geometry']['coordinates'] for f in feats], float)
    want = geo_points(z, col)
    if len(feats) >= 8:
        out = {}
        for n in NAMES:
            d = np.hypot(*(geo - np.array(want[n])).T)
            i = int(d.argmin()); assert d[i] < 1e-5, (n, d[i])
            out[n] = px[i].tolist()
        return out
    H = cv2.getPerspectiveTransform(geo[:4].astype(np.float32), px[:4].astype(np.float32))
    return {n: cv2.perspectiveTransform(np.float32([[want[n]]]), H)[0, 0].tolist() for n in NAMES}


def gray(path):
    g = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(g)


def poly_terms(p, deg=3):
    x, y = p[:, 0] / 1000.0, p[:, 1] / 1000.0
    return np.stack([x ** i * y ** j for i in range(deg + 1) for j in range(deg + 1 - i)], 1)


def fit_poly(a, b, deg=3):
    keep = np.ones(len(a), bool)
    for _ in range(6):
        A = poly_terms(a[keep], deg)
        cx, *_ = np.linalg.lstsq(A, b[keep, 0], rcond=None); cy, *_ = np.linalg.lstsq(A, b[keep, 1], rcond=None)
        P = poly_terms(a, deg); res = np.hypot(P @ cx - b[:, 0], P @ cy - b[:, 1])
        new = res < max(3.0, 3 * np.median(res[keep]))
        if (new == keep).all(): break
        keep = new
    rms = float(np.sqrt((res[keep] ** 2).mean()))
    return (lambda q: np.stack([poly_terms(q, deg) @ cx, poly_terms(q, deg) @ cy], 1)), rms, int(keep.sum()), keep, res


def one(k, items):
    z, col = map(int, k.split('-'))
    sid = f'{z}-{ROM[col]}'
    item = next(it for it in items if it['id'].endswith('#' + sid))
    src = item['target']['source']
    assert 'nypl' in src['id'], (k, src['id'])
    gN = nypl_gcps(item, z, col)
    iI = json.load(open(HU + f'info/{k}.json'))
    service = SRC[k]
    a, b = gray(HU + f'raw_n/{k}.jpg'), gray(HU + f'raw/{k}.jpg')
    sN = src['width'] / a.shape[1]; sI = iI['width'] / b.shape[1]
    orb = cv2.ORB_create(40000, scaleFactor=1.2, nlevels=8, fastThreshold=10)
    ka, da = orb.detectAndCompute(a, None); kb, db = orb.detectAndCompute(b, None)
    m = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(da, db, k=2)
    good = [x[0] for x in m if len(x) == 2 and x[0].distance < 0.8 * x[1].distance]
    pa = np.float32([ka[x.queryIdx].pt for x in good]); pb = np.float32([kb[x.trainIdx].pt for x in good])
    H, inl = cv2.findHomography(pa, pb, cv2.RANSAC, 6.0)
    inl = inl.ravel().astype(bool)
    # пари поблизу гомографії, далі кубічний поліном
    proj = cv2.perspectiveTransform(pa.reshape(-1, 1, 2), H).reshape(-1, 2)
    near = np.hypot(*(proj - pb).T) < 12
    f, rms, nkeep, keep, res = fit_poly(pa[near].astype(float), pb[near].astype(float))
    # покриття: чи є пари біля кожної точки рамки (у межах 15 % розміру)
    pts_copyN = np.array([[gN[n][0] / sN, gN[n][1] / sN] for n in NAMES])
    near_pts = pa[near][keep]
    cover = [int((np.hypot(*(near_pts - p).T) < 0.15 * a.shape[1]).sum()) for p in pts_copyN]
    tI = f(pts_copyN) * sI
    W, Hh = iI['width'], iI['height']
    inside = [bool(0 <= x <= W - 1 and 0 <= y <= Hh - 1) for x, y in tI]
    margin = float(min(min(x, W - 1 - x, y, Hh - 1 - y) for x, y in tI))
    geo = geo_points(z, col)
    return {'cell': k, 'sid': sid, 'service': service, 'info_id': iI.get('@id') or iI.get('id'), 'width': W, 'height': Hh, 'nypl': src['id'],
            'matches': len(good), 'h_inliers': int(inl.sum()), 'poly_pairs': nkeep, 'rms_copy_px': round(rms, 2),
            'cover': cover, 'inside': inside, 'min_margin_px': round(margin, 1),
            'gcps': [{'name': n, 'px': [round(float(tI[i][0]), 1), round(float(tI[i][1]), 1)],
                      'geo': [round(geo[n][0], 6), round(geo[n][1], 6)]} for i, n in enumerate(NAMES)]}


if __name__ == '__main__':
    out_path, cells = sys.argv[1], sys.argv[2].split(',')
    items = json.load(open(GEO))['items']
    SRC.update({k: v['service'] for k, v in json.load(open(HU + 'sources.json')).items() if 'ios-regensburg' in v['service']})
    try: res = json.load(open(out_path))
    except Exception: res = {}
    for k in cells:
        try:
            r = one(k, items)
        except Exception as ex:
            r = {'cell': k, 'error': repr(ex)[:300]}
        res[k] = r
        print(k, {x: r.get(x) for x in ('matches', 'h_inliers', 'poly_pairs', 'rms_copy_px', 'min_margin_px', 'error')}, 'cover', r.get('cover'), flush=True)
        json.dump(res, open(out_path, 'w'), indent=1)
