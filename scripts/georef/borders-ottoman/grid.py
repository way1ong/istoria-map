# Спільна сітка довгот і широт, у якій складаються стани за роками, і перенесення областей мапи-джерела в цю сітку.
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from georef import Georef

LON0, LON1, LAT0, LAT1, CELL = 12.0, 28.5, 43.0, 50.5, 0.005
NX, NY = int(round((LON1 - LON0) / CELL)), int(round((LAT1 - LAT0) / CELL))

def cell_centers():
    """Довготи й широти центрів клітинок (рядок 0 — північ)."""
    lon = LON0 + (np.arange(NX) + 0.5) * CELL
    lat = LAT1 - (np.arange(NY) + 0.5) * CELL
    return np.meshgrid(lon, lat)

def to_cell(lon, lat):
    return (np.asarray(lon) - LON0) / CELL - 0.5, (LAT1 - np.asarray(lat)) / CELL - 0.5

def inverse_georef(names, px, geo, deg):
    """Поліном (довгота, широта) → піксель мапи за тими самими містами."""
    return Georef(geo, px, deg)

def warp_regions(regions, inv):
    """Номер області мапи-джерела в кожній клітинці сітки (0 — поза мапою)."""
    lon, lat = cell_centers()
    p = inv(np.stack([lon.ravel(), lat.ravel()], axis=1))
    x = np.rint(p[:, 0]).astype(int); y = np.rint(p[:, 1]).astype(int)
    ok = (x >= 0) & (x < regions.shape[1]) & (y >= 0) & (y < regions.shape[0])
    out = np.zeros(NX * NY, np.int32)
    out[ok] = regions[y[ok], x[ok]]
    return out.reshape(NY, NX)
