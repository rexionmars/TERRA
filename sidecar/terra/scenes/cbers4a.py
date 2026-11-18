"""
CBERS-4A true colour at 2 m over an area, from INPE's Brazil Data Cube.

INPE publishes the WPM camera's red, green and blue bands fused with its 2 m
panchromatic band (principal components fusion) as collection
CB4A-WPM-PCA-FUSED-1 of its STAC API: one cloud-optimised GeoTIFF per scene,
three 8-bit bands, 0 as no data, on a UTM grid of WGS 84, under CC BY 4.0. On
2026-11-17 a scene of 56,254 by 57,850 pixels (3.4 GB) opened without a login
in 0.5 s and a 1 km window of it read in 0.2 s, through its overviews.

THE FOOTPRINT IS NOT THE IMAGE. An item's geometry is the rectangle of its
grid; the camera's strip runs tilted across that rectangle and fills about two
thirds of it (67.5 % of one scene), so a scene the catalogue lists over an
area can hold no pixel of it. Each scene is therefore read over the area at a
coarse overview and listed with the share of the area it actually covers, and
one that covers none is left out.

NO CLOUD COVER. The catalogue's eo:cloud_cover is empty on these items, so a
cloudy scene is seen only once it is drawn. And the camera sees a place about
once a month, which is why the list is short.

The fused bands are only red, green and blue: there is no near-infrared at
2 m, so no vegetation index is drawn from this collection.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

import numpy as np

from terra import stac

STAC_URL = 'https://data.inpe.br/bdc/stac/v1'
COLLECTION = 'CB4A-WPM-PCA-FUSED-1'
ASSET = 'tci'
# TERRA's name for the collection, as imagery_source carries it.
TERRA_COLLECTION = 'cbers-4a-wpm'
TITLE = 'INPE Brazil Data Cube'
# Pixels on the long side of the area when its coverage is checked. Read from
# an overview, so a scene costs a few kilobytes whatever the area's size.
COVERAGE_PX = 96
# The most pixels on the long side of a drawn view. An area 8 km across is
# 4,000 pixels at 2 m; a larger one is read from an overview, and the pixel
# size the view was drawn at is in its meta.
MAX_PX = 4096
# Scenes checked at once.
READERS = 8


@dataclass
class Scene:
    id: str
    date: str
    href: str
    preview: str
    coverage: float


def path_row(scene_id: str) -> str:
    """
    The orbit path and row of a scene, from its id: INPE names a scene
    CBERS4A_WPM_PCA_RGB321_<date>_<path>_<row>.
    """
    parts = scene_id.split('_')
    return f'{parts[-2]}/{parts[-1]}' if len(parts) >= 3 else ''


def imagery_source() -> list[dict[str, str]]:
    """Where the scenes came from, in the shape every view reports it."""
    return [{
        'collection': TERRA_COLLECTION,
        'source': 'inpe',
        'title': TITLE,
        'url': STAC_URL,
        'catalogue_collection': COLLECTION,
    }]


def _items(polygon: Any, start: str, end: str) -> list[Any]:
    """
    The catalogue's items whose grid touches the area in the period.

    Asked again on failure, as every catalogue is (stac.with_retries): INPE's
    gateway answered 502 to one listing on 2026-11-18 and the next one worked.
    """
    from pystac_client import Client
    from shapely.geometry import shape

    def once() -> list[Any]:
        client = Client.open(STAC_URL)
        search = client.search(
            collections=[COLLECTION],
            bbox=list(polygon.bounds),
            datetime=f'{start}T00:00:00Z/{end}T23:59:59Z',
            max_items=500,
        )
        return list(search.items())

    items: list[Any] = stac.with_retries(once, TITLE)
    return [it for it in items if shape(it.geometry).intersects(polygon)]


def _window(ds: Any, polygon: Any) -> tuple[Any, Any]:
    """The area's window on the scene's grid, and the area in the scene's CRS."""
    from rasterio.warp import transform_geom
    from rasterio.windows import from_bounds
    from shapely.geometry import mapping, shape

    local = shape(transform_geom('EPSG:4326', ds.crs, mapping(polygon)))
    win = from_bounds(*local.bounds, transform=ds.transform)
    win = win.round_offsets().round_lengths()
    return win, local


def _read(ds: Any, polygon: Any, long_side: int) -> tuple[np.ndarray, np.ndarray, Any]:
    """
    The scene's three bands over the area, at most `long_side` pixels across,
    whether each pixel is inside the area, and the grid they lie on.

    Read with `boundless`, so an area reaching past the scene's edge comes back
    as no data there rather than as an error.
    """
    from rasterio.enums import Resampling
    from rasterio.features import geometry_mask
    from rasterio.transform import Affine

    win, local = _window(ds, polygon)
    width, height = max(int(win.width), 1), max(int(win.height), 1)
    scale = max(width, height) / long_side if max(width, height) > long_side else 1.0
    out_w, out_h = max(int(round(width / scale)), 1), max(int(round(height / scale)), 1)
    bands = ds.read(
        window=win, out_shape=(3, out_h, out_w), boundless=True, fill_value=0,
        resampling=Resampling.average,
    )
    transform = ds.window_transform(win) @ Affine.scale(width / out_w, height / out_h)
    inside = geometry_mask([local], out_shape=(out_h, out_w), transform=transform, invert=True)
    return bands, inside, transform


def _coverage(href: str, polygon: Any) -> float:
    """The share of the area where the scene has data, from a coarse read."""
    import rasterio

    with rasterio.open(href) as ds:
        bands, inside, _ = _read(ds, polygon, COVERAGE_PX)
    if not inside.any():
        return 0.0
    data = (bands > 0).any(axis=0)
    return float((data & inside).sum() / inside.sum())


def list_scenes(polygon: Any, start: str, end: str) -> list[Scene]:
    """
    The scenes of the period with data over the area, newest first, each with
    the share of the area it covers.
    """
    from terra.imagery import cog

    cog.configure()
    items = _items(polygon, start, end)

    def check(it: Any) -> Scene | None:
        asset = it.assets.get(ASSET)
        if asset is None:
            return None
        share = _coverage(asset.href, polygon)
        if share <= 0:
            return None
        thumb = it.assets.get('thumbnail')
        return Scene(
            id=it.id,
            date=it.datetime.strftime('%Y-%m-%d') if it.datetime else '',
            href=asset.href,
            preview=thumb.href if thumb is not None else '',
            coverage=round(share, 4),
        )

    with ThreadPoolExecutor(max_workers=READERS) as pool:
        found = [s for s in pool.map(check, items) if s is not None]
    return sorted(found, key=lambda s: s.date, reverse=True)


def find(scene_id: str) -> Any:
    """The catalogue's item for a scene id, or None."""
    from pystac_client import Client

    def once() -> list[Any]:
        client = Client.open(STAC_URL)
        return list(client.search(collections=[COLLECTION], ids=[scene_id], max_items=1).items())

    found: list[Any] = stac.with_retries(once, TITLE)
    return found[0] if found else None


@dataclass
class View:
    rgba: np.ndarray
    profile: dict[str, Any]
    coverage: float
    pixel_m: float


def view(href: str, polygon: Any, stretch_lo: float, stretch_hi: float) -> View:
    """
    The scene over the area as an RGBA image on the scene's own grid, cut to
    the area's outline, each band stretched between its percentiles inside it.

    Transparent outside the outline and where the scene has no data, so a
    scene covering part of the area is drawn as that part.
    """
    import rasterio

    from terra.imagery import cog
    from terra.imagery.composite import percentile_stretch

    cog.configure()
    with rasterio.open(href) as ds:
        bands, inside, transform = _read(ds, polygon, MAX_PX)
        crs = ds.crs
    data = (bands > 0).any(axis=0)
    shown = inside & data
    h, w = shown.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for i in range(3):
        stretched = percentile_stretch(bands[i].astype(np.float32), shown, stretch_lo, stretch_hi)
        rgba[:, :, i] = np.round(stretched * 255).astype(np.uint8)
    rgba[:, :, 3] = np.where(shown, 255, 0).astype(np.uint8)
    coverage = float(shown.sum() / inside.sum()) if inside.any() else 0.0
    profile = {'crs': crs, 'transform': transform, 'width': w, 'height': h}
    return View(rgba=rgba, profile=profile, coverage=coverage, pixel_m=float(abs(transform.a)))
