"""
The radar action: every Sentinel-1 pass over an area in a period, its series by
orbit, the canopy losses (harvests among them), and two maps of the latest pass.
"""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from terra import aoi, protocol

# Passes read at once. Each is two windowed reads of cloud-optimised GeoTIFFs,
# which wait on the network rather than on the processor; the same count the
# vegetation health product reads Sentinel-2 at.
READERS = 8
# The latest passes whose images are kept for the maps.
MAP_CANDIDATES = 3


def radar(req: protocol.Request, work_dir: Path) -> None:
    from rasterio.warp import transform_bounds

    from terra import stac
    from terra.imagery import cog, composite, mosaic
    from terra.radar import series

    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    start = str(req.get('start') or '')
    end = str(req.get('end') or '')
    if not start or not end:
        protocol.fail('start and end are required')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])

    cog.configure()

    def note(msg: str) -> None:
        protocol.emit_progress(-1, msg)

    protocol.emit_progress(2, 'building the grid')
    grid = mosaic.reference_grid(polygon, 0.0)
    inside = mosaic.area_mask(polygon, grid)
    if not inside.any():
        protocol.fail('the area covers no 10 m cell')

    protocol.emit_progress(4, f'searching Sentinel-1 RTC ({start} to {end})')
    bbox = transform_bounds(grid.crs, 'EPSG:4326', *grid.bounds, densify_pts=21)
    try:
        items = stac.search(series.COLLECTION, bbox=bbox, datetime=f'{start}/{end}')
    except stac.Unavailable as e:
        raise protocol.Unavailable(f'the Planetary Computer catalogue did not answer: {e}') from e
    passes = series.group_acquisitions(items)
    if not passes:
        protocol.fail(f'no Sentinel-1 RTC pass over the area from {start} to {end}')
    latest = passes[-1]

    # The images of the last few passes are kept, since the latest can cover
    # too little of the area to be counted and the map then shows the one
    # before; the rest keep only their means, so memory holds a few passes
    # rather than every one of the period.
    keep = {id(a) for a in passes[-MAP_CANDIDATES:]}

    def read(acq: series.Acquisition) -> series.Observation | None:
        vv = series.read_gamma0(acq.items, 'vv', grid)
        vh = series.read_gamma0(acq.items, 'vh', grid)
        return series.measure(acq, vv, vh, inside, keep=id(acq) in keep)

    obs: list[series.Observation] = []
    done = 0
    with ThreadPoolExecutor(max_workers=READERS) as pool:
        futures = [pool.submit(read, a) for a in passes]
        for acq, f in zip(passes, futures, strict=True):
            try:
                o = f.result()
            except Exception as e:  # a slice that fails to read is one pass lost
                note(f'{acq.date} orbit {acq.relative_orbit}: not read ({e})')
                o = None
            done += 1
            if o is None:
                note(f'{acq.date} orbit {acq.relative_orbit}: under {100 * series.MIN_VALID:.0f}% of the area covered')
            else:
                obs.append(o)
            protocol.emit_progress(6 + int(80 * done / len(passes)), f'{done} of {len(passes)} passes read')
    if not obs:
        protocol.fail(f'no Sentinel-1 pass from {start} to {end} covered {100 * series.MIN_VALID:.0f}% of the area')
    obs.sort(key=lambda o: (o.date, o.relative_orbit))
    shown = next((o for o in reversed(obs) if o.vv is not None), None)
    if shown is None:
        protocol.fail(f'none of the last {MAP_CANDIDATES} passes covered {100 * series.MIN_VALID:.0f}% of the area')
    if shown.date != latest.date:
        note(f'the latest pass ({latest.date}) covered too little of the area; the maps show {shown.date}')

    protocol.emit_progress(90, 'looking for canopy losses')
    found = series.losses(obs)

    protocol.emit_progress(94, 'writing the maps')
    assert shown.vv is not None and shown.vh is not None
    outside = ~inside
    composite_png = work_dir / 'radar_composite.png'
    water_png = work_dir / 'radar_water.png'
    composite.write_rgba_png(series.composite_rgba(shown.vv, shown.vh, outside), composite_png)
    composite.write_rgba_png(series.water_rgba(shown.vv, shown.vh, outside), water_png)

    lon_min, lat_min, lon_max, lat_max = transform_bounds(grid.crs, 'EPSG:4326', *grid.bounds, densify_pts=21)
    result = {
        'extent': {'lon_min': lon_min, 'lat_min': lat_min, 'lon_max': lon_max, 'lat_max': lat_max},
        'orbits': series.orbits(obs),
        'series': [o.point() for o in obs],
        'losses': found,
        'map_date': shown.date,
        'map_orbit': shown.relative_orbit,
        'water_vh_db': series.WATER_VH_DB,
        'water_vv_db': series.WATER_VV_DB,
        'loss_vh_db': series.HARVEST_DROP_DB,
        'loss_cr_db': series.CR_DROP_DB,
        'composite_png': str(composite_png),
        'water_png': str(water_png),
    }
    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'radar': result}))
    sys.stdout.flush()
