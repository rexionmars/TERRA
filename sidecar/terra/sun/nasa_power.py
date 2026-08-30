"""
The one reader of the NASA POWER record.

Physics with no trained head, so unlike the classifier this carries no fixed
legend and no domain to shift out of, and unlike every Sentinel-2 product it
cannot fail on scene availability: any point on Earth returns an answer.

    NASA POWER      point time series, radiation from SYN1DEG (CERES) at 1 deg
                    and meteorology from MERRA-2 at 0.5 x 0.625 deg

RESOLUTION. The radiation product resolves a single 1 degree cell, so every
point inside a field-scale AOI returns the same series. The result describes the
cell the AOI sits in, not structure within the AOI. Callers must surface that:
a per-AOI number shown without it reads as local.

`request` was `solar._request`. It is the single transport for both the
radiation and the meteorology paths, so the two cannot drift apart in how they
handle a failure against the same endpoint, and after the split it crosses a
package boundary to reach the wind screening -- a private name imported across
packages is the one-reader rule written as a lie.

Named for the source rather than for power, because electrical power is the
subject of the modules in terra/energy and the collision would be unreadable.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

import numpy as np
import pandas as pd

POWER_BASE = "https://power.larc.nasa.gov/api/temporal"


POWER_COMMUNITY = "RE"


POWER_TIME_STANDARD = "UTC"


# POWER writes this for a missing value. Left in place it would sink a
# climatology by hundreds of units, so it becomes NaN on read.
FILL_VALUE = -999.0


DAILY_PARAMS = [
    "ALLSKY_SFC_SW_DWN",   # GHI
    "CLRSKY_SFC_SW_DWN",   # GHI under a clear sky
    "ALLSKY_SFC_SW_DNI",   # DNI
    "ALLSKY_SFC_SW_DIFF",  # DHI
    "ALLSKY_KT",           # clearness index as published by POWER
    "T2M",
    "WS2M",
]


HOURLY_PARAMS = [
    "ALLSKY_SFC_SW_DWN",
    "CLRSKY_SFC_SW_DWN",
    "ALLSKY_SFC_SW_DNI",
    "ALLSKY_SFC_SW_DIFF",
    "T2M",
    "WS2M",
]


# The radiation grid is 1 degree, so requests are keyed on the cell rather than
# on the exact centroid: neighbouring AOIs resolve to the same series.
GRID_DECIMALS = 2


GRID_NOTE = (
    "Radiation is resolved on a 1 degree grid, so the whole AOI falls in one "
    "cell and no structure within it is resolved. Meteorology comes from a "
    "0.5 by 0.625 degree grid."
)


def request_point(lon: float, lat: float) -> tuple[float, float]:
    """
    The coordinate as a request carries it, rounded to GRID_DECIMALS.

    NOT the cell the request resolves to, which is what this was called and
    what its name said. 0.01 degrees is about 1 km and finer than either grid
    POWER serves, so two points this separates can return the same series --
    keying the on-disk cache on it produced a miss for two AOIs inside one
    cell, and each paid the fetch the cache exists to avoid. terra/actions.py
    power_cell_key is where the cell is decided; this only normalises the
    coordinate so one AOI does not request under two spellings of its centroid.
    """
    return (round(float(lon), GRID_DECIMALS), round(float(lat), GRID_DECIMALS))


# MERRA-2 cell size. Finer than the 1 degree radiation grid this module's
# radiation product resolves, so two nearby AOIs can legitimately return
# different meteorology, and a cell-to-cell difference is still a difference
# between reanalysis cells, not between sites.
MERRA2_LON_STEP = 0.625
MERRA2_LAT_STEP = 0.5


def meteorology_cell(lon: float, lat: float) -> tuple[float, float]:
    """
    Centre of the MERRA-2 cell a POWER request resolves to.

    Requests inside one cell return identical wind, temperature, pressure and
    elevation, so this is both the cache key and the statement a response has
    to carry about what the numbers describe.

    It lives beside the radiation reader rather than beside the turbine because
    the cache key is the intersection of BOTH grids -- 0.625 does not divide
    1.0 -- and four of the five actions that key on it have no wind in them.
    """
    return (
        round(round(float(lon) / MERRA2_LON_STEP) * MERRA2_LON_STEP, 6),
        round(round(float(lat) / MERRA2_LAT_STEP) * MERRA2_LAT_STEP, 6),
    )


def request(url: str, retries: int = 3, timeout: int = 300) -> dict:
    """One POWER call, retried on transport errors with a widening pause."""
    last: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as fh:
                return json.load(fh)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"NASA POWER request failed after {retries} attempts: {last}")


def build_url(
    temporal: str,
    lon: float,
    lat: float,
    params: list[str],
    start: str,
    end: str,
) -> str:
    return (
        f"{POWER_BASE}/{temporal}/point?"
        f"parameters={','.join(params)}"
        f"&community={POWER_COMMUNITY}"
        f"&longitude={lon}&latitude={lat}"
        f"&start={start}&end={end}"
        f"&format=JSON&time-standard={POWER_TIME_STANDARD}"
    )


def to_frame(payload: dict, temporal: str) -> pd.DataFrame:
    """POWER payload to a time-indexed frame, with fill values as NaN."""
    param = payload["properties"]["parameter"]
    df = pd.DataFrame(param)
    fmt = "%Y%m%d" if temporal == "daily" else "%Y%m%d%H"
    df.index = pd.to_datetime(df.index, format=fmt, utc=(temporal == "hourly"))
    df.index.name = "time"
    return df.replace(FILL_VALUE, np.nan).sort_index()


def fetch(
    temporal: str,
    lon: float,
    lat: float,
    start: str,
    end: str,
    progress=None,
) -> pd.DataFrame:
    """
    A POWER series, requested one year at a time.

    Chunked by whole years so a failure costs one year rather than the whole
    period, following the reference client.
    """
    params = DAILY_PARAMS if temporal == "daily" else HOURLY_PARAMS
    y0, y1 = int(start[:4]), int(end[:4])
    frames = []
    total = y1 - y0 + 1
    for i, year in enumerate(range(y0, y1 + 1)):
        s = f"{year}0101"
        e = f"{year}1231"
        if progress:
            progress(i, total, year)
        payload = request(build_url(temporal, lon, lat, params, s, e))
        frames.append(to_frame(payload, temporal))
    if not frames:
        raise RuntimeError("NASA POWER returned no data for this period")
    return pd.concat(frames).sort_index()
