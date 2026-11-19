#!/usr/bin/env python3 -I
"""Аркуші Generalkarte з Commons (мініатюра 3840 px ≈ оригінал 3400–3500 px) -> orig/<lon-lat>.jpg"""
import hashlib, json, os, subprocess, time, urllib.parse
B = os.environ.get('GK_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')) + '/'
need = json.load(open(B + 'need.json'))
for k, v in sorted(need.items()):
    f = B + f'orig/{k}.jpg'
    if os.path.exists(f) and os.path.getsize(f) > 1_000_000: continue
    n = v['name'].replace(' ', '_'); h = hashlib.md5(n.encode()).hexdigest(); q = urllib.parse.quote(n)
    url = f'https://thumb.wikimedia.org/wikipedia/commons/thumb/{h[0]}/{h[:2]}/{q}/3840px-{q}'
    for att in range(4):
        r = subprocess.run(['curl', '-sS', '-m', '240', '-o', f, '-w', '%{http_code} %{size_download}', url], capture_output=True, text=True)
        print(k, r.stdout.strip(), r.stderr.strip()[:80], flush=True)
        if r.stdout.startswith('200'): break
        time.sleep(20 * (att + 1))
    time.sleep(2.5)
print('done', flush=True)
