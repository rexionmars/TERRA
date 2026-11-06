"""
The sun and viewing angles of a Sentinel-2 scene at a point, from the tile's
metadata (MTD_TL.xml).

The tile metadata gives each angle on a grid of nodes 5 km apart: the sun's
zenith and azimuth on one grid, and the viewing zenith and azimuth on one grid
per band and detector, empty where that detector does not see. The answer here
is taken at the node nearest the point, which is within 3.6 km of it. Across a
tile the viewing zenith changes by about 0.1 degree per kilometre, so the node
stands for the point to a fraction of a degree.

THE TILE'S MEAN VIEWING AZIMUTH IS NOT A SUBSTITUTE. Detectors either side of
the swath look from opposite directions, so the azimuth differs by about 180
degrees from one side to the other, and a mean over the tile is a direction no
detector looked from. That is why the grids are read, not the means beside
them.

Several detectors can see one node where their footprints overlap, and the
angle is then the mean over them and over the bands -- the "mean" viewing
angles ESA's SNAP biophysical processor takes. Azimuths are averaged as
directions (Fisher 1993, Statistical Analysis of Circular Data), so 359 and 1
degree average to 0 and not to 180.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import numpy as np
from pyproj import Transformer

# Grid spacing of the angle grids in the tile metadata, in metres.
GRID_STEP_M = 5000.0


@dataclass(frozen=True)
class Angles:
    """Degrees, at one point of one scene."""

    sun_zenith: float
    sun_azimuth: float
    view_zenith: float
    view_azimuth: float


def _local(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def _child(node: ET.Element, name: str) -> ET.Element | None:
    for c in node:
        if _local(c.tag) == name:
            return c
    return None


def _grid(node: ET.Element) -> np.ndarray:
    """The VALUES rows of an angle grid as a float array, NaN where empty."""
    values = _child(node, 'Values_List')
    if values is None:
        raise ValueError('an angle grid without Values_List')
    rows = [
        [float(v) for v in (row.text or '').split()]
        for row in values
        if _local(row.tag) == 'VALUES'
    ]
    return np.array(rows, dtype=np.float64)


def _circular_mean(degrees: list[float]) -> float:
    r = np.radians(degrees)
    return float(np.degrees(np.arctan2(np.sin(r).mean(), np.cos(r).mean())) % 360.0)


def angles_at(xml_text: str, lon: float, lat: float) -> Angles:
    """
    The angles at a point of the tile described by `xml_text`.

    Raises ValueError where the metadata lacks a grid, where the point lies off
    the tile, or where no detector saw the node nearest it.
    """
    root = ET.fromstring(xml_text)
    geocoding = next((n for n in root.iter() if _local(n.tag) == 'Tile_Geocoding'), None)
    if geocoding is None:
        raise ValueError('the tile metadata has no Tile_Geocoding')
    code = _child(geocoding, 'HORIZONTAL_CS_CODE')
    position = next(
        (
            n
            for n in geocoding
            if _local(n.tag) == 'Geoposition' and n.get('resolution') == '10'
        ),
        None,
    )
    if code is None or position is None:
        raise ValueError('the tile metadata has no 10 m Geoposition')
    ulx_node, uly_node = _child(position, 'ULX'), _child(position, 'ULY')
    if ulx_node is None or uly_node is None:
        raise ValueError('the tile Geoposition has no ULX or ULY')
    ulx, uly = float(ulx_node.text or 'nan'), float(uly_node.text or 'nan')
    to_tile = Transformer.from_crs('EPSG:4326', (code.text or '').strip(), always_xy=True)
    x, y = to_tile.transform(lon, lat)
    col = int(round((x - ulx) / GRID_STEP_M))
    row = int(round((uly - y) / GRID_STEP_M))

    def at(grid: np.ndarray) -> float:
        if not (0 <= row < grid.shape[0] and 0 <= col < grid.shape[1]):
            raise ValueError('the point lies off the tile')
        return float(grid[row, col])

    sun = next((n for n in root.iter() if _local(n.tag) == 'Sun_Angles_Grid'), None)
    sun_zenith = sun_azimuth = math.nan
    if sun is not None:
        zen, azi = _child(sun, 'Zenith'), _child(sun, 'Azimuth')
        if zen is not None and azi is not None:
            sun_zenith, sun_azimuth = at(_grid(zen)), at(_grid(azi))
    if not (math.isfinite(sun_zenith) and math.isfinite(sun_azimuth)):
        raise ValueError('the tile metadata gives no sun angle at the point')

    zeniths: list[float] = []
    azimuths: list[float] = []
    for grids in root.iter():
        if _local(grids.tag) != 'Viewing_Incidence_Angles_Grids':
            continue
        zen, azi = _child(grids, 'Zenith'), _child(grids, 'Azimuth')
        if zen is None or azi is None:
            continue
        z, a = at(_grid(zen)), at(_grid(azi))
        if math.isfinite(z) and math.isfinite(a):
            zeniths.append(z)
            azimuths.append(a)
    if not zeniths:
        raise ValueError('no detector of the tile saw the point')
    return Angles(
        sun_zenith=sun_zenith,
        sun_azimuth=sun_azimuth,
        view_zenith=float(np.mean(zeniths)),
        view_azimuth=_circular_mean(azimuths),
    )


def fetch_metadata(href: str, timeout_s: float = 60.0) -> str:
    """The tile metadata at a signed href, as text."""
    import requests

    response = requests.get(href, timeout=timeout_s)
    response.raise_for_status()
    return response.text
