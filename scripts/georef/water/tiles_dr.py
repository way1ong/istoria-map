#!/usr/bin/env python3 -I
"""Аркуші Ліпскі плитками 4096 px повної роздільності -> 1024 px (1/4), склеювання в dr4/<i>.jpg."""
import json, os, subprocess, time
from PIL import Image
A = json.load(open('../../../public/georef/lipszky-1806.json'))
T = 4096
for i, it in enumerate(A['items']):
    src = it['target']['source']; sid = src['id']; W, H = src['width'], src['height']
    out = Image.new('RGB', ((W + 3) // 4, (H + 3) // 4), 'white')
    for y0 in range(0, H, T):
        for x0 in range(0, W, T):
            w, h = min(T, W - x0), min(T, H - y0)
            f = f'tiles/{i}_{x0}_{y0}.jpg'
            if not (os.path.exists(f) and os.path.getsize(f) > 2000):
                for att in range(3):
                    r = subprocess.run(['curl', '-sS', '-m', '120', '-o', f, '-w', '%{http_code}', f'{sid}/{x0},{y0},{w},{h}/{max(1, round(w / 4))},/0/default.jpg'], capture_output=True, text=True)
                    if r.stdout == '200': break
                    time.sleep(3)
                time.sleep(0.3)
            try:
                tile = Image.open(f).convert('RGB')
            except Exception as e:
                print('bad tile', f, e); continue
            out.paste(tile, (x0 // 4, y0 // 4))
    out.save(f'dr4/{i}.jpg', quality=92)
    print(i, out.size, flush=True)
