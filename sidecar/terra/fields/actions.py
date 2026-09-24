"""
The field-boundary action: two scenes in, one polygon per field out.

Reads its request, runs the product, and writes one JSON object to stdout. The
request and response shapes are the contract with
internal/analysis/runner_fields.go, which builds each request and parses each
response.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

from terra import aoi, protocol
from terra.imagery import cog

NODATA_CLASS = 255

# RGBA of the class overlay. Interior translucent, so the imagery under it
# stays readable; boundary opaque, since it is the line the product is about.
_INTERIOR_RGBA = (77, 175, 74, 90)
_BOUNDARY_RGBA = (255, 217, 47, 235)


def _window(req, key):
    w = req.get(key)
    if not isinstance(w, dict) or not w.get('start') or not w.get('end'):
        protocol.fail(f'{key} requires start and end dates (YYYY-MM-DD)')
    return str(w['start']), str(w['end'])


def _class_rgba(classes: np.ndarray) -> np.ndarray:
    from terra.fields.segment import CLASS_BOUNDARY, CLASS_INTERIOR

    rgba = np.zeros(classes.shape + (4,), dtype=np.uint8)
    rgba[classes == CLASS_INTERIOR] = _INTERIOR_RGBA
    rgba[classes == CLASS_BOUNDARY] = _BOUNDARY_RGBA
    return rgba


def _true_colour_rgba(bands: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """B04 B03 B02 as RGBA, one 2-98 percentile stretch shared by the three."""
    rgb = bands[:3].transpose(1, 2, 0)
    rgba = np.zeros(rgb.shape[:2] + (4,), dtype=np.uint8)
    values = rgb[valid]
    if values.size == 0:
        return rgba
    lo, hi = np.percentile(values, [2, 98])
    scaled = np.clip((rgb - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    rgba[..., :3] = (scaled * 255).astype(np.uint8)
    rgba[..., 3] = np.where(valid, 255, 0).astype(np.uint8)
    return rgba


def _write_classes_tif(classes, grid, path):
    import rasterio

    profile = {
        'driver': 'GTiff',
        'dtype': 'uint8',
        'count': 1,
        'compress': 'lzw',
        'nodata': NODATA_CLASS,
        **grid.profile(),
    }
    with rasterio.open(path, 'w', **profile) as dst:
        dst.write(classes.astype(np.uint8), 1)


def _cropland_on_grid(polygon, grid, work_dir):
    """MapBiomas cropland on the grid, or None outside Brazil or on failure."""
    from terra import mapbiomas
    from terra.imagery import grid as ref_grid

    if not mapbiomas.polygon_in_brazil(polygon):
        return None
    path = mapbiomas.fetch_mapbiomas_window(polygon, work_dir)
    classes = ref_grid.reproject_to_reference(
        str(path), grid.profile(), np.ones((grid.height, grid.width), dtype=np.uint8)
    )
    return np.isin(classes, list(mapbiomas.CROP_CLASSES))


def delineate(req: protocol.Request, work_dir: Path) -> None:
    from rasterio.warp import transform_bounds

    from terra.fields import polygons, scenes, segment, weights
    from terra.imagery import composite

    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])
    start_a, end_a = _window(req, 'window_a')
    start_b, end_b = _window(req, 'window_b')
    max_cloud = protocol.request_number(req, 'max_cloud', 60.0)
    min_area = protocol.request_number(req, 'min_area_m2', polygons.MIN_AREA_M2)
    simplify = protocol.request_number(req, 'simplify_m', polygons.SIMPLIFY_M)
    buffer_m = protocol.request_number(req, 'buffer_m', 320.0)
    weights_dir = req.get('weights_dir')
    if not weights_dir:
        protocol.fail('weights_dir is required')
    try:
        checkpoint = weights.lookup(req.get('checkpoint'))
    except ValueError as e:
        protocol.fail(str(e))

    # Before any network or download, so a missing package costs nothing.
    segment.require_network()
    cog.configure()

    def note(msg):
        protocol.emit_progress(-1, msg)

    protocol.emit_progress(3, 'building the grid')
    grid = scenes.reference_grid(polygon, buffer_m)
    inside = scenes.area_mask(polygon, grid)

    chosen = []
    for label, (start, end), pct in (('A', (start_a, end_a), 6), ('B', (start_b, end_b), 14)):
        protocol.emit_progress(pct, f'searching window {label} ({start} to {end})')
        found = scenes.search_scenes(grid, start, end, max_cloud)
        if not found:
            protocol.fail(
                f'no Sentinel-2 scene in window {label} ({start} to {end}) '
                f'under {max_cloud:.0f}% cloud'
            )
        scene = scenes.choose(found, grid, inside, note=note)
        assert scene is not None
        note(f'window {label}: {scene.date}, {100 * (scene.clear_fraction or 0):.1f}% of the area clear')
        chosen.append(scene)
    scene_a, scene_b = chosen

    protocol.emit_progress(22, f'weights: {checkpoint.title}')
    path = weights.ensure(
        checkpoint,
        Path(weights_dir),
        progress=lambda frac, msg: protocol.emit_progress(22 + int(18 * frac), msg),
    )

    protocol.emit_progress(42, f'reading window A ({scene_a.date})')
    bands_a = scenes.read_bands(scene_a, grid)
    protocol.emit_progress(50, f'reading window B ({scene_b.date})')
    bands_b = scenes.read_bands(scene_b, grid)
    # choose() measures every scene it returns, which is what reads the SCL.
    if scene_a.scl is None or scene_b.scl is None:
        protocol.fail('a chosen scene carries no scene classification')
    valid = (
        scenes.usable(scene_a.scl) & scenes.usable(scene_b.scl)
        & (bands_a > 0).all(axis=0) & (bands_b > 0).all(axis=0)
    )

    protocol.emit_progress(58, 'loading the network')
    net = segment.load_network(path)
    protocol.emit_progress(60, f'delineating ({grid.width} x {grid.height} px)')
    probs = segment.predict(
        net,
        scenes.network_input(bands_a, bands_b),
        progress=lambda frac: protocol.emit_progress(60 + int(25 * frac), 'delineating'),
    )
    classes = probs.argmax(axis=0).astype(np.uint8)
    classes[~valid] = NODATA_CLASS

    cropland = None
    try:
        protocol.emit_progress(87, 'reading MapBiomas cropland')
        cropland = _cropland_on_grid(polygon, grid, work_dir)
    except Exception as e:
        note(f'cropland share skipped: {e}')

    protocol.emit_progress(90, 'vectorising fields')
    features = polygons.fields_from_classes(
        classes,
        probs[segment.CLASS_INTERIOR],
        valid,
        grid,
        polygon,
        min_area_m2=min_area,
        simplify_m=simplify,
        cropland=cropland,
    )

    protocol.emit_progress(95, 'writing outputs')
    fields_path = work_dir / 'fields.geojson'
    fields_path.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}))
    classes_png = work_dir / 'field_classes.png'
    composite.write_rgba_png(_class_rgba(classes), classes_png)
    classes_tif = work_dir / 'field_classes.tif'
    _write_classes_tif(classes, grid, classes_tif)
    window_a_png = work_dir / 'window_a.png'
    window_b_png = work_dir / 'window_b.png'
    for bands, out in ((bands_a, window_a_png), (bands_b, window_b_png)):
        composite.write_rgba_png(_true_colour_rgba(bands, (bands > 0).all(axis=0)), out)

    in_area = inside & valid
    n_in = int(in_area.sum())
    lon_min, lat_min, lon_max, lat_max = transform_bounds(
        grid.crs, 'EPSG:4326', *grid.bounds, densify_pts=21
    )
    result: dict[str, Any] = {
        'extent': {
            'lon_min': float(lon_min), 'lon_max': float(lon_max),
            'lat_min': float(lat_min), 'lat_max': float(lat_max),
        },
        'checkpoint': {
            'name': checkpoint.name,
            'title': checkpoint.title,
            'license': checkpoint.license,
        },
        'window_a': scene_a.summary(),
        'window_b': scene_b.summary(),
        'grid': {
            'crs': grid.crs.to_string(),
            'width': grid.width,
            'height': grid.height,
            'pixel_size_m': scenes.PIXEL_M,
            'buffer_m': buffer_m,
        },
        'resize_factor': segment.RESIZE,
        'min_area_m2': min_area,
        'simplify_m': simplify,
        'area_ha': round(int(inside.sum()) * scenes.PIXEL_M ** 2 / 1e4, 2),
        # Of the area's cells, those either window could not see clearly.
        'masked_fraction': round(1.0 - n_in / int(inside.sum()), 4) if inside.any() else 1.0,
        'class_fraction': {
            name: round(float((classes[in_area] == i).mean()), 4) if n_in else 0.0
            for i, name in enumerate(segment.CLASS_NAMES)
        },
        'n_fields': len(features),
        'field_area_ha': polygons.area_summary(features),
        'cropland_reference': (
            'MapBiomas Collection 10 (2023)' if cropland is not None else None
        ),
        'fields_geojson': str(fields_path),
        'classes_png': str(classes_png),
        'classes_tif': str(classes_tif),
        'window_a_png': str(window_a_png),
        'window_b_png': str(window_b_png),
    }
    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'fields': result}))
    sys.stdout.flush()
