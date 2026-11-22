# Сітка класів → полігони зі спільними межами.
# Межі проходять по ребрах клітинок; відрізки між вузлами (де сходяться три й більше областей) спрощуються
# один раз для всіх років, тому незмінна межа в різних роках збігається точка в точку, а сусідні полігони
# не мають ні щілин, ні накладань.
import numpy as np
from scipy import ndimage
from shapely.geometry import LineString, MultiLineString, Polygon
from shapely.ops import linemerge, polygonize, unary_union
import grid as G

KX = float(np.cos(np.radians(47.0)))     # довготу стискаємо, щоб допуск спрощення був однаковим в усі боки
PAD = 1                                  # сітки обводяться смужкою нулів, щоб області на краю сітки теж замикалися

def pad(a):
    return np.pad(a, PAD, constant_values=0)

def smooth(labels, sigma=3.0, mask=None):
    """Згладжування меж: у кожній клітинці перемагає клас, якого найбільше довкола (ваги Ґаусса, sigma в клітинках).
    Прибирає «сходинки» від пікселів мап-джерел (1 піксель мапи 1280 px ≈ 1,5 км ≈ 3–4 клітинки).
    З mask класи рахуються лише серед ненульових, а результат записується тільки всередині mask."""
    classes = [k for k in np.unique(labels) if mask is None or k != 0]
    best = np.full(labels.shape, -1.0, np.float32); out = np.zeros_like(labels)
    for k in classes:
        v = ndimage.gaussian_filter((labels == k).astype(np.float32), sigma, mode='nearest')
        win = v > best
        out[win] = k; best[win] = v[win]
    if mask is not None: out = np.where(mask, out, 0).astype(labels.dtype)
    return out

def fill_nearest(state, mask):
    """Усі клітинки mask дістають клас найближчої ненульової клітинки state; поза mask — нуль."""
    idx = ndimage.distance_transform_edt(state == 0, return_distances=False, return_indices=True)
    return np.where(mask, state[idx[0], idx[1]], 0).astype(state.dtype)

def clean(state, radius=6, min_cells=300):
    """Прибрати смужки, вужчі за ~2·radius клітинок, і дрібні острівці: їхні клітинки дістають найближчий клас.
    Клітинки з нулем (поза рамкою) не змінюються."""
    inside = state != 0
    yy, xx = np.mgrid[-radius:radius + 1, -radius:radius + 1]
    disk = (xx * xx + yy * yy) <= radius * radius
    keep = np.zeros_like(state)
    for k in np.unique(state[inside]):
        m = state == k
        o = ndimage.binary_opening(m, structure=disk)
        lab, n = ndimage.label(o)
        if n:
            sizes = ndimage.sum(o, lab, index=np.arange(1, n + 1))
            o = np.isin(lab, 1 + np.nonzero(sizes >= min_cells)[0])
        keep[o] = k
    idx = ndimage.distance_transform_edt(keep == 0, return_distances=False, return_indices=True)
    return np.where(inside, keep[idx[0], idx[1]], 0).astype(state.dtype)

def crack_arcs(combo):
    """Ребра клітинок, де значення по різні боки різні, зшиті у відрізки між вузлами (combo — сітка після pad()).
    Повертає список (координати кутів клітинок [[i, j], …], клітинка A, клітинка B) — A і B лежать по різні боки
    першого ребра відрізка (рядок, стовпчик)."""
    ny, nx = combo.shape
    segs = []
    ys, xs = np.nonzero(combo[:-1, :] != combo[1:, :])          # горизонтальні ребра між рядками y і y+1
    segs += [((x, y + 1), (x + 1, y + 1)) for y, x in zip(ys.tolist(), xs.tolist())]
    ys, xs = np.nonzero(combo[:, :-1] != combo[:, 1:])          # вертикальні ребра між стовпчиками x і x+1
    segs += [((x + 1, y), (x + 1, y + 1)) for y, x in zip(ys.tolist(), xs.tolist())]
    merged = linemerge(MultiLineString(segs))
    lines = list(merged.geoms) if hasattr(merged, 'geoms') else [merged]
    out = []
    for ln in lines:
        c = np.array(ln.coords)
        (x0, y0), (x1, y1) = c[0], c[1]
        if y0 == y1:                                           # горизонтальне ребро: клітинки над і під ним
            x = int(min(x0, x1)); y = int(y0); a, b = (y - 1, x), (y, x)
        else:
            y = int(min(y0, y1)); x = int(x0); a, b = (y, x - 1), (y, x)
        out.append((c, a, b))
    return out

def corners_to_lonlat(c):
    return np.stack([G.LON0 + (c[:, 0] - PAD) * G.CELL, G.LAT1 - (c[:, 1] - PAD) * G.CELL], axis=1)

def simplify_arc(c, tol):
    """Спрощення Дугласа–Пекера; кінці відрізка лишаються на місці. Замкнене кільце ділиться навпіл."""
    ll = corners_to_lonlat(c); ll[:, 0] *= KX
    if len(ll) > 3 and np.allclose(ll[0], ll[-1]):
        h = len(ll) // 2
        parts = [ll[:h + 1], ll[h:]]
    else:
        parts = [ll]
    res = []
    for p in parts:
        s = np.array(LineString(p).simplify(tol, preserve_topology=False).coords)
        res.append(s if not res else s[1:])
    out = np.vstack(res); out[:, 0] /= KX
    return np.round(out, 3)

def faces(arcs, state, classes):
    """Полігони класів одного стану з уже спрощених відрізків: {клас: MultiPolygon} (state — сітка після pad())."""
    lines = [LineString(ll) for ll, a, b in arcs if state[a] != state[b] and len(ll) >= 2]
    polys = list(polygonize(unary_union(lines)))
    by = {k: [] for k in classes}
    for p in polys:
        q = p.representative_point()
        x, y = G.to_cell(q.x, q.y)
        k = int(state[int(round(float(y))) + PAD, int(round(float(x))) + PAD])
        if k in by: by[k].append(p)
    return {k: unary_union(v) for k, v in by.items() if v}
