"""Читання віддаленого PMTiles v3 (build.protomaps.com) Range-запитами: заголовок, кореневий і листові каталоги
(з кешем на диску), пошук записів для потрібних tile id."""
import gzip, json, os, subprocess, time, hashlib
from pmtiles.tile import deserialize_header, deserialize_directory, zxy_to_tileid, find_tile, Compression

# збірка задається змінною середовища BUILD (YYYYMMDD); старі збірки сервер з часом видаляє
URL = f"https://build.protomaps.com/{os.environ.get('BUILD', '20261120')}.pmtiles"
CACHE = 'dircache'
os.makedirs(CACHE, exist_ok=True)

def get(off, length, cache=True):
    key = os.path.join(CACHE, hashlib.md5(f'{URL}{off}-{length}'.encode()).hexdigest())
    if cache and os.path.exists(key): return open(key, 'rb').read()
    for attempt in range(5):
        r = subprocess.run(['curl', '-sS', '-m', '300', '-r', f'{off}-{off + length - 1}', URL], capture_output=True)
        if r.returncode == 0 and len(r.stdout) == length: break
        time.sleep(3 * (attempt + 1))
    else:
        raise RuntimeError(f'range {off}+{length} failed: {r.stderr[:200]}')
    if cache: open(key, 'wb').write(r.stdout)
    return r.stdout

def decomp(b, c):
    return gzip.decompress(b) if c == Compression.GZIP else b

class Remote:
    def __init__(self):
        self.h = deserialize_header(get(0, 127))
        self.root = deserialize_directory(get(self.h['root_offset'], self.h['root_length']))
        self.leaves = {}
    def leaf(self, off, length):
        k = (off, length)
        if k not in self.leaves:
            self.leaves[k] = deserialize_directory(get(self.h['leaf_directory_offset'] + off, length))
        return self.leaves[k]
    def entry(self, tid):
        d = self.root
        for _ in range(4):
            e = find_tile(d, tid)
            if e is None: return None
            if e.run_length > 0: return e
            d = self.leaf(e.offset, e.length)
        return None
