"""
What one Sentinel-2 acquisition says about an area, in the six channels a
gp_series model reads.

The model was calibrated and checked on series read this way, with these
functions of terra.imagery (terra_signal_spectrum,
experiments/20261113_terra_series_acquisition/acquire.py, field_series): the
median of each channel over the area's clear pixels, not their mean, so a few
cells of unflagged haze or shadow do not move the value. Kept apart from the
action so the arithmetic is exercised without a catalogue or a network
(tests/test_trajectory.py).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from rasterio.warp import Resampling

from terra.imagery import indices, mosaic, sentinel2

# Blue, green, red and NIR, read onto the 10 m grid. NDVI and EVI are computed
# from them per pixel, which makes the six channels of gp_series.CHANNELS.
BANDS = ('B02', 'B03', 'B04', 'B08')
CHANNELS = 6


@dataclass(frozen=True)
class Acquisition:
    """One acquisition over the area, in the order of gp_series.CHANNELS."""

    date: str
    # The pixels inside the area that are clear, positive and finite in every
    # channel, over all the pixels inside it.
    clear_fraction: float
    # The medians over those pixels; NaN where the acquisition was not read
    # that far, which the model drops as it drops an unclear date.
    values: np.ndarray


def medians(stack: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Each channel's median over the cells of `mask`; NaN where it holds none."""
    if not mask.any():
        return np.full(stack.shape[0], np.nan)
    return np.median(stack[:, mask], axis=1)


def read(
    scene: mosaic.Scene, grid: mosaic.Grid, inside: np.ndarray, min_clear: float
) -> Acquisition:
    """
    One acquisition's six medians over the area's clear cells.

    A cell counts where it is inside the area, the scene classification calls
    it clear (mosaic.usable), every band has data, and every channel is finite.
    The bands are reflectance, the BOA offset added to the digital numbers and
    the sum divided by QUANTIFICATION_VALUE. The SCL is read by nearest
    neighbour and the bands bilinearly, as everywhere in terra.imagery.

    The classification is read first and alone. Where it already leaves less
    than `min_clear` of the area clear the bands are not read: the fraction can
    only fall once they are, and the model drops such a date either way. Most
    dates of a rainy season are such dates.
    """
    n_area = int(inside.sum())
    scl = mosaic.read_asset(scene.items, 'SCL', grid, Resampling.nearest, np.uint8)
    clear = inside & mosaic.usable(scl)
    if not n_area or float(clear.sum()) / n_area < min_clear:
        fraction = float(clear.sum()) / n_area if n_area else 0.0
        return Acquisition(scene.date, fraction, np.full(CHANNELS, np.nan))
    dn = {
        b: mosaic.read_asset(scene.items, b, grid, Resampling.bilinear, np.uint16).astype(np.float32)
        for b in BANDS
    }
    has_data = np.all([v > 0 for v in dn.values()], axis=0)
    offset = mosaic.boa_offset(scene)
    refl = {b: (v + offset) / sentinel2.QUANTIFICATION_VALUE for b, v in dn.items()}
    with np.errstate(invalid='ignore', divide='ignore'):
        ndvi = indices.calculate_ndvi(refl['B08'], refl['B04'])
        evi = indices.calculate_evi(refl['B08'], refl['B04'], refl['B02'])
    stack = np.stack([refl['B02'], refl['B03'], refl['B04'], refl['B08'], ndvi, evi])
    counted = clear & has_data & np.isfinite(stack).all(0)
    return Acquisition(
        date=scene.date,
        clear_fraction=int(counted.sum()) / float(n_area),
        values=medians(stack, counted),
    )
