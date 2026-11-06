"""
The scene actions: which acquisitions exist over an area, and the views drawn
from them -- from one scene, from two (a change), or from the period's clear
observations (the median).

A view is looked at, not run: it leaves no saved run and carries no claim over
the period beyond what its own legend states. That is what keeps these apart
from the products, and they are a slice of their own rather than part of
terra.imagery because that package is a reader, and a reader with actions in
it stops being one.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from terra import protocol
from terra.imagery import cog, sentinel2
from terra.scenes import lookup


# Inventory Sentinel-2 scenes for the AOI (no classification / band reads).
def list_datacube(req, work_dir):

    from terra import aoi
    start = req.get('start')
    end = req.get('end')
    max_cloud = float(req.get('max_cloud', 100.0))
    monthly_best = bool(req.get('monthly_best', True))
    tiles = req.get('tiles') or None
    if not start or not end:
        protocol.fail('list_datacube requires start and end dates (YYYY-MM-DD)')
    if req.get('polygon_geojson'):
        polygon = aoi.polygon_from_geojson(req['polygon_geojson'])
    elif req.get('kml_path'):
        area = aoi.parse_kml_coordinates(Path(req['kml_path']), req.get('kml_target'))
        if area is None:
            protocol.fail('polygon not found in KML')
        polygon = area['polygon']
    else:
        protocol.fail('no polygon provided (polygon_geojson or kml_path required)')
    protocol.emit_progress(20, 'querying STAC catalog (Planetary Computer)')
    try:
        products = sentinel2.list_stac_products(
            polygon, start, end, tile_list=tiles, max_cloud=max_cloud,
            monthly_best=monthly_best,
        )
    except Exception as e:
        protocol.fail(f'STAC query failed: {e}')
    scenes = []
    for p in products:
        scenes.append({
            'id': p.get('id') or '',
            'date': p['date'].strftime('%Y-%m-%d'),
            'cloud_cover': round(float(p.get('cloud_cover', 0.0)), 2),
            'tile': p.get('tile') or '',
            'satellite': p.get('satellite') or 'S2',
            'preview_uri': p.get('preview_uri') or '',
        })
    date_range = []
    if scenes:
        date_range = [scenes[0]['date'], scenes[-1]['date']]
    protocol.emit_progress(100, f'{len(scenes)} scenes')
    sys.stdout.write(json.dumps({
        'n_scenes': len(scenes),
        'scenes': scenes,
        'date_range': date_range,
        'monthly_best': monthly_best,
        'max_cloud': max_cloud,
    }))
    sys.stdout.flush()


# What render_composite draws, and the band reads each needs.
KINDS = ('rgb', 'index', 'pca', 'clusters', 'change', 'biophysical')
# Kinds that read one acquisition and cannot be drawn from the period median:
# a change is two acquisitions, and a canopy model needs one scene's angles.
SCENE_ONLY = ('change', 'biophysical')
DEFAULT_CLUSTERS = 5


def _date_of(product) -> str:
    d = product.get('date')
    return d.strftime('%Y-%m-%d') if hasattr(d, 'strftime') else str(d or '')


def render_composite(req, work_dir):
    """
    One view of the area: a band composite, an index, the principal components
    or clusters of the bands, a change between two scenes, or a canopy variable.

    From one scene, or -- for the first four -- from the period's cloud-free
    median (`median: true`). Not `source`, which every request already uses
    to name where imagery comes from (stac).
    """
    from terra import aoi
    from terra.imagery import composite as comp
    from terra.scenes import angles, median, sl2p, views

    cog.configure()
    start = req.get('start')
    end = req.get('end')
    max_cloud = float(req.get('max_cloud', 100.0))
    # monthly_best arrives in the request and cannot be honoured here:
    # matching scene_id needs every scene, so both searches below pass False.
    # The Go side still sends it, because CompositeRequest shares its shape
    # with the requests that do use it.
    tiles = req.get('tiles') or None
    scene_id = (req.get('scene_id') or '').strip()
    kind = (req.get('kind') or 'rgb').strip().lower()
    from_median = bool(req.get('median'))
    stretch = req.get('stretch_pct') or [2, 98]
    try:
        stretch_lo = float(stretch[0])
        stretch_hi = float(stretch[1])
    except Exception:
        stretch_lo, stretch_hi = 2.0, 98.0

    if kind not in KINDS:
        protocol.fail(f'unknown kind: {kind}; one of {", ".join(KINDS)}')
    if from_median and kind in SCENE_ONLY:
        protocol.fail(f'a {kind} view reads single scenes; choose a scene rather than the period median')
    if not from_median and not scene_id:
        protocol.fail('render_composite requires scene_id')
    if not start or not end:
        protocol.fail('render_composite requires start and end dates (YYYY-MM-DD)')
    if req.get('polygon_geojson'):
        polygon = aoi.polygon_from_geojson(req['polygon_geojson'])
    elif req.get('kml_path'):
        area = aoi.parse_kml_coordinates(Path(req['kml_path']), req.get('kml_target'))
        if area is None:
            protocol.fail('polygon not found in KML')
        polygon = area['polygon']
    else:
        protocol.fail('no polygon provided (polygon_geojson or kml_path required)')

    # The bands the kind reads, decided before anything is read: the median
    # reads them all at once, scene by scene.
    spec = None
    if kind == 'rgb':
        needed = list(req.get('bands') or comp.RGB_PRESETS['true_color'])
        if len(needed) != 3:
            protocol.fail('rgb kind requires bands: [R, G, B]')
        for bname in needed:
            if bname not in comp.ALLOWED_BANDS:
                protocol.fail(f'unsupported band: {bname}')
    elif kind in ('index', 'change'):
        index_name = (req.get('index') or 'ndvi').strip().lower()
        spec = comp.COMPOSITE_INDICES.get(index_name)
        if spec is None:
            protocol.fail(
                f'unsupported index: {index_name}; '
                f'this sidecar draws {", ".join(comp.ALLOWED_INDICES)}'
            )
        needed = list(dict.fromkeys([*spec.bands, *(('B03', 'B11') if spec.water_only else ())]))
    elif kind in ('pca', 'clusters'):
        needed = list(comp.ALLOWED_BANDS)
    else:
        needed = list(sl2p.BANDS)

    def note(msg: str) -> None:
        protocol.emit_progress(-1, msg)

    meta: dict = {'kind': kind, 'median': from_median, 'stretch_pct': [stretch_lo, stretch_hi]}
    product = None
    if from_median:
        protocol.emit_progress(10, 'searching the period for clear acquisitions')
        try:
            pm = median.period_median(polygon, start, end, max_cloud, tuple(needed), note=note)
        except ValueError as e:
            protocol.fail(str(e))
        except Exception as e:
            protocol.fail(f'period median failed: {e}')
        profile = pm.grid.profile()
        mask = pm.inside & (pm.count > 0)

        def load_band(name: str):
            return pm.bands[name]

        seen = pm.count[mask]
        meta['dates'] = pm.dates
        meta['observations'] = {
            'min': int(seen.min()), 'median': float(np.median(seen)), 'max': int(seen.max()),
        }
        meta['date'] = f'median of {len(pm.dates)} clear scenes, {pm.dates[0]} to {pm.dates[-1]}'
    else:
        protocol.emit_progress(10, 'querying STAC for scene')
        product = _find(polygon, start, end, scene_id, tiles, max_cloud, note)
        protocol.emit_progress(30, 'loading reference band B04')
        try:
            ref, profile = sentinel2.load_and_clip_band(product, 'B04', polygon, '10m')
        except Exception as e:
            protocol.fail(f'failed to load B04: {e}')

        def load_band(name: str):
            """Reflectance, not DN. The offset belongs to the product, which
            this closure holds, so the callers below cannot forget it."""
            res = comp.BAND_RESOLUTION.get(name, '10m')
            return sentinel2.load_reflectance_to_reference_grid(product, name, polygon,
                                                      profile, res)

        mask = ref > 0
        meta['scene_id'] = scene_id
        meta['date'] = _date_of(product)

    protocol.emit_progress(50, f'reading {", ".join(needed)}')
    try:
        arrays = {b: load_band(b) for b in needed}
    except Exception as e:
        protocol.fail(f'band load failed: {e}')

    values = None
    if kind == 'rgb':
        r, g, b = (arrays[n] for n in needed)
        mask = mask & views.valid(r, g, b)
        rgba = comp.rgb_to_rgba(r, g, b, mask, stretch_lo, stretch_hi)
        meta['bands'] = needed
    elif kind == 'index':
        idx, mask = views.index_values(
            spec, [arrays[b] for b in spec.bands], mask, arrays.get('B03'), arrays.get('B11')
        )
        if not mask.any():
            protocol.fail(_nothing_to_read(index_name, spec))
        rgba = comp.index_to_rgba(idx, mask, index_name, stretch_lo, stretch_hi)
        meta['index'] = index_name
    elif kind in ('pca', 'clusters'):
        stack = np.stack([arrays[b] for b in needed])
        mask = mask & views.valid(*stack)
        try:
            if kind == 'pca':
                view = views.pca_view(stack, mask, tuple(needed), stretch_lo, stretch_hi)
            else:
                k = int(req.get('clusters') or DEFAULT_CLUSTERS)
                k = max(2, min(k, len(comp.CATEGORICAL)))
                cell_ha = abs(profile['transform'].a * profile['transform'].e) / 10_000.0
                view = views.cluster_view(stack, mask, k, cell_ha)
        except ValueError as e:
            protocol.fail(str(e))
        rgba = view.rgba
        meta.update(view.meta)
    elif kind == 'change':
        before_id = (req.get('scene_id_before') or '').strip()
        if not before_id:
            protocol.fail('a change needs the earlier scene (scene_id_before)')
        if before_id == scene_id:
            protocol.fail('a change needs two different scenes')
        protocol.emit_progress(60, 'reading the earlier scene')
        before = _find(polygon, start, end, before_id, tiles, max_cloud, note)
        try:
            before_arrays = {
                b: sentinel2.load_reflectance_to_reference_grid(
                    before, b, polygon, profile, comp.BAND_RESOLUTION.get(b, '10m'))
                for b in needed
            }
        except Exception as e:
            protocol.fail(f'band load failed for the earlier scene: {e}')
        after_idx, after_mask = views.index_values(
            spec, [arrays[b] for b in spec.bands], mask, arrays.get('B03'), arrays.get('B11'))
        before_idx, before_mask = views.index_values(
            spec, [before_arrays[b] for b in spec.bands], mask,
            before_arrays.get('B03'), before_arrays.get('B11'))
        mask = after_mask & before_mask
        if not mask.any():
            protocol.fail(_nothing_to_read(index_name, spec, both=True))
        view = views.change_view(
            before_idx, after_idx, mask, index_name.upper(), _date_of(before), meta['date'])
        rgba, values = view.rgba, view.values
        meta.update(view.meta)
        meta['index'] = index_name
        meta['scene_id_before'] = before_id
        meta['before_date'] = _date_of(before)
        meta['date'] = f"{meta['before_date']} to {meta['date']}"
    else:
        variable = (req.get('variable') or 'lai').strip().lower()
        if variable not in sl2p.VARIABLES:
            protocol.fail(f'unknown variable: {variable}; one of {", ".join(sl2p.VARIABLES)}')
        href = (product or {}).get('granule_metadata') or ''
        if not href:
            protocol.fail('the scene carries no tile metadata, so its sun and viewing angles are unknown')
        protocol.emit_progress(70, 'reading the sun and viewing angles')
        centre = polygon.centroid
        try:
            at = angles.angles_at(angles.fetch_metadata(href), centre.x, centre.y)
        except ValueError as e:
            protocol.fail(f'angles: {e}')
        except Exception as e:
            protocol.fail(f'tile metadata could not be read: {e}')
        sensor, sensor_note = sl2p.sensor_for(str((product or {}).get('satellite') or ''))
        protocol.emit_progress(80, f'running SL2P ({sensor}, {variable})')
        view = views.biophysical_view(
            np.stack([arrays[b] for b in sl2p.BANDS]),
            mask,
            sl2p.angle_cosines(at.view_zenith, at.sun_zenith, at.sun_azimuth, at.view_azimuth),
            sensor, variable, sensor_note, str((product or {}).get('satellite') or ''),
        )
        rgba, values = view.rgba, view.values
        meta.update(view.meta)
        meta['angles'] = {k: round(v, 2) for k, v in at.__dict__.items()}

    overlay_png = work_dir / 'composite.png'
    protocol.emit_progress(85, 'writing PNG')
    comp.write_rgba_png(rgba, overlay_png)
    raster_tif = work_dir / 'composite.tif'
    protocol.emit_progress(92, 'writing GeoTIFF')
    try:
        if values is not None:
            comp.write_float_geotiff(values, profile, raster_tif)
        else:
            comp.write_rgba_geotiff(rgba, profile, raster_tif)
    except Exception as e:
        protocol.fail(f'composite GeoTIFF failed: {e}')
    extent = comp.extent_from_profile(profile)
    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({
        'extent': extent,
        'overlay_png': str(overlay_png),
        'raster_tif': str(raster_tif),
        'meta': meta,
    }))
    sys.stdout.flush()


def _find(polygon, start, end, scene_id, tiles, max_cloud, note):
    """The product for a scene id, or the process ends with the reason."""
    try:
        return lookup.find(
            polygon, start, end, scene_id, tiles=tiles, max_cloud=max_cloud, note=note,
        )
    except lookup.SceneNotFound as e:
        protocol.fail(str(e))
    except Exception as e:
        protocol.fail(f'STAC query failed: {e}')


def _nothing_to_read(index_name: str, spec, both: bool = False) -> str:
    when = 'on both dates' if both else 'in this scene'
    if spec.water_only:
        return (f'{index_name.upper()} is read over open water only, and MNDWI finds none '
                f'{when} inside the area')
    return f'no cell of the area has reflectance in every band {index_name.upper()} reads {when}'
