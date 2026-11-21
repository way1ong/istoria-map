"""Чорні кружки опорних пунктів на рис. 1 Kulcsár 2025: кореляція з шаблоном темного диска (r = 4 px), локальні
максимуми, темний центр, придушення сусідів ближче 8 px. Кандидатів перевірено вручну на контактному аркуші;
4 хибні (знаки підкладки, край скану) відкидає geo1914.py. Пише dots_tm.json."""
import json
import numpy as np, cv2

fig = cv2.imread('../img/kv-005-000.png', cv2.IMREAD_GRAYSCALE)
T = np.full((15, 15), 220, np.uint8)
cv2.circle(T, (7, 7), 4, 30, -1)
cc = cv2.matchTemplate(fig, T, cv2.TM_CCOEFF_NORMED)
mx = cv2.dilate(cc, np.ones((9, 9), np.uint8))
cand = np.argwhere((cc >= mx - 1e-6) & (cc >= 0.55))
pts = []
for y, x in sorted(cand.tolist(), key=lambda p: -cc[p[0], p[1]]):
    cx, cy = x + 7, y + 7
    if fig[cy - 2:cy + 3, cx - 2:cx + 3].mean() > 110:
        continue
    if all((cx - px) ** 2 + (cy - py) ** 2 > 64 for px, py, _ in pts):
        pts.append((int(cx), int(cy), round(float(cc[y, x]), 2)))
json.dump(pts, open('dots_tm.json', 'w'))
print(len(pts), 'кандидатів')
