"""
A 10 m UTM grid over an area, and Sentinel-2 acquisitions mosaicked onto it with
their scene classification.

Moved out of terra.fields, which wrote it for the field delineation, when the
vegetation health product needed the same reading: products do not reach into
each other (pyproject, import-linter), and a reader two products share belongs
in the layer below them.

WHY A GRID OF ITS OWN rather than one taken from a scene clipped to the polygon.
That grid reads everything outside the polygon as zero, which draws an
artificial edge along the area, and keeps one tile per date, so an area over a
tile boundary loses the strip on the other side. This grid covers the area's
bounding box plus a margin, in the UTM zone of its centre, at 10 m on multiples
of 10 m -- the lattice every Sentinel-2 tile in that zone is on, so a same-zone
scene is read without resampling -- and every item of one date and relative
orbit is mosaicked onto it.

THE SCENE CLASSIFICATION IS WHAT SAYS WHETHER A CELL WAS SEEN. The scene-level
cloud cover is a statement about a 110 km tile; an area can be clear under a
cloudy tile and covered under a clear one, so each acquisition is judged by the
SCL band over the area itself.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import rasterio
import rasterio.features
from pyproj import CRS, Transformer
from rasterio.transform import Affine, from_origin
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds
from shapely.ops import transform as shp_transform

from terra import stac

COLLECTION = 'sentinel-2-l2a'
PIXEL_M = 10.0

# Scene classification values that are not ground seen clearly: no data,
# saturated or defective, cloud shadow, cloud of medium and high probability,
# and thin cirrus (Sentinel-2 L2A product specification, SCL legend).
SCL_UNUSABLE = (0, 1, 3, 8, 9, 10)


@dataclass(frozen=True)
class Grid:
    crs: CRS
    transform: Affine
    width: int
    height: int

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        left, top = self.transform.c, self.transform.f
        return (left, top - self.height * PIXEL_M, left + self.width * PIXEL_M, top)

    def profile(self) -> dict[str, Any]:
        return {
            'crs': self.crs,
            'transform': self.transform,
            'width': self.width,
            'height': self.height,
        }


def utm_crs(lon: float, lat: float) -> CRS:
    zone = min(60, int((lon + 180.0) // 6.0) + 1)
    return CRS.from_epsg((32600 if lat >= 0 else 32700) + zone)


def to_grid_crs(polygon, crs: CRS):
    """`polygon`, in WGS84 degrees, in `crs`."""
    to_crs = Transformer.from_crs('EPSG:4326', crs, always_xy=True)
    return shp_transform(to_crs.transform, polygon)


def reference_grid(polygon, buffer_m: float) -> Grid:
    """A 10 m UTM grid over the polygon's bounding box plus `buffer_m`."""
    lon, lat = polygon.centroid.coords[0]
    crs = utm_crs(lon, lat)
    minx, miny, maxx, maxy = to_grid_crs(polygon, crs).bounds
    minx = math.floor((minx - buffer_m) / PIXEL_M) * PIXEL_M
    miny = math.floor((miny - buffer_m) / PIXEL_M) * PIXEL_M
    maxx = math.ceil((maxx + buffer_m) / PIXEL_M) * PIXEL_M
    maxy = math.ceil((maxy + buffer_m) / PIXEL_M) * PIXEL_M
    return Grid(
        crs=crs,
        transform=from_origin(minx, maxy, PIXEL_M, PIXEL_M),
        width=int(round((maxx - minx) / PIXEL_M)),
        height=int(round((maxy - miny) / PIXEL_M)),
    )


def area_mask(polygon, grid: Grid):
    """True on the grid cells whose centre falls inside the polygon."""
    return rasterio.features.geometry_mask(
        [to_grid_crs(polygon, grid.crs)],
        out_shape=(grid.height, grid.width),
        transform=grid.transform,
        invert=True,
    )


@dataclass
class Scene:
    """One acquisition over the grid: every item of one date and orbit."""

    date: str
    items: list[Any]
    cloud_cover: float
    # Filled when the scene is measured.
    clear_fraction: float | None = None
    scl: np.ndarray | None = field(default=None, repr=False)

    @property
    def item_ids(self) -> list[str]:
        return [it.id for it in self.items]

    def summary(self) -> dict[str, Any]:
        return {
            'date': self.date,
            'items': self.item_ids,
            'cloud_cover': round(self.cloud_cover, 2),
            'clear_fraction': (
                round(self.clear_fraction, 4) if self.clear_fraction is not None else None
            ),
        }


def group_scenes(items: list[Any], bands: tuple[str, ...]) -> list[Scene]:
    """
    Items grouped into acquisitions, least cloudy first.

    One acquisition is one date and one relative orbit: tiles of one datatake
    are the same pass cut into squares, and a mosaic of them is one image. Two
    orbits on one date are two passes and are kept apart. An item lacking any
    of `bands` or the scene classification is left out, since it cannot be read
    or cannot be judged.
    """
    groups: dict[tuple[str, Any], list[Any]] = {}
    for it in items:
        if any(b not in it.assets for b in (*bands, 'SCL')):
            continue
        key = (
            str(it.properties.get('datetime', ''))[:10],
            it.properties.get('sat:relative_orbit'),
        )
        groups.setdefault(key, []).append(it)
    scenes = [
        Scene(
            date=date,
            items=sorted(members, key=lambda i: i.id),
            cloud_cover=max(float(i.properties.get('eo:cloud_cover', 0.0)) for i in members),
        )
        for (date, _orbit), members in groups.items()
    ]
    scenes.sort(key=lambda s: (s.cloud_cover, s.date))
    return scenes


def search_scenes(
    grid: Grid, start: str, end: str, max_cloud: float, bands: tuple[str, ...]
) -> list[Scene]:
    """The acquisitions over the grid in the period that carry `bands` and the SCL."""
    bbox = transform_bounds(grid.crs, 'EPSG:4326', *grid.bounds, densify_pts=21)
    items = stac.search(
        COLLECTION,
        bbox=bbox,
        datetime=f'{start}/{end}',
        query={'eo:cloud_cover': {'lt': max_cloud}},
    )
    return group_scenes(items, bands)


def source_window(src, grid: Grid) -> Window:
    """The source window covering the grid, one pixel wider on every side."""
    left, bottom, right, top = transform_bounds(
        grid.crs, src.crs, *grid.bounds, densify_pts=21
    )
    win = from_bounds(left, bottom, right, top, transform=src.transform)
    col = math.floor(win.col_off) - 1
    row = math.floor(win.row_off) - 1
    return Window(
        col, row, math.ceil(win.width) + 3, math.ceil(win.height) + 3
    )


def item_epsg(item) -> int | None:
    epsg = item.properties.get('proj:epsg')
    if epsg:
        return int(epsg)
    code = str(item.properties.get('proj:code') or '')
    return int(code.split(':')[1]) if code.upper().startswith('EPSG:') else None


def read_asset(items: list[Any], asset: str, grid: Grid, resampling, dtype) -> np.ndarray:
    """
    One asset of every item mosaicked onto the grid; zero where none covers.

    Zero is the Sentinel-2 L2A no-data value for bands and scene
    classification alike. Where two tiles of one pass overlap they hold the
    same observation, so the first non-zero value is kept -- and the tiles in
    the grid's own UTM zone go first, because theirs is read without
    resampling while a neighbouring zone's has to be warped onto the grid.
    """
    out = np.zeros((grid.height, grid.width), dtype=dtype)
    own = grid.crs.to_epsg()
    for it in sorted(items, key=lambda i: (item_epsg(i) != own, i.id)):
        with rasterio.open(it.assets[asset].href) as src:
            win = source_window(src, grid)
            data = src.read(1, window=win, boundless=True, fill_value=0)
            tile = np.zeros_like(out)
            reproject(
                source=data,
                destination=tile,
                src_transform=src.window_transform(win),
                src_crs=src.crs,
                src_nodata=0,
                dst_transform=grid.transform,
                dst_crs=grid.crs,
                dst_nodata=0,
                resampling=resampling,
            )
        empty = out == 0
        out[empty] = tile[empty]
    return out


def usable(scl: np.ndarray) -> np.ndarray:
    """True where the scene classification says the ground was seen clearly."""
    return ~np.isin(scl, SCL_UNUSABLE)
