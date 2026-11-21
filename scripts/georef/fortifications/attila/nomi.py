"""Координати населених пунктів з Nominatim (вузли place=*), з паузою; кеш у places_osm.json."""
import json, subprocess, sys, time, urllib.parse, os
names = sys.argv[1].split('|')
cache = json.load(open('places_osm.json')) if os.path.exists('places_osm.json') else {}
for q in names:
    if q in cache: continue
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': q, 'format': 'jsonv2', 'limit': 5, 'countrycodes': 'hu'})
    for attempt in range(3):
        r = subprocess.run(['curl', '-sS', '--max-time', '30', '-A', 'istoria-map-qa/1.0', url], capture_output=True, text=True)
        try:
            d = json.loads(r.stdout); break
        except Exception:
            d = None; time.sleep(20)
    if d is None: print('FAIL', q); continue
    cand = [x for x in d if x.get('category') in ('place', 'boundary')]
    best = cand[0] if cand else (d[0] if d else None)
    if best:
        cache[q] = {'lat': float(best['lat']), 'lon': float(best['lon']), 'type': best.get('type'), 'cat': best.get('category'), 'name': best.get('display_name', '')[:90]}
        print(q, cache[q])
    else:
        print('NONE', q)
    json.dump(cache, open('places_osm.json', 'w'), ensure_ascii=False, indent=1)
    time.sleep(2.2)
