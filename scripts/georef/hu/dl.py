#!/usr/bin/env python3 -I
"""info.json і зменшена копія (!3300,3300) для кожної клітинки -> hu/info/<key>.json, hu/raw/<key>.jpg"""
import json, os, os, subprocess, sys, time
S = os.environ.get('HU_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')) + '/'
src = json.load(open(S + 'sources.json'))
os.makedirs(S + 'info', exist_ok=True); os.makedirs(S + 'raw', exist_ok=True)
keys = sys.argv[1:] or sorted(src, key=lambda k: tuple(map(int, k.split('-'))))
for k in keys:
    s = src[k]['service']
    fi, fr = S + f'info/{k}.json', S + f'raw/{k}.jpg'
    for url, f in ((s + '/info.json', fi), (s + '/full/!3300,3300/0/default.jpg', fr)):
        if os.path.exists(f) and os.path.getsize(f) > 1000:
            continue
        for attempt in range(3):
            r = subprocess.run(['curl', '-sS', '-m', '180', '-o', f, '-w', '%{http_code} %{size_download}', url], capture_output=True, text=True)
            code = r.stdout.split()[0] if r.stdout else '000'
            if code == '200':
                break
            time.sleep(5 * (attempt + 1))
        print(k, url.rsplit('/', 4)[-4] if 'full' in url else 'info', r.stdout.strip(), r.stderr.strip()[:120], flush=True)
        time.sleep(0.5)
print('done', flush=True)
