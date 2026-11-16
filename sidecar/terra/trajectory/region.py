"""
The region whose interval scale a field takes: the state its centroid lies in,
among those a gp_series model was calibrated on.

A model's parameters hold one scale per region it was fitted on (Bahia, Mato
Grosso and Paraná for gp_series 0.1.0) and one global scale. The outlines are
IBGE's, simplified by tools/build_regions.py into data/regions.json, which
says how far they may sit from the published mesh.

IN DOUBT, NO REGION. A centroid within MARGIN_M of an outline is given none,
and the model then takes its global scale: a simplified outline cannot place
such a field on one side of a border, and the global scale was fitted on the
three regions together. Bounding boxes, as terra.overlap keeps them, were not
enough: those of the states overlap, and Luís Eduardo Magalhães, in western
Bahia, also falls in the box of Tocantins.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

from pyproj import CRS, Transformer
from shapely.geometry import Point, shape
from shapely.ops import transform as shp_transform

OUTLINES = Path(__file__).resolve().parent / 'data' / 'regions.json'
# Six times the largest distance between a simplified outline and the IBGE
# mesh it came from (331 m, tools/build_regions.py).
MARGIN_M = 2000.0


@cache
def outlines() -> dict[str, Any]:
    """Each region's outline in WGS84 degrees, by its code ('BA', 'MT', 'PR')."""
    raw = json.loads(OUTLINES.read_text(encoding='utf-8'))
    return {f['properties']['code']: shape(f['geometry']) for f in raw['features']}


def region_of(polygon: Any) -> str | None:
    """
    The code of the region holding the polygon's centroid at least MARGIN_M
    inside its outline, or None.

    The distance is measured in an azimuthal equidistant projection centred on
    the centroid, where a distance from the centre is the distance on the
    ellipsoid.
    """
    lon, lat = polygon.centroid.coords[0]
    centre = Point(lon, lat)
    for code, outline in outlines().items():
        if not outline.contains(centre):
            continue
        local = CRS.from_proj4(f'+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m')
        to_local = Transformer.from_crs('EPSG:4326', local, always_xy=True).transform
        border = shp_transform(to_local, outline.boundary)
        return code if border.distance(Point(0.0, 0.0)) >= MARGIN_M else None
    return None
