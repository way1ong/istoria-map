#!/usr/bin/env python3 -I
import json, os, re
S = os.environ.get('HU_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')) + '/'
cells = json.load(open(S + 'cells.json'))
existing = json.load(open(S + 'spez/ids.json'))  # '13-20' -> map id
ios = {}
for l in open(S + 'all.tsv'):
    mid, flag, w, e, s, n, title = l.rstrip('\n').split('\t')
    w, e, s, n = map(float, (w, e, s, n))
    z = round((48.75 - n) / 0.25) + 11
    col = round((w - 18.3333) / 0.5) + 19
    ios[f'{z}-{col}'] = (mid, title, w, e, s, n)
nypl = {}
for l in open(S + 'gk/nypl_all.txt'):
    m = re.match(r'(.*)\. NYPL(\d+)\.tiff', l.strip())
    if m: nypl[int(m.group(2))] = m.group(1)
plan = {}
need_nypl = []
for k, v in sorted(cells.items(), key=lambda kv: tuple(map(int, kv[0].split('-')))):
    if k in existing: plan[k] = {'src': 'existing', 'id': existing[k]}
    elif k in ios: plan[k] = {'src': 'ios', 'id': ios[k][0], 'title': ios[k][1], 'bounds': ios[k][2:]}
    else:
        need_nypl.append(k); plan[k] = {'src': 'nypl?'}
    plan[k].update(v)
json.dump(plan, open(S + 'plan.json', 'w'), indent=1, ensure_ascii=False)
print('existing', sum(1 for p in plan.values() if p['src'] == 'existing'), 'ios', sum(1 for p in plan.values() if p['src'] == 'ios'), 'nypl?', len(need_nypl))
for k in need_nypl: print(k, cells[k])
# IOS bounds check vs nominal grid
bad = []
for k, (mid, t, w, e, s, n) in ios.items():
    z, col = map(int, k.split('-'))
    nn = 48.75 - (z - 11) * 0.25; ww = 18.333333 + (col - 19) * 0.5
    if abs(n - nn) > 0.01 or abs(w - ww) > 0.01: bad.append((k, mid, w, n))
print('ios off-grid', bad)
