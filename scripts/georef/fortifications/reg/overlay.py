import json, sys, numpy as np
from PIL import Image, ImageDraw
fig, aff, osm, out = sys.argv[1:5]
x1 = int(sys.argv[5]) if len(sys.argv) > 5 else None
im = Image.open(fig).convert('RGB')
if x1: im = im.crop((0, 0, x1, im.size[1]))
A = json.load(open(aff)); cx, cy = np.array(A['cx']), np.array(A['cy'])
M = np.array([[cx[0], cx[1]], [cy[0], cy[1]]]); t = np.array([cx[2], cy[2]]); Mi = np.linalg.inv(M)
O = json.load(open(osm))
S = 2
big = im.resize((im.size[0] * S, im.size[1] * S), Image.LANCZOS); d = ImageDraw.Draw(big)
col = {'water': (0, 90, 255), 'rail': (255, 0, 0), 'road': (255, 0, 255)}
for k in ('road', 'water', 'rail'):
    P = (np.array(O[k]) - t) @ Mi.T
    for x, y in P[::2]:
        if 0 <= x < im.size[0] and 0 <= y < im.size[1]: d.point((x * S, y * S), fill=col[k])
big.save(out)
