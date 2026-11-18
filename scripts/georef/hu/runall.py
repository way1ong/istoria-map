#!/usr/bin/env python3 -I
"""Запуск detect2 для всіх raw/*.jpg паралельно -> det_all.json"""
import glob, json, os, sys
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import detect2
def one(p):
    k = os.path.basename(p).rsplit('.', 1)[0]
    try:
        return k, detect2.detect(p)
    except Exception as ex:
        return k, {'error': repr(ex)}
if __name__ == '__main__':
    files = sorted(glob.glob('raw/*.jpg'))
    out = json.load(open('det_all.json')) if os.path.exists('det_all.json') else {}
    todo = [f for f in files if os.path.basename(f).rsplit('.', 1)[0] not in out] if '--all' not in sys.argv else files
    with Pool(int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 4) as pool:
        for k, r in pool.imap_unordered(one, todo):
            out[k] = r
            print(k, 'ok' if r.get('corners') else 'FAIL', flush=True)
    json.dump(out, open('det_all.json', 'w'), default=float)
