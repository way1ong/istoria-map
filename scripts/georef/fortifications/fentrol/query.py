"""fentrol.hu: знімки в bbox (lon/lat) за роками; повертає список gid з назвами (рік_плівка_кадр) і центрами."""
import math, json, subprocess, sys, time, urllib.parse
def merc(lon, lat):
    return lon * 20037508.34 / 180, math.log(math.tan((90 + lat) * math.pi / 360)) * 6378137
def unmerc(x, y):
    return x / 20037508.34 * 180, math.degrees(2 * math.atan(math.exp(y / 6378137)) - math.pi / 2)
def query(w, s, e, n, y0, y1, res=0.5):
    x0, yy0 = merc(w, s); x1, yy1 = merc(e, n)
    flt = json.dumps([{"filtername": "felmeres_ido", "checkedvalues": [{"value": str(y0)}, {"value": str(y1)}]}])
    data = urllib.parse.urlencode({'balalsoX': x0, 'balalsoY': yy0, 'jobbfelsoX': x1, 'jobbfelsoY': yy1, 'mapresolution': res,
                                   'legifoto_filter_searchtext': '', 'legifoto_filter_search_type': '', 'legifoto_filter_search_type2': '',
                                   'legifoto_filter_searchfilter': flt, 'userid': ''})
    r = subprocess.run(['curl', '-sS', '-m', '90', '-X', 'POST', '-H', 'Content-Type: application/x-www-form-urlencoded', '--data', data,
                        'https://www.fentrol.hu/DLAMap/create_cluster.php'], capture_output=True, text=True)
    return json.loads(r.stdout)
if __name__ == '__main__':
    w, s, e, n = map(float, sys.argv[1].split(',')); y0, y1 = int(sys.argv[2]), int(sys.argv[3])
    d = query(w, s, e, n, y0, y1)
    print('képek', d.get('kepekdb'), 'clusters', len(d.get('theclusters') or []), 'singles', len(d.get('thesingles') or []))
    out = []
    for c in d.get('theclusters') or []:
        out += [{'gid': g, 'cluster': True, 'x': c['x'], 'y': c['y']} for g in c['elemek'].split(',')]
    for sgl in d.get('thesingles') or []:
        out.append({'gid': str(sgl['id']), 'kepnev': sgl.get('kepnev'), 'x': sgl['x'], 'y': sgl['y']})
    json.dump(out, open(sys.argv[4], 'w'), indent=0)
    names = sorted({o.get('kepnev', '')[:4] for o in out if o.get('kepnev')})
    print('роки (singles):', names)
