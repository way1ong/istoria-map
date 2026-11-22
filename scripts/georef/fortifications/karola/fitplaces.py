"""Перша афінна прив'язка рисунків 8, 12, 14 (Ádám 2022) за значками населених пунктів Google Earth
(пікселі з markers.py, назви за підписами) ↔ координати з Nominatim (places.py). Значки Google не збігаються
з точками OpenStreetMap (залишки 30–480 м), тож це лише початкове наближення → aff_places_<рис>.json."""
import json, math, numpy as np
C = json.load(open('places_osm.json'))
FIG = {
 '007': {'Heréd': (875.4, 24.9), 'Kartal': (340.9, 324.9), 'Hatvan': (1111.0, 350.3), 'Kerekharaszt': (839.6, 375.8), 'Bag': (75.0, 584.8), 'Hévízgyörk': (268.1, 633.2), 'Galgahévíz': (485.8, 723.9)},
 '011': {'Heréd': (315.2, 145.7), 'Hort': (1140.6, 302.2), 'Hatvan': (552.1, 490.0), 'Kerekharaszt': (270.1, 516.1)},
 '013': {'Gyöngyössolymos': (1136.7, 1.5), 'Gyöngyöspata': (667.1, 10.1), 'Gyöngyöstarján': (912.8, 14.7), 'Szűcsi': (565.3, 64.6), 'Apc': (347.0, 112.3),
         'Rózsaszentmárton': (494.5, 153.2), 'Gyöngyös': (1122.5, 192.5), 'Zagyvaszántó': (261.2, 200.7), 'Nagyréde': (861.9, 254.0), 'Petőfibánya': (365.7, 257.9),
         'Gyöngyöshalász': (1100.3, 370.2), 'Lőrinci': (277.1, 379.9), 'Ecséd': (586.0, 421.9), 'Atkár': (996.5, 471.6), 'Heréd': (132.7, 532.3), 'Hort': (638.2, 629.2),
         'Vámosgyörk': (1107.4, 650.4), 'Hatvan': (277.6, 744.4)},
}
KY = 111320.0
def fit(fig, drop=None):
    names = [n for n in FIG[fig] if n != drop]
    P = np.array([FIG[fig][n] for n in names]); L = np.array([[C[n]['lon'], C[n]['lat']] for n in names])
    A = np.c_[P, np.ones(len(P))]
    cx, *_ = np.linalg.lstsq(A, L[:, 0], rcond=None); cy, *_ = np.linalg.lstsq(A, L[:, 1], rcond=None)
    return cx, cy, names, P, L
if __name__ == '__main__':
    for fig in FIG:
        cx, cy, names, P, L = fit(fig)
        KX = KY * math.cos(math.radians(L[:, 1].mean()))
        res = np.hypot((np.c_[P, np.ones(len(P))] @ cx - L[:, 0]) * KX, (np.c_[P, np.ones(len(P))] @ cy - L[:, 1]) * KY)
        print(fig, 'точок', len(names), 'м/px', round(math.hypot(cx[0] * KX, cy[0] * KY), 2), round(math.hypot(cx[1] * KX, cy[1] * KY), 2), 'залишки м:', {n: int(r) for n, r in zip(names, res)})
        json.dump({'cx': cx.tolist(), 'cy': cy.tolist()}, open(f'aff_places_{fig}.json', 'w'))
