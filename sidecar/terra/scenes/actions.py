"""
The scene actions: which acquisitions exist over an area, and what one of them
looks like rendered.

They answer about the imagery itself rather than about anything derived from
it, which is why they are a slice of their own and not part of terra.imagery:
that package is a reader, and a reader with actions in it stops being one.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from terra import protocol
from terra.imagery import cog, indices, sentinel2


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


# RGB / false-color composite or spectral index for one STAC scene.
def render_composite(req, work_dir):
    from terra import aoi
    from terra.imagery import composite as comp

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
    stretch = req.get('stretch_pct') or [2, 98]
    try:
        stretch_lo = float(stretch[0])
        stretch_hi = float(stretch[1])
    except Exception:
        stretch_lo, stretch_hi = 2.0, 98.0

    if not scene_id:
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

    protocol.emit_progress(10, 'querying STAC for scene')
    try:
        products = sentinel2.list_stac_products(
            polygon, start, end, tile_list=tiles, max_cloud=max_cloud,
            monthly_best=False,  # need full list to match scene_id
        )
    except Exception as e:
        protocol.fail(f'STAC query failed: {e}')

    product = None
    for p in products:
        if (p.get('id') or '') == scene_id:
            product = p
            break
    if product is None:
        # Fall back: monthly_best list may have dropped the scene; retry without cloud filter widen
        try:
            products = sentinel2.list_stac_products(
                polygon, start, end, tile_list=tiles, max_cloud=100.0,
                monthly_best=False,
            )
        except Exception as e:
            protocol.fail(f'STAC query failed: {e}')
        for p in products:
            if (p.get('id') or '') == scene_id:
                product = p
                break
    if product is None:
        protocol.fail(f'scene not found: {scene_id}')

    protocol.emit_progress(30, 'loading reference band B04')
    try:
        ref, ref_prof = sentinel2.load_and_clip_band(product, 'B04', polygon, '10m')
    except Exception as e:
        protocol.fail(f'failed to load B04: {e}')

    def load_band(name: str):
        """Reflectance, not DN. The offset belongs to the product, which
        this closure holds, so the callers below cannot forget it."""
        res = comp.BAND_RESOLUTION.get(name, '10m')
        return sentinel2.load_reflectance_to_reference_grid(product, name, polygon,
                                                  ref_prof, res)

    mask = ref > 0
    overlay_png = work_dir / 'composite.png'
    meta = {
        'kind': kind,
        'scene_id': scene_id,
        'date': product['date'].strftime('%Y-%m-%d') if hasattr(product.get('date'), 'strftime') else str(product.get('date', '')),
        'stretch_pct': [stretch_lo, stretch_hi],
    }

    if kind == 'rgb':
        bands = req.get('bands') or list(comp.RGB_PRESETS['true_color'])
        if len(bands) != 3:
            protocol.fail('rgb kind requires bands: [R, G, B]')
        for bname in bands:
            if bname not in comp.ALLOWED_BANDS:
                protocol.fail(f'unsupported band: {bname}')
        protocol.emit_progress(50, f'loading {bands[0]}/{bands[1]}/{bands[2]}')
        try:
            r = load_band(bands[0])
            g = load_band(bands[1])
            b = load_band(bands[2])
        except Exception as e:
            protocol.fail(f'band load failed: {e}')
        mask = mask & (r > 0) & (g > 0) & (b > 0)
        rgba = comp.rgb_to_rgba(r, g, b, mask, stretch_lo, stretch_hi)
        meta['bands'] = bands
    elif kind == 'index':
        index_name = (req.get('index') or 'ndvi').strip().lower()
        if index_name not in comp.ALLOWED_INDICES:
            protocol.fail(f'unsupported index: {index_name}')
        protocol.emit_progress(50, f'computing {index_name}')
        try:
            if index_name == 'ndvi':
                nir = load_band('B08')
                red = load_band('B04')
                idx = indices.calculate_ndvi(nir, red)
                mask = mask & (nir > 0) & (red > 0)
            elif index_name == 'ndwi':
                green = load_band('B03')
                nir = load_band('B08')
                idx = comp.calculate_ndwi(green, nir)
                mask = mask & (green > 0) & (nir > 0)
            elif index_name == 'ndmi':
                nir = load_band('B08')
                swir = load_band('B11')
                idx = comp.calculate_ndmi(nir, swir)
                mask = mask & (nir > 0) & (swir > 0)
            else:  # evi
                nir = load_band('B08')
                red = load_band('B04')
                blue = load_band('B02')
                idx = indices.calculate_evi(nir, red, blue)
                mask = mask & (nir > 0) & (red > 0) & (blue > 0)
        except Exception as e:
            protocol.fail(f'index bands failed: {e}')
        rgba = comp.index_to_rgba(idx, mask, index_name, stretch_lo, stretch_hi)
        meta['index'] = index_name
    else:
        protocol.fail(f'unknown kind: {kind}')

    protocol.emit_progress(85, 'writing PNG')
    comp.write_rgba_png(rgba, overlay_png)
    raster_tif = work_dir / 'composite.tif'
    protocol.emit_progress(92, 'writing GeoTIFF')
    try:
        comp.write_rgba_geotiff(rgba, ref_prof, raster_tif)
    except Exception as e:
        protocol.fail(f'composite GeoTIFF failed: {e}')
    extent = comp.extent_from_profile(ref_prof)
    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({
        'extent': extent,
        'overlay_png': str(overlay_png),
        'raster_tif': str(raster_tif),
        'meta': meta,
    }))
    sys.stdout.flush()
