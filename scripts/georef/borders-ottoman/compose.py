# Складання станів поділу Угорщини за роками у спільній сітці довгот і широт.
#
# Джерела (усі CC0, Вікісховище): мапа 1572 року (Central_europe_1572_hu.svg, PNG 3840 px),
# «Expansion de l'Empire ottoman en Europe centrale (1526–1568)» і Central_europe_1683.png.
# Кроки: області за кольорами (segment.py) → клас кожної області → перенесення в сітку (grid.py) →
# спільна рамка давнього королівства з мапи 1572 року (поза нею — з «Expansion») → підгонка мапи 1683 року
# до цієї рамки → стани за роками (1530, 1547, 1568, 1606, 1664, 1683). Результат: <робоча тека>/states.npz і контрольні зображення.
#
#   python3 compose.py <робоча тека>
import json, os, sys
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from georef import Georef, load_points, evaluate, km
import grid as G

# класи в сітці
NONE, ROYAL, CROATIA, OTTOMAN, TRANS, HABSBURG, POLAND, MOLDAVIA, WALLACHIA, WATER, ZONE, UPPER, VARAT, UYVAR, KINGDOM = range(15)
INSIDE = (ROYAL, CROATIA, OTTOMAN, TRANS, ZONE, UPPER, VARAT, UYVAR, KINGDOM)      # землі давнього королівства й османські провінції
KM_LON = 111.32 * np.cos(np.radians(47.0)); KM_LAT = 110.57

def region_classes(meta, regions, name, state=None):
    """Номер області → клас. Області розпізнаються за кольором і за точкою всередині (піксель мапи)."""
    def at(x, y): return int(regions[int(y), int(x)])
    out = {}
    big_poland = max((m['area'], rid) for rid, m in meta.items() if m['class'] == 'poland')[1]
    for rid, m in meta.items():
        c = m['class']
        if c == 'royal': k = ROYAL
        elif c == 'croatia': k = CROATIA
        elif c == 'habsburg': k = HABSBURG
        elif c == 'poland': k = POLAND if rid == big_poland else None     # дрібні жовті плями розв'язуються нижче
        elif c in ('eyalet', 'ott_old', 'z1526'): k = OTTOMAN
        elif c == 'z1547': k = KINGDOM if state == '1530' else OTTOMAN        # здобуто між 1526 і 1547 роками
        elif c == 'z1568': k = KINGDOM if state == '1530' else ZONE if state == '1547' else OTTOMAN
        elif c in ('trans', 'partium'): k = TRANS
        elif c == 'vassal': k = None
        else: k = WATER
        out[rid] = k
    if name == '1572':
        out[at(3637, 1700)] = TRANS; out[at(3527, 2740)] = WALLACHIA
    elif name == 'exp':
        out[at(996, 319)] = MOLDAVIA; out[at(851, 631)] = WALLACHIA
    elif name == '1683':
        out[at(555, 189)] = UPPER; out[at(795, 374)] = TRANS; out[at(1014, 314)] = MOLDAVIA; out[at(879, 573)] = WALLACHIA
        out[at(640, 359)] = VARAT
        for rid, m in meta.items():           # Уйварський вілаєт: дві маленькі плями біля значка Uyvar
            if m['class'] == 'eyalet' and m['area'] < 3000 and abs(m['cx'] - 392) < 30 and abs(m['cy'] - 251) < 25: out[rid] = UYVAR
    # решта: жовті острівці всередині королівства (заставлені Польщі спиські міста) — до королівства;
    # інші дрібні області (Рагуза, Чорногорія, сусіди на краю мапи) — поза розглядом
    for rid, m in meta.items():
        if out[rid] is None:
            out[rid] = ROYAL if (m['class'] == 'poland' and name != '1683') else WATER
    if name == '1683':
        for rid, m in meta.items():
            if m['class'] == 'poland' and rid != big_poland: out[rid] = WATER if m['cx'] < 120 else ROYAL
    if state == '1530':                       # до 1541 року: одне королівство, без поділу на частини
        for rid in out:
            if out[rid] in (ROYAL, CROATIA, TRANS): out[rid] = KINGDOM
    return out

def class_image(regions, cls):
    lut = np.zeros(max(cls) + 1, np.uint8)
    for rid, k in cls.items(): lut[rid] = k
    return lut[regions]

def load_source(work, name, state=None):
    regions = np.load(os.path.join(work, f'{name}_regions.npy'))
    meta = {int(k): v for k, v in json.load(open(os.path.join(work, f'{name}_regions.json'))).items()}
    return class_image(regions, region_classes(meta, regions, name, state))

def warp(cls_img, inv):
    return G.warp_regions(cls_img.astype(np.int32), inv).astype(np.uint8)

def frame_cells(cls, kinds=(HABSBURG, POLAND, MOLDAVIA, WALLACHIA)):
    """Клітинки королівства, що межують із сусідом: {клас сусіда: [(стовпчик, рядок), …]}."""
    ins = np.isin(cls, INSIDE); res = {}
    for k in kinds:
        o = cls == k
        nb = np.zeros_like(o)
        nb[1:] |= o[:-1]; nb[:-1] |= o[1:]; nb[:, 1:] |= o[:, :-1]; nb[:, :-1] |= o[:, 1:]
        ys, xs = np.nonzero(ins & nb)
        res[k] = np.stack([xs, ys], axis=1).astype(float)
    return res

def grid_lonlat(cells):
    return np.stack([G.LON0 + (cells[:, 0] + 0.5) * G.CELL, G.LAT1 - (cells[:, 1] + 0.5) * G.CELL], axis=1)

def metric(ll):
    return np.stack([ll[:, 0] * KM_LON, ll[:, 1] * KM_LAT], axis=1)

# Балатон намальовано на мапі 1683 року: кінці озера — ще дві опорні точки (піксель; довгота, широта з Nominatim:
# Keszthely і Balatonakarattya)
LAKE_1683 = (np.array([[301.0, 381.0], [367.0, 348.0]]), np.array([[17.2463, 46.7675], [18.1439, 47.0240]]))

def register_to_frame(cls_img, px, geo, target, extra=None, w_city=20.0, log=print):
    """Прив'язка мапи 1683 року. Її значки міст поставлено недбало (самі між собою розходяться на ~12 км),
    а рамка королівства намальована так само, як на мапі 1572 року. Тому точки рамки притягуються до найближчих
    точок рамки-еталона того самого виду (межа з Габсбургами, Польщею, Молдавією, Волощиною), а значки міст
    і кінці Балатону втримують середину мапи: прив'язка лише за рамкою зсуває їх на 15–20 км на південь.
    Модель — поліном 3-го степеня; вага одного значка міста w_city, кінця озера — утричі більша."""
    src = frame_cells(cls_img)
    trees = {k: cKDTree(metric(target[k])) for k in target if len(target[k])}
    ex_px, ex_geo = extra if extra is not None else (np.zeros((0, 2)), np.zeros((0, 2)))
    fwd = Georef(px, geo, 1)
    for it, thr in enumerate((45, 35, 25, 18, 14, 12, 10, 10, 10, 10)):
        P, Q = [], []
        for k, pts in src.items():
            if k not in trees or not len(pts): continue
            d, i = trees[k].query(metric(fwd(pts)))
            ok = d < thr
            P.append(pts[ok]); Q.append(target[k][i[ok]])
        P = np.vstack(P); Q = np.vstack(Q)
        w = np.concatenate([np.ones(len(P)), np.full(len(px), w_city), np.full(len(ex_px), 3 * w_city)])
        fwd = Georef(np.vstack([P, px, ex_px]), np.vstack([Q, geo, ex_geo]), 3 if it > 1 else 2, w)
        d = np.hypot(*(metric(fwd(P)) - metric(Q)).T)
        log(f'   крок {it}: поріг {thr} км, пар {len(P)}, відстань до рамки: медіана {np.median(d):.1f}, 90 % {np.percentile(d, 90):.1f} км')
    # обернена модель (довгота, широта) → піксель за тими самими парами й вагами: нею мапа переноситься в сітку
    inv = Georef(np.vstack([Q, geo, ex_geo]), np.vstack([P, px, ex_px]), 3, w)
    return fwd, inv

def snap(state, frame, allowed):
    """Стан у спільній рамці: усередині рамки — клас зі свого джерела; клітинки, де джерело через неточність
    прив'язки показує сусіда (або клас не з переліку), дістають найближчий дозволений клас."""
    ok = np.isin(state, allowed)
    idx = ndimage.distance_transform_edt(~ok, return_distances=False, return_indices=True)
    filled = state[idx[0], idx[1]]
    out = np.where(frame, filled, 0).astype(np.uint8)
    return out

def main(work):
    log = print
    cities = os.path.join(HERE, 'cities.json')
    src = {}
    for name, deg in (('1572', 2), ('exp', 2), ('1683', 1)):
        names, px, geo = load_points(os.path.join(HERE, f'points_{name}.json'), cities)
        g, res, loo = evaluate(names, px, geo, deg)
        log(f'{name}: міст {len(names)}, поліном {deg}-го степеня, залишок сер. {np.mean(res):.1f} км, «без одного»: медіана {np.median(loo):.1f}, макс {np.max(loo):.1f} км')
        src[name] = dict(names=names, px=np.array(px, float), geo=np.array(geo, float), deg=deg)
    # мапа 1572 року й «Expansion»: прив'язка за значками міст
    c1572 = load_source(work, '1572'); cexp = load_source(work, 'exp'); cexp47 = load_source(work, 'exp', '1547'); c1683 = load_source(work, '1683')
    cexp30 = load_source(work, 'exp', '1530')
    g1572 = warp(c1572, G.inverse_georef(None, src['1572']['px'], src['1572']['geo'], 2))
    inv_exp = G.inverse_georef(None, src['exp']['px'], src['exp']['geo'], 2)
    gexp = warp(cexp, inv_exp); gexp47 = warp(cexp47, inv_exp); gexp30 = warp(cexp30, inv_exp)
    # спільна основа: мапа 1572 року, поза її полем — «Expansion»
    base = np.where(g1572 != NONE, g1572, gexp)
    frame = np.isin(base, INSIDE)
    target = {k: grid_lonlat(v) for k, v in frame_cells(base).items()}
    # наскільки «Expansion» збігається з мапою 1572 року там, де є обидві
    both = (g1572 != NONE) & (gexp != NONE)
    te = frame_cells(np.where(both, gexp, NONE)); t7 = frame_cells(np.where(both, g1572, NONE))
    for k, nm in ((HABSBURG, 'Габсбурги'), (POLAND, 'Польща')):
        d, _ = cKDTree(metric(grid_lonlat(t7[k]))).query(metric(grid_lonlat(te[k])))
        log(f'рамка «Expansion» проти мапи 1572 ({nm}): медіана {np.median(d):.1f}, 90 % {np.percentile(d, 90):.1f}, макс {d.max():.1f} км')
    # мапа 1683 року: значки міст неточні, тому підгонка до рамки
    log('мапа 1683: підгонка до спільної рамки')
    fwd, inv83 = register_to_frame(c1683, src['1683']['px'], src['1683']['geo'], target, LAKE_1683, log=log)
    res = [km(p[0], p[1], q[0], q[1]) for p, q in zip(fwd(src['1683']['px']), src['1683']['geo'])]
    log('   значки міст після підгонки: ' + ', '.join(f'{n} {r:.0f}' for n, r in zip(src['1683']['names'], res)) + f' км; медіана {np.median(res):.1f}')
    lk = np.hypot(*(metric(fwd(LAKE_1683[0])) - metric(LAKE_1683[1])).T)
    log(f'   кінці Балатону: {lk[0]:.1f} і {lk[1]:.1f} км')
    ys, xs = np.nonzero(np.isin(c1683, (ROYAL, CROATIA, TRANS, UPPER, VARAT, UYVAR)))
    p = np.stack([xs, ys], axis=1)[::50].astype(float)
    e = np.hypot(*(inv83(fwd(p)) - p).T)
    log(f'   пряма й обернена моделі в межах королівства розходяться до {e.max():.2f} px (1 px ≈ 1,5 км)')
    g1683 = warp(c1683, inv83)
    np.savez_compressed(os.path.join(work, 'grids.npz'), g1572=g1572, gexp=gexp, gexp47=gexp47, g1683=g1683, base=base)
    json.dump({'lonlat_to_px': {'coef': inv83.coef.tolist(), 'c': inv83.c.tolist(), 's': float(inv83.s), 'deg': inv83.deg}}, open(os.path.join(work, 'georef_1683.json'), 'w'))
    # стани
    R = {}
    # 1530: османське — лише здобуте до 1526 року (зона «1526» і давніша імперія), решта рамки — королівство
    R['s1530'] = snap(gexp30, frame, (KINGDOM, OTTOMAN))
    log(f'стан 1530: у рамці королівство {(R["s1530"] == KINGDOM).sum() * G.CELL * G.CELL * KM_LON * KM_LAT:.0f} км²')
    R['s1547'] = snap(gexp47, frame, (ROYAL, CROATIA, OTTOMAN, TRANS, ZONE))
    R['s1568'] = snap(base, frame, (ROYAL, CROATIA, OTTOMAN, TRANS))
    s83 = snap(g1683, frame, (ROYAL, CROATIA, OTTOMAN, TRANS, UPPER, VARAT, UYVAR))
    def remap(a, m):
        out = a.copy()
        for k, v in m.items(): out[a == k] = v
        return out
    R['s1606'] = remap(s83, {UPPER: ROYAL, UYVAR: ROYAL, VARAT: TRANS})
    # землі, які мапа 1572 року показує трансільванськими, а мапа 1683 року — османськими (Карансебесько-Лугоське
    # банство й західний край Partium), Трансільванія втратила лише 1658–1660 років: до того вони її
    late = (R['s1606'] == OTTOMAN) & (R['s1568'] == TRANS)
    R['s1606'][late] = TRANS
    log(f'стан 1606: за мапою 1572 року Трансільванії повернуто {late.sum() * G.CELL * G.CELL * KM_LON * KM_LAT:.0f} км²')
    R['s1664'] = remap(s83, {UPPER: ROYAL, UYVAR: OTTOMAN, VARAT: OTTOMAN})
    R['s1683'] = remap(s83, {UYVAR: OTTOMAN, VARAT: OTTOMAN})
    np.savez_compressed(os.path.join(work, 'states.npz'), base=base, **R)
    return R, base

if __name__ == '__main__':
    main(sys.argv[1])
