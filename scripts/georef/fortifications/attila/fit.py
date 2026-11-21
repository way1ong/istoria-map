import json, math, numpy as np
P = {'Alsógöd': (174, 6), 'Dunakeszi': (174.0, 74.7), 'Fót': (229, 102), 'Veresegyház': (311.4, 39.6), 'Vácegres': (384.5, 13.8),
     'Szada': (334.0, 70.5), 'Gödöllő': (377, 117), 'Mogyoród': (268, 117), 'Csömör': (256.8, 188.4), 'Kistarcsa': (284.5, 188.4),
     'Isaszeg': (412, 222), 'Cinkota': (254.3, 229.4), 'Pécel': (361.3, 280.1), 'Rákosliget': (289, 267.6), 'Rákoshegy': (264.8, 308.5),
     'Maglód': (374.6, 342.8), 'Gyömrő': (412, 370.2), 'Mende': (463.9, 362.8), 'Vecsés': (290, 387), 'Üllő': (365, 427),
     'Péteri': (421.8, 422.5), 'Monor': (454.3, 468), 'Soroksár': (160, 390), 'Pesterzsébet': (157, 342.6), 'Csepel': (119.1, 360.4),
     'Budaörs': (20.3, 310.6), 'Pesthidegkút': (18.0, 180.7)}
T = json.load(open('places_osm.json'))
KX = 111.32 * math.cos(math.radians(47.5)); KY = 111.32
names = list(P)
px = np.array([P[n] for n in names], float); ll = np.array([[T[n]['lon'], T[n]['lat']] for n in names])
keep = np.ones(len(names), bool)
for it in range(5):
    A = np.c_[px[keep], np.ones(keep.sum())]
    cx, *_ = np.linalg.lstsq(A, ll[keep, 0], rcond=None); cy, *_ = np.linalg.lstsq(A, ll[keep, 1], rcond=None)
    pred = np.c_[px, np.ones(len(px))] @ np.c_[cx, cy]
    err = np.hypot((pred[:, 0] - ll[:, 0]) * KX, (pred[:, 1] - ll[:, 1]) * KY) * 1000
    med = np.median(err[keep]); new = err < max(600, 2.5 * med)
    if (new == keep).all(): break
    keep = new
for n, e, k in sorted(zip(names, err, keep), key=lambda t: -t[1]):
    print(f'{n:14s} {e:6.0f} m {"" if k else "ВІДКИНУТО"}')
print('медіана', round(float(np.median(err[keep]))), 'м; rms', round(float(np.sqrt((err[keep]**2).mean()))), 'м; точок', int(keep.sum()))
# масштаб: м на піксель
mx = math.hypot(cx[0] * KX, cy[0] * KY) * 1000; my = math.hypot(cx[1] * KX, cy[1] * KY) * 1000
print('м/px x', round(mx, 1), 'y', round(my, 1), '; поворот', round(math.degrees(math.atan2(cy[0] * KY, cx[0] * KX)), 2), '°')
json.dump({'cx': cx.tolist(), 'cy': cy.tolist(), 'used': [n for n, k in zip(names, keep) if k]}, open('affine.json', 'w'), ensure_ascii=False)
