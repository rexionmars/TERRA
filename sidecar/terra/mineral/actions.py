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

MAX_DRAWS = 50


def mineral_map(req, work_dir):
    from terra import aoi
    from terra.mineral import emit, mapping

    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    start = req.get('start') or emit.RECORD_START
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
    # The passes compared per cell (terra/mineral/cover.py). Zero, which the
    # frontend sends, takes the default.
    max_scenes = int(protocol.request_number(req, 'max_scenes', 0, cast=int)) or mapping.DEFAULT_PASSES
    if not 1 <= max_scenes <= mapping.MAX_PASSES:
        protocol.fail(f'max_scenes must be between 1 and {mapping.MAX_PASSES}')
    # Classifications of the reflectance perturbed by its uncertainty, for the
    # stability of each cell's class. Zero skips them: each one costs a full
    # classification and the uncertainty is a second cube as large as the
    # reflectance.
    draws = int(protocol.request_number(req, 'uncertainty_draws', 0, cast=int))
    if not 0 <= draws <= MAX_DRAWS:
        protocol.fail(f'uncertainty_draws must be between 0 and {MAX_DRAWS}')

    try:
        result = mapping.run(
            polygon, start, end,
            max_cloud=max_cloud, max_scenes=max_scenes, uncertainty_draws=draws,
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
