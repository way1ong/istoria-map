"""Права частина рис. 8 (Juhász–Balogh 2025): лінія «Маргіт» довкола Velencei-tó.
Растр ../img/ht-005-008.png (1080×474) містить дві мапи; права починається з x = 478."""
import os, sys, cv2
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'reg'))
X0 = 478
LEGEND = (424, 368, 602, 474)          # легенда в правому нижньому куті (пікселі правої частини)
def load():
    img = cv2.imread(os.path.join(HERE, '..', 'img', 'ht-005-008.png'))
    if img is None: raise SystemExit('немає ../img/ht-005-008.png (див. README: pdfimages)')
    return img[:, X0:].copy()
