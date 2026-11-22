# Координати міст для прив'язки й контролю → cities.json.
# Спершу з кешу scripts/georef/lipszky-towns/towns_osm.json (ті самі запити Nominatim, зроблені раніше),
# решта — Nominatim: 1 запит на секунду, загальний User-Agent, жодних особистих даних.
import json, os, subprocess, time, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'cities.json')
# назва міста на мапі (угорська) → запит до Nominatim
Q = {
  'Olomouc': 'Olomouc, Czechia', 'Brno': 'Brno, Czechia', 'Linz': 'Linz, Austria', 'Bécs': 'Wien, Austria', 'Graz': 'Graz, Austria',
  'Klagenfurt': 'Klagenfurt, Austria', 'Maribor': 'Maribor, Slovenia', 'Ljubljana': 'Ljubljana, Slovenia', 'Varasd': 'Varaždin, Croatia',
  'Zágráb': 'Zagreb, Croatia', 'Károlyváros': 'Karlovac, Croatia', 'Bihács': 'Bihać, Bosnia and Herzegovina', 'Banja Luka': 'Banja Luka, Bosnia and Herzegovina',
  'Pozsega': 'Požega, Croatia', 'Pétervárad': 'Petrovaradin, Serbia', 'Belgrád': 'Beograd, Serbia', 'Szendrő': 'Smederevo, Serbia',
  'Szörényvár': 'Drobeta-Turnu Severin, Romania', 'Karánsebes': 'Caransebeș, Romania', 'Lugos': 'Lugoj, Romania', 'Déva': 'Deva, Romania',
  'Gyulafehérvár': 'Alba Iulia, Romania', 'Zilah': 'Zalău, Romania', 'Nagybánya': 'Baia Mare, Romania', 'Munkács': 'Mukachevo, Ukraine',
  'Ungvár': 'Uzhhorod, Ukraine', 'Eperjes': 'Prešov, Slovakia', 'Besztercebánya': 'Banská Bystrica, Slovakia', 'Túrócszentmárton': 'Martin, Slovakia',
  'Trencsén': 'Trenčín, Slovakia', 'Nagyszombat': 'Trnava, Slovakia', 'Lippa': 'Lipova, Arad, Romania', 'Csanád': 'Cenad, Romania',
  'Szigetvár': 'Szigetvár, Hungary', 'Simontornya': 'Simontornya, Hungary', 'Nógrád': 'Nógrád, Nógrád, Hungary', 'Szécsény': 'Szécsény, Hungary',
  'Fülek': 'Fiľakovo, Slovakia', 'Tatabánya': 'Tatabánya, Hungary', 'Buda': 'Budapest, Hungary', 'Göd': 'Göd, Hungary',
  'Érsekújvár': 'Nové Zámky, Slovakia', 'Kanizsa': 'Nagykanizsa, Hungary', 'Brassó': 'Brașov, Romania', 'Nagyszeben': 'Sibiu, Romania',
  'Marosvásárhely': 'Târgu Mureș, Romania', 'Beszterce': 'Bistrița, Romania', 'Huszt': 'Khust, Ukraine', 'Lőcse': 'Levoča, Slovakia',
  'Segesvár': 'Sighișoara, Romania', 'Zimony': 'Zemun, Serbia', 'Sziszek': 'Sisak, Croatia', 'Eszék': 'Osijek, Croatia',
  'Szarajevó': 'Sarajevo, Bosnia and Herzegovina', 'Szófia': 'Sofia, Bulgaria', 'Jászvásár': 'Iași, Romania', 'Bukarest': 'București, Romania',
  'Szilisztra': 'Silistra, Bulgaria',
}
ALIAS = {'Várad': 'Nagyvárad', 'Szatmár': 'Szatmárnémeti'}
cache = json.load(open(os.path.join(HERE, '..', 'lipszky-towns', 'towns_osm.json'), encoding='utf-8'))
out = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
for k, v in cache.items(): out.setdefault(k, {'lat': v['lat'], 'lon': v['lon'], 'src': 'lipszky-towns (Nominatim)'})
for a, b in ALIAS.items(): out.setdefault(a, dict(out[b]))
for name, q in Q.items():
    if name in out: continue
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': q, 'format': 'json', 'limit': 1})
    r = subprocess.run(['curl', '-s', '-m', '30', '-A', 'istoria-map-qa/1.0', url], capture_output=True, text=True).stdout
    try:
        j = json.loads(r)[0]
        out[name] = {'lat': float(j['lat']), 'lon': float(j['lon']), 'q': q, 'osm': f"{j.get('osm_type')}/{j.get('osm_id')}", 'src': 'Nominatim'}
        print(name, out[name]['lat'], out[name]['lon'], j.get('display_name', '')[:60])
    except Exception:
        print('ПОМИЛКА', name, q, r[:120])
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    time.sleep(1.1)
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('міст:', len(out))
