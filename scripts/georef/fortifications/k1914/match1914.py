"""Рис. 1 Kulcsár 2025 (опорні пункти 1914 року на Spezialkarte) ↔ аркуші 15:XX і 16:XX з IIIF (s15.jpg, s16.jpg,
!1500,1500): ознаки SIFT, тест відношення, гомографія RANSAC; пари-внутрішні точки зберігаються в match.json
для квадратичного полінома в geo1914.py.
Копії аркушів:
  curl -o s15.jpg 'https://iiif.ios-regensburg.de/iiif/2/BV035904981.tif/full/!1500,1500/0/default.jpg'
  curl -o s16.jpg 'https://iiif.nypl.org/iiif/2/1226633/full/!1500,1500/0/default.jpg'"""
import json
import numpy as np, cv2

fig = cv2.imread('../img/kv-005-000.png', cv2.IMREAD_GRAYSCALE)
clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
sift = cv2.SIFT_create(nfeatures=20000, contrastThreshold=0.01)
kf, df = sift.detectAndCompute(clahe.apply(fig), None)
res = {}
for s in ['s15', 's16']:
    im = clahe.apply(cv2.imread(s + '.jpg', cv2.IMREAD_GRAYSCALE))
    ks, ds = sift.detectAndCompute(im, None)
    mm = cv2.BFMatcher(cv2.NORM_L2).knnMatch(df, ds, k=2)
    good = [m[0] for m in mm if len(m) == 2 and m[0].distance < 0.8 * m[1].distance]
    pa = np.float32([kf[m.queryIdx].pt for m in good]); pb = np.float32([ks[m.trainIdx].pt for m in good])
    H, inl = cv2.findHomography(pa, pb, cv2.RANSAC, 4.0)
    ip = inl.ravel().astype(bool)
    print(s, 'пар', len(good), 'внутрішніх', int(ip.sum()))
    res[s] = {'H': H.tolist(), 'n': int(ip.sum()), 'pa': pa[ip].tolist(), 'pb': pb[ip].tolist()}
json.dump(res, open('match.json', 'w'))
