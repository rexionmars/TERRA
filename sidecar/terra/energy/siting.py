"""
Where within an area a photovoltaic plant could stand.

Slope limits and land-cover eligibility, the legend they produce, the class
areas and the overlay that paints them.

PROJECT CONVENTIONS, NOT VERIFIED LEGAL RESTRICTIONS. The thresholds and the
excluded cover classes below are the study's working assumptions. They are not
a permitting analysis and a class named unsuitable here is not a class a
regulator has ruled on.
"""

from __future__ import annotations

import numpy as np

# ----------------------------------------------------------------- suitability
#
# PROJECT CONVENTIONS, NOT VERIFIED LEGAL RESTRICTIONS. The slope limits follow
# common practice for fixed-tilt utility photovoltaics with standard racking,
# and the excluded-cover list is a reading of MapBiomas classes. Legal reserve,
# permanent preservation areas and municipal zoning require the CAR and local
# legislation, which this analysis does not consult. Both are request
# parameters, and every response repeats the values it used.
SLOPE_ACCEPTABLE_DEG = 10.0


SLOPE_RESTRICTIVE_DEG = 15.0


# Forest formation (legal reserve and riparian protection), planted forest,
# urban, water and perennial crops.
EXCLUDED_COVER = (3, 9, 24, 33, 46, 47, 48)


# Classes where installation competes with annual cropping.
CROPLAND_COVER = (20, 39, 40, 41, 62)


SUITABILITY_LEGEND = [
    {"code": 0, "name": "Excluded - protected or occupied cover", "color": "#4d4d4d"},
    {"code": 1, "name": "Excluded - slope above the limit", "color": "#8c510a"},
    {"code": 2, "name": "Restrictive - slope near the limit", "color": "#dfc27d"},
    {"code": 3, "name": "Suitable - conflicts with annual cropping", "color": "#fdae61"},
    {"code": 4, "name": "Suitable - no land-use conflict", "color": "#1a9850"},
]


def suitability_map(
    slope: np.ndarray,
    mapbiomas: np.ndarray,
    valid: np.ndarray,
    slope_acceptable: float = SLOPE_ACCEPTABLE_DEG,
    slope_restrictive: float = SLOPE_RESTRICTIVE_DEG,
    excluded_cover=EXCLUDED_COVER,
    cropland_cover=CROPLAND_COVER,
) -> np.ndarray:
    """
    Five-class siting map from slope limits and land-cover eligibility.

    Cropland is its own class and is never merged into the suitable area: a
    pixel that is geometrically fine but currently produces soybean carries a
    trade-off a binary map would hide.

    A pixel with no slope is treated as steep rather than flat, so missing
    terrain cannot present itself as suitable.
    """
    out = np.full(slope.shape, -1, dtype=np.int16)
    s = np.nan_to_num(slope, nan=90.0)

    is_excluded = np.isin(mapbiomas, list(excluded_cover))
    is_cropland = np.isin(mapbiomas, list(cropland_cover))

    out[valid] = 4
    out[valid & is_cropland] = 3
    out[valid & (s > slope_acceptable) & (s <= slope_restrictive)] = 2
    out[valid & (s > slope_restrictive)] = 1
    out[valid & is_excluded] = 0
    return out


def suitability_rgba(suit: np.ndarray) -> np.ndarray:
    """Paint the siting classes, matching the classification overlay path."""
    h, w = suit.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for entry in SUITABILITY_LEGEND:
        m = suit == entry["code"]
        if not np.any(m):
            continue
        c = entry["color"].lstrip("#")
        rgba[m] = [int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), 255]
    return rgba


def suitability_stats(suit: np.ndarray, px_area_ha: float) -> list[dict]:
    """Area per class. The two suitable classes are reported separately."""
    rows = []
    total = int((suit >= 0).sum())
    for entry in SUITABILITY_LEGEND:
        n = int((suit == entry["code"]).sum())
        rows.append({
            "code": entry["code"],
            "name": entry["name"],
            "color": entry["color"],
            "pixels": n,
            "area_ha": round(float(n * px_area_ha), 3),
            "pct": round(float(100.0 * n / total), 2) if total else 0.0,
        })
    return rows
