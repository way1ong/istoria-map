# Файли кордонів 1530–1699 років: Угорське королівство до 1541 року й стани його поділу в османську добу
# (compose.py) вставляються у вирізки historical-basemaps (data/borders/y1530, y1600, y1650); сусідні держави
# лишаються з того набору.
#
#   python3 build.py <робоча тека> [тека для результату; типово data/borders]
#
# Вихідні вирізки historical-basemaps беруться з git — з коміту BASE_REV, де y1530, y1600 і y1650 ще без поділу, —
# а не з робочої копії, тож повторний запуск дає той самий результат, хоч y1600 і y1650 уже переписано.
import json, os, subprocess, sys
import numpy as np
from scipy import ndimage
import shapely
from shapely.geometry import shape, mapping, Polygon, MultiPolygon
from shapely.ops import unary_union
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import grid as G
import polygons as P
from compose import ROYAL, CROATIA, OTTOMAN, TRANS, HABSBURG, POLAND, ZONE, UPPER, KINGDOM, INSIDE

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
BASE_REV = '1deff46a534218e93cf3cf54d0187ddd766ecdaa'   # «Шар історичних кордонів…», 2026-11-16 (є в main)
TOL = 0.010            # допуск спрощення меж, градуси широти (≈ 1,1 км)
SIGMA = 3.5            # згладжування меж у сітці, клітинки (≈ 1,3–1,9 км)
RING_KM = {POLAND: 220.0, HABSBURG: 100.0}   # наскільки далеко від рамки сусіди беруться з мап-джерел

COMMONS = 'https://commons.wikimedia.org/wiki/File:'
SRC_1572 = {'title': 'Central europe 1572 hu.svg — «Közép-Európa 1572-ben» (PANONIAN; угорська версія: Sepultura), Вікісховище',
            'url': COMMONS + 'Central_europe_1572_hu.svg', 'license': 'CC0'}
SRC_EXP = {'title': "Expansion de l'Empire ottoman en Europe centrale (1526 - 1568).png (AlmostPenguin, 2022, за мапами PANONIAN), Вікісховище",
           'url': COMMONS + "Expansion_de_l%27Empire_ottoman_en_Europe_centrale_(1526_-_1568).png", 'license': 'CC0'}
SRC_1683 = {'title': 'Central europe 1683.png — «Central Europe in 1683» (WikiEditor2004 = PANONIAN, 2011), Вікісховище',
            'url': COMMONS + 'Central_europe_1683.png', 'license': 'CC0'}
SRC_HUWIKI = {'title': 'hu.wikipedia: Török hódoltság (роки утворення вілаєтів: Egri 1596, Kanizsai 1600, Váradi 1660, Érsekújvári 1663)',
              'url': 'https://hu.wikipedia.org/wiki/T%C3%B6r%C3%B6k_h%C3%B3dolts%C3%A1g', 'license': 'CC BY-SA 4.0'}
SRC_LUGOS = {'title': 'hu.wikipedia: Lugos (Karánsebesi–lugosi bánság: 1658-ig az Erdélyi Fejedelemség határőrvidéke)',
             'url': 'https://hu.wikipedia.org/wiki/Lugos', 'license': 'CC BY-SA 4.0'}
SRC_JANOS = {'title': 'hu.wikipedia: I. János magyar király (Szapolyai János: magyar király 1526-tól haláláig, 1540. július 22.; kettős királyválasztás)',
             'url': 'https://hu.wikipedia.org/wiki/I._J%C3%A1nos_magyar_kir%C3%A1ly', 'license': 'CC BY-SA 4.0'}
SRC_BELHABORU = {'title': 'hu.wikipedia: Magyar belháború (1526–38) — I. Ferdinánd és Szapolyai János harca a magyar trónért',
                 'url': 'https://hu.wikipedia.org/wiki/Magyar_belh%C3%A1bor%C3%BA_(1526%E2%80%9338)', 'license': 'CC BY-SA 4.0'}
SRC_UH = {'title': 'hu.wikipedia: Felső-Magyarországi Fejedelemség (1682–1685)',
          'url': 'https://hu.wikipedia.org/wiki/Fels%C5%91-Magyarorsz%C3%A1gi_Fejedelems%C3%A9g', 'license': 'CC BY-SA 4.0'}

PROPS = {
    ROYAL:   {'name': 'Royal Hungary', 'subjecto': 'Royal Hungary', 'name_uk': 'Королівська Угорщина', 'name_hu': 'Királyi Magyarország'},
    CROATIA: {'name': 'Croatia', 'subjecto': 'Royal Hungary', 'name_uk': 'Хорватія', 'name_hu': 'Horvátország'},
    TRANS:   {'name': 'Principality of Transylvania', 'subjecto': 'Transylvania', 'name_uk': 'Трансільванське князівство', 'name_hu': 'Erdélyi Fejedelemség'},
    ZONE:    {'name': 'Ottoman conquests 1547–1568', 'subjecto': 'Ottoman Empire', 'name_uk': 'Османські завоювання 1547–1568', 'name_hu': 'Oszmán hódítások 1547–1568'},
    # до 1541 року: назва й subjecto як у historical-basemaps для 1492 і 1500 років, тому й колір той самий
    KINGDOM: {'name': 'Imperial Hungary', 'subjecto': 'Imperial Hungary', 'name_uk': 'Угорське королівство (два королі)', 'name_hu': 'Magyar Királyság (két király)'},
    UPPER:   {'name': 'Principality of Upper Hungary', 'subjecto': 'Ottoman Empire', 'name_uk': 'Верхньоугорське князівство (1682–1685)', 'name_hu': 'Felső-Magyarországi Fejedelemség (1682–1685)'},
}

# рік файлу → стан, вирізка historical-basemaps із сусідами, точність нових полігонів, джерела, пояснення
YEARS = {
    1530: dict(state='s1530', base=1530, precision=1, sources=[SRC_EXP, SRC_JANOS, SRC_BELHABORU],
               note='Угорське королівство в тій самій рамці, що й у наступних роках; османська частина — лише землі, які мапа '
                    '«Expansion de l\'Empire ottoman en Europe centrale (1526–1568)» показує здобутими до 1526 року (смуга на північ '
                    'від давнього кордону імперії, від далматинського узбережжя до Белграда). З 1526 року королівство мало двох королів: '
                    'Яноша I (Szapolyai János), короля до смерті 1540 року, і Фердинанда I Габсбурга; їхня війна за трон тривала 1526–1538 років. '
                    'Межу між володіннями двох королів не показано, бо мапи-джерела її не дають; тому ж Хорватію й Трансільванію '
                    'окремо не виділено (мапа показує Хорватію лише в межах 1568 року, а Трансільванського князівства ще не було). '
                    'Сусідні держави — з вирізки world_1530.'),
    1541: dict(state='s1547', base=1530, precision=1, sources=[SRC_EXP],
               note='Поділ Угорщини — стан близько 1547 року за мапою «Expansion de l\'Empire ottoman en Europe centrale (1526–1568)»: '
                    'османська частина — землі, здобуті до 1547 року; окремим контуром — землі, здобуті між 1547 і 1568 роками '
                    '(кому з християнських володарів вони належали до того, мапа не показує); Трансільванія разом з Partium. '
                    'Межі зон на мапі схематичні. Сусідні держави — з вирізки world_1530.'),
    1568: dict(state='s1568', base=1600, precision=2, sources=[SRC_1572, SRC_EXP],
               note='Поділ Угорщини — за мапою «Közép-Európa 1572-ben» (стан 1572 року). Файл датовано 1568 роком, бо мапа '
                    '«Expansion… (1526–1568)» показує ті самі межі як підсумок османських завоювань до 1568 року. '
                    'Східна частина Трансільванії, якої на мапі 1572 року немає (на схід від ≈24,2° сх. д.), — за мапою «Expansion…». '
                    'Сусідні держави — з вирізки world_1600.'),
    1600: dict(state='s1606', base=1600, precision=1, sources=[SRC_1683, SRC_1572, SRC_HUWIKI, SRC_LUGOS],
               note='Поділ Угорщини для 1600–1663 років виведено з мапи 1683 року, бо окремої вільної мапи з заливками для цих років '
                    'на Вікісховищі немає: до османської частини не зараховано Варадський (з 1660) та Уйварський (з 1663) вілаєти, утворені пізніше '
                    '(перший показано в складі Трансільванії, другий — Королівської Угорщини), а землі Верхньоугорського князівства Текелі (1682–1685) '
                    'показано королівськими. Еґерський (1596) і Каніжський (1600) вілаєти вже османські. Землі, які мапа 1572 року показує '
                    'трансільванськими, а мапа 1683 року — османськими (Карансебесько-Лугоське банство, яке Трансільванія віддала 1658 року, '
                    'і західний край Partium), лишено за Трансільванією. Це наближення: дрібніші зміни меж між 1600 і 1663 роками не показано.'),
    1650: dict(state='s1606', base=1650, precision=1, sources=[SRC_1683, SRC_1572, SRC_HUWIKI, SRC_LUGOS], note=None),
    1664: dict(state='s1664', base=1650, precision=1, sources=[SRC_1683, SRC_HUWIKI, SRC_UH],
               note='Поділ Угорщини для 1664–1682 років — за мапою 1683 року: Варадський (з 1660) та Уйварський (з 1663) вілаєти османські; '
                    'землі Верхньоугорського князівства Текелі, що існувало лише 1682–1685 років, показано королівськими. '
                    'Сусідні держави — з вирізки world_1650.'),
    1683: dict(state='s1683', base=1650, precision=2, sources=[SRC_1683, SRC_UH],
               note='Поділ Угорщини — за мапою «Central Europe in 1683»: Королівська Угорщина, османські вілаєти, Трансільванія '
                    'і Верхньоугорське князівство Імре Текелі (васал Османської імперії, 1682–1685). Відвоювання Угорщини 1686–1699 років '
                    'не показано: наступний файл набору — 1700 рік. Сусідні держави — з вирізки world_1650.'),
}
YEARS[1650]['note'] = YEARS[1600]['note'] + ' Сусідні держави — з вирізки world_1650.'
ATTR = {'s1530': 'AlmostPenguin', 's1547': 'AlmostPenguin', 's1568': 'PANONIAN, AlmostPenguin'}

def original(year):
    """Первісна вирізка historical-basemaps (до вставки поділу) з git."""
    out = subprocess.run(['git', '-C', ROOT, 'show', f'{BASE_REV}:data/borders/y{year}.geojson'], capture_output=True, text=True, check=True).stdout
    d = json.loads(out)
    assert 'division' not in d
    return d

def fix(g):
    if not g.is_valid: g = shapely.make_valid(g)
    if g.geom_type == 'GeometryCollection':
        g = unary_union([p for p in g.geoms if p.geom_type in ('Polygon', 'MultiPolygon')])
    return g

def tidy(g, min_area=0.03):
    """Сітка 0,001°, без уламків (менше ≈ 250 км²: кожна частина дістала б на мапі власний підпис) і дірок-щілин."""
    g = fix(shapely.set_precision(fix(g), 0.001))
    parts = [p for p in (g.geoms if g.geom_type == 'MultiPolygon' else [g]) if p.geom_type == 'Polygon' and p.area >= min_area]
    parts = [Polygon(p.exterior, [h for h in p.interiors if Polygon(h).area >= min_area]) for p in parts]
    if not parts: return None
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)

def geometry(g):
    m = mapping(g)
    def rnd(c): return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 3), round(c[1], 3)]
    return {'type': m['type'], 'coordinates': rnd(m['coordinates'])}

def state_polygons(work, log=print):
    st = np.load(os.path.join(work, 'states.npz'))
    base = P.smooth(st['base'], SIGMA)                     # спільна основа: рамка королівства й сусіди довкола
    frame = np.isin(base, INSIDE)
    km = ndimage.distance_transform_edt(~frame, sampling=(G.CELL * 110.57, G.CELL * 111.32 * P.KX))
    ring = np.zeros_like(base)
    for k, d in RING_KM.items(): ring[(base == k) & (km < d)] = k
    keys = sorted({v['state'] for v in YEARS.values()})
    full = {}
    for k in keys:
        s = np.where(np.isin(st[k], INSIDE), st[k], 0)
        c = P.clean(P.smooth(P.fill_nearest(s, frame), SIGMA, frame))
        log(f'{k}: згладжування й прибирання смужок змінило {int((c != st[k]).sum())} клітинок з {int(frame.sum())}')
        full[k] = P.pad(np.where(frame, c, ring).astype(np.int64))
    combo = sum(full[k] << (4 * i) for i, k in enumerate(keys))
    arcs = P.crack_arcs(combo)
    simp = [(P.simplify_arc(c, TOL), a, b) for c, a, b in arcs]
    log(f'відрізків меж {len(arcs)}, точок до спрощення {sum(len(c) for c, _, _ in arcs)}, після {sum(len(c) for c, _, _ in simp)}')
    out = {}
    for k in keys:
        out[k] = P.faces(simp, full[k], (ROYAL, CROATIA, OTTOMAN, TRANS, ZONE, UPPER, KINGDOM, POLAND, HABSBURG))
        # перевірка: площі полігонів проти площі клітинок
        for cls, g in out[k].items():
            cells = float((full[k] == cls).sum()) * G.CELL * G.CELL
            if cls == OTTOMAN: continue        # османська частина сягає краю сітки, її площу не звіряємо
            if abs(g.area - cells) > 0.02 * cells + 0.01: log(f'   УВАГА {k} клас {cls}: площа полігона {g.area:.3f}, клітинок {cells:.3f}')
    return out

def find(feats, shapes, names, near):
    """Індекс полігона базового набору з однією з назв, який найбільше перекривається з near."""
    best, area = None, 0.0
    for i, f in enumerate(feats):
        if f['properties']['name'] in names:
            a = shapes[i].intersection(near).area
            if a > area: best, area = i, a
    return best

def build_year(year, cfg, polys, log=print):
    d = original(cfg['base'])
    feats = d['features']; shapes = [fix(shape(f['geometry'])) for f in feats]
    pl = polys[cfg['state']]
    newk = [k for k in (KINGDOM, ROYAL, CROATIA, TRANS, ZONE, UPPER) if k in pl]
    new = unary_union([pl[k] for k in newk])
    so, sp, sh = pl[OTTOMAN], pl.get(POLAND, Polygon()), pl.get(HABSBURG, Polygon())
    hull = new.buffer(0.3)
    io = find(feats, shapes, ('Ottoman Empire',), new.union(so))
    ip = find(feats, shapes, ('Poland-Lithuania', 'Polish–Lithuanian Commonwealth'), hull.union(sp))
    ih = find(feats, shapes, ('Holy Roman Empire',), hull.union(sh))
    assert None not in (io, ip, ih), (io, ip, ih)
    O, Pl, H = shapes[io], shapes[ip], shapes[ih]
    tongue_p = O.intersection(sp); tongue_h = O.intersection(sh)       # базовий набір веде османську межу надто далеко
    back = so.intersection(unary_union([Pl, H]))                        # і навпаки: османські землі, віддані сусідам
    out = []
    for i, f in enumerate(feats):
        g = shapes[i]
        if not g.intersects(hull.union(so).union(sp).union(sh)):
            out.append(f); continue
        g = g.difference(new)
        if i == io: g = unary_union([g.difference(unary_union([tongue_p, tongue_h])), back])
        elif i == ip: g = unary_union([g.difference(back), tongue_p])
        elif i == ih: g = unary_union([g.difference(back), tongue_h])
        # від османського полігона нові полігони можуть відрізати клапоть грубого узбережжя базового набору
        # (у 1530 році — біля Далмації); такий уламок дістав би власний підпис «Османська імперія», тому його прибираємо
        g = tidy(g, 0.5 if i == io else 0.03)
        if g is None: continue
        out.append({'type': 'Feature', 'properties': f['properties'], 'geometry': geometry(g)})
    for k in newk:
        g = tidy(pl[k])
        out.append({'type': 'Feature', 'properties': {**PROPS[k], 'precision': cfg['precision']}, 'geometry': geometry(g)})
    src = dict(d['source'])
    src['note'] = src['note'] + ' У межах давнього Угорського королівства полігони цього набору замінено поділом на Королівську Угорщину, османську частину й Трансільванію — див. поле division.'
    res = {'type': 'FeatureCollection', 'year': year, 'license': d['license'], 'licenseUrl': d['licenseUrl'],
           'attribution': d['attribution'] + '; ' + ATTR.get(cfg['state'], 'PANONIAN') + ' (Wikimedia Commons), CC0',
           'source': src,
           'division': {'note': cfg['note'], 'sources': cfg['sources'], 'method': 'scripts/georef/borders-ottoman/README.md'},
           'features': out}
    return res

def main(work, outdir):
    polys = state_polygons(work)
    for year, cfg in YEARS.items():
        res = build_year(year, cfg, polys)
        s = json.dumps(res, ensure_ascii=False, separators=(',', ':'))
        path = os.path.join(outdir, f'y{year}.geojson')
        open(path, 'w', encoding='utf-8').write(s + '\n')
        n = sum(len(r) for f in res['features'] for poly in ([f['geometry']['coordinates']] if f['geometry']['type'] == 'Polygon' else f['geometry']['coordinates']) for r in poly)
        print(f'y{year}.geojson: {len(res["features"])} об\'єктів, {n} точок, {len(s.encode()) / 1024:.1f} КБ')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'data', 'borders'))
