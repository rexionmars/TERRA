"""
From a class map to fields: one polygon per connected region of interior.

The same reduction ftw_tools/postprocess/polygonize.py performs, with its
defaults: 4-connected interior regions vectorised on the pixel lattice,
simplified by 15 m, and regions under 500 m^2 dropped. The boundary class is
what keeps two neighbours apart; it belongs to no field, so every polygon
stops about half a boundary short of the line a surveyor would draw.

CLIPPED TO THE AREA, AFTER. The network saw a margin around the area so that
the fields along its edge were not cut by an artificial one. Here each polygon
is intersected with the area, and one left with less than the minimum inside
it is dropped: it is a field of the neighbour's.

ONE POLYGON PER FIELD, ALWAYS. A region can come out of the simplification or
the clip in several parts: a bridge a pixel wide collapses under a 15 m
tolerance, and an area whose edge doubles back cuts a region twice. The parts
are not slivers -- measured on a western Paraná run, one region of 83.8 ha
came out as 47.3 and 38.8 ha -- so each part at least the minimum is a field of
its own, and the figures are taken over its own cells rather than the
region's. Every product reads an area as a Polygon, so a MultiPolygon here
would be a field nothing downstream can run over.

WHAT EACH POLYGON CARRIES, and what it does not. The area and perimeter in the
grid's UTM projection; the mean interior probability over its pixels, which is
the network's vote and not a probability of being right (the same caveat the
classification's confidence carries); and, when a MapBiomas window was read,
the share of its pixels MapBiomas calls cropland. FTW models are known to
segment pasture as fields (ftw-baselines README, filter-by-lulc); the share is
reported rather than used to drop anything, so the reader decides.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import rasterio.features
from pyproj import Transformer
from scipy import ndimage
from shapely.geometry import mapping, shape
from shapely.ops import transform as shp_transform, unary_union

from terra.fields.scenes import Grid, to_grid_crs
from terra.fields.segment import CLASS_INTERIOR

MIN_AREA_M2 = 500.0
SIMPLIFY_M = 15.0


def label_interior(classes: np.ndarray, valid: np.ndarray) -> tuple[np.ndarray, int]:
    """4-connected interior regions, numbered from 1; 0 elsewhere."""
    interior = (classes == CLASS_INTERIOR) & valid
    labels, n = ndimage.label(interior)
    return labels.astype(np.int32), int(n)


def region_means(labels: np.ndarray, n: int, values: np.ndarray) -> np.ndarray:
    """Mean of `values` per label, index 0 unused."""
    counts = np.bincount(labels.ravel(), minlength=n + 1).astype(np.float64)
    sums = np.bincount(labels.ravel(), weights=values.ravel(), minlength=n + 1)
    with np.errstate(invalid='ignore', divide='ignore'):
        return np.where(counts > 0, sums / counts, np.nan)


def _polygon_parts(geom) -> list:
    """The Polygons of a geometry, whatever collection it arrived as."""
    if geom.is_empty:
        return []
    if geom.geom_type == 'Polygon':
        return [geom]
    if hasattr(geom, 'geoms'):
        out = []
        for g in geom.geoms:
            out.extend(_polygon_parts(g))
        return out
    return []


def fields_from_classes(
    classes: np.ndarray,
    interior_prob: np.ndarray,
    valid: np.ndarray,
    grid: Grid,
    area_polygon,
    min_area_m2: float = MIN_AREA_M2,
    simplify_m: float = SIMPLIFY_M,
    cropland: np.ndarray | None = None,
) -> list[dict[str, Any]]:
    """
    GeoJSON Polygon features in WGS84, largest first, numbered in that order.

    `area_polygon` is the area in WGS84; `cropland`, when given, is a boolean
    grid of MapBiomas cropland cells.
    """
    labels, n = label_interior(classes, valid)
    if n == 0:
        return []

    pieces: dict[int, list] = {}
    for geom, value in rasterio.features.shapes(
        labels, mask=labels > 0, transform=grid.transform, connectivity=4
    ):
        pieces.setdefault(int(value), []).append(shape(geom))

    area_utm = to_grid_crs(area_polygon, grid.crs)
    if not area_utm.is_valid:
        area_utm = area_utm.buffer(0)

    kept: list[Any] = []
    for parts in pieces.values():
        region = unary_union(parts)
        if simplify_m > 0:
            region = region.simplify(simplify_m, preserve_topology=True)
        region = region.intersection(area_utm)
        if not region.is_valid:
            region = region.buffer(0)
        kept.extend(p for p in _polygon_parts(region) if p.area >= min_area_m2)
    if not kept:
        return []
    kept.sort(key=lambda p: p.area, reverse=True)

    # Each field's own cells, one rasterisation for all of them: a cell
    # belongs to the field its centre falls in.
    index = rasterio.features.rasterize(
        [(p, i) for i, p in enumerate(kept, start=1)],
        out_shape=labels.shape,
        transform=grid.transform,
        fill=0,
        dtype='int32',
    )
    mean_prob = region_means(index, len(kept), interior_prob)
    crop_share = (
        region_means(index, len(kept), cropland.astype(np.float64))
        if cropland is not None else None
    )

    to_wgs84 = Transformer.from_crs(grid.crs, 'EPSG:4326', always_xy=True)
    features = []
    for i, poly in enumerate(kept, start=1):
        props: dict[str, Any] = {
            'field': i,
            'area_ha': round(poly.area / 1e4, 4),
            'perimeter_m': round(poly.length, 1),
            # A polygon narrower than a cell can hold no cell centre; its
            # figures are then not measured rather than invented.
            'mean_interior_prob': _rounded(mean_prob[i]),
        }
        if crop_share is not None:
            props['cropland_share'] = _rounded(crop_share[i])
        features.append({
            'type': 'Feature',
            'properties': props,
            'geometry': mapping(shp_transform(to_wgs84.transform, poly)),
        })
    return features


def _rounded(v: float) -> float | None:
    return round(float(v), 4) if np.isfinite(v) else None


def area_summary(features: list[dict[str, Any]]) -> dict[str, float] | None:
    if not features:
        return None
    ha = np.array([f['properties']['area_ha'] for f in features], dtype=np.float64)
    return {
        'total': round(float(ha.sum()), 2),
        'median': round(float(np.median(ha)), 2),
        'p10': round(float(np.percentile(ha, 10)), 2),
        'p90': round(float(np.percentile(ha, 90)), 2),
        'max': round(float(ha.max()), 2),
    }
