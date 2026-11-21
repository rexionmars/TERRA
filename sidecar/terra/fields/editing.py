"""
Fields corrected by hand: one field cut in two along a line, or neighbours
joined into one.

The delineation proposes fields and the reader reviews them, because the
network's polygons are not a farmer's fields (see the package docstring): two
plots sown alike come out as one, and one plot with a track across it comes
out as two. Moving vertices and deleting a field need no geometry beyond what
the map already does; cutting and joining do, and are done here, in the
field's own UTM zone, so that a tolerance in metres is one.

JOINING NEIGHBOURS ACROSS THE BOUNDARY STRIP. Two delineated neighbours never
touch. The network's boundary class lies between them and belongs to neither
(polygons.py), and the simplification moves each edge by up to 15 m, so a
union of two neighbours is two pieces. A join therefore fills the ground
between the fields where they are at most JOIN_GAP_M apart, and nothing
beyond it (_strip), so the rest of the joined field's edge is the edges the
fields had. Fields farther apart than that are refused, since a field is one
polygon (polygons.py) and two pieces cannot be one field.

The imports are kept to shapely and pyproj. The action runs while the reader
waits with the map in hand, and the raster stack the delineation needs would
double its start-up time for nothing it uses.
"""

from __future__ import annotations

import json
import math
import sys
from itertools import combinations
from pathlib import Path
from typing import Any

import numpy as np
import shapely
from pyproj import CRS, Transformer
from shapely import set_precision
from shapely.geometry import MultiPoint, Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import split as shp_split, transform as shp_transform, unary_union

from terra import protocol

# The widest strip between two fields a join fills. On a delineation of 64
# fields near Toledo, PR (scenes of 2025-11-20 and 2026-03-15, measured on
# 2026-11-19), the gaps between pairs of fields under 80 m apart fell on the
# 10 m lattice: 37 of the 97 pairs were 10 m apart or less, one boundary cell;
# 20 more were 22.4 m or less, two cells or their diagonal; the other 40 were
# 23.2 m or more, where a road, a tree line or other cover lies between. 25 m
# takes the first two groups and refuses the third.
JOIN_GAP_M = 25.0
# How far apart the shortest lines that make a strip start along an edge.
STEP_M = 2.0
# A part smaller than this is what floating point leaves where a cut runs
# along an edge, not a field anyone drew.
MIN_PART_M2 = 1.0
# Output coordinates are kept to 1e-7 degree, about a centimetre.
PRECISION_DEG = 1e-7
# See _strip and _quads.
OVERLAP_M = 0.01
BACK_ACROSS_M = 0.1


class Refused(ValueError):
    """An edit that cannot be made, with the sentence that says why."""


def _utm(geom: BaseGeometry) -> CRS:
    """The UTM zone of `geom`'s centroid; imagery.mosaic.utm_crs, without rasterio."""
    lon, lat = geom.centroid.coords[0]
    zone = min(60, int((lon + 180.0) // 6.0) + 1)
    return CRS.from_epsg((32600 if lat >= 0 else 32700) + zone)


class _Local:
    """To and from metres in one UTM zone."""

    def __init__(self, around: BaseGeometry):
        crs = _utm(around)
        self._to = Transformer.from_crs('EPSG:4326', crs, always_xy=True).transform
        self._back = Transformer.from_crs(crs, 'EPSG:4326', always_xy=True).transform

    def metres(self, geom: BaseGeometry) -> BaseGeometry:
        out = shp_transform(self._to, geom)
        return out if out.is_valid else out.buffer(0)

    def degrees(self, geom: BaseGeometry) -> BaseGeometry:
        return set_precision(shp_transform(self._back, geom), PRECISION_DEG)


def _polygons(geom: BaseGeometry) -> list[BaseGeometry]:
    """The Polygons of a geometry, whatever collection it arrived as."""
    if geom.is_empty:
        return []
    if geom.geom_type == 'Polygon':
        return [geom]
    return [p for g in getattr(geom, 'geoms', []) for p in _polygons(g)]


def _part(local: _Local, poly: BaseGeometry) -> dict[str, Any]:
    return {
        'geometry': mapping(local.degrees(poly)),
        'area_ha': round(poly.area / 1e4, 4),
    }


def split(field: BaseGeometry, line: BaseGeometry) -> list[dict[str, Any]]:
    """
    The parts `line` cuts `field` into, largest first.

    The line has to cross the field from edge to edge; one that stops inside
    cuts nothing. It is not extended to the edge, because on a field that
    bends, a line carried on past where the reader stopped can cross it again
    somewhere they did not mean.
    """
    if field.geom_type != 'Polygon':
        raise Refused('a field is one polygon')
    if line.geom_type != 'LineString':
        raise Refused('the cut is a line')
    local = _Local(field)
    poly, cut = local.metres(field), local.metres(line)
    parts = [p for p in _polygons(shp_split(poly, cut)) if p.area >= MIN_PART_M2]
    if len(parts) < 2:
        raise Refused('The line has to cross the field from one edge to another.')
    parts.sort(key=lambda p: p.area, reverse=True)
    return [_part(local, p) for p in parts]


def _strip(a: BaseGeometry, b: BaseGeometry, gap_m: float) -> BaseGeometry:
    """
    The ground between two fields at most `gap_m` apart: what the shortest
    lines from each field's edge to the other cover.

    From every point of `a`'s edge within `gap_m` of `b`, a STEP_M apart, the
    shortest line to `b`; the quadrilateral between two consecutive lines is
    ground between the fields, and so is each one taken from `b`'s side.
    Between two facing edges that is the strip, end to end and no further;
    between two fields that meet at a corner it is a bridge from one corner
    to the other. A line that runs back across its own field starts on the
    far edge of a field narrower than `gap_m` and is not used.

    A morphological closing, the usual way to fill a gap, was tried first on
    the Toledo delineation and left 11 of the 57 pairs 22.4 m apart or less
    in two pieces: a closing does not connect two fields that meet only at a
    corner, however close the corners are.
    """
    # The corners of every quadrilateral lie on the fields' edges, which in
    # floating point leaves hairline gaps where a union should close; a
    # centimetre of overlap closes them.
    strip = unary_union(_quads(a, b, gap_m) + _quads(b, a, gap_m))
    return strip.buffer(OVERLAP_M, join_style='mitre')


def _quads(src: BaseGeometry, dst: BaseGeometry, gap_m: float) -> list[BaseGeometry]:
    edge = src.exterior.intersection(dst.buffer(gap_m))
    out: list[BaseGeometry] = []
    for piece in _lines(edge):
        n = max(1, math.ceil(piece.length / STEP_M))
        starts = shapely.line_interpolate_point(piece, np.linspace(0.0, 1.0, n + 1), normalized=True)
        lines = shapely.shortest_line(starts, dst)
        # A line that runs back across its own field crosses metres of it;
        # every other line still touches it over a few millimetres, where the
        # interpolated start lands a hair inside the edge.
        usable = (shapely.length(lines) <= gap_m + 1e-6) & (
            shapely.length(shapely.intersection(lines, src)) < BACK_ACROSS_M
        )
        for k in range(n):
            if usable[k] and usable[k + 1]:
                corners = np.vstack([shapely.get_coordinates(lines[k]),
                                     shapely.get_coordinates(lines[k + 1])])
                out.append(MultiPoint(corners).convex_hull)
    return out


def _lines(geom: BaseGeometry) -> list[BaseGeometry]:
    """The LineStrings of a geometry; points, where an edge only grazes, carry no length."""
    if geom.is_empty:
        return []
    if geom.geom_type == 'LineString':
        return [geom]
    return [ln for g in getattr(geom, 'geoms', []) for ln in _lines(g)]


def _without_new_holes(joined: BaseGeometry, fields: list[BaseGeometry]) -> BaseGeometry:
    """
    `joined` with the holes the join made filled, and the fields' own kept.

    A field's hole is ground inside it the network did not call field, a
    house or a stand of trees, and stays one. A hole the join made is ground
    the strip closed off: on the Toledo delineation, mostly the mouth of a
    narrow notch in one field's edge, sealed where it faced the other field.
    Inside the field the reader has just said this is, it is that field.
    """
    own = [Polygon(r) for f in fields for r in f.interiors]
    kept = [r for r in joined.interiors if any(Polygon(r).intersects(h) for h in own)]
    return Polygon(joined.exterior, kept)


def join(fields: list[BaseGeometry], gap_m: float = JOIN_GAP_M) -> dict[str, Any]:
    """`fields` as one field, across strips up to `gap_m` wide between them."""
    if len(fields) < 2:
        raise Refused('Choose at least two fields to join.')
    if any(f.geom_type != 'Polygon' for f in fields):
        raise Refused('a field is one polygon')
    local = _Local(unary_union(fields))
    polys = [local.metres(f) for f in fields]
    whole = unary_union(polys)
    if whole.geom_type != 'Polygon':
        whole = unary_union([whole, *(
            _strip(a, b, gap_m) for a, b in combinations(polys, 2)
            if a.distance(b) <= gap_m
        )])
        if not whole.is_valid:
            whole = whole.buffer(0)
    if whole.geom_type == 'Polygon':
        whole = _without_new_holes(whole, polys)
    if whole.geom_type != 'Polygon':
        raise Refused(
            f'Only neighbours can be joined: these fields are more than {gap_m:.0f} m apart.'
        )
    return _part(local, whole)


def edit(req: protocol.Request, work_dir: Path) -> None:
    """The `field_edit` action: `op` is "split" (`field`, `line`) or "join" (`fields`)."""
    op = req.get('op')
    try:
        if op == 'split':
            if not req.get('field') or not req.get('line'):
                protocol.fail('a split needs the field and the line')
            parts = split(shape(req['field']), shape(req['line']))
        elif op == 'join':
            given = req.get('fields') or []
            parts = [join([shape(g) for g in given])]
        else:
            protocol.fail(f'unknown field edit {op!r}; expected "split" or "join"')
    except Refused as e:
        protocol.fail(str(e))
    sys.stdout.write(json.dumps({'field_edit': {'op': op, 'parts': parts}}))
    sys.stdout.flush()
