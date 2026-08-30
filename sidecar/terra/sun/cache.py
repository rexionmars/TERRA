"""
The POWER series on disk: what a request resolves to, and whether it was
already fetched.

A POWER response is determined by the cell the point falls in on BOTH grids the
service serves, radiation at 1 degree and meteorology at 0.5 by 0.625, so the
key is the pair. Keying on either alone does not hold, because 0.625 does not
divide 1.0 and two points inside one meteorology cell can straddle a radiation
cell boundary.

It sits beside the reader rather than beside a product because five actions key
on it and four of them have no wind in them. It reads no product and no
product reads it except through an action.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from terra.sun import nasa_power


def power_cache_dir(req):
    """
    Directory the NASA POWER series are cached in, or None if it cannot be made.

    Deliberately outside work_dir: the Go runner creates a fresh temporary
    work_dir per run, so a cache written under it would never be read by the
    next one and the fetch would be paid again on every action.
    """
    raw = req.get('power_cache_dir')
    path = Path(raw) if raw else Path.home() / '.cache' / 'geosense' / 'power'
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    return path


# NASA POWER serves the radiation parameters on a 1 degree grid; see
# sun_power.GRID_NOTE, which states it beside every solar response.
POWER_RADIATION_STEP_DEG = 1.0


def power_cell_key(lon, lat):
    """
    The pair of grid cells a POWER point request resolves to, as a cache key.

    A POWER response is determined by the cell the point falls in on BOTH grids
    it serves: radiation on 1 degree (sun_power.GRID_NOTE) and meteorology on the
    MERRA-2 0.5 by 0.625 degree grid (nasa_power.meteorology_cell). Keying on
    alone does not hold, because 0.625 does not divide 1.0, so two points inside
    one MERRA-2 longitude cell can straddle a radiation cell boundary. The key
    is the pair, which is the conservative intersection.

    sun_power.request_point rounds to 0.01 degrees, about 1 km and far finer
    than either grid. Keying the cache on that produced a miss for two AOIs
    that resolve to identical series and each paid the fetch, so the reuse the
    cache states it guarantees did not hold.
    """
    met_lon, met_lat = nasa_power.meteorology_cell(lon, lat)
    rad_lon = round(round(float(lon) / POWER_RADIATION_STEP_DEG)
                    * POWER_RADIATION_STEP_DEG, 6)
    rad_lat = round(round(float(lat) / POWER_RADIATION_STEP_DEG)
                    * POWER_RADIATION_STEP_DEG, 6)
    return f'{met_lon:g}_{met_lat:g}_r{rad_lon:g}_{rad_lat:g}'


def cached_power_series(cache_dir, product, lon, lat, start, end, params,
                        fetch_fn, progress=None):
    """
    A POWER series read from disk when one covering `params` is stored, fetched
    and stored otherwise, with the provenance of whichever path was taken.

    The hourly request is the dominant cost of the whole analysis, measured at
    about 23 s for ten years, and three actions ask for the same series over
    the same cell. What determines a POWER response is the
    grid cell, the period and the parameter list, so those are the key; see
    power_cell_key for the cell.

    A stored file is reused when its columns cover the requested parameters, so
    a superset written by one action serves the subset another asks for.

    THE FETCH DATE TRAVELS WITH THE SERIES. POWER reprocesses historical data,
    so a cached series can be a superseded revision of the record. The cache has
    no expiry by design, because a research figure benchmarked against a stored
    run has to stay reproducible; what would make that dangerous is the run not
    saying so. Each series is stored with the timestamp it was fetched at, and
    the record returned here is carried into the response of every action that
    read one, so a cached run and a fetched run are distinguishable.

    Returns (frame, provenance).
    """
    import hashlib

    import pandas as pd

    def _record(source, fetched_utc, path=None):
        return {
            'source': source,
            'fetched_utc': fetched_utc,
            'product': product,
            'cell_key': cell,
            'period': f'{start}-{end}',
            'cache_file': None if path is None else path.name,
            'note': (
                'Fetched from NASA POWER during this run.'
                if source == 'fetch' else
                'Read from the on-disk POWER cache, not fetched during this '
                'run. POWER reprocesses historical data, so a series fetched '
                'earlier can be a superseded revision of the record; the fetch '
                'timestamp above is when it was retrieved.'
                if source == 'cache' else
                'No cache directory was available, so the series was fetched '
                'and not stored.'
            ),
        }

    def now():
        return datetime.now(UTC).replace(microsecond=0).isoformat()
    cell = power_cell_key(lon, lat)

    if cache_dir is None:
        return fetch_fn(progress), _record('fetch_uncached', now())

    prefix = f'{product}_{cell}_{start}_{end}_'
    wanted = set(params)
    for path in sorted(cache_dir.glob(prefix + '*.parquet')):
        try:
            stored = pd.read_parquet(path)
        except Exception:
            continue
        if wanted.issubset(stored.columns):
            return stored, _record('cache', _cache_fetch_time(path), path)

    df = fetch_fn(progress)
    fetched = now()
    key = hashlib.sha1(','.join(sorted(params)).encode()).hexdigest()[:12]
    final = cache_dir / (prefix + key + '.parquet')
    partial = cache_dir / (prefix + key + '.parquet.partial')
    try:
        df.to_parquet(partial)
        partial.replace(final)
        # Written after the parquet, so a stamp never exists for a series that
        # is not there. A missing stamp reads as an unknown fetch date rather
        # than as a fresh one.
        final.with_name(final.name + '.json').write_text(
            json.dumps({'fetched_utc': fetched, 'product': product,
                        'cell_key': cell, 'period': f'{start}-{end}',
                        'params': sorted(params)})
        )
    except Exception:
        # A cache that cannot be written must not fail a run that already holds
        # its data. The next run simply pays the fetch again.
        try:
            partial.unlink()
        except OSError:
            pass
    return df, _record('fetch', fetched, final)


def _cache_fetch_time(path):
    """
    When a cached series was fetched, from its stamp, or None if unrecorded.

    Files written before the stamp existed have none. Reporting None is the
    honest answer: the file modification time is when the parquet was written
    to this disk, which a copy or a restore changes, so it is not the fetch
    date and must not be presented as one.
    """
    stamp = path.with_name(path.name + '.json')
    try:
        return json.loads(stamp.read_text()).get('fetched_utc')
    except Exception:
        return None
