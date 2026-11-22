# Перевірка готових файлів кордонів: коректність полігонів, накладання й щілини між сусідами, кількість частин,
# і до якої держави потрапляють контрольні міста.
#   python3 check.py <тека з y*.geojson> <рік> [<рік> …]
import json, os, sys
import shapely
from shapely.geometry import shape, Point, box
from shapely.ops import unary_union
HERE = os.path.dirname(os.path.abspath(__file__))
TOWNS = ['Buda', 'Vác', 'Göd', 'Pécs', 'Szeged', 'Temesvár', 'Pozsony', 'Győr', 'Kassa', 'Kolozsvár', 'Gyulafehérvár', 'Eger', 'Nagyvárad',
         'Esztergom', 'Komárom', 'Székesfehérvár', 'Veszprém', 'Kanizsa', 'Érsekújvár', 'Fülek', 'Debrecen', 'Szatmár', 'Munkács', 'Huszt',
         'Brassó', 'Nagyszeben', 'Zágráb', 'Varasd', 'Sopron', 'Trencsén', 'Bécs', 'Belgrád', 'Lugos', 'Gyula', 'Szolnok', 'Szigetvár']
WINDOW = box(13.0, 43.8, 27.0, 50.0)

def check(path, cities):
    d = json.load(open(path, encoding='utf-8'))
    feats = d['features']; shapes = [shape(f['geometry']) for f in feats]
    name = lambda f: f['properties'].get('name_uk') or f['properties'].get('name') or '(без назви)'
    bad = [name(f) for f, g in zip(feats, shapes) if not g.is_valid]
    shapes = [g if g.is_valid else shapely.make_valid(g) for g in shapes]     # у базовому наборі трапляються самоперетини далеко від Угорщини
    parts = {name(f): len(g.geoms) for f, g in zip(feats, shapes) if g.geom_type == 'MultiPolygon'}
    over = 0.0; worst = None
    tree = shapely.STRtree(shapes)
    for i, g in enumerate(shapes):
        for j in tree.query(g):
            if j <= i: continue
            a = g.intersection(shapes[j]).area
            if a > over: over, worst = a, (name(feats[i]), name(feats[j]))
    cover = unary_union([g.intersection(WINDOW) for g in shapes if g.intersects(WINDOW)])
    holes = [h for p in (cover.geoms if cover.geom_type == 'MultiPolygon' else [cover]) for h in p.interiors]
    hole_area = sum(shapely.Polygon(h).area for h in holes)
    print(f"{os.path.basename(path)}: рік {d['year']}, об'єктів {len(feats)}, некоректних {len(bad)} {bad}, найбільше накладання {over:.6f} кв. град. {worst or ''}, "
          f"щілин усередині вікна {len(holes)} (разом {hole_area:.5f} кв. град.)")
    if parts: print('   з кількох частин:', parts)
    res = {}
    for n in TOWNS:
        p = Point(cities[n]['lon'], cities[n]['lat'])
        hit = [name(f) for f, g in zip(feats, shapes) if g.contains(p)]
        res[n] = ' + '.join(hit) if hit else '—'
    return res

if __name__ == '__main__':
    cities = json.load(open(os.path.join(HERE, 'cities.json'), encoding='utf-8'))
    folder, years = sys.argv[1], sys.argv[2:]
    table = {y: check(os.path.join(folder, f'y{y}.geojson'), cities) for y in years}
    short = {'Королівська Угорщина': 'КОРОЛ.', 'Османська імперія': 'осман.', 'Трансільванське князівство': 'ТРАНС.', 'Хорватія': 'Хорв.',
             'Священна Римська імперія': 'СРІ', 'Османські завоювання 1547–1568': 'зона 1547–68', 'Верхньоугорське князівство (1682–1685)': 'Текелі',
             'Польща-Литва': 'Польща', 'Угорське королівство (два королі)': 'КОРОЛІВСТВО', 'Річ Посполита': 'Польща', 'Австрійська (Габсбурзька) монархія': 'Австрія'}
    print('\n%-16s' % 'місто' + ''.join('%-14s' % y for y in years))
    for n in TOWNS:
        print('%-16s' % n + ''.join('%-14s' % short.get(table[y][n], table[y][n][:13]) for y in years))
