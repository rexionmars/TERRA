"""
ESA CCI Biomass, version 6.0: where its tiles are, and a window of them read
over an area.

The maps are global above-ground biomass at 100 m (0.000888 degree) for the
years in YEARS, in Mg/ha, with a standard deviation map per year. They are
estimated from L-band (ALOS-2 PALSAR-2) and C-band (Sentinel-1) backscatter
by GAMMA Remote Sensing for ESA's Climate Change Initiative, and published
under the ESA CCI data policy, free and open access, through CEDA.

The files are 10 by 10 degree GeoTIFFs named for their north-west corner
(S10W060 spans 10 to 20 degrees south and 60 to 50 west). They are stored in
strips, not tiles, so a window costs a read of every row it crosses, and are
read over HTTP range requests without downloading the file.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

BASE_URL = 'https://dap.ceda.ac.uk/neodc/esacci/biomass/data/agb/maps/v6.0/geotiff'
VERSION = '6.0'
YEARS = (2007, 2010, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022)
TILE_DEG = 10
# The sphere of equal area (authalic) radius, for a cell's area in hectares.
EARTH_RADIUS_M = 6_371_007.2


def tile_name(top: int, left: int) -> str:
    """The name of the tile whose north-west corner is (top, left), in degrees."""
    ns = 'N' if top >= 0 else 'S'
    ew = 'E' if left >= 0 else 'W'
    return f'{ns}{abs(top):02d}{ew}{abs(left):03d}'


def tiles_over(lon_min: float, lat_min: float, lon_max: float, lat_max: float) -> list[tuple[int, int]]:
    """The (top, left) corners of every tile the box touches."""
    lefts = range(
        math.floor(lon_min / TILE_DEG) * TILE_DEG,
        math.floor(lon_max / TILE_DEG) * TILE_DEG + 1,
        TILE_DEG,
    )
    bottoms = range(
        math.floor(lat_min / TILE_DEG) * TILE_DEG,
        math.floor(lat_max / TILE_DEG) * TILE_DEG + 1,
        TILE_DEG,
    )
    return [(bottom + TILE_DEG, left) for bottom in bottoms for left in lefts]


def tile_url(year: int, top: int, left: int, deviation: bool = False) -> str:
    """The URL of one year's tile, of the biomass or of its standard deviation."""
    layer = 'AGB_SD' if deviation else 'AGB'
    return (
        f'{BASE_URL}/{year}/{tile_name(top, left)}_ESACCI-BIOMASS-L4-{layer}-MERGED-100m-'
        f'{year}-fv{VERSION}.tif'
    )


def cell_area_ha(transform, rows: int) -> np.ndarray:
    """
    The area of each row's cells, in hectares, on a geographic grid.

    A degree of longitude narrows towards the poles, so cells of one size in
    degrees differ in area from row to row: R^2 dlon (sin lat1 - sin lat2).
    """
    top = transform.f
    dlat = transform.e
    dlon = math.radians(transform.a)
    edges = np.radians(top + dlat * np.arange(rows + 1))
    return (EARTH_RADIUS_M**2 * dlon * np.abs(np.sin(edges[:-1]) - np.sin(edges[1:]))) / 10_000.0


@dataclass
class Window:
    values: np.ndarray  # float32, Mg/ha
    transform: object
    crs: str


def read(polygon, year: int, deviation: bool = False) -> Window:
    """The cells of one year's map over the polygon's bounding box, across tiles."""
    import rasterio
    from rasterio.merge import merge

    if year not in YEARS:
        raise ValueError(f'CCI Biomass {VERSION} has no map for {year}; one of {", ".join(map(str, YEARS))}')
    lon_min, lat_min, lon_max, lat_max = polygon.bounds
    sources = [
        rasterio.open('/vsicurl/' + tile_url(year, top, left, deviation))
        for top, left in tiles_over(lon_min, lat_min, lon_max, lat_max)
    ]
    try:
        # One cell of margin, so a cell the boundary crosses is read whole.
        pad = abs(sources[0].res[0])
        mosaic, transform = merge(
            sources, bounds=(lon_min - pad, lat_min - pad, lon_max + pad, lat_max + pad)
        )
    finally:
        for src in sources:
            src.close()
    return Window(values=mosaic[0].astype(np.float32), transform=transform, crs='EPSG:4326')
