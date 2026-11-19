"""Локальне уточнення точок рамки: вікно навколо точки на скані NYPL (повна роздільність, ±260 px) і відповідне
вікно на скані IOS (навколо перенесеної точки, з запасом); ознаки SIFT, тест відношення, афінне перетворення
RANSAC за сотнями пар. Точка NYPL переводиться цим локальним перетворенням — воно стійке до періодичного
штрихування рамки, бо спирається на всі структури у вікні (підписи, лінії, рельєф).

Також: частка темного тла сканера вздовж рамки (скан обрізаний по рамці) і чи всі точки всередині скану.
Запуск: nypl2ios_local.py <transfer.json> <out.json> <клітинка>[,...]"""
import json, sys, subprocess, time, os
import numpy as np, cv2

HU = os.environ.get('HU_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')) + '/'
GEO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'public', 'georef', 'spezialkarte-75000.json')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nypl2ios_transfer as TR  # noqa: E402

AN = 260   # півсторона вікна NYPL, px повного скану NYPL
L = 1400   # найбільша сторона вікна IOS, яке просимо в сервера


def fetch(url, path):
    if not (os.path.exists(path) and os.path.getsize(path) > 300):
        for _ in range(3):
            subprocess.run(['curl', '-sS', '--max-time', '120', '-o', path, url], check=False)
            if os.path.exists(path) and os.path.getsize(path) > 300: break
            time.sleep(3)
        time.sleep(0.15)
    return cv2.imread(path, cv2.IMREAD_GRAYSCALE)


def window(service, W, H, cx, cy, a, path, out=None):
    x0, y0 = max(0, int(cx - a)), max(0, int(cy - a)); x1, y1 = min(W, int(cx + a)), min(H, int(cy + a))
    size = 'full' if out is None else f'!{out},{out}'
    img = fetch(f'{service}/{x0},{y0},{x1 - x0},{y1 - y0}/{size}/0/default.jpg', path)
    if img is None: return None, None
    return img, (x0, y0, (x1 - x0) / img.shape[1], (y1 - y0) / img.shape[0])


def prep(g):
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4)).apply(g)


def dark_along_frame(k, gcps, W, H):
    g = cv2.imread(HU + f'raw/{k}.jpg', cv2.IMREAD_GRAYSCALE).astype(np.float32)
    s = W / g.shape[1]
    paper = float(np.percentile(g[g.shape[0] // 4:3 * g.shape[0] // 4, g.shape[1] // 4:3 * g.shape[1] // 4], 80))
    P = np.array([p['px'] for p in gcps]) / s
    c = P.mean(0); fr = []
    for i in range(8):
        a, b = P[i], P[(i + 1) % 8]
        for t in np.linspace(0, 1, 80):
            q = a + (b - a) * t; q = q + (c - q) / np.linalg.norm(c - q) * 4
            x, y = int(round(q[0])), int(round(q[1]))
            if not (0 <= x < g.shape[1] and 0 <= y < g.shape[0]): fr.append(1); continue
            fr.append(1 if g[max(0, y - 1):y + 2, max(0, x - 1):x + 2].mean() < 0.40 * paper else 0)
    return round(float(np.mean(fr)), 3)


def main():
    T = json.load(open(sys.argv[1])); out_path = sys.argv[2]; cells = sys.argv[3].split(',')
    items = json.load(open(GEO))['items']
    try: out = json.load(open(out_path))
    except Exception: out = {}
    os.makedirs('loc', exist_ok=True)
    sift = cv2.SIFT_create(nfeatures=6000, contrastThreshold=0.02)
    for k in cells:
        r = T[k]; z, col = map(int, k.split('-'))
        item = next(it for it in items if it['id'].endswith('#' + r['sid']))
        srcN = item['target']['source']; gN = TR.nypl_gcps(item, z, col)
        tP = {g['name']: np.array(g['px']) for g in r['gcps']}
        nP = {n: np.array(gN[n]) for n in gN}
        s = np.linalg.norm(tP['se'] - tP['nw']) / np.linalg.norm(nP['se'] - nP['nw'])
        res = []
        for g in r['gcps']:
            n = g['name']
            imN, fN = window(srcN['id'], srcN['width'], srcN['height'], *nP[n], AN, f'loc/{k}_{n}_N.jpg')
            aI = AN * s * 1.25
            imI, fI = window(r['service'], r['width'], r['height'], *tP[n], aI, f'loc/{k}_{n}_I.jpg', out=L)
            rec = {**g, 'pred': g['px']}
            if imN is None or imI is None:
                res.append({**rec, 'inl': 0, 'note': 'немає вікна'}); continue
            ka, da = sift.detectAndCompute(prep(imN), None); kb, db = sift.detectAndCompute(prep(imI), None)
            if da is None or db is None or len(ka) < 10 or len(kb) < 10:
                res.append({**rec, 'inl': 0, 'note': 'мало ознак'}); continue
            mm = cv2.BFMatcher(cv2.NORM_L2).knnMatch(da, db, k=2)
            good = [x[0] for x in mm if len(x) == 2 and x[0].distance < 0.75 * x[1].distance]
            if len(good) < 12:
                res.append({**rec, 'inl': len(good), 'note': 'мало пар'}); continue
            pa = np.float32([ka[x.queryIdx].pt for x in good]); pb = np.float32([kb[x.trainIdx].pt for x in good])
            Maff, inl = cv2.estimateAffine2D(pa, pb, method=cv2.RANSAC, ransacReprojThreshold=2.0, maxIters=5000, confidence=0.999)
            if Maff is None:
                res.append({**rec, 'inl': 0, 'note': 'афінне не знайдено'}); continue
            inl = inl.ravel().astype(bool)
            resid = np.hypot(*((pa[inl] @ Maff[:, :2].T + Maff[:, 2]) - pb[inl]).T)
            # точка NYPL у координатах вікна NYPL -> вікно IOS -> повний IOS
            pnw = np.array([(nP[n][0] - fN[0]) / fN[2], (nP[n][1] - fN[1]) / fN[3]])
            piw = Maff[:, :2] @ pnw + Maff[:, 2]
            full = np.array([fI[0] + piw[0] * fI[2], fI[1] + piw[1] * fI[3]])
            res.append({**rec, 'px': [round(float(full[0]), 1), round(float(full[1]), 1)], 'inl': int(inl.sum()),
                        'resid_full_px': round(float(np.median(resid) * fI[2]), 2),
                        'shift': [round(float(full[0] - tP[n][0]), 1), round(float(full[1] - tP[n][1]), 1)]})
        dark = dark_along_frame(k, res, r['width'], r['height'])
        inside = all(0 <= p['px'][0] <= r['width'] - 1 and 0 <= p['px'][1] <= r['height'] - 1 for p in res)
        out[k] = {**{x: r[x] for x in ('cell', 'sid', 'service', 'width', 'height', 'nypl')}, 'gcps': res, 'dark': dark, 'inside': inside}
        print(k, 'dark', dark, 'inside', inside, 'inl', [p.get('inl') for p in res], 'shift', [p.get('shift') for p in res],
              'resid', [p.get('resid_full_px') for p in res], flush=True)
        json.dump(out, open(out_path, 'w'), indent=1)


if __name__ == '__main__':
    main()
