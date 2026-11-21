"""Збирає об'єкти лінії «Аттіла» з рис. 8 (Juhász–Balogh 2025) у GeoJSON: траси (traced.json) і жовті плями
(позиції піхоти) як полігони; дорожні жовті лінії (автомагістралі підкладки) і плями в руслі Дунаю відкинуто."""
import json, numpy as np, cv2
import trace as TR

EXCLUDE = {23, 27, 37, 39, 40, 43}
lab = np.load('yel_lab.npy'); comps = json.load(open('yel_comp.json'))
feats = []
# повторне трасування з сильнішим згладжуванням для пунктирних (передбачуваних) трас
lines = json.load(open('waypoints.json'))
for name, rec in lines.items():
    full = [tuple(rec['wps'][0])]
    for a, b in zip(rec['wps'], rec['wps'][1:]): full += TR.path(tuple(a), tuple(b))[1:]
    arr = np.array(full, float)
    k = 2 if rec['kind'] == 'ditch' else 5
    sm = arr.copy()
    for i in range(k, len(arr) - k): sm[i] = arr[i - k:i + k + 1].mean(0)
    simp = TR.dp([tuple(p) for p in sm], 0.7 if rec['kind'] == 'ditch' else 1.0)
    feats.append({'type': 'Feature', 'properties': {'id': name, 'kind': rec['kind']},
                  'geometry': {'type': 'LineString', 'coordinates': [TR.ll(p) for p in simp]}})
for (i, area, cx, cy, el, L) in comps:
    if i in EXCLUDE: continue
    m = (lab == i).astype(np.uint8)
    big = cv2.resize(m, (m.shape[1] * 4, m.shape[0] * 4), interpolation=cv2.INTER_NEAREST)
    big = cv2.GaussianBlur(big * 255, (5, 5), 0)
    cs, _ = cv2.findContours((big > 127).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)
    c = cv2.approxPolyDP(c, 1.6, True)[:, 0, :].astype(float) / 4.0 + 0.125
    ring = [TR.ll((x, y)) for x, y in c]
    ring.append(ring[0])
    feats.append({'type': 'Feature', 'properties': {'id': f'attila-infantry-{i}', 'kind': 'infantry'},
                  'geometry': {'type': 'Polygon', 'coordinates': [ring]}})
json.dump({'type': 'FeatureCollection', 'features': feats}, open('attila.geojson', 'w'), ensure_ascii=False)
print(len(feats), 'об\'єктів;', sum(1 for f in feats if f['geometry']['type'] == 'Polygon'), 'плям піхоти')
