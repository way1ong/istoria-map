"""Жовті плями (позиції піхоти) на рис. 8: компоненти кольору, площа й видовженість (видовжені смуги — автомагістралі
підкладки, їх відкидає build_attila.py). Пише yel_lab.npy і yel_comp.json."""
import json
import numpy as np, cv2
from PIL import Image

a = np.asarray(Image.open('left.png').convert('RGB')).astype(int)
R, G, B = a[..., 0], a[..., 1], a[..., 2]
yel = ((R > 190) & (G > 180) & (B < 150) & (R - B > 70)).astype(np.uint8)
yel[:, 478:] = 0
yel[:150, :130] = 0   # легенда
n, lab, stats, cent = cv2.connectedComponentsWithStats(yel, connectivity=8)
keep = []
for i in range(1, n):
    ys, xs = np.nonzero(lab == i)
    area = len(xs)
    if area < 5:
        continue
    P = np.c_[xs, ys].astype(float)
    P -= P.mean(0)
    ev = np.sort(np.linalg.eigvalsh(np.cov(P.T)))
    elong = float(np.sqrt(ev[1] / max(ev[0], 0.05)))
    keep.append((i, area, round(float(cent[i][0]), 1), round(float(cent[i][1]), 1), round(elong, 1), round(float(np.sqrt(ev[1]) * 4), 1)))
np.save('yel_lab.npy', lab)
json.dump(keep, open('yel_comp.json', 'w'))
print(len(keep), 'плям')
