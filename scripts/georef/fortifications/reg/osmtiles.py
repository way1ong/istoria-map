"""Зразки ліній OSM (вода, залізниці, головні дороги) з векторних тайлів OpenFreeMap для bbox: точки кожні ~step м."""
import json, math, os, subprocess, sys, time
import mapbox_vector_tile as mvt
URL = 'https://tiles.openfreemap.org/planet/20261115_080022_pt/{z}/{x}/{y}.pbf'
def tile_xy(lon, lat, z):
    n = 2 ** z; x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y
def tile2ll(z, x, y, ext, px, py):
    n = 2 ** z; lon = (x + px / ext) / n * 360 - 180
    yy = y + (1 - py / ext)  # mvt: y вгору в decode з y_coord_down=False
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yy / n))))
    return lon, lat
def fetch(z, x, y):
    fn = f'tiles/{z}_{x}_{y}.pbf'
    os.makedirs('tiles', exist_ok=True)
    if not os.path.exists(fn):
        subprocess.run(['curl', '-sS', '--max-time', '60', '-o', fn, URL.format(z=z, x=x, y=y)], check=False); time.sleep(0.2)
    return mvt.decode(open(fn, 'rb').read())
def densify(coords, step_deg):
    out = []
    for a, b in zip(coords, coords[1:]):
        d = math.hypot((b[0] - a[0]) * math.cos(math.radians(a[1])), b[1] - a[1]); k = max(1, int(d / step_deg))
        for i in range(k): out.append((a[0] + (b[0] - a[0]) * i / k, a[1] + (b[1] - a[1]) * i / k))
    out.append(coords[-1]); return out
def lines_of(geom):
    t, c = geom['type'], geom['coordinates']
    if t == 'LineString': return [c]
    if t == 'MultiLineString': return c
    if t == 'Polygon': return c
    if t == 'MultiPolygon': return [r for p in c for r in p]
    return []
def collect(bbox, z=12, step_m=40, road_classes=('motorway', 'trunk', 'primary', 'secondary', 'tertiary')):
    w, s, e, n = bbox
    x0, y1 = tile_xy(w, s, z); x1, y0 = tile_xy(e, n, z)
    out = {'water': [], 'rail': [], 'road': []}
    step = step_m / 111320
    for x in range(int(x0), int(x1) + 1):
        for y in range(int(y0), int(y1) + 1):
            T = fetch(z, x, y)
            for lname, L in T.items():
                ext = L.get('extent', 4096)
                for f in L['features']:
                    p = f['properties']; kind = None
                    if lname in ('water', 'waterway'): kind = 'water'
                    elif lname == 'transportation':
                        if p.get('class') == 'rail' and p.get('subclass', 'rail') in ('rail', None) and not p.get('service'): kind = 'rail'
                        elif p.get('class') in road_classes: kind = 'road'
                    if not kind: continue
                    for ln in lines_of(f['geometry']):
                        ll = [tile2ll(z, x, y, ext, px, py) for px, py in ln]
                        ll = [q for q in ll if w - 0.02 <= q[0] <= e + 0.02 and s - 0.02 <= q[1] <= n + 0.02]
                        if len(ll) >= 2: out[kind] += densify(ll, step)
    return out
if __name__ == '__main__':
    bbox = list(map(float, sys.argv[1].split(','))); name = sys.argv[2]
    o = collect(bbox)
    print({k: len(v) for k, v in o.items()})
    json.dump(o, open(name, 'w'))
