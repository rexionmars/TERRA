"""
The vegetation health action: this season over an area, the same days of the
year in earlier seasons, and the one against the other.
"""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import numpy as np

from terra import aoi, protocol
from terra.imagery import cog

# Acquisitions read at once. Each is up to five windowed reads of cloud-optimised
# GeoTIFFs, which wait on the network rather than on the processor: one field
# over four seasons took 7 min 47 s of wall time for 32 s of processor time at
# four at once.
READERS = 8

# ColorBrewer BrBG: brown below the earlier seasons, green above, white at none.
BRBG = [
    (0.549, 0.318, 0.039),
    (0.847, 0.702, 0.396),
    (0.965, 0.910, 0.765),
    (0.961, 0.961, 0.961),
    (0.780, 0.918, 0.898),
    (0.353, 0.706, 0.675),
    (0.004, 0.400, 0.369),
]


def _rgba(values: np.ndarray, low: float, high: float, stops) -> np.ndarray:
    """Values over [low, high] through `stops`; transparent where not finite."""
    from terra.imagery import composite

    finite = np.isfinite(values)
    t = np.where(finite, (values - low) / (high - low), 0.0)
    rgb = composite._lerp_cmap(t, stops)
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    rgba[..., :3] = (rgb * 255).astype(np.uint8)
    rgba[..., 3] = np.where(finite, 255, 0).astype(np.uint8)
    return rgba


def health(req: protocol.Request, work_dir: Path) -> None:
    from rasterio.warp import transform_bounds

    from terra.health import series
    from terra.imagery import composite, mosaic

    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    start = str(req.get('start') or '')
    end = str(req.get('end') or '')
    if not start or not end:
        protocol.fail('start and end are required')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])
    max_cloud = protocol.request_number(req, 'max_cloud', 60.0)
    years = int(protocol.request_number(req, 'baseline_years', series.BASELINE_YEARS, int))
    years = years if years > 0 else series.BASELINE_YEARS
    window = series.WINDOW_DAYS

    cog.configure()

    def note(msg: str) -> None:
        protocol.emit_progress(-1, msg)

    protocol.emit_progress(2, 'building the grid')
    grid = mosaic.reference_grid(polygon, 0.0)
    inside = mosaic.area_mask(polygon, grid)
    if not inside.any():
        protocol.fail('the area covers no 10 m cell')

    def read(scenes: list[mosaic.Scene], keep, lo: int, hi: int, label: str) -> list[series.Observation]:
        """Every acquisition's figures, read a few at a time, in date order."""
        out: list[series.Observation] = []
        done = 0
        with ThreadPoolExecutor(max_workers=READERS) as pool:
            futures = [pool.submit(series.observe, s, grid, inside, keep(s)) for s in scenes]
            for s, f in zip(scenes, futures, strict=True):
                try:
                    obs = f.result()
                except Exception as e:  # a tile that fails to read is one date lost
                    note(f'{label} {s.date}: not read ({e})')
                    obs = None
                done += 1
                if obs is None:
                    note(f'{label} {s.date}: under {100 * series.MIN_CLEAR:.0f}% of the area clear')
                else:
                    out.append(obs)
                protocol.emit_progress(
                    lo + int((hi - lo) * done / max(1, len(scenes))),
                    f'{label}: {done} of {len(scenes)} acquisitions read',
                )
        return series.one_per_date(out)

    # This season, every map kept until the one to show is known.
    protocol.emit_progress(4, f'searching this season ({start} to {end})')
    found = sorted(mosaic.search_scenes(grid, start, end, max_cloud, series.BANDS), key=lambda s: s.date)
    if not found:
        protocol.fail(f'no Sentinel-2 acquisition over the area from {start} to {end} under {max_cloud:.0f}% cloud')
    current = read(found, lambda _s: True, 6, 40, 'this season')
    if not current:
        protocol.fail(
            f'no acquisition from {start} to {end} saw {100 * series.MIN_CLEAR:.0f}% of the area clearly'
        )
    shown = series.map_date(current)
    for o in current:
        if o is not shown:
            o.ndvi_map = None

    # The earlier seasons, with a map kept only near the shown date's day of the year.
    reference: list[tuple[int, series.Observation]] = []
    read_years: list[int] = []
    for k in range(1, years + 1):
        lo = 40 + int(50 * (k - 1) / years)
        hi = 40 + int(50 * k / years)
        a, b = series.window_of(start, end, k)
        protocol.emit_progress(lo, f'searching the season {k} year{"s" if k > 1 else ""} earlier ({a} to {b})')
        try:
            earlier = sorted(mosaic.search_scenes(grid, a, b, max_cloud, series.BANDS), key=lambda s: s.date)
        except Exception as e:
            note(f'the season {k} years earlier could not be searched ({e})')
            continue
        obs = read(
            earlier,
            lambda s: series.doy_distance(s.date, shown.date) <= window,
            lo,
            hi,
            f'{k} year{"s" if k > 1 else ""} earlier',
        )
        if obs:
            read_years.append(date.fromisoformat(a).year)
            reference.extend((k, o) for o in obs)

    protocol.emit_progress(92, 'comparing with the earlier seasons')
    anomaly = [series.against(o, reference, window) for o in current]
    with_reference = [a for a in anomaly if a['ndvi_z'] is not None]
    latest = with_reference[-1] if with_reference else None

    protocol.emit_progress(95, 'writing the maps')
    near = [o for _, o in reference if series.doy_distance(o.date, shown.date) <= window]
    diff = series.anomaly_map(shown, near)
    outside = ~inside
    diff[outside] = np.nan
    assert shown.ndvi_map is not None
    ndvi = shown.ndvi_map.copy()
    ndvi[outside] = np.nan
    anomaly_png = work_dir / 'health_anomaly.png'
    ndvi_png = work_dir / 'health_ndvi.png'
    composite.write_rgba_png(_rgba(diff, -series.MAP_RANGE, series.MAP_RANGE, BRBG), anomaly_png)
    composite.write_rgba_png(_rgba(ndvi, 0.0, 1.0, composite.CONTINUOUS_STOPS['rdylgn']), ndvi_png)
    if not near:
        note('no earlier acquisition near the shown date: the anomaly map is empty')

    lon_min, lat_min, lon_max, lat_max = transform_bounds(
        grid.crs, 'EPSG:4326', *grid.bounds, densify_pts=21
    )
    result = {
        'extent': {
            'lon_min': lon_min,
            'lat_min': lat_min,
            'lon_max': lon_max,
            'lat_max': lat_max,
        },
        'window_days': window,
        'baseline_years': sorted(read_years),
        'current': [o.point() for o in current],
        'baseline': [
            {**o.point(), 'year': date.fromisoformat(o.date).year} for _, o in reference
        ],
        'anomaly': anomaly,
        'latest': latest,
        'map_date': shown.date,
        'map_range': series.MAP_RANGE,
        'anomaly_png': str(anomaly_png),
        'ndvi_png': str(ndvi_png),
    }
    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'health': result}))
    sys.stdout.flush()
