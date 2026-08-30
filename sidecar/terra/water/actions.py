"""
The water action: surface water over an area, from a thresholded spectral index.

It reads the request, validates it, calls the survey, and writes one JSON
object to stdout. Everything it does not do is in terra/water/survey.py, which
is reachable from a test with three synthetic scenes and no subprocess.
"""

from __future__ import annotations

import json
import sys

from terra import protocol
from terra.imagery import cog, sentinel2


# Surface water / flood mapping from spectral water indices (no model).
def water(req, work_dir):
    from terra import aoi
    from terra.water import indices as water_indices, survey

    cog.configure()
    start = req.get('start')
    end = req.get('end')
    index_name = (req.get('index') or water_indices.PRIMARY_INDEX).upper()
    if index_name not in water_indices.INDEX_NAMES:
        protocol.fail(f'unknown water index: {index_name}')
    if not start or not end:
        protocol.fail('water requires start and end dates (YYYY-MM-DD)')
    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])

    protocol.emit_progress(10, 'querying STAC catalog (Planetary Computer)')
    try:
        products = sentinel2.list_stac_products(
            polygon, start, end,
            tile_list=req.get('tiles') or None,
            max_cloud=float(req.get('max_cloud', 100.0)),
            monthly_best=bool(req.get('monthly_best', True)),
        )
    except Exception as e:
        protocol.fail(f'STAC query failed: {e}')
    if not products:
        protocol.fail('no scenes found for this period and cloud filter')

    try:
        result = survey.run(
            products, polygon, index_name,
            progress=protocol.emit_progress,
            skipped=lambda msg: protocol.emit_progress(-1, msg),
        )
    except survey.NoUsableScene as e:
        protocol.fail(str(e))

    protocol.emit_progress(100, f'{len(result.series)} dates')
    sys.stdout.write(json.dumps({'water': result.to_payload(work_dir)}))
    sys.stdout.flush()
