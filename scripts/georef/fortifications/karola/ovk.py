"""Контроль прив'язки рисунків Ádám 2022 на око: дороги, залізниці, вода й межі з OpenStreetMap поверх знімка з рисунка.
python3 ovk.py <рис> <aff.json> <префікс>; karola_osm.json — python3 ../reg/osmtiles.py 19.42,47.57,19.99,47.84 karola_osm.json"""
import json, sys, numpy as np, cv2
import figs
def overlay(fig, aff, scale=2):
    img = cv2.imread(figs.path(fig)); H, W = img.shape[:2]
    big = cv2.resize(img, (W * scale, H * scale), interpolation=cv2.INTER_CUBIC)
    A = json.load(open(aff)); cx, cy = np.array(A['cx']), np.array(A['cy'])
    M = np.array([[cx[0], cx[1]], [cy[0], cy[1]]]); t = np.array([cx[2], cy[2]]); Mi = np.linalg.inv(M)
    O = json.load(open('karola_osm.json'))
    col = {'road': (0, 255, 255), 'rail': (255, 255, 255), 'water': (255, 200, 0)}
    for k in ('road', 'rail', 'water'):
        for x, y in (np.array(O[k]) - t) @ Mi.T:
            if 0 <= x < W and 0 <= y < H: big[int(y * scale), int(x * scale)] = col[k]
    for f in ('cty_heves.json', 'cty_nograd.json', 'jar_hatvani.json', 'jar_gyongyosi.json'):
        g = json.load(open(f))[0]['geojson']
        for r in (g['coordinates'] if g['type'] == 'Polygon' else [r for p in g['coordinates'] for r in p]):
            cv2.polylines(big, [((np.array(r) - t) @ Mi.T * scale).astype(np.int32).reshape(-1, 1, 2)], False, (0, 0, 255), 1, cv2.LINE_AA)
    return big
if __name__ == '__main__':
    fig, aff, pref = sys.argv[1:4]
    big = overlay(fig, aff); H, W = big.shape[:2]
    for i in range(2):
        for j in range(2):
            cv2.imwrite(f'{pref}_{i}{j}.jpg', big[j * H // 2:(j + 1) * H // 2, i * W // 2:(i + 1) * W // 2], [cv2.IMWRITE_JPEG_QUALITY, 92])
