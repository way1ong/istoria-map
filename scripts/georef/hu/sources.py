#!/usr/bin/env python3 -I
"""Джерело (IIIF) для кожної клітинки: IOS з каталогу GeoPortOst, прогалини — NYPL за номерами з Commons."""
import json, os
S = os.environ.get('HU_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')) + '/'
plan = json.load(open(S + 'plan.json'))
NYPL = {  # клітинка -> (id NYPL, назва файлу на Commons або None)
    '11-25': (1226486, 'Toketerebes und Nagyszalancz'),
    '12-24': (1226513, 'Goncz und Csobad (Ungarn)'),
    '12-25': (1226514, 'Saros-Nagypatak und Satoralja-Ujhely'),
    '13-24': (1226541, 'Szikszo und Tisza-Dob'),
    '13-25': (1226542, 'Tokai'),
    '15-15': (1226593, 'Oedenburg'),
    '15-17': (1226595, 'Raab'),
    '15-19': (1226597, None),
    '15-24': (1226602, 'Csege'),
    '15-25': (1226603, 'Debreczen'),
    '15-26': (1226604, 'Nyir-Beltek und Hajdu-Yamos-Percs'),
    '15-27': (1226605, None),
    '16-15': (1226628, 'Guns'),
    '16-16': (1226629, 'Sarvar, Kis-Cell und Beled'),
    '16-22': (1226635, 'Jasz-Ladany'),
    '17-18': (1226665, 'Veszprem und Varpalota (Ungarn)'),
    '17-25': (1226672, 'Berettyo-Ujfalu und Koros-Tarjan'),
    '22-16': (1226821, 'Belovar und Grdjevac Veliki'),
    '22-17': (1226822, 'Barcs und Virovitica'),
}
out = {}
for k, p in plan.items():
    if p['src'] == 'existing':
        continue
    if p['src'] == 'ios':
        out[k] = {'src': 'ios', 'service': f"https://iiif.ios-regensburg.de/iiif/2/{p['id']}.tif", 'title': p['title'], 'cat_id': p['id']}
    elif k in NYPL:
        i, t = NYPL[k]
        out[k] = {'src': 'nypl', 'service': f'https://iiif.nypl.org/iiif/2/{i}', 'title': t, 'cat_id': str(i)}
json.dump(out, open(S + 'sources.json', 'w'), indent=1, ensure_ascii=False)
print(len(out), 'to fetch;', 'missing:', [k for k, p in plan.items() if p['src'] == 'nypl?' and k not in NYPL])
