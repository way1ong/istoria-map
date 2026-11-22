"""Рисунки 8, 12, 14 зі статті Ádám B., A Karola-vonal erődítési rendszere (Hadtudományi Szemle 2022/3):
знімки Google Earth із синіми лініями позицій. Растри ../img/ad-007.png, ad-011.png, ad-013.png
(pdfimages -png 03_adam_33-59_HSZ_2022_3.pdf img/ad)."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'reg'))
FIGS = ['007', '011', '013']          # рис. 8 (Aszód–Hatvan), рис. 12 (Hatvan), рис. 14 (Hatvan–Gyöngyös)
def path(fig):
    p = os.path.join(HERE, '..', 'img', f'ad-{fig}.png')
    if not os.path.exists(p): raise SystemExit(f'немає {p} (див. README: pdfimages)')
    return p
