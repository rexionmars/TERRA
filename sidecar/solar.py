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

import functools

import numpy as np
import pandas as pd

from terra import stac

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
# Inverter oversizing factor, NOT a DC/AC ratio. pvlib's pdc0 is the inverter's
# DC input limit, so passing PDC0_W * 1.15 gives an inverter rated above the
# array and an array-to-inverter ratio of 1000/1104 = 0.906. The constant was
# previously labelled DC/AC, which reads as the opposite of what it does. The
# arithmetic is left unchanged on purpose: sizing the inverter to a true 1.15
# would move a shipped, externally benchmarked yield by 0.09 percent, which is
# not a change to make as a side effect of a relabelling.
INVERTER_OVERSIZE_RATIO = 1.15
FAIMAN_U0 = 25.0
FAIMAN_U1 = 6.84
ALBEDO = 0.20
# ASHRAE incidence-angle coefficient. Named because the beam correction and the
# diffuse one have to be the same relation integrated differently; two literals
# would let them drift apart.
IAM_ASHRAE_B = 0.05
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
            # The clear-sky reference, kept rather than dropped: it is already
            # in HOURLY_PARAMS and already fetched, and ghi/clrsky is the
            # hourly clearness -- how much of the available sun actually
            # arrived. Nothing downstream had it, so every consumer that wanted
            # to say whether an hour was overcast had to do without, and the
            # column was being paid for and thrown away.
            #
            # NOT in the dropna subset: an hour with no clear-sky reference is
            # still a usable hour of irradiance, and dropping it would shrink
            # every existing series for the sake of a column they do not read.
            #
            # OPTIONAL, and that is not defensiveness for its own sake. The
            # on-disk POWER cache has no expiry by design, so a series written
            # before this parameter was requested is still read today and has no
            # such column; requiring it turned a working cache into a KeyError.
            # Callers that construct a frame directly -- every test in this
            # module among them -- are the same case.
            **(
                {"clrsky": hourly["CLRSKY_SFC_SW_DWN"]}
                if "CLRSKY_SFC_SW_DWN" in hourly
                else {}
            ),
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


# Tilt resolution the diffuse modifier is evaluated on, in degrees.
#
# marion_diffuse integrates the incidence relation over the sky dome and the
# ground plane numerically, allocating a grid per tilt it is given. That is
# unremarkable for a fixed array, which has one tilt, and ruinous for a tracker,
# which has one per hour: passing the raw 17520-value tracker series built a
# grid for every hour of the record at once and drove resident memory into tens
# of gigabytes. Rounding to a tenth of a degree bounds the distinct values at
# 901 over the full 0-90 range, and the modifier varies by under 1e-4 across a
# step that size, so nothing measurable is lost.
DIFFUSE_IAM_TILT_DECIMALS = 1


@functools.lru_cache(maxsize=1024)
def _diffuse_iam_scalar(tilt: float) -> tuple:
    """
    Sky and ground incidence modifiers for one tilt, as a hashable pair list.

    Cached because the value depends on the tilt alone: the sky dome and the
    ground plane subtend the same solid angles every hour of the year, so the
    integral is a property of the geometry rather than of the record.
    """
    import pvlib

    d = pvlib.iam.marion_diffuse("ashrae", float(tilt), b=IAM_ASHRAE_B)
    return tuple((k, float(v)) for k, v in d.items())


def diffuse_iam(tilt):
    """
    Sky and ground incidence modifiers, for a fixed tilt or a tracker series.

    Returns floats for a scalar tilt and aligned Series for a varying one, so
    the caller multiplies without caring which it has.
    """
    if np.isscalar(tilt) or (getattr(tilt, "ndim", 0) == 0):
        return dict(_diffuse_iam_scalar(round(float(tilt), DIFFUSE_IAM_TILT_DECIMALS)))

    t = pd.Series(tilt)
    keys = np.round(t.to_numpy(dtype=float), DIFFUSE_IAM_TILT_DECIMALS)
    # One integration per distinct angle, not one per hour.
    lookup = {k: dict(_diffuse_iam_scalar(float(k))) for k in np.unique(keys)}
    return {
        part: pd.Series([lookup[k][part] for k in keys], index=t.index)
        for part in ("sky", "ground")
    }


def pv_yield_frame(
    poa, df: pd.DataFrame, solpos: pd.DataFrame, tilt: float, azimuth: float
) -> pd.DataFrame:
    """
    PVWatts DC and AC power for a 1 kWp reference array, with the intermediate
    stages of the chain.

    Module temperature from Faiman, DC from PVWatts, inversion from the PVWatts
    inverter model. Per kWp, so the result is a specific yield independent of
    plant size.

    Returns the frame the research solar_model.pv_yield returns: poa_global,
    g_eff, temp_cell, p_dc and p_ac. The intermediates are what a loss account
    needs; recomputing them at the call site would recompute the chain and let
    the two drift.
    """
    import pvlib

    # POA irradiance after the angle-of-incidence loss.
    #
    # IAM is NaN where the sun is behind the plane, which must read as no beam
    # rather than as a missing hour, and the sum is floored at zero.
    #
    # The diffuse components carry their own incidence-angle correction. Sky and
    # ground diffuse arrive from the whole hemisphere the plane sees, so their
    # effective incidence angle is a property of the tilt, not of the hour:
    # Marion (2013) integrates the ASHRAE relation over each solid angle once
    # per tilt. Ground-reflected light is the strongly corrected term because it
    # arrives near-grazing -- at 10 degrees of tilt it keeps 0.466 against 0.956
    # for the sky.
    #
    # This is a physics change, not a refactor, and every yield built on it
    # moves. At the reference site the IAM factor falls from 0.98694 to 0.97136
    # and the specific yield from 1474.73 to 1450.78 kWh/kWp/yr, which is
    # -1.62 percent.
    #
    # The size of the shift scales with how diffuse the site is, so it cannot be
    # quoted as one number: under a clear sky, where the diffuse share is 0.14,
    # the same correction costs 0.75 percent, and at the reference site's ~0.40
    # it costs 1.62. The ground term drives it -- reflected light arrives
    # near-grazing and keeps 0.788 at 26 degrees of tilt against 0.961 for the
    # sky.
    #
    # It is made because the omission was a declared overstatement in the loss
    # waterfall, and correcting it moves the chain toward the Global Solar Atlas
    # reference it is benchmarked against, not away from it.
    aoi = pvlib.irradiance.aoi(
        tilt, azimuth, solpos["apparent_zenith"], solpos["azimuth"]
    )
    iam = pvlib.iam.ashrae(aoi)
    iam_diffuse = diffuse_iam(tilt)
    g_eff = (
        poa["poa_direct"] * iam.fillna(0.0)
        + poa["poa_sky_diffuse"] * iam_diffuse["sky"]
        + poa["poa_ground_diffuse"] * iam_diffuse["ground"]
    ).clip(lower=0.0)
    temp_cell = pvlib.temperature.faiman(
        poa["poa_global"], df["temp_air"], df["wind"], u0=FAIMAN_U0, u1=FAIMAN_U1
    )
    p_dc = pvlib.pvsystem.pvwatts_dc(g_eff, temp_cell, PDC0_W, GAMMA_PDC)
    p_ac = pvlib.inverter.pvwatts(
        p_dc, PDC0_W * INVERTER_OVERSIZE_RATIO, eta_inv_nom=INVERTER_ETA_NOM
    )
    return pd.DataFrame(
        {
            "poa_global": poa["poa_global"],
            "g_eff": g_eff,
            "temp_cell": temp_cell,
            "p_dc": p_dc,
            "p_ac": p_ac,
        }
    )


def pv_yield(poa, df: pd.DataFrame, solpos: pd.DataFrame, tilt: float, azimuth: float):
    """AC power alone, for callers that need no intermediate stage."""
    return pv_yield_frame(poa, df, solpos, tilt, azimuth)["p_ac"]


def modelled_performance_ratio(p_ac: pd.Series, poa_global: pd.Series) -> float:
    """AC energy over what the array would deliver at STC efficiency."""
    e_ac = float(p_ac.sum()) / 1000.0
    e_ref = float(poa_global.sum()) / 1000.0 * (PDC0_W / 1000.0)
    return float(e_ac / e_ref) if e_ref > 0 else float("nan")


# --------------------------------------------------------------------- terrain
#
# The atmospheric resource has no spatial structure at AOI scale, but the
# irradiation reaching an inclined surface does, because the surface is terrain.
# That is the mappable quantity.

# Copernicus DEM GLO-30, served from the same STAC catalogue as Sentinel-2.
DEM_COLLECTION = "cop-dem-glo-30"

# Lookup grid over (slope, aspect). Coarser than the research grid: against the
# research configuration the mean error is 0.04 percent and the maximum 0.31,
# while the table shrinks from 1116 pairs to 198. Shortening the period is what
# costs accuracy, so the period is kept and the grid is coarsened.
SLOPE_GRID = np.arange(0.0, 31.0, 3.0)
ASPECT_GRID = np.arange(0.0, 360.0, 20.0)


def pixel_size_m(transform, lat: float) -> tuple[float, float]:
    """Approximate pixel dimensions in metres for a geographic grid."""
    dx_deg, dy_deg = abs(transform.a), abs(transform.e)
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = m_per_deg_lat * np.cos(np.radians(lat))
    return dx_deg * m_per_deg_lon, dy_deg * m_per_deg_lat


def horn_slope_aspect(z: np.ndarray, dx_m: float, dy_m: float):
    """
    Slope and aspect by the Horn (1981) third-order finite difference.

    Aspect is the compass bearing of the downhill direction, clockwise from
    north. A flat cell has no aspect and is returned as NaN rather than as a
    bearing of zero, which would read as north-facing.
    """
    p = np.pad(z, 1, mode="edge")
    nw, n_, ne = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    w_, e_ = p[1:-1, :-2], p[1:-1, 2:]
    sw, s_, se = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]

    # Rows increase southward, so the north gradient is top minus bottom.
    gx = ((ne + 2 * e_ + se) - (nw + 2 * w_ + sw)) / (8.0 * dx_m)
    gy = ((nw + 2 * n_ + ne) - (sw + 2 * s_ + se)) / (8.0 * dy_m)

    grad = np.hypot(gx, gy)
    slope = np.degrees(np.arctan(grad))
    aspect = np.degrees(np.arctan2(-gx, -gy)) % 360.0
    aspect = np.where(grad < 1e-9, np.nan, aspect)
    return slope, aspect


def build_poa_lookup(
    df: pd.DataFrame,
    solpos: pd.DataFrame,
    n_years: float,
    slopes: np.ndarray = SLOPE_GRID,
    aspects: np.ndarray = ASPECT_GRID,
    progress=None,
) -> np.ndarray:
    """
    Plane-of-array irradiation for every (slope, aspect) pair, kWh/m2/year.

    Transposition is the expensive step, so it runs once per pair here and the
    pixel grid is interpolated from the table rather than transposed per pixel.
    """
    table = np.empty((len(slopes), len(aspects)), dtype=float)
    for i, tilt in enumerate(slopes):
        if progress:
            progress(i, len(slopes))
        if tilt == 0.0:
            # A horizontal surface has no aspect; one transposition serves all.
            poa = transpose(df, solpos, 0.0, 0.0)
            table[i, :] = float(poa["poa_global"].sum()) / 1000.0 / n_years
            continue
        for j, az in enumerate(aspects):
            poa = transpose(df, solpos, float(tilt), float(az))
            table[i, j] = float(poa["poa_global"].sum()) / 1000.0 / n_years
    return table


def interpolate_poa(
    slope: np.ndarray,
    aspect: np.ndarray,
    table: np.ndarray,
    slopes: np.ndarray = SLOPE_GRID,
    aspects: np.ndarray = ASPECT_GRID,
) -> np.ndarray:
    """
    Bilinear interpolation of the lookup table onto the pixel grid.

    Aspect wraps at 360 degrees, so the table is extended by one column before
    interpolating rather than clamped, which would flatten north-facing slopes.
    """
    s = np.clip(np.nan_to_num(slope, nan=0.0), slopes[0], slopes[-1])
    a = np.mod(np.nan_to_num(aspect, nan=0.0), 360.0)

    aspects_ext = np.append(aspects, 360.0)
    table_ext = np.concatenate([table, table[:, :1]], axis=1)

    si = np.clip(np.searchsorted(slopes, s) - 1, 0, len(slopes) - 2)
    ai = np.clip(np.searchsorted(aspects_ext, a) - 1, 0, len(aspects_ext) - 2)
    s0, s1 = slopes[si], slopes[si + 1]
    a0, a1 = aspects_ext[ai], aspects_ext[ai + 1]
    ws = np.where(s1 > s0, (s - s0) / (s1 - s0), 0.0)
    wa = np.where(a1 > a0, (a - a0) / (a1 - a0), 0.0)

    v00 = table_ext[si, ai]
    v01 = table_ext[si, ai + 1]
    v10 = table_ext[si + 1, ai]
    v11 = table_ext[si + 1, ai + 1]
    return (
        v00 * (1 - ws) * (1 - wa)
        + v01 * (1 - ws) * wa
        + v10 * ws * (1 - wa)
        + v11 * ws * wa
    )


# ------------------------------------------------------------ horizon shading
#
# Terrain blocks the beam component near sunrise and sunset, and in an incised
# valley it blocks it for much of the day. The research measures a mean loss of
# 1.1 to 1.3 per cent of the annual beam over the study areas and up to 19 per
# cent in valley bottoms, so leaving it out overstates exactly the pixels a
# siting map should be most careful about.
N_HORIZON_AZIMUTHS = 16
# The research searches 60 pixels on a 27 x 30 m grid, about 1.7 km. Carried in
# metres because the DEM window here is in geographic degrees and its pixel size
# varies with latitude.
HORIZON_MAX_DIST_M = 1700.0
HORIZON_MAX_STEPS = 120


def horizon_angles(
    elevation: np.ndarray,
    dx_m: float,
    dy_m: float,
    n_azimuths: int = N_HORIZON_AZIMUTHS,
    max_dist_m: float = HORIZON_MAX_DIST_M,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Horizon elevation angle per pixel, per azimuth, walking outward on the DEM.

    Azimuths are clockwise from north, matching the aspect convention, so a
    solar azimuth indexes straight into the result.
    """
    h, w = elevation.shape
    az_deg = np.arange(0.0, 360.0, 360.0 / n_azimuths)
    step_m = max(min(dx_m, dy_m), 1e-6)
    n_steps = int(min(HORIZON_MAX_STEPS, max(1, round(max_dist_m / step_m))))

    z = np.nan_to_num(elevation, nan=float(np.nanmedian(elevation)))
    rows, cols = np.mgrid[0:h, 0:w]
    horizon = np.zeros((h, w, n_azimuths), dtype=np.float32)

    for k, az in enumerate(az_deg):
        drow = -np.cos(np.radians(az))   # north is a decreasing row index
        dcol = np.sin(np.radians(az))
        best = np.zeros((h, w), dtype=np.float32)
        for step in range(1, n_steps + 1):
            r = np.rint(rows + drow * step).astype(int)
            c = np.rint(cols + dcol * step).astype(int)
            inside = (r >= 0) & (r < h) & (c >= 0) & (c < w)
            dz = z[np.clip(r, 0, h - 1), np.clip(c, 0, w - 1)] - z
            dist = np.hypot(dcol * step * dx_m, drow * step * dy_m)
            ang = np.degrees(np.arctan2(dz, max(dist, 1e-6)))
            best = np.maximum(best, np.where(inside, ang, 0.0).astype(np.float32))
        horizon[:, :, k] = np.maximum(best, 0.0)
    return horizon, az_deg


def doy_window_mask(index, centre_date, half_width_days: int = 21):
    """
    Hours whose day of year lies within `half_width_days` of `centre_date`.

    NOT `season_mask`, which is further down this module and selects by NAMED
    season from a month table. This one centres on a date the caller observed,
    which is what a dated question needs and what a fixed set of months cannot
    express.

    WHY A RECORD IS NOT A SKY. A multi-year hourly record answers "what sun does
    this cell get", and averaging all of it answers a question nobody asked: the
    sun of no particular time. For anything dated -- a canopy observed on one
    Sentinel-2 pass, a yield on one harvest -- the season is the larger term.
    Measured on this project's own cached POWER records, faPAR varies by 0.068
    across months at one site against 0.016 across the entire latitude range of
    Brazil, so a whole-record average is wrong by four times the geographic
    signal it was assembled to capture.

    Kept as a day-of-year window rather than a date range so the other years in
    the record still contribute. One February in one year is a few hundred
    daylight hours and a thin histogram; three Februaries is a sky.

    The window wraps at the new year, which is not a detail in the southern
    hemisphere: the December-January window covers the peak of the Brazilian
    summer crop, and a naive `abs(doy - centre)` would cut it in half and keep
    the wrong half.

    Returns a boolean array, or None when there is no date to centre on -- the
    caller then keeps the whole record and says that it did.
    """
    if centre_date is None:
        return None
    try:
        centre = pd.Timestamp(str(centre_date)[:10]).dayofyear
    except (ValueError, TypeError):
        return None

    half = int(half_width_days)
    if half <= 0 or half >= 183:
        return None

    doy = np.asarray(index.dayofyear, dtype=float)
    gap = np.abs(doy - float(centre))
    gap = np.minimum(gap, 366.0 - gap)
    return gap <= half


def mean_beam_direction(df, solpos) -> dict | None:
    """
    The DNI-weighted mean direction of the beam, as azimuth and elevation.

    WHY A VECTOR MEAN AND NOT A MEAN OF ANGLES. Averaging azimuths is averaging
    a circular quantity, and the average of 350 and 10 degrees is 180 -- the
    exact opposite of the answer. Summing unit vectors weighted by the energy
    that arrived along each and taking the direction of the sum is the only
    form that survives the wrap.

    This is the single direction that best represents what the march actually
    integrated, so a scene lit from here is lit by the same sun the number came
    from. It is not solar noon and should not be labelled as such: it sits
    toward the hours that carried the energy.

    Returns None when no hour of the record has the sun up with usable beam.
    """
    elev = np.radians(90.0 - solpos["apparent_zenith"].to_numpy())
    az = np.radians(solpos["azimuth"].to_numpy())
    dni = df["dni"].to_numpy()
    up = (elev > 0) & np.isfinite(dni) & (dni > 0)
    if not up.any():
        return None

    w = dni[up]
    ce = np.cos(elev[up])
    # East-north-up, matching the azimuth convention pvlib returns: measured
    # clockwise from north.
    x = float(np.sum(w * ce * np.sin(az[up])))
    y = float(np.sum(w * ce * np.cos(az[up])))
    z = float(np.sum(w * np.sin(elev[up])))
    horizontal = float(np.hypot(x, y))
    if horizontal <= 0 and z <= 0:
        return None
    return {
        "azimuth_deg": float(np.degrees(np.arctan2(x, y)) % 360.0),
        "elevation_deg": float(np.degrees(np.arctan2(z, horizontal))),
        # How concentrated the beam was in direction. Near 1 the sun effectively
        # came from one place all season; low means the energy was spread across
        # the sky and a single direction represents it poorly.
        "concentration": float(np.sqrt(x * x + y * y + z * z) / np.sum(w)),
    }


def representative_day(df):
    """
    The date in `df` whose daily beam total is the median of the record given.

    A REAL DAY RATHER THAN AN AVERAGED ONE, and the difference matters near the
    equator. Averaging hour-of-day across a window degenerates exactly where
    this application's AOIs are: at latitude -4.5 the noon sun passes within ten
    degrees of the zenith for much of the year, azimuth swings tens of degrees
    in half an hour there, and a per-hour mean of azimuth produces a direction
    no sun ever occupied. Picking one actual day avoids the whole class.

    The median by beam total rather than the mean or the brightest: a window
    holds clear days and overcast ones, and the median is the day a reader would
    call typical.

    Returns None for an empty record.
    """
    if df is None or len(df) == 0:
        return None
    totals = df["dni"].groupby(df.index.date).sum()
    totals = totals[np.isfinite(totals.to_numpy())]
    if len(totals) == 0:
        return None
    order = totals.sort_values()
    return order.index[len(order) // 2]


def sun_track(df, solpos, day=None) -> list[dict]:
    """
    One day of sun, hour by hour: where it was and what arrived.

    This is what a viewer needs in order to draw the sun rather than assume it.
    Hours with the sun below the horizon are left out, because a scene has
    nothing to do with them and their azimuth is not meaningful to a renderer.

    `clearness` is the hour's global irradiance over its clear-sky reference:
    1.0 is a cloudless hour, and low values are the overcast ones a scene should
    render as flat and hazy. Absent when the clear-sky column is not carried.

    HOURS ARE UTC, which is why the field says so in its name. This module asks
    POWER for `time-standard=UTC` explicitly because the API's default is Local
    Solar Time, and a consumer that assumed the label meant local would place
    the sun three hours wrong for a Brazilian AOI -- at this project's own cell
    solar noon lands at 15h UTC. A renderer should drive itself from azimuth and
    elevation and treat the hour as a caption; nothing here depends on the label.
    """
    if df is None or len(df) == 0:
        return []
    if day is None:
        day = representative_day(df)
    if day is None:
        return []

    mask = np.asarray(df.index.date) == day
    d, s = df[mask], solpos[mask]
    elev = 90.0 - s["apparent_zenith"].to_numpy()
    up = elev > 0
    has_clear = "clrsky" in d.columns

    out = []
    for i in np.flatnonzero(up):
        row = {
            "hour_utc": int(d.index[i].hour),
            "azimuth_deg": float(s["azimuth"].to_numpy()[i]),
            "elevation_deg": float(elev[i]),
            "dni": float(d["dni"].to_numpy()[i]),
            "dhi": float(d["dhi"].to_numpy()[i]),
            "ghi": float(d["ghi"].to_numpy()[i]),
        }
        # THE DIFFUSE SHARE IS COMPUTED HERE, CLAMPED, rather than left as
        # dhi/ghi for a consumer to divide.
        #
        # The ratio is not bounded by 1 in this record and the excess is not
        # small: over three years at this project's cell it reaches 1.531, and
        # 4.2 percent of daylight hours exceed 1. Those hours have a median
        # elevation of 3.3 degrees and none above 14.7, and POWER's own
        # components do not close there -- (DHI + DNI cos z) / GHI has a median
        # of 1.17 across them. It is a grazing-sun artefact in the source, most
        # likely the hour-averaged fluxes disagreeing with geometry evaluated at
        # the interval mid-point when the sun crosses the horizon inside the
        # hour.
        #
        # Clamped at the source because every consumer would otherwise have to
        # know this. A renderer that clamps still draws something sensible, but
        # a caption reading "120% diffuse" is a number no one can defend, and
        # the caption is exactly what a viewer of this array would write.
        if row["ghi"] > 0:
            row["diffuse_share"] = float(min(max(row["dhi"] / row["ghi"], 0.0), 1.0))
        if has_clear:
            clear = float(d["clrsky"].to_numpy()[i])
            if np.isfinite(clear) and clear > 0:
                row["clearness"] = float(min(row["ghi"] / clear, 1.0))
        out.append(row)
    return out


def clearness(df) -> float | None:
    """
    Global irradiance over its clear-sky reference, across the whole record.

    How much of the sun that was available actually arrived: 1.0 is a cloudless
    record, and the difference from 1 is cloud. Measured over the cell this was
    developed against, a 21-day window runs 0.743 in February against 0.927 in
    October -- the same site, two visibly different skies.
    """
    if df is None or len(df) == 0 or "clrsky" not in df.columns:
        return None
    ghi = df["ghi"].to_numpy()
    clear = df["clrsky"].to_numpy()
    ok = np.isfinite(ghi) & np.isfinite(clear) & (clear > 0)
    if not ok.any():
        return None
    total = float(np.sum(clear[ok]))
    return float(np.sum(ghi[ok]) / total) if total > 0 else None


def beam_energy_histogram(
    df,
    solpos,
    n_azimuths: int = N_HORIZON_AZIMUTHS,
    elev_step: float = 1.0,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Beam energy binned over (solar azimuth, solar elevation).

    Pre-aggregating turns the per-pixel shading step into a table lookup instead
    of an hourly loop over every pixel.
    """
    elevation = 90.0 - solpos["apparent_zenith"].to_numpy()
    azimuth = solpos["azimuth"].to_numpy()
    dni = df["dni"].to_numpy()
    up = (elevation > 0) & np.isfinite(dni)

    az_bins = np.linspace(0, 360, n_azimuths + 1)
    el_edges = np.arange(0.0, 90.0 + elev_step, elev_step)
    az_idx = np.clip(np.digitize(azimuth[up], az_bins) - 1, 0, n_azimuths - 1)
    el_idx = np.clip(np.digitize(elevation[up], el_edges) - 1, 0, len(el_edges) - 2)

    hist = np.zeros((n_azimuths, len(el_edges) - 1), dtype=float)
    np.add.at(hist, (az_idx, el_idx), dni[up])
    return hist, el_edges


def shading_loss_fraction(
    horizon: np.ndarray,
    hist: np.ndarray,
    el_edges: np.ndarray,
) -> np.ndarray:
    """
    Share of the beam energy each pixel loses to its own horizon.

    Per azimuth sector, the cumulative beam energy arriving below the pixel
    horizon is blocked; sectors are summed and normalised by the annual total.
    """
    total = hist.sum()
    if total <= 0:
        return np.zeros(horizon.shape[:2])

    cum = np.cumsum(hist, axis=1)
    centres = 0.5 * (el_edges[:-1] + el_edges[1:])
    blocked = np.zeros(horizon.shape[:2], dtype=float)
    for k in range(horizon.shape[2]):
        idx = np.clip(np.searchsorted(centres, horizon[:, :, k]) - 1,
                      0, len(centres) - 1)
        blocked += np.where(horizon[:, :, k] > centres[0], cum[k][idx], 0.0)
    return np.clip(blocked / total, 0.0, 1.0)


def beam_fraction(df) -> float:
    """
    Share of the horizontal irradiation carried by the beam component.

    Shading removes beam energy only, so the loss fraction is scaled by this
    before it is applied to a plane-of-array total. The published shading layer
    stays unscaled, which is what the research reports.
    """
    ghi = float(np.nansum(df["ghi"].to_numpy()))
    dhi = float(np.nansum(df["dhi"].to_numpy()))
    if ghi <= 0:
        return 0.0
    return float(np.clip((ghi - dhi) / ghi, 0.0, 1.0))


# Below this mean horizon there is no enclosure to measure. Derived from the
# relation between the two: an isotropic sky view of cos^2(h) puts a 2 degree
# mean horizon at a 0.12 percent diffuse loss, which is under the rounding of
# every figure this module publishes. The threshold is read off the horizon the
# chain already traced, so it costs nothing to evaluate.
SVF_MIN_MEAN_HORIZON_DEG = 2.0


def sky_view_factor(horizon: np.ndarray) -> np.ndarray:
    """
    Share of the isotropic sky dome each pixel still sees.

    For a horizon elevation h in an azimuth sector, the fraction of the diffuse
    hemisphere that sector still admits is cos^2(h) (the sector integral of the
    isotropic radiance weighted by the cosine response of a horizontal plane).
    Averaging over sectors gives the pixel's sky view factor.

    Shading removed beam energy only, which is the expensive half to compute and
    the small half to collect: measured on a synthetic incised valley the beam
    term moves the median yield by -0.003 percent while the diffuse term moves
    it by -2.82 percent. On flat ground both vanish (-0.04 percent). The horizon
    that carries the beam answer already carries this one.
    """
    if horizon.size == 0:
        return np.ones(horizon.shape[:2], dtype=float)
    h = np.clip(np.nan_to_num(horizon, nan=0.0), 0.0, 90.0)
    return np.clip(np.cos(np.radians(h)) ** 2, 0.0, 1.0).mean(axis=2)


def diffuse_loss_fraction(horizon: np.ndarray) -> np.ndarray:
    """Share of the diffuse irradiance each pixel loses to its own horizon."""
    return np.clip(1.0 - sky_view_factor(horizon), 0.0, 1.0)


def horizon_enclosure(horizon: np.ndarray) -> dict:
    """
    Whether the terrain encloses the site enough for the diffuse loss to be a
    figure rather than noise, and the evidence for the verdict.

    Returned rather than applied, so the caller reports the threshold it was
    judged against instead of a bare boolean.
    """
    if horizon.size == 0:
        return {
            "mean_horizon_deg": 0.0,
            "max_horizon_deg": 0.0,
            "threshold_deg": SVF_MIN_MEAN_HORIZON_DEG,
            "encloses": False,
        }
    h = np.clip(np.nan_to_num(horizon, nan=0.0), 0.0, 90.0)
    mean_h = float(np.mean(h))
    return {
        "mean_horizon_deg": round(mean_h, 4),
        "max_horizon_deg": round(float(np.max(h)), 4),
        "threshold_deg": SVF_MIN_MEAN_HORIZON_DEG,
        "encloses": bool(mean_h >= SVF_MIN_MEAN_HORIZON_DEG),
    }


def fetch_dem(polygon, out_path, buffer_m: float = 0.0) -> str:
    """
    Copernicus DEM GLO-30 window covering the AOI.

    Served as a COG from the same Planetary Computer catalogue Sentinel-2 comes
    from, so this needs no new imagery infrastructure.

    `buffer_m` widens the window so terrain outside the AOI can still cast onto
    pixels inside it. Without it, a ridge just beyond the boundary is invisible
    and the pixels it shades are reported as unshaded.
    """
    import rasterio
    from rasterio.windows import from_bounds

    items = stac.search(DEM_COLLECTION, intersects=polygon)
    if not items:
        raise RuntimeError("no Copernicus DEM tile covers this AOI")

    minx, miny, maxx, maxy = polygon.bounds
    if buffer_m > 0:
        lat_mid = 0.5 * (miny + maxy)
        dlat = buffer_m / 111_320.0
        dlon = buffer_m / max(111_320.0 * np.cos(np.radians(lat_mid)), 1.0)
        minx, miny, maxx, maxy = minx - dlon, miny - dlat, maxx + dlon, maxy + dlat
    bounds = (minx, miny, maxx, maxy)

    with rasterio.open(items[0].assets["data"].href) as src:
        # Clip to the tile before reading. `read` silently drops the part of a
        # window that falls outside, while `window_transform` does not, so an
        # unclipped window near a tile edge would georeference the raster to the
        # wrong corner.
        window = from_bounds(*bounds, transform=src.transform).intersection(
            rasterio.windows.Window(0, 0, src.width, src.height)
        )
        data = src.read(1, window=window)
        profile = src.profile.copy()
        profile.update(
            height=data.shape[0],
            width=data.shape[1],
            transform=src.window_transform(window),
            driver="GTiff",
            compress="lzw",
        )
    if data.size == 0:
        raise RuntimeError("Copernicus DEM window is empty for this AOI")
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(data, 1)
    return str(out_path)


def terrain_rgba(
    values: np.ndarray,
    valid: np.ndarray,
    vmin: float,
    vmax: float,
    palette: str,
) -> np.ndarray:
    """
    Colour a continuous terrain layer on a domain decided by the caller.

    The domain is an argument rather than derived here because two layers can
    only be compared if they were drawn on the same one, and this function sees
    a single array. `render_scale` owns that decision.
    """
    import composite as comp

    if not np.isfinite(vmin) or not np.isfinite(vmax) or vmax <= vmin:
        vmin = 0.0 if not np.isfinite(vmin) else float(vmin)
        vmax = vmin + 1.0
    t = np.clip((np.nan_to_num(values, nan=vmin) - vmin) / (vmax - vmin), 0.0, 1.0)
    rgb = comp._lerp_cmap(t.astype(np.float32), comp.CONTINUOUS_STOPS[palette])
    h, w = values.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = (rgb[..., 0] * 255).astype(np.uint8)
    rgba[..., 1] = (rgb[..., 1] * 255).astype(np.uint8)
    rgba[..., 2] = (rgb[..., 2] * 255).astype(np.uint8)
    rgba[..., 3] = np.where(valid, 255, 0).astype(np.uint8)
    return rgba


# --------------------------------------------------------------------- seasons
#
# The annual map averages a geometry that reverses within the year: a
# north-facing slope receives far more than a south-facing one in winter and
# marginally less in summer. A quantity read from the annual map alone is the
# mean of two opposite situations, so the windows are carried explicitly.
SEASONS = {
    "annual": list(range(1, 13)),
    "winter": [6, 7, 8],
    "summer": [12, 1, 2],
    # Sowing to harvest of the western Parana winter cereals.
    "winter_crop": [5, 6, 7, 8, 9],
}


def season_mask(index, season: str) -> np.ndarray:
    return np.isin(index.month, SEASONS[season])


def season_years(index, season: str) -> float:
    """Seasons covered, so a total is per season rather than per record."""
    months = SEASONS[season]
    n_hours = int(season_mask(index, season).sum())
    denom = 8766.0 * len(months) / 12.0
    return (n_hours / denom) if denom > 0 else 1.0


# ------------------------------------------------------------- render policy
#
# Palette per quantity, matching the research renderers so an overlay and a
# published figure of the same quantity are the same colours: irradiation on
# inferno, shading loss on viridis, the seasonal ratio on a diverging ramp.
PALETTE_IRRADIATION = "inferno"
PALETTE_SHADING = "viridis"
PALETTE_ANISOTROPY = "rdbu_r"

# Fixed domains for the two layers whose value means something absolute.
# Anisotropy is a ratio with a reference at one; the window keeps that reference
# visible without spending half the ramp on values the quantity does not reach
# (0.33 to 0.83 over the study areas).
ANISOTROPY_DOMAIN = (0.3, 1.1)
ANISOTROPY_REFERENCE = 1.0
# Shading loss is a fraction; the research measures at most 0.19.
SHADING_DOMAIN = (0.0, 0.25)

# Seasons drawn on a shared domain, so the pair stays comparable.
SEASON_PAIR = {"winter": "summer", "summer": "winter"}


def render_scale(
    layer: str,
    values: np.ndarray | None = None,
    valid: np.ndarray | None = None,
    companion: np.ndarray | None = None,
    companion_valid: np.ndarray | None = None,
) -> dict:
    """
    Colour domain and palette for a terrain layer.

    Derived here rather than inside the renderer because winter and summer have
    to land on the same domain. Their spatial spread differs by roughly a factor
    of ten, so normalising each to its own range draws both at identical
    contrast and asserts the opposite of the measurement.

    `basis` records how the domain was chosen, so a client can say so instead of
    leaving the reader to assume.
    """
    if layer == "anisotropy":
        lo, hi = ANISOTROPY_DOMAIN
        return {"palette": PALETTE_ANISOTROPY, "min": lo, "max": hi,
                "reference": ANISOTROPY_REFERENCE, "basis": "fixed",
                "shared_with": None, "decimals": 2}

    if layer == "shading":
        lo, hi = SHADING_DOMAIN
        return {"palette": PALETTE_SHADING, "min": lo, "max": hi,
                "reference": None, "basis": "fixed",
                "shared_with": None, "decimals": 3}

    pool = _finite(values, valid)
    if layer in SEASON_PAIR and companion is not None:
        pool = np.concatenate([pool, _finite(companion, companion_valid)])
        basis, shared_with = "shared", SEASON_PAIR[layer]
    else:
        basis, shared_with = "own", None

    if pool.size == 0:
        lo, hi = 0.0, 1.0
    else:
        lo, hi = float(pool.min()), float(pool.max())
    return {"palette": PALETTE_IRRADIATION, "min": lo, "max": hi,
            "reference": None, "basis": basis,
            "shared_with": shared_with, "decimals": 0}


def _finite(values, valid) -> np.ndarray:
    """Valid, finite samples of a layer, flattened."""
    if values is None:
        return np.empty(0, dtype=float)
    m = np.isfinite(values)
    if valid is not None:
        m &= valid
    return values[m].ravel()


# ----------------------------------------------------------------- suitability
#
# PROJECT CONVENTIONS, NOT VERIFIED LEGAL RESTRICTIONS. The slope limits follow
# common practice for fixed-tilt utility photovoltaics with standard racking,
# and the excluded-cover list is a reading of MapBiomas classes. Legal reserve,
# permanent preservation areas and municipal zoning require the CAR and local
# legislation, which this analysis does not consult. Both are request
# parameters, and every response repeats the values it used.
SLOPE_ACCEPTABLE_DEG = 10.0
SLOPE_RESTRICTIVE_DEG = 15.0

# Forest formation (legal reserve and riparian protection), planted forest,
# urban, water and perennial crops.
EXCLUDED_COVER = (3, 9, 24, 33, 46, 47, 48)
# Classes where installation competes with annual cropping.
CROPLAND_COVER = (20, 39, 40, 41, 62)

SUITABILITY_LEGEND = [
    {"code": 0, "name": "Excluded - protected or occupied cover", "color": "#4d4d4d"},
    {"code": 1, "name": "Excluded - slope above the limit", "color": "#8c510a"},
    {"code": 2, "name": "Restrictive - slope near the limit", "color": "#dfc27d"},
    {"code": 3, "name": "Suitable - conflicts with annual cropping", "color": "#fdae61"},
    {"code": 4, "name": "Suitable - no land-use conflict", "color": "#1a9850"},
]


def suitability_map(
    slope: np.ndarray,
    mapbiomas: np.ndarray,
    valid: np.ndarray,
    slope_acceptable: float = SLOPE_ACCEPTABLE_DEG,
    slope_restrictive: float = SLOPE_RESTRICTIVE_DEG,
    excluded_cover=EXCLUDED_COVER,
    cropland_cover=CROPLAND_COVER,
) -> np.ndarray:
    """
    Five-class siting map from slope limits and land-cover eligibility.

    Cropland is its own class and is never merged into the suitable area: a
    pixel that is geometrically fine but currently produces soybean carries a
    trade-off a binary map would hide.

    A pixel with no slope is treated as steep rather than flat, so missing
    terrain cannot present itself as suitable.
    """
    out = np.full(slope.shape, -1, dtype=np.int16)
    s = np.nan_to_num(slope, nan=90.0)

    is_excluded = np.isin(mapbiomas, list(excluded_cover))
    is_cropland = np.isin(mapbiomas, list(cropland_cover))

    out[valid] = 4
    out[valid & is_cropland] = 3
    out[valid & (s > slope_acceptable) & (s <= slope_restrictive)] = 2
    out[valid & (s > slope_restrictive)] = 1
    out[valid & is_excluded] = 0
    return out


def suitability_rgba(suit: np.ndarray) -> np.ndarray:
    """Paint the siting classes, matching the classification overlay path."""
    h, w = suit.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for entry in SUITABILITY_LEGEND:
        m = suit == entry["code"]
        if not np.any(m):
            continue
        c = entry["color"].lstrip("#")
        rgba[m] = [int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), 255]
    return rgba


def suitability_stats(suit: np.ndarray, px_area_ha: float) -> list[dict]:
    """Area per class. The two suitable classes are reported separately."""
    rows = []
    total = int((suit >= 0).sum())
    for entry in SUITABILITY_LEGEND:
        n = int((suit == entry["code"]).sum())
        rows.append({
            "code": entry["code"],
            "name": entry["name"],
            "color": entry["color"],
            "pixels": n,
            "area_ha": round(float(n * px_area_ha), 3),
            "pct": round(float(100.0 * n / total), 2) if total else 0.0,
        })
    return rows
