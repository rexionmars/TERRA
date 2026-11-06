"""
The period's cloud-free median: each cell's median reflectance over the
acquisitions that saw it clearly.

This is what fills the gaps a single scene leaves under cloud. Each acquisition
is judged cell by cell by its scene classification (imagery.mosaic.usable), the
cells it did not see clearly are dropped, and the median is taken over what is
left. A cell therefore carries a value from a different set of dates than its
neighbour, and a cell seen once carries that one observation: the count of
observations behind each cell is returned with the median so the reader can
see where it is thin.

The median rather than the mean, because an observation the classification
missed -- haze, a cloud edge, a shadow it called ground -- is an outlier, and the
median of three or more clear observations ignores one.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from rasterio.warp import Resampling

from terra.imagery import mosaic, sentinel2

# The least cloudy acquisitions of the period that are read. Every one is a read
# of each band, and past a dozen clear observations the median of a season
# settles; the bound keeps a year-long period from reading seventy scenes.
MAX_SCENES = 12
# An acquisition that sees less than this share of the area clearly adds little
# and costs a read of every band, so it is skipped after its classification.
MIN_CLEAR = 0.05
# The median holds one band of every kept acquisition in memory at once. This
# many cells is 12 million at 10 m, or 120 000 ha, and about 600 MB per band.
MAX_CELLS = 12_000_000


@dataclass
class PeriodMedian:
    bands: dict[str, np.ndarray]  # reflectance, NaN where no clear observation
    count: np.ndarray  # clear observations behind each cell
    inside: np.ndarray  # cells inside the area
    grid: mosaic.Grid
    dates: list[str]


def period_median(
    polygon,
    start: str,
    end: str,
    max_cloud: float,
    bands: tuple[str, ...],
    note: Callable[[str], None] = lambda _msg: None,
) -> PeriodMedian:
    """
    The median of `bands` over the area's clear observations in the period.

    Raises ValueError where the area is too large to hold, or where no
    acquisition in the period saw enough of it.
    """
    grid = mosaic.reference_grid(polygon, 0.0)
    if grid.width * grid.height > MAX_CELLS:
        raise ValueError(
            f'the area spans {grid.width * grid.height / 1e6:.1f} million cells at 10 m; '
            f'the period median holds every scene of a band at once and is limited to '
            f'{MAX_CELLS / 1e6:.0f} million (about {MAX_CELLS / 100:,.0f} ha). Use one scene, or a smaller area'
        )
    inside = mosaic.area_mask(polygon, grid)
    n_inside = int(inside.sum())
    if not n_inside:
        raise ValueError('the area covers no 10 m cell')
    found = mosaic.search_scenes(grid, start, end, max_cloud, bands)[:MAX_SCENES]
    kept: list[tuple[mosaic.Scene, np.ndarray]] = []
    for i, scene in enumerate(found):
        note(f'judging {scene.date} ({i + 1} of {len(found)})')
        scl = mosaic.read_asset(scene.items, 'SCL', grid, Resampling.nearest, np.uint8)
        clear = inside & mosaic.usable(scl)
        if clear.sum() / n_inside >= MIN_CLEAR:
            kept.append((scene, clear))
    if not kept:
        raise ValueError(
            f'none of the {len(found)} acquisitions in the period saw at least '
            f'{MIN_CLEAR:.0%} of the area clearly'
        )
    out: dict[str, np.ndarray] = {}
    count = np.zeros(inside.shape, dtype=np.int16)
    for b_i, band in enumerate(bands):
        note(f'reading {band} from {len(kept)} acquisitions ({b_i + 1} of {len(bands)})')
        layers = np.full((len(kept), *inside.shape), np.nan, dtype=np.float32)
        for s_i, (scene, clear) in enumerate(kept):
            dn = mosaic.read_asset(scene.items, band, grid, Resampling.bilinear, np.uint16)
            seen = clear & (dn > 0)
            offset = mosaic.boa_offset(scene)
            layers[s_i][seen] = (dn[seen].astype(np.float32) + offset) / sentinel2.QUANTIFICATION_VALUE
        if b_i == 0:
            count = np.isfinite(layers).sum(axis=0).astype(np.int16)
        out[band] = median_ignoring_gaps(layers)
    return PeriodMedian(
        bands=out,
        count=count,
        inside=inside,
        grid=grid,
        dates=sorted(scene.date for scene, _ in kept),
    )


def median_ignoring_gaps(layers: np.ndarray) -> np.ndarray:
    """The median over the first axis of the finite values, NaN where there are none."""
    seen = np.isfinite(layers).any(axis=0)
    out = np.full(layers.shape[1:], np.nan, dtype=np.float32)
    if seen.any():
        out[seen] = np.nanmedian(layers[:, seen], axis=0)
    return out
