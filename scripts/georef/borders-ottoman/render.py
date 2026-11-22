# Контрольне зображення файлу кордонів: полігони з назвами + міста (рівнокутна сітка, без застосунку).
# Кольори рахуються так само, як у застосунку (src/borders.ts: colorFor(subjecto || name) → hsl), заливка густіша,
# ніж на сайті, щоб межі було видно без підкладки.
# Запуск: python3 render.py <файл.geojson> <вихід.png> [cities.json]
import colorsys, json, math, sys
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import shape

BOX = (12.5, 43.6, 27.2, 50.2)   # захід, південь, схід, північ
PPD = 110                         # пікселів на градус довготи
KY = 1 / math.cos(math.radians(47))
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
CONTROL = ['Buda', 'Vác', 'Göd', 'Pécs', 'Szeged', 'Temesvár', 'Pozsony', 'Győr', 'Kassa', 'Kolozsvár', 'Gyulafehérvár', 'Eger', 'Nagyvárad',
           'Bécs', 'Zágráb', 'Belgrád', 'Debrecen', 'Esztergom', 'Nagykanizsa', 'Érsekújvár', 'Fülek', 'Szatmárnémeti', 'Munkács', 'Brassó',
           'Nagyszeben', 'Székesfehérvár', 'Szolnok', 'Gyula', 'Eszék', 'Varasd', 'Sopron', 'Huszt', 'Nógrád', 'Komárom', 'Veszprém', 'Szigetvár']

def xy(lon, lat):
    return ((lon - BOX[0]) * PPD, (BOX[3] - lat) * PPD * KY)

def color(name):
    """Той самий відтінок, що в застосунку: hsl(h 55% 55%)."""
    h = 0
    for ch in name: h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360, 0.55, 0.55)
    return (int(r * 255), int(g * 255), int(b * 255))

def render(path, out, cities_path=None):
    d = json.load(open(path))
    W, H = int((BOX[2] - BOX[0]) * PPD), int((BOX[3] - BOX[1]) * PPD * KY)
    im = Image.new('RGB', (W, H), (248, 248, 244))
    dr = ImageDraw.Draw(im, 'RGBA')
    f1 = ImageFont.truetype(BOLD, 13); f2 = ImageFont.truetype(FONT, 11)
    labels = []
    for ft in d['features']:
        g = ft['geometry']; pr = ft['properties']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        col = color(pr.get('subjecto') or pr.get('name') or '?')
        solid = pr.get('precision') == 3
        for poly in polys:
            ring = [xy(*p[:2]) for p in poly[0]]
            if len(ring) < 3: continue
            dr.polygon(ring, fill=col + (70,))
            for hole in poly[1:]:
                hr = [xy(*p[:2]) for p in hole]
                if len(hr) >= 3: dr.polygon(hr, fill=(248, 248, 244, 255))
            for r in [ring] + [[xy(*p[:2]) for p in h] for h in poly[1:]]:
                dr.line(r + [r[0]], fill=col + (255,), width=2 if solid else 1)
            sh = shape({'type': 'Polygon', 'coordinates': poly}).buffer(0)
            sh = sh.intersection(shape({'type': 'Polygon', 'coordinates': [[[BOX[0], BOX[1]], [BOX[2], BOX[1]], [BOX[2], BOX[3]], [BOX[0], BOX[3]], [BOX[0], BOX[1]]]]}))
            if sh.is_empty or sh.area < 0.35: continue
            q = sh.representative_point()
            labels.append((xy(q.x, q.y), f"{pr.get('name_uk') or pr.get('name') or '(без назви)'} [{pr.get('precision')}]", col))
    for (x, y), t, col in labels:
        dark = tuple(int(c * 0.55) for c in col)
        dr.text((x - 3.6 * len(t), y - 7), t, fill=dark + (255,), font=f1, stroke_width=2, stroke_fill=(255, 255, 255, 255))
    if cities_path:
        c = json.load(open(cities_path))
        for n in CONTROL:
            if n not in c: continue
            x, y = xy(c[n]['lon'], c[n]['lat'])
            dr.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(200, 0, 0, 255), outline=(255, 255, 255, 255))
            dr.text((x + 5, y - 6), n, fill=(120, 0, 0, 255), font=f2, stroke_width=2, stroke_fill=(255, 255, 255, 255))
    im.save(out)
    print(out, im.size, 'рік', d.get('year'), 'об\'єктів', len(d['features']))

if __name__ == '__main__':
    render(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
