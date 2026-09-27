"""
The arithmetic of an overlap: features cut to the area, measured in hectares,
and PRODES years placed against the two cutoffs.

Areas are measured in a Lambert azimuthal equal-area projection centred on the
area, which preserves area on the GRS80 ellipsoid (Snyder, 1987). The
registers publish in WGS84 or SIRGAS 2000, which differ by less than a metre
and are read as one.

A register's overlap with the area is the area of the UNION of its features
inside the area, not the sum: CAR registrations and PRODES polygons of
successive years overlap one another, and a sum would count their shared
ground twice. Each feature's own overlap is reported beside it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from shapely import make_valid
from shapely.geometry import Polygon, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform, unary_union

M2_PER_HA = 10_000.0
# An overlap below this, in hectares, is a sliver of two outlines drawn from
# different sources along one line, not ground the area shares with a feature:
# 10 m^2, one tenth of a 10 m Sentinel-2 cell.
MIN_OVERLAP_HA = 0.001

FOREST_CODE_CUTOFF = '2008-07-22'
EUDR_CUTOFF = '2020-12-31'


class EqualArea:
    """A lon/lat geometry to metres, in the equal-area plane of one area."""

    def __init__(self, lon: float, lat: float) -> None:
        from pyproj import CRS, Transformer

        crs = CRS.from_proj4(f'+proj=laea +lat_0={lat} +lon_0={lon} +ellps=GRS80 +units=m +no_defs')
        self._fwd = Transformer.from_crs('EPSG:4326', crs, always_xy=True).transform
        # Back to lon/lat, for the map, which is drawn on a lon/lat grid.
        self.inverse = Transformer.from_crs(crs, 'EPSG:4326', always_xy=True).transform

    def __call__(self, geom: BaseGeometry) -> BaseGeometry:
        return transform(self._fwd, geom)


def polygonal(geom: BaseGeometry) -> BaseGeometry:
    """
    A geometry repaired and reduced to its polygons.

    Registers publish self-intersecting rings (CAR boundaries drawn by hand
    most often); make_valid splits them into valid parts, which can include
    lines where a ring touched itself. Only area counts here.
    """
    if not geom.is_valid:
        geom = make_valid(geom)
    if geom.geom_type in ('Polygon', 'MultiPolygon'):
        return geom
    parts = [g for g in getattr(geom, 'geoms', []) if g.geom_type in ('Polygon', 'MultiPolygon')]
    return unary_union(parts) if parts else Polygon()


@dataclass
class Cut:
    """One feature inside the area: its attributes and its part in metres."""

    properties: dict[str, Any]
    part_m: BaseGeometry

    @property
    def ha(self) -> float:
        return float(self.part_m.area) / M2_PER_HA


def cut(features: list[dict[str, Any]], area_m: BaseGeometry, to_m: EqualArea) -> list[Cut]:
    """The features that share ground with the area, each cut to it."""
    out: list[Cut] = []
    for f in features:
        g = f.get('geometry')
        if not g:
            continue
        try:
            geom = polygonal(to_m(shape(g)))
        except Exception:  # an unreadable ring is one feature lost, not the register
            continue
        if geom.is_empty or not geom.intersects(area_m):
            continue
        part = polygonal(geom.intersection(area_m))
        c = Cut(properties=f.get('properties') or {}, part_m=part)
        if c.ha >= MIN_OVERLAP_HA:
            out.append(c)
    return out


def union_ha(cuts: list[Cut]) -> float:
    if not cuts:
        return 0.0
    return float(unary_union([c.part_m for c in cuts]).area) / M2_PER_HA


# --- PRODES years against the cutoffs --------------------------------------
#
# A PRODES year t is the clearing seen between the images of the previous
# mapping and the images of t, which are taken in the dry season, around
# August. In an annual series year t covers about August t-1 to July t, so:
#
#   t <= 2008          before 22 July 2008
#   2009 <= t <= 2020  after the Forest Code date and before the EUDR cutoff
#   t = 2021           August 2020 to July 2021: STRADDLES 31 December 2020,
#                      and nothing in the polygon says on which side
#   t >= 2022          after the EUDR cutoff
#
# Before 2013 the Cerrado series, and in several years the other non-Amazon
# series, were mapped every two years, so a year of theirs covers two dry
# seasons. The periods below are the annual reading; the card states it.

PERIODS: list[tuple[str, str, int, int]] = [
    ('before_forest_code', 'PRODES up to 2008: before 22 Jul 2008', 0, 2008),
    ('forest_code_to_eudr', 'PRODES 2009 to 2020: after 22 Jul 2008, before 31 Dec 2020', 2009, 2020),
    ('straddles_eudr', 'PRODES 2021: Aug 2020 to Jul 2021, across 31 Dec 2020', 2021, 2021),
    ('after_eudr', 'PRODES 2022 onwards: after 31 Dec 2020', 2022, 9999),
]


def prodes_periods(cuts: list[Cut]) -> list[dict[str, Any]]:
    """Hectares of PRODES clearing inside the area in each period, as a union."""
    out = []
    for pid, label, lo, hi in PERIODS:
        inside = []
        for c in cuts:
            try:
                year = int(c.properties.get('year') or 0)
            except (TypeError, ValueError):
                year = 0
            if year and lo <= year <= hi:
                inside.append(c)
        out.append({'id': pid, 'label': label, 'ha': round(union_ha(inside), 4)})
    return out
