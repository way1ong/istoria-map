"""Область офлайн-мапи: контур Угорщини (data/borders/modern.geojson) з буфером, плюс околиці місць проєкту за кордоном.
tiles_for(z) -> множина (x, y) тайлів зуму z."""
import glob, json, math
from pathlib import Path
from shapely.geometry import shape, Point, box
from shapely.ops import unary_union
from shapely import prepared

ROOT = Path(__file__).resolve().parents[2]
G = json.load(open(ROOT / 'data/borders/modern.geojson'))
HU = shape(next(f['geometry'] for f in G['features'] if f['properties'].get('id') == 'hungary'))
KM = 1 / 111.32
def buffered(km):
    # буфер у градусах із поправкою на довготу (широта ~47°)
    from shapely import affinity
    k = math.cos(math.radians(47.2))
    g = affinity.scale(HU, xfact=k, yfact=1, origin=(19, 47.2))
    g = g.buffer(km * KM)
    return affinity.scale(g, xfact=1 / k, yfact=1, origin=(19, 47.2))
outside = []
for f in glob.glob(str(ROOT / 'data/places/*.json')):
    p = json.load(open(f)); lon, lat = p['coords']
    if not HU.buffer(0.02).contains(Point(lon, lat)): outside.append((p['id'], lon, lat))
def circles(km):
    k = math.cos(math.radians(47.2))
    from shapely import affinity
    return unary_union([affinity.scale(Point(lon, lat).buffer(km * KM), xfact=1 / k, yfact=1, origin=(lon, lat)) for _, lon, lat in outside])

def tile_bounds(z, x, y):
    n = 2 ** z
    lon0 = x / n * 360 - 180; lon1 = (x + 1) / n * 360 - 180
    lat0 = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    lat1 = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon0, lat0, lon1, lat1

def tiles_for(z, region):
    w, s, e, n_ = region.bounds
    N = 2 ** z
    x0 = int((w + 180) / 360 * N); x1 = int((e + 180) / 360 * N)
    def ty(lat): return int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * N)
    y0 = ty(n_); y1 = ty(s)
    pr = prepared.prep(region); out = set()
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            if pr.intersects(box(*tile_bounds(z, x, y))): out.add((x, y))
    return out

if __name__ == '__main__':
    print('місць за межами Угорщини:', len(outside), [o[0] for o in outside][:30])
    print('bbox HU', HU.bounds)
