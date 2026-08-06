"""
Solar resource and photovoltaic yield at a point, from NASA POWER.

Physics with no trained head, so unlike the classifier this carries no fixed
legend and no domain to shift out of, and unlike every Sentinel-2 product it
cannot fail on scene availability: any AOI on Earth returns an answer.

Chain, following mestrado/experiments/solar_resource:

    NASA POWER      point time series, radiation from SYN1DEG (CERES) at 1 deg
                    and meteorology from MERRA-2 at 0.5 x 0.625 deg
    pvlib           solar position, Perez transposition to a tilted plane,
                    Faiman module temperature, PVWatts DC and inverter

RESOLUTION. The radiation product resolves a single 1 degree cell, so every
point inside a field-scale AOI returns the same series. The result describes the
cell the AOI sits in, not structure within the AOI. Callers must surface that:
a per-AOI number shown without it reads as local.

YIELD CALIBRATION. The modelled performance ratio runs near 0.877 because this
chain omits soiling, inter-row shading, degradation, availability and cabling.
Against the Global Solar Atlas that makes the specific yield high by roughly 3
to 7 percent. The reported yield is therefore computed at a reference ratio, and
both the applied and the modelled ratio are returned so the assumption is
visible. See report.md section 9.1.
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

# Hourly values are hour-averaged fluxes labelled by the hour they begin, so
# solar geometry is evaluated at the mid-point of the interval.
HOUR_LABEL_OFFSET_MIN = 30

# PV reference array and model coefficients.
PDC0_W = 1000.0              # 1 kWp, so the result is a specific yield
GAMMA_PDC = -0.0035          # power temperature coefficient, 1/C, crystalline Si
INVERTER_ETA_NOM = 0.96
INVERTER_PDC0_RATIO = 1.15   # DC/AC ratio
FAIMAN_U0 = 25.0
FAIMAN_U1 = 6.84
ALBEDO = 0.20
TRANSPOSITION_MODEL = "perez"
SOLAR_CONSTANT = 1361.0      # W/m2, Kopp and Lean (2011)

# Fixed-tilt search. Half-degree steps resolve an optimum that is reported to
# the nearest degree; the azimuth sweep is relative to north.
TILT_SWEEP_DEG = (0.0, 45.0, 0.5)

# Applied when the caller does not supply one. Near the Global Solar Atlas
# reference, which includes the loss terms this chain omits.
REFERENCE_PERFORMANCE_RATIO = 0.80

# The radiation grid is 1 degree, so requests are keyed on the cell rather than
# on the exact centroid: neighbouring AOIs resolve to the same series.
GRID_DECIMALS = 2

GRID_NOTE = (
    "Radiation is resolved on a 1 degree grid, so the whole AOI falls in one "
    "cell and no structure within it is resolved. Meteorology comes from a "
    "0.5 by 0.625 degree grid."
)


def grid_key(lon: float, lat: float) -> tuple[float, float]:
    """Coordinate rounded to the cell a POWER request resolves to."""
    return (round(float(lon), GRID_DECIMALS), round(float(lat), GRID_DECIMALS))


def _request(url: str, retries: int = 3, timeout: int = 300) -> dict:
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
        payload = _request(build_url(temporal, lon, lat, params, s, e))
        frames.append(to_frame(payload, temporal))
    if not frames:
        raise RuntimeError("NASA POWER returned no data for this period")
    return pd.concat(frames).sort_index()


def annual_totals(daily: pd.DataFrame, column: str = "ALLSKY_SFC_SW_DWN") -> pd.Series:
    """
    Annual sums over complete calendar years only.

    A partial year would read as a low one and would bias both the spread and
    the trend.
    """
    s = daily[column].dropna()
    if s.empty:
        return pd.Series(dtype=float)
    counts = s.groupby(s.index.year).count()
    complete = counts[counts >= 365].index
    return s[s.index.year.isin(complete)].groupby(lambda t: t.year).sum()


def linear_trend(values: pd.Series) -> tuple[float, float]:
    """
    Least-squares slope per year and its two-sided p-value.

    Returns (0, 1) for fewer than three points, which reads as no detectable
    trend rather than as a fitted one.
    """
    if values.size < 3:
        return 0.0, 1.0
    from scipy import stats

    res = stats.linregress(values.index.astype(float), values.values.astype(float))
    return float(res.slope), float(res.pvalue)


def monthly_climatology(daily: pd.DataFrame) -> list[dict]:
    """Mean daily GHI, DNI, DHI and clearness index by calendar month."""
    out = []
    by_month = daily.groupby(daily.index.month)
    for month, block in by_month:
        row = {"month": int(month)}
        for key, name in (
            ("ALLSKY_SFC_SW_DWN", "ghi"),
            ("ALLSKY_SFC_SW_DNI", "dni"),
            ("ALLSKY_SFC_SW_DIFF", "dhi"),
            ("ALLSKY_KT", "kt"),
        ):
            v = block[key].mean() if key in block else np.nan
            row[name] = None if pd.isna(v) else round(float(v), 4)
        out.append(row)
    return out


def clear_sky_index(daily: pd.DataFrame) -> float | None:
    """
    All-sky over clear-sky irradiation: how much of the available resource the
    atmosphere actually delivered.
    """
    if "ALLSKY_SFC_SW_DWN" not in daily or "CLRSKY_SFC_SW_DWN" not in daily:
        return None
    allsky = daily["ALLSKY_SFC_SW_DWN"].sum()
    clear = daily["CLRSKY_SFC_SW_DWN"].sum()
    if not clear or pd.isna(clear) or clear <= 0:
        return None
    return round(float(allsky / clear), 4)


def prepare_hourly(hourly: pd.DataFrame, lat: float, lon: float, elevation: float):
    """
    Hourly irradiance and solar position on a shared index.

    Geometry is evaluated at the mid-point of each interval because POWER
    labels an hour-averaged flux by the hour it begins.
    """
    import pvlib

    df = pd.DataFrame(
        {
            "ghi": hourly["ALLSKY_SFC_SW_DWN"],
            "dni": hourly["ALLSKY_SFC_SW_DNI"],
            "dhi": hourly["ALLSKY_SFC_SW_DIFF"],
            "temp_air": hourly["T2M"],
            "wind": hourly["WS2M"],
        }
    ).dropna(subset=["ghi", "dni", "dhi"])
    mid = df.index + pd.Timedelta(minutes=HOUR_LABEL_OFFSET_MIN)
    solpos = pvlib.solarposition.get_solarposition(
        mid, lat, lon, altitude=elevation
    )
    solpos.index = df.index
    return df, solpos


def transpose(df: pd.DataFrame, solpos: pd.DataFrame, tilt: float, azimuth: float):
    """Plane-of-array irradiance for a fixed surface (Perez et al. 1990)."""
    import pvlib

    dni_extra = pvlib.irradiance.get_extra_radiation(
        df.index, solar_constant=SOLAR_CONSTANT
    )
    airmass = pvlib.atmosphere.get_relative_airmass(solpos["apparent_zenith"])
    return pvlib.irradiance.get_total_irradiance(
        surface_tilt=tilt,
        surface_azimuth=azimuth,
        solar_zenith=solpos["apparent_zenith"],
        solar_azimuth=solpos["azimuth"],
        dni=df["dni"],
        ghi=df["ghi"],
        dhi=df["dhi"],
        dni_extra=dni_extra,
        airmass=airmass,
        albedo=ALBEDO,
        model=TRANSPOSITION_MODEL,
    )


def sweep_tilt(
    df: pd.DataFrame,
    solpos: pd.DataFrame,
    azimuth: float,
    n_years: float,
) -> list[dict]:
    """Annual plane-of-array insolation against fixed tilt."""
    lo, hi, step = TILT_SWEEP_DEG
    rows = []
    for tilt in np.arange(lo, hi + step / 2, step):
        poa = transpose(df, solpos, float(tilt), azimuth)
        annual = float(poa["poa_global"].sum()) / 1000.0 / n_years
        rows.append({"tilt_deg": float(tilt), "poa_kwh_m2_year": annual})
    return rows


def pv_yield(poa, df: pd.DataFrame, solpos: pd.DataFrame, tilt: float, azimuth: float):
    """
    PVWatts DC and AC power for a 1 kWp reference array.

    Module temperature from Faiman, DC from PVWatts, inversion from the PVWatts
    inverter model. Per kWp, so the result is a specific yield independent of
    plant size.
    """
    import pvlib

    # POA irradiance after the angle-of-incidence loss on the beam component.
    # IAM is NaN where the sun is behind the plane, which must read as no beam
    # rather than as a missing hour, and the sum is floored at zero.
    aoi = pvlib.irradiance.aoi(
        tilt, azimuth, solpos["apparent_zenith"], solpos["azimuth"]
    )
    iam = pvlib.iam.ashrae(aoi)
    g_eff = (poa["poa_direct"] * iam.fillna(0.0) + poa["poa_diffuse"]).clip(lower=0.0)
    temp_cell = pvlib.temperature.faiman(
        poa["poa_global"], df["temp_air"], df["wind"], u0=FAIMAN_U0, u1=FAIMAN_U1
    )
    p_dc = pvlib.pvsystem.pvwatts_dc(g_eff, temp_cell, PDC0_W, GAMMA_PDC)
    p_ac = pvlib.inverter.pvwatts(
        p_dc, PDC0_W * INVERTER_PDC0_RATIO, eta_inv_nom=INVERTER_ETA_NOM
    )
    return p_ac


def modelled_performance_ratio(p_ac: pd.Series, poa_global: pd.Series) -> float:
    """AC energy over what the array would deliver at STC efficiency."""
    e_ac = float(p_ac.sum()) / 1000.0
    e_ref = float(poa_global.sum()) / 1000.0 * (PDC0_W / 1000.0)
    return float(e_ac / e_ref) if e_ref > 0 else float("nan")
