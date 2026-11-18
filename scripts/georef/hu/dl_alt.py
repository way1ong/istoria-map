#!/usr/bin/env python3 -I
"""Запасні скани NYPL для клітинок, де IOS не вдалося прив'язати -> raw_n/<key>.jpg, info_n/<key>.json"""
import json, os, os, subprocess, sys, time
S = os.environ.get('HU_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')) + '/'
alt = json.load(open(S + 'alt.json'))
os.makedirs(S + 'raw_n', exist_ok=True); os.makedirs(S + 'info_n', exist_ok=True)
for k, i in alt.items():
    s = f'https://iiif.nypl.org/iiif/2/{i}'
    for url, f in ((s + '/info.json', S + f'info_n/{k}.json'), (s + '/full/!3300,3300/0/default.jpg', S + f'raw_n/{k}.jpg')):
        if os.path.exists(f) and os.path.getsize(f) > 1000: continue
        r = subprocess.run(['curl', '-sS', '-m', '180', '-o', f, '-w', '%{http_code} %{size_download}', url], capture_output=True, text=True)
        print(k, i, 'info' if url.endswith('json') else 'img', r.stdout.strip(), r.stderr.strip()[:100], flush=True)
        if not r.stdout.startswith('200'):
            try: os.remove(f)
            except OSError: pass
            break
        time.sleep(0.4)
