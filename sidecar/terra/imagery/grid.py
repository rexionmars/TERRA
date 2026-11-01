"""
The reference grid: its pixel size, its extent, and putting another raster on it.

Every run reads its bands onto one grid, taken from one band of one date, so a
temporal statistic compares the same pixel to itself. These are the three
things the rest of the application asks about that grid once it exists.
"""

from __future__ import annotations

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.warp import Resampling, reproject


def reproject_to_reference(source_path, ref_profile, ref_band_data):
    """
    Reproject a categorical raster onto the reference grid, masked to its
    valid cells.

    Nearest neighbour, because the values are class codes and an interpolation
    between two of them is a third class that neither cell holds. Cells the
    reference band reports as empty are set to zero, so a class does not appear
    where no imagery was read.

    It was called reproject_mapbiomas_to_grid, which named what its caller
    passed it and not what it does: nothing here depends on the raster being
    MapBiomas, only on its values being classes.
    """
    with rasterio.open(source_path) as src:
        data = src.read(1)
        transform = src.transform
        crs = src.crs
    dst = np.zeros((ref_profile['height'], ref_profile['width']), dtype=np.uint8)
    reproject(
        source=data.astype(np.uint8), destination=dst,
        src_transform=transform, src_crs=crs,
        dst_transform=ref_profile['transform'], dst_crs=ref_profile['crs'],
        resampling=Resampling.nearest,
    )
    dst[~(ref_band_data > 0)] = 0
    return dst


def reference_pixel_size_m(profile):
    """
    The side of one pixel of the reference grid, in metres.

    Read off the grid rather than assumed. Every consumer that turns a pixel
    count into an area needs this number, and the two that already do --
    class_statistics for hectares and the brush probe in the studio -- each
    carried their own copy of the literal 10.

    A projected grid is read as it stands. The reference grid comes from a
    Sentinel-2 COG in UTM, so its transform is already in metres, and a
    degrees-to-metres conversion applied to it would multiply this grid by
    111320. The geographic branch below exists for a local product that is not
    in metres, and is an approximation at the grid's own latitude.
    """
    transform = profile['transform']
    side = abs(float(transform.a))
    crs = profile.get('crs')
    if crs is not None and getattr(crs, 'is_geographic', False):
        lat = float(transform.f) + 0.5 * float(transform.e) * profile['height']
        return side * 111_320.0 * float(np.cos(np.radians(lat)))
    return side


def map_corners(crs, left, bottom, right, top):
    """
    A raster's four corners in lon/lat, clockwise from the top left.

    A UTM grid does not run along the meridians: away from its central meridian
    grid north differs from true north, by about a degree at Cascavel. A lon/lat
    box cannot say that, so a raster stretched across one is drawn turned, by more
    the larger the area. These are what it has to be pinned to. Its pixels are
    untouched: this is about where they are drawn, not what they measure.
    """
    to_lonlat = Transformer.from_crs(crs, 'EPSG:4326', always_xy=True)
    return [
        [float(v) for v in to_lonlat.transform(x, y)]
        for x, y in ((left, top), (right, top), (right, bottom), (left, bottom))
    ]


def profile_corners(profile):
    """`map_corners` of a rasterio-like profile."""
    t = profile['transform']
    left, top = t.c, t.f
    right = left + profile['width'] * t.a
    bottom = top + profile['height'] * t.e
    return map_corners(profile['crs'], left, bottom, right, top)


def get_map_extent(profile):
    """Compute the EPSG:4326 lat/lon extent from a raster profile (from notebooks)."""
    t = profile['transform']
    h, w = profile['height'], profile['width']
    left = t.c
    top = t.f
    right = left + w * t.a
    bottom = top + h * t.e
    transformer = Transformer.from_crs(profile['crs'], 'EPSG:4326', always_xy=True)
    lon_min, lat_min = transformer.transform(left, bottom)
    lon_max, lat_max = transformer.transform(right, top)
    return lon_min, lon_max, lat_min, lat_max
