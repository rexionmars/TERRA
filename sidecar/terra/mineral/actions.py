"""
The mineral_map action: Tetracorder mineral identification over an area, from
EMIT reflectance.

It reads the request, validates it, calls terra/mineral/mapping.py and writes
one JSON object to stdout.
"""

from __future__ import annotations

import json
import sys

from terra import protocol

DEFAULT_START = '2022-08-01'   # EMIT science operations began in August 2022


def mineral_map(req, work_dir):
    from terra import aoi
    from terra.mineral import mapping

    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    start = req.get('start') or DEFAULT_START
    end = req.get('end')
    if not end:
        protocol.fail('mineral_map requires an end date (YYYY-MM-DD)')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])
    # 100 by default, not a Sentinel-2-style ceiling: EMIT scores cloud over its
    # whole ~75 km scene, over the humid tropics every pass can exceed 50%
    # while the area is clear, and the mask removes cloud per cell anyway.
    # Over an area near Belem all 14 passes of 2024-2026 were 55-100% cloud
    # and the least cloudy observed all 1,025 cells of the area unmasked.
    max_cloud = protocol.request_number(req, 'max_cloud', 100.0) or 100.0
    max_scenes = int(protocol.request_number(req, 'max_scenes', 3, cast=int))
    if max_scenes < 1:
        protocol.fail('max_scenes must be at least 1')

    try:
        result = mapping.run(
            polygon, start, end,
            max_cloud=max_cloud, max_scenes=max_scenes,
            progress=protocol.emit_progress,
        )
    except mapping.NoScene as e:
        protocol.fail(str(e))
    # A missing or refused Earthdata token is protocol.Unavailable, which
    # terra/cli.py reports as the sentence emit.py wrote.

    payload = result.to_payload(work_dir)
    protocol.emit_progress(100, f"{payload['observed_cells']} cells observed")
    sys.stdout.write(json.dumps({'mineral': payload}))
    sys.stdout.flush()
