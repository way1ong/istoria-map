# Сегментація мапи-джерела за кольорами заливки: кожна зв'язна одноколірна ділянка — окрема «область».
# Лінії меж, підписи й значки міст (невідомі пікселі) віддаються найближчій області, тож сусідні області
# сходяться посередині намальованої лінії. Дрібні плями (нутрощі літер, озера) теж розчиняються в сусідах.
#
#   python3 segment.py <мапа.png> <вихід-префікс> <x0,y0,x1,y1 рамки мапи> [мін. площа області, px]
# Результат: <префікс>_regions.npy (номер області в кожному пікселі, 0 поза рамкою),
#            <префікс>_regions.json (клас, площа, центр, рамка кожної області), <префікс>_regions.png (перегляд).
import json, sys
import cv2, numpy as np
from scipy import ndimage

# кольори заливки на мапах PANONIAN і AlmostPenguin (RGB) → клас
CLASSES = {
    'royal':    (166, 200, 217),   # Королівська Угорщина (блакитний)
    'croatia':  (232, 179, 179),   # Хорватія (рожевий)
    'habsburg': (177, 187, 197),   # інші габсбурзькі землі (сірий)
    'eyalet':   (198, 224, 212),   # османські вілаєти (світло-зелений)
    'vassal':   (180, 212, 178),   # васальні князівства (зелений)
    'poland':   (231, 235, 162),   # Польща (жовтий)
    'sea':      (225, 241, 241),
    'venice':   (225, 223, 187),
    'other':    (214, 194, 210),
    # лише мапа «Expansion… (1526–1568)»
    'ott_old':  (104, 172, 91),    # імперія до 1526 року
    'z1526':    (122, 200, 107),
    'z1547':    (142, 232, 124),
    'z1568':    (160, 255, 142),
    'trans':    (3, 235, 174),     # Трансільванія (ядро)
    'partium':  (0, 255, 190),     # частина з підписом «1541»
}
TOL = 10

def segment(path, box, min_area=60):
    im = cv2.imread(path, cv2.IMREAD_COLOR)
    rgb = cv2.cvtColor(im, cv2.COLOR_BGR2RGB).astype(np.int16)
    x0, y0, x1, y1 = box
    inside = np.zeros(rgb.shape[:2], bool); inside[y0:y1, x0:x1] = True
    regions = np.zeros(rgb.shape[:2], np.int32); meta = {}; nxt = 1
    for cname, col in CLASSES.items():
        m = (np.abs(rgb - np.array(col)).max(axis=2) <= TOL) & inside
        if not m.any(): continue
        lab, n = ndimage.label(m)          # 4-зв'язність: тонка лінія навскоси теж розділяє
        if n == 0: continue
        areas = ndimage.sum(m, lab, index=np.arange(1, n + 1))
        for i, a in enumerate(areas, start=1):
            if a < min_area: continue
            regions[lab == i] = nxt
            meta[nxt] = {'class': cname, 'area': int(a)}
            nxt += 1
    # озера всередині суходолу: невеликі плями кольору моря, що не торкаються рамки мапи
    for rid, mt in list(meta.items()):
        if mt['class'] != 'sea': continue
        ys, xs = np.nonzero(regions == rid)
        touches = xs.min() <= x0 + 1 or xs.max() >= x1 - 2 or ys.min() <= y0 + 1 or ys.max() >= y1 - 2
        if not touches and mt['area'] < 0.004 * (x1 - x0) * (y1 - y0):
            regions[regions == rid] = 0; del meta[rid]
    # невідоме → найближча область
    unknown = (regions == 0) & inside
    idx = ndimage.distance_transform_edt(regions == 0, return_distances=False, return_indices=True)
    filled = regions[idx[0], idx[1]]
    regions = np.where(unknown, filled, regions); regions[~inside] = 0
    for rid, mt in meta.items():
        ys, xs = np.nonzero(regions == rid)
        mt.update(area=int(len(xs)), cx=float(xs.mean()), cy=float(ys.mean()), bbox=[int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())])
    return regions, meta

def preview(regions, meta, out, scale=1.0):
    rng = np.random.default_rng(3)
    pal = np.zeros((max(meta) + 1, 3), np.uint8)
    for rid, mt in meta.items():
        base = np.array(CLASSES[mt['class']], float)
        pal[rid] = np.clip(base + rng.integers(-28, 29, 3), 0, 255)
    vis = cv2.cvtColor(pal[regions], cv2.COLOR_RGB2BGR)
    edges = (regions != np.roll(regions, 1, 0)) | (regions != np.roll(regions, 1, 1))
    vis[edges] = (40, 40, 40)
    if scale != 1.0: vis = cv2.resize(vis, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    big = sorted(meta.items(), key=lambda t: -t[1]['area'])
    for rid, mt in big:
        if mt['area'] * scale * scale < 250: continue
        cv2.putText(vis, str(rid), (int(mt['cx'] * scale) - 8, int(mt['cy'] * scale) + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 200), 1, cv2.LINE_AA)
    cv2.imwrite(out, vis)

if __name__ == '__main__':
    path, prefix = sys.argv[1], sys.argv[2]
    box = [int(v) for v in sys.argv[3].split(',')]
    min_area = int(sys.argv[4]) if len(sys.argv) > 4 else 60
    regions, meta = segment(path, box, min_area)
    np.save(prefix + '_regions.npy', regions)
    json.dump({str(k): v for k, v in meta.items()}, open(prefix + '_regions.json', 'w'), indent=0)
    preview(regions, meta, prefix + '_regions.png', scale=min(1.0, 1500 / regions.shape[1]))
    by = {}
    for rid, mt in meta.items(): by.setdefault(mt['class'], []).append((mt['area'], rid))
    for c, lst in by.items(): print(c, [(rid, a) for a, rid in sorted(lst, reverse=True)[:14]])
