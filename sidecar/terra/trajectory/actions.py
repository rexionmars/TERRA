"""
The trajectory action: an area's Sentinel-2 series over a period, run through
an installed gp_series model, as a daily NDVI trajectory with its interval.

The request and response shapes are the contract with
internal/analysis/runner_trajectory.go, which builds the request and parses the
response.
"""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np

from terra import aoi, models, protocol

# The family this action runs. A model of another time-series family reads
# another series or returns another quantity, and is refused here by name.
FAMILY = 'gp_series'
# Acquisitions read at once. Each is up to five windowed reads of cloud-optimised
# GeoTIFFs, which wait on the network rather than on the processor; the count
# the vegetation health product reads at.
READERS = 8
# Every scene of the period is searched: whether a date counts is the per-pixel
# mask's decision, not the scene's cloud cover, which is over the whole tile.
MAX_CLOUD = 100.0
# Around the grid, so that a bilinear read of an edge cell has its neighbours.
BUFFER_M = 10.0
DECIMALS = 5


def _dates(n: int) -> str:
    return f'{n} date' if n == 1 else f'{n} dates'


def trajectory(req: protocol.Request, work_dir: Path) -> None:
    from terra import stac
    from terra.imagery import cog, mosaic
    from terra.trajectory import gp_series, region, series

    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    start = str(req.get('start') or '')
    end = str(req.get('end') or '')
    if not start or not end:
        protocol.fail('start and end are required')
    model_path = req.get('model_path')
    if not model_path:
        protocol.fail('no model was given; install a time-series model from Models')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])

    def note(msg: str) -> None:
        protocol.emit_progress(-1, msg)

    # Before anything is read: a file changed since it was installed is refused
    # here rather than run. See terra.models.
    protocol.emit_progress(2, 'checking the model files')
    try:
        package = models.load(Path(model_path))
        models.verify(package)
    except models.PackageError as e:
        protocol.fail(str(e))
    # The shell resolves only time-series packages for this action, and the
    # family check holds the rest when the sidecar is run by hand.
    if package.family != FAMILY:
        protocol.fail(
            f'{package.name} is a {package.family} model; the NDVI trajectory runs a {FAMILY} model'
        )
    try:
        raw = json.loads(package.path('parameters').read_text(encoding='utf-8'))
        params = gp_series.load_parameters(raw)
    except (OSError, ValueError, KeyError, TypeError) as e:
        protocol.fail(f'model {package.id}: its parameters cannot be read ({e})')
    # The medians the model was calibrated on were taken under this mask.
    mask = raw.get('scl_unusable')
    if mask is not None and sorted(mask) != sorted(mosaic.SCL_UNUSABLE):
        protocol.fail(
            f'model {package.id} was fitted on pixels judged clear by SCL classes other than '
            f'those this version of TERRA reads ({mask}, not {list(mosaic.SCL_UNUSABLE)})'
        )

    cog.configure()
    protocol.emit_progress(4, 'building the grid')
    grid = mosaic.reference_grid(polygon, BUFFER_M)
    inside = mosaic.area_mask(polygon, grid)
    if not inside.any():
        protocol.fail('the area covers no 10 m cell')

    protocol.emit_progress(6, f'searching Sentinel-2 ({start} to {end})')
    try:
        found = sorted(
            mosaic.search_scenes(grid, start, end, MAX_CLOUD, series.BANDS), key=lambda s: s.date
        )
    except stac.Unavailable as e:
        raise protocol.Unavailable(f'the Planetary Computer catalogue did not answer: {e}') from e
    if not found:
        protocol.fail(f'no Sentinel-2 acquisition over the area from {start} to {end}')

    read: list[series.Acquisition] = []
    done = 0
    with ThreadPoolExecutor(max_workers=READERS) as pool:
        futures = [
            pool.submit(series.read, s, grid, inside, params.min_clear_fraction) for s in found
        ]
        for s, f in zip(found, futures, strict=True):
            try:
                read.append(f.result())
            except Exception as e:  # a tile that fails to read is one date lost
                note(f'{s.date}: not read ({e})')
            done += 1
            protocol.emit_progress(
                8 + int(82 * done / len(found)), f'{done} of {len(found)} acquisitions read'
            )

    dates = [a.date for a in read]
    clear = [a.clear_fraction for a in read]
    values = np.array([a.values for a in read], dtype=float).reshape(-1, len(gp_series.CHANNELS))
    usable, _ = gp_series.acquisitions(dates, clear, values, params.min_clear_fraction)
    share = f'{100 * params.min_clear_fraction:.0f} %'
    if len(usable) < gp_series.MIN_ACQUISITIONS:
        protocol.fail(
            f'{_dates(len(usable))} from {start} to {end} saw at least {share} of the area clearly, '
            f'and the trajectory needs {gp_series.MIN_ACQUISITIONS}. Choose a longer period.'
        )

    code = region.region_of(polygon)
    protocol.emit_progress(92, 'fitting the trajectory')
    try:
        out = gp_series.trajectory(params, dates, clear, values, region=code)
    except ValueError as e:
        # The only refusal left once enough dates are clear: too few of them
        # agree with their neighbours once the outliers are set aside.
        if 'after cleaning' not in str(e):
            raise
        protocol.fail(
            f'{_dates(len(usable))} saw the area clearly, but fewer than '
            f'{gp_series.MIN_ACQUISITIONS} agree with the dates around them, and the trajectory '
            'needs that many. Choose a longer period.'
        )

    # The share of the area clear on each date the model used: of two orbits on
    # one date, the one it kept, which is the clearer of those it could use.
    clear_on: dict[str, float] = {}
    for a in read:
        if a.clear_fraction >= params.min_clear_fraction and np.isfinite(a.values).all():
            clear_on[a.date] = max(clear_on.get(a.date, 0.0), a.clear_fraction)

    def r(v: np.ndarray) -> list[float]:
        return [round(float(x), DECIMALS) for x in v]

    observed = out.observed_dates.astype(str).tolist()
    result: dict[str, Any] = {
        'dates': out.dates.astype(str).tolist(),
        'ndvi': r(out.ndvi),
        'lower': r(out.lower),
        'upper': r(out.upper),
        'level': gp_series.LEVEL,
        'observations': [
            {
                'date': d,
                'ndvi': round(float(v), DECIMALS),
                'clear_fraction': round(clear_on[d], 4),
                'kept': bool(k),
            }
            for d, v, k in zip(observed, out.observed_ndvi, out.kept, strict=True)
        ],
        'scenes_found': len(found),
        'scenes_read': len(read),
        'min_clear_fraction': params.min_clear_fraction,
        'region': code,
        'scale': out.scale_name,
        'multiplier': out.multiplier,
        'model': {
            'id': package.id,
            'version': package.version,
            'name': package.name,
            'digest': package.digest,
        },
    }
    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'trajectory': result}))
    sys.stdout.flush()
