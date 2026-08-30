"""
The water action: surface water over an area, from a thresholded spectral index.

Reads its request, runs the product, and writes one JSON object to stdout.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from terra import protocol
from terra.imagery import cog, sentinel2


# Surface water / flood mapping from spectral water indices (no model).
def water(req, work_dir):
    from terra import aoi
    from terra.imagery import composite as comp, grid as ref_grid
    from terra.water import indices as water_mod

    cog.configure()
    start = req.get('start')
    end = req.get('end')
    max_cloud = float(req.get('max_cloud', 100.0))
    monthly_best = bool(req.get('monthly_best', True))
    tiles = req.get('tiles') or None
    index_name = (req.get('index') or water_mod.PRIMARY_INDEX).upper()
    if index_name not in water_mod.INDEX_NAMES:
        protocol.fail(f'unknown water index: {index_name}')
    if not start or not end:
        protocol.fail('water requires start and end dates (YYYY-MM-DD)')
    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])

    protocol.emit_progress(10, 'querying STAC catalog (Planetary Computer)')
    try:
        products = sentinel2.list_stac_products(
            polygon, start, end, tile_list=tiles, max_cloud=max_cloud,
            monthly_best=monthly_best,
        )
    except Exception as e:
        protocol.fail(f'STAC query failed: {e}')
    if not products:
        protocol.fail('no scenes found for this period and cloud filter')

    # The reference grid comes from B04 at 10 m, as in the predict path.
    ref_band, ref_profile = sentinel2.load_and_clip_band(products[0], 'B04', polygon)
    aoi_valid = ref_band > 0

    series = []
    masks = []
    observed = []
    frames = []
    n = len(products)
    for idx, product in enumerate(products):
        pct = 15 + int(70 * (idx + 1) / n)
        date_str = product['date'].strftime('%Y-%m-%d')
        protocol.emit_progress(pct, f'water index {idx + 1}/{n} ({date_str})')
        try:
            bands = {}
            for name in ('B03', 'B8A', 'B11', 'B12'):
                res = comp.BAND_RESOLUTION.get(name, '10m')
                bands[name] = sentinel2.load_band_to_reference_grid(
                    product, name, polygon, ref_profile, resolution=res
                )
                bands[name] = sentinel2.to_reflectance(bands[name], product)
        except Exception as e:
            sys.stderr.write(json.dumps({
                'progress': -1, 'msg': f'skipping {date_str}: {e}'
            }) + '\n')
            sys.stderr.flush()
            continue

        date_valid = water_mod.per_date_valid_mask(aoi_valid, bands, index_name)
        if not date_valid.any():
            continue
        indices = water_mod.compute_water_indices(
            bands['B03'], bands['B8A'], bands['B11'], bands['B12']
        )
        frame = indices[index_name]
        vals = frame[date_valid]
        thr_otsu, clipped, degenerate = water_mod.otsu_threshold_for_date(vals)
        thr_fixed = water_mod.DEFAULT_THRESHOLD

        mask_fixed = water_mod.water_mask_for_date(frame, date_valid, thr_fixed)
        mask_otsu = water_mod.water_mask_for_date(frame, date_valid, thr_otsu)

        masks.append(mask_fixed)
        observed.append(date_valid)
        frames.append(frame)
        series.append({
            'date': date_str,
            'scene_id': product.get('id') or '',
            'cloud_cover': round(float(product.get('cloud_cover', 0.0)), 2),
            'observed_pixels': int(date_valid.sum()),
            'threshold_fixed': thr_fixed,
            'threshold_otsu': thr_otsu,
            'threshold_clipped': bool(clipped),
            'threshold_degenerate': bool(degenerate),
            'water_fraction_pct': round(
                water_mod.water_fraction_pct(mask_fixed, date_valid), 4
            ),
            'water_fraction_otsu_pct': round(
                water_mod.water_fraction_pct(mask_otsu, date_valid), 4
            ),
            'water_pixels': int(mask_fixed.sum()),
            'area_ha': round(float(int(mask_fixed.sum()) * 0.01), 4),
        })

    if not series:
        protocol.fail('no scene produced a usable observation over the AOI')

    protocol.emit_progress(88, 'building occurrence map')
    occ = water_mod.occurrence_map(masks, observed)
    bands_occ = water_mod.classify_occurrence(occ)
    observed_cube = np.stack(observed, axis=0)
    anomaly = water_mod.max_minus_median_index(np.stack(frames, axis=0), observed_cube)

    px_ha = 0.01
    peak = max(series, key=lambda r: r['water_fraction_pct'])

    occ_png = Path(work_dir) / 'water_occurrence.png'
    comp.write_rgba_png(water_mod.occurrence_to_rgba(occ), occ_png)

    lon_min, lon_max, lat_min, lat_max = ref_grid.get_map_extent(ref_profile)
    protocol.emit_progress(100, f'{len(series)} dates')
    sys.stdout.write(json.dumps({
        'water': {
            'index': index_name,
            'threshold_method': 'fixed',
            'threshold_fixed': water_mod.DEFAULT_THRESHOLD,
            'otsu_clip': [water_mod.OTSU_CLIP_LOW, water_mod.OTSU_CLIP_HIGH],
            'n_dates': len(series),
            'date_range': [series[0]['date'], series[-1]['date']],
            'aoi_pixels': int(aoi_valid.sum()),
            'aoi_area_ha': round(float(int(aoi_valid.sum()) * px_ha), 4),
            'series': series,
            'peak_date': peak['date'],
            'peak_water_fraction_pct': peak['water_fraction_pct'],
            'ephemeral_pixels': int(bands_occ['ephemeral'].sum()),
            'ephemeral_area_ha': round(
                float(int(bands_occ['ephemeral'].sum()) * px_ha), 4
            ),
            'persistent_pixels': int(bands_occ['persistent'].sum()),
            'persistent_area_ha': round(
                float(int(bands_occ['persistent'].sum()) * px_ha), 4
            ),
            'mean_anomaly': float(np.nanmean(anomaly)) if np.isfinite(anomaly).any() else 0.0,
            'occurrence_png': str(occ_png),
            'extent': {
                'lon_min': lon_min, 'lat_min': lat_min,
                'lon_max': lon_max, 'lat_max': lat_max,
            },
        }
    }))
    sys.stdout.flush()
