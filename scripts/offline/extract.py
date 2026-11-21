"""Запуск: BUILD=20261120 python3 scripts/offline/extract.py 14 hungary-z14.pmtiles [попередня-вирізка.pmtiles]
Вирізка Угорщини з планетарної збірки Protomaps (build.protomaps.com) у PMTiles z0–MAXZ:
z0–7 — широкий прямокутник (уся Центральна Європа: щоб на огляді країни не було порожніх смуг),
z8–10 — прямокутник з околицями, z11+ — контур Угорщини з буфером 4 км і околиці місць проєкту за кордоном (5 км).
Тайли качаються злитими Range-запитами (сусідні в кривій Гільберта лежать поруч у файлі); якщо вказано попередню
вирізку з тієї самої збірки, тайли, що в ній є, беруться звідти. Каталоги збірки кешуються в ./dircache."""
import gzip, json, sys, time
from shapely.ops import unary_union
from shapely.geometry import box
from pmtiles.tile import zxy_to_tileid, Compression, TileType
from pmtiles.writer import Writer
import area
from pmremote import Remote, get, URL

MAXZ = int(sys.argv[1]) if len(sys.argv) > 1 else 14
OUT = sys.argv[2] if len(sys.argv) > 2 else f'hungary-z{MAXZ}.pmtiles'
REUSE = sys.argv[3] if len(sys.argv) > 3 else None
r = Remote(); h = r.h
meta = json.loads(gzip.decompress(get(h['metadata_offset'], h['metadata_length'])))
WIDE = (10.0, 41.0, 29.0, 53.0)
region_wide = box(*WIDE)
region_low = box(15.6, 45.4, 23.4, 49.0)
region_high = unary_union([area.buffered(4), area.circles(5)])
need = []                                     # (tileid, entry)
for z in range(0, MAXZ + 1):
    for x, y in area.tiles_for(z, region_wide if z <= 7 else region_low if z <= 10 else region_high):
        tid = zxy_to_tileid(z, x, y); e = r.entry(tid)
        if e is not None: need.append((tid, e))
need.sort(key=lambda t: t[0])
data = {}
if REUSE:
    from pmtiles.reader import Reader, MmapSource
    from pmtiles.tile import tileid_to_zxy
    with open(REUSE, 'rb') as rf:
        rd = Reader(MmapSource(rf))
        for tid, e in need:
            t = rd.get(*tileid_to_zxy(tid))
            if t is not None: data[e.offset] = t
    print('з попередньої вирізки', len(data), 'тайлів', flush=True)
offs = sorted({e.offset: e.length for _, e in need if e.offset not in data}.items())
print('тайлів', len(need), 'унікальних', len(offs), 'байт', sum(l for _, l in offs), flush=True)
# злиття діапазонів
ranges = []; cur = None
for o, l in offs:
    if cur and o - (cur[0] + cur[1]) <= 32768 and (o + l - cur[0]) <= 16 * 2 ** 20: cur[1] = o + l - cur[0]; cur[2].append((o, l))
    else:
        cur = [o, l, [(o, l)]]; ranges.append(cur)
print('запитів', len(ranges), flush=True)
t0 = time.time(); got = 0
for i, (o, l, parts) in enumerate(ranges):
    b = get(h['tile_data_offset'] + o, l, cache=False)
    for po, pl in parts: data[po] = b[po - o: po - o + pl]
    got += l
    if i % 20 == 0: print(f'  {i}/{len(ranges)} {got/1e6:.0f} МБ {time.time()-t0:.0f} с', flush=True)
with open(OUT, 'wb') as f:
    w = Writer(f)
    for tid, e in need: w.write_tile(tid, data[e.offset])
    hd = {'tile_type': TileType.MVT, 'tile_compression': Compression.GZIP,
          # межі — широкий прямокутник: поза ним MapLibre тайлів не запитує; ближче поза вирізкою тайли просто порожні
          'min_lon_e7': int(WIDE[0] * 1e7), 'min_lat_e7': int(WIDE[1] * 1e7), 'max_lon_e7': int(WIDE[2] * 1e7), 'max_lat_e7': int(WIDE[3] * 1e7),
          'center_zoom': 7, 'center_lon_e7': int(19.4e7), 'center_lat_e7': int(47.15e7)}
    meta2 = dict(meta); meta2['name'] = 'Protomaps basemap — Угорщина (istoria-map)'; meta2['description'] = f'Вирізка зі збірки {URL.rsplit("/",1)[1]}, z0–{MAXZ}'
    w.finalize(hd, meta2)
import os
print('готово', OUT, os.path.getsize(OUT), 'байт')
