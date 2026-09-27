"""
The grid a delineation is read onto, and the two scenes read onto it.

WHY TWO DATES. Two adjacent fields sown with one crop on one day have one
spectrum on any single date; what separates them is that they rarely stay
alike across a season. The FTW checkpoints were trained on a pair -- window A
near planting, window B near harvest -- and take the two scenes stacked as
eight channels, B04 B03 B02 B08 of A then of B (ftw-baselines README, "Input
format"). One scene per window, the clearest over the area.

THE GRID AND THE MOSAIC are terra.imagery.mosaic's, which says why the area
is read onto a UTM grid of its own rather than the classification's: a field
crossing the area's edge or a tile boundary would otherwise be cut. The
polygons are clipped to the area afterwards (see polygons.py).

WHY DN / 3000 AND NO OFFSET. ftw-tools feeds its networks the digital numbers
divided by 3000 (ftw_tools/inference/inference.py, default_preprocess), read
from the Planetary Computer, which does not remove the baseline 04.00 offset.
That is the convention the weights were fitted under, the same situation
imagery.sentinel2.as_trained records for the classification heads with a
different divisor; converting to reflectance first would hand the network a
range it never saw.
"""

from __future__ import annotations

import numpy as np
from rasterio.warp import Resampling

from terra.imagery import mosaic
from terra.imagery.mosaic import (
    COLLECTION,
    PIXEL_M,
    SCL_UNUSABLE,
    Grid,
    Scene,
    area_mask,
    read_asset,
    reference_grid,
    to_grid_crs,
    usable,
    utm_crs,
)

__all__ = [
    'BANDS',
    'CLEAR_ENOUGH',
    'COLLECTION',
    'MAX_CANDIDATES',
    'NORMALISER',
    'PIXEL_M',
    'SCL_UNUSABLE',
    'Grid',
    'Scene',
    'area_mask',
    'choose',
    'group_scenes',
    'measure',
    'network_input',
    'read_asset',
    'read_bands',
    'reference_grid',
    'search_scenes',
    'to_grid_crs',
    'usable',
    'utm_crs',
]

# Channel order of each window in the network input.
BANDS = ('B04', 'B03', 'B02', 'B08')
NORMALISER = 3000.0

# Scenes whose clear fraction is measured per window, least cloudy first. The
# scene-level cloud cover is a statement about a 110 km tile; the area can be
# clear under a cloudy tile and covered under a clear one, so a few are read.
MAX_CANDIDATES = 8
# A scene this clear over the area ends the search early.
CLEAR_ENOUGH = 0.999


def group_scenes(items: list) -> list[Scene]:
    """The items grouped into acquisitions that carry the four network bands."""
    return mosaic.group_scenes(items, BANDS)


def search_scenes(grid: Grid, start: str, end: str, max_cloud: float) -> list[Scene]:
    return mosaic.search_scenes(grid, start, end, max_cloud, BANDS)


def measure(scene: Scene, grid: Grid, inside: np.ndarray) -> float:
    """The fraction of the area this scene sees clearly. Keeps the SCL read."""
    scene.scl = read_asset(scene.items, 'SCL', grid, Resampling.nearest, np.uint8)
    n = int(inside.sum())
    scene.clear_fraction = float(usable(scene.scl)[inside].sum()) / n if n else 0.0
    return scene.clear_fraction


def choose(scenes: list[Scene], grid: Grid, inside: np.ndarray, note=None) -> Scene | None:
    """
    The clearest of the least cloudy few, by what the area itself shows.

    Ties go to the scene the catalogue ranked first, which is the lower
    scene-level cloud cover.
    """
    best: Scene | None = None
    for scene in scenes[:MAX_CANDIDATES]:
        frac = measure(scene, grid, inside)
        if note:
            note(f'{scene.date}: {100 * frac:.1f}% of the area clear')
        if best is None or frac > (best.clear_fraction or 0.0):
            best = scene
        if frac >= CLEAR_ENOUGH:
            break
    return best


def read_bands(scene: Scene, grid: Grid) -> np.ndarray:
    """(4, H, W) float32 digital numbers, in BANDS order."""
    return np.stack([
        read_asset(scene.items, band, grid, Resampling.bilinear, np.uint16).astype(np.float32)
        for band in BANDS
    ])


def network_input(bands_a: np.ndarray, bands_b: np.ndarray) -> np.ndarray:
    """The eight channels the checkpoints take, in the scale they were fitted on."""
    return (np.concatenate([bands_a, bands_b], axis=0) / NORMALISER).astype(np.float32)
