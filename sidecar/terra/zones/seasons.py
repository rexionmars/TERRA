"""
The seasons a field's zones are drawn from: each one's acquisitions read onto
the field's grid, and one NDVI layer per season.
"""

from __future__ import annotations

import warnings
from datetime import date, datetime

import numpy as np

from terra.imagery import mosaic, sentinel2

BANDS = ('B04', 'B08')
# The seasons read: the requested period and this many before it.
EARLIER_SEASONS = 3
# The percentile of a cell's clear NDVI values that stands for its season:
# near the peak, without resting on the single highest date.
PERCENTILE = 90
# Clear acquisitions a cell needs in a season for that season to have a value.
MIN_OBS = 3
# An acquisition that sees less of the field than this is not read further.
MIN_CLEAR = 0.3


def shift_years(iso: str, years: int) -> str:
    d = date.fromisoformat(iso)
    try:
        return d.replace(year=d.year + years).isoformat()
    except ValueError:  # 29 February into a common year
        return d.replace(year=d.year + years, day=28).isoformat()


def windows(start: str, end: str, earlier: int = EARLIER_SEASONS) -> list[tuple[str, str]]:
    """The requested period and `earlier` periods before it, latest first."""
    return [(shift_years(start, -k), shift_years(end, -k)) for k in range(earlier + 1)]


def _offset(scene: mosaic.Scene) -> float:
    """The BOA offset the scene's digital numbers carry (sentinel2.boa_add_offset)."""
    props = scene.items[0].properties if scene.items else {}
    try:
        acquired = datetime.fromisoformat(scene.date)
    except ValueError:
        acquired = None
    return sentinel2.boa_add_offset({'processing_baseline': props.get('s2:processing_baseline'), 'date': acquired})


def ndvi_map(scene: mosaic.Scene, grid: mosaic.Grid, inside: np.ndarray) -> np.ndarray | None:
    """
    One acquisition's NDVI over the field's clear cells, NaN elsewhere; None
    where it sees less than MIN_CLEAR of the field.

    The scene classification is read first and alone, as the vegetation health
    product does: a date the clouds took is judged by one read, not three.
    """
    from rasterio.enums import Resampling

    n = int(inside.sum())
    scl = mosaic.read_asset(scene.items, 'SCL', grid, Resampling.nearest, np.uint8)
    clear = inside & mosaic.usable(scl)
    if not n or float(clear.sum()) / n < MIN_CLEAR:
        return None
    dn = {b: mosaic.read_asset(scene.items, b, grid, Resampling.bilinear, np.uint16).astype(np.float32) for b in BANDS}
    for band in dn.values():
        clear &= band > 0
    if float(clear.sum()) / n < MIN_CLEAR:
        return None
    offset = _offset(scene)
    red = (dn['B04'] + offset) / sentinel2.QUANTIFICATION_VALUE
    nir = (dn['B08'] + offset) / sentinel2.QUANTIFICATION_VALUE
    with np.errstate(divide='ignore', invalid='ignore'):
        ndvi = (nir - red) / (nir + red)
    ok = clear & np.isfinite(ndvi)
    return np.where(ok, ndvi, np.nan).astype(np.float32)


def season_layer(maps: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """
    The season's layer -- each cell's PERCENTILE-th clear NDVI, NaN with fewer
    than MIN_OBS clear values -- and each cell's count of clear values.
    """
    stack = np.stack(maps)
    count = np.isfinite(stack).sum(axis=0)
    with warnings.catch_warnings():
        # A cell with no clear value is the ordinary case outside the field.
        warnings.simplefilter('ignore', category=RuntimeWarning)
        layer = np.nanpercentile(stack, PERCENTILE, axis=0).astype(np.float32)
    layer[count < MIN_OBS] = np.nan
    return layer, count
