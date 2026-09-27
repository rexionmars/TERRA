"""
What one acquisition says about an area, and how this season's acquisitions
are held against earlier ones.

Kept apart from the action so the arithmetic is exercised without a catalogue
or a network (tests/test_health.py).
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from datetime import date, datetime

import numpy as np
from rasterio.warp import Resampling

from terra.imagery import mosaic, sentinel2

# Red, NIR, and the red edge with its 20 m NIR, read onto the 10 m grid.
BANDS = ('B04', 'B08', 'B05', 'B8A')

# Days either side of a date's day of the year that count as the same time of
# year. Sixteen spans a little over three revisits of the two Sentinel-2
# satellites, so a cloudy stretch in one earlier season still leaves dates in
# the window from the others.
WINDOW_DAYS = 16
# Earlier seasons read as the reference.
BASELINE_YEARS = 3

# The spread below which a departure is not divided further, in index units.
# Three reference dates of a steady canopy can agree to the third decimal, and
# dividing by that turns a 0.02 difference into ten standard deviations.
SD_FLOOR = 0.02

# The share of the area an acquisition has to see clearly to count: below it
# the mean is of whatever corner the clouds left.
MIN_CLEAR = 0.3
# The share the date shown on the map has to see, where one does.
MAP_CLEAR = 0.6
# The NDVI difference the anomaly map's colours span, either side of zero.
MAP_RANGE = 0.3


@dataclass
class Observation:
    """One acquisition over the area: its index means over the clear cells."""

    date: str
    ndvi: float
    ndre: float
    clear_fraction: float
    # Kept only where a map may be drawn from it.
    ndvi_map: np.ndarray | None = field(default=None, repr=False)

    def point(self) -> dict:
        return {
            'date': self.date,
            'ndvi': round(self.ndvi, 4),
            'ndre': round(self.ndre, 4),
            'clear_fraction': round(self.clear_fraction, 4),
        }


def shift_years(iso: str, years: int) -> str:
    """The same calendar day `years` earlier (negative) or later; 29 Feb falls to 28."""
    d = date.fromisoformat(iso[:10])
    try:
        return d.replace(year=d.year + years).isoformat()
    except ValueError:
        return d.replace(year=d.year + years, day=28).isoformat()


def day_of_year(iso: str) -> int:
    return date.fromisoformat(iso[:10]).timetuple().tm_yday


def doy_distance(a: str, b: str) -> int:
    """Days between two dates' days of the year, around the turn of the year."""
    d = abs(day_of_year(a) - day_of_year(b))
    return min(d, 365 - d)


def normalized_difference(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    with np.errstate(divide='ignore', invalid='ignore'):
        out = (a - b) / (a + b)
    return np.where(np.isfinite(out), out, np.nan).astype(np.float32)


def _offset(scene: mosaic.Scene) -> float:
    """The BOA offset the scene's digital numbers carry (sentinel2.boa_add_offset)."""
    props = scene.items[0].properties if scene.items else {}
    acquired = None
    try:
        acquired = datetime.fromisoformat(scene.date)
    except ValueError:
        pass
    return sentinel2.boa_add_offset(
        {'processing_baseline': props.get('s2:processing_baseline'), 'date': acquired}
    )


def observe(
    scene: mosaic.Scene, grid: mosaic.Grid, inside: np.ndarray, keep_map: bool
) -> Observation | None:
    """
    One acquisition's index means over the area's clear cells, or None where it
    sees less than MIN_CLEAR of the area.

    A cell counts where it is inside the area, the scene classification calls
    it clear, and every band has data. The bands are reflectance, the BOA offset
    removed: an index of digital numbers carrying the offset is not the index.
    """
    n = int(inside.sum())
    scl = mosaic.read_asset(scene.items, 'SCL', grid, Resampling.nearest, np.uint8)
    clear = inside & mosaic.usable(scl)
    # The classification first, and alone: a date the clouds took is judged by
    # one read rather than five. Most dates of a rainy season are such dates.
    if not n or float(clear.sum()) / n < MIN_CLEAR:
        return None
    dn = {
        b: mosaic.read_asset(scene.items, b, grid, Resampling.bilinear, np.uint16).astype(np.float32)
        for b in BANDS
    }
    for band in dn.values():
        clear &= band > 0
    frac = float(clear.sum()) / n
    if frac < MIN_CLEAR:
        return None
    offset = _offset(scene)
    refl = {b: (v + offset) / sentinel2.QUANTIFICATION_VALUE for b, v in dn.items()}
    ndvi = normalized_difference(refl['B08'], refl['B04'])
    ndre = normalized_difference(refl['B8A'], refl['B05'])
    ok = clear & np.isfinite(ndvi) & np.isfinite(ndre)
    if not ok.any():
        return None
    ndvi_map = None
    if keep_map:
        ndvi_map = np.where(ok, ndvi, np.nan).astype(np.float32)
    return Observation(
        date=scene.date,
        ndvi=float(np.mean(ndvi[ok])),
        ndre=float(np.mean(ndre[ok])),
        clear_fraction=frac,
        ndvi_map=ndvi_map,
    )


def one_per_date(obs: list[Observation]) -> list[Observation]:
    """The clearest acquisition of each date, in date order: two orbits, one day."""
    best: dict[str, Observation] = {}
    for o in obs:
        if o.date not in best or o.clear_fraction > best[o.date].clear_fraction:
            best[o.date] = o
    return [best[d] for d in sorted(best)]


def against(
    current: Observation, reference: list[tuple[int, Observation]], window: int
) -> dict:
    """
    One date of this season against the earlier seasons' acquisitions within
    `window` days of its day of the year.

    The departure is (x - mean) / max(sd, SD_FLOOR), with the sample standard
    deviation; null with fewer than two reference dates, where a spread cannot
    be measured.
    """
    near = [o for _, o in reference if doy_distance(o.date, current.date) <= window]
    n = len(near)

    def stats(values: list[float], x: float) -> tuple[float | None, float | None, float | None]:
        if not values:
            return None, None, None
        mean = float(np.mean(values))
        if len(values) < 2:
            return mean, None, None
        sd = float(np.std(values, ddof=1))
        return mean, sd, (x - mean) / max(sd, SD_FLOOR)

    ndvi_mean, ndvi_sd, ndvi_z = stats([o.ndvi for o in near], current.ndvi)
    ndre_mean, ndre_sd, ndre_z = stats([o.ndre for o in near], current.ndre)

    def r(v: float | None, k: int = 4) -> float | None:
        return None if v is None else round(v, k)

    return {
        'date': current.date,
        'ndvi': round(current.ndvi, 4),
        'ndre': round(current.ndre, 4),
        'baseline_n': n,
        'ndvi_mean': r(ndvi_mean),
        'ndvi_sd': r(ndvi_sd),
        'ndvi_z': r(ndvi_z, 3),
        'ndre_mean': r(ndre_mean),
        'ndre_sd': r(ndre_sd),
        'ndre_z': r(ndre_z, 3),
    }


def map_date(current: list[Observation]) -> Observation:
    """The latest date that sees at least MAP_CLEAR of the area, or the clearest."""
    clear = [o for o in current if o.clear_fraction >= MAP_CLEAR]
    if clear:
        return clear[-1]
    return max(current, key=lambda o: o.clear_fraction)


def anomaly_map(shown: Observation, reference: list[Observation]) -> np.ndarray:
    """
    The shown date's NDVI minus the per-cell median of the reference maps; NaN
    where the shown date has no value or no reference map does.
    """
    if shown.ndvi_map is None:
        raise ValueError('the shown date kept no map')
    maps = [o.ndvi_map for o in reference if o.ndvi_map is not None]
    if not maps:
        return np.full(shown.ndvi_map.shape, np.nan, dtype=np.float32)
    with warnings.catch_warnings():
        # An all-NaN cell is the ordinary case outside the area.
        warnings.simplefilter('ignore', category=RuntimeWarning)
        median = np.nanmedian(np.stack(maps), axis=0)
    return (shown.ndvi_map - median).astype(np.float32)


def window_of(start: str, end: str, years_back: int) -> tuple[str, str]:
    """The period moved `years_back` seasons earlier."""
    return shift_years(start, -years_back), shift_years(end, -years_back)
