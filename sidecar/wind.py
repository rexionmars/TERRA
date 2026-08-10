"""
Wind resource screening at a point, from NASA POWER hourly MERRA-2.

Chain:

    NASA POWER      point time series, MERRA-2 meteorology on a
                    0.5 latitude by 0.625 longitude grid: WS10M, WS50M,
                    WD10M, WD50M, T2M, PS, plus WS2M for the diagnostic
    power law       shear exponent from the two measured heights, then
                    extrapolation to hub height
    scipy           two-parameter Weibull by maximum likelihood
    IEA Task 37     published electrical power curve of the IEA-3.4-130
                    reference turbine, with a density normalisation

STANDING OF THE RESULT. Unlike the photovoltaic chain in sidecar/solar.py,
which is benchmarked against the Global Solar Atlas, nothing here is validated
against an external wind reference. Every turbine-level figure is a screening
indication, gross of wake and array losses, availability, electrical collection
losses, icing, blade soiling and curtailment, and it rests on an extrapolation
above the highest level the reanalysis carries. `RESULT_QUALIFIER` states this
and `assess` attaches it to the response; callers must display it beside the
numbers, not behind a disclosure.

DIAGNOSTICS ARE THE PRODUCT. The research report for this project discarded the
wind estimate at one of its study sites on the evidence of the near-surface
field, and that judgement was made by reading numbers rather than by computing
them. `data_quality` computes them: the calm fraction at each height, the record
maximum, the shear exponent inverted to an equivalent surface roughness, and the
completeness count. A caller that shows the capacity factor without them is
showing an unqualified number.

The two heights the reanalysis carries are 10 m and 50 m. Nothing above 50 m is
constrained by the data.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import solar

POWER_BASE = solar.POWER_BASE
POWER_COMMUNITY = solar.POWER_COMMUNITY
POWER_TIME_STANDARD = solar.POWER_TIME_STANDARD
FILL_VALUE = solar.FILL_VALUE

# Wind, direction and the two air-density inputs. The hourly endpoint accepts
# 20 parameters per request, so these travel in one call per year.
RESOURCE_PARAMS = ["WS10M", "WS50M", "WD10M", "WD50M", "T2M", "PS"]

# WS2M is fetched for the diagnostic alone. It sits below the roughness
# sublayer of a real crop canopy and is the field the project already found
# implausible; using it in the resource calculation would carry that defect
# into the answer.
DIAGNOSTIC_PARAMS = ["WS2M"]

HOURLY_PARAMS = RESOURCE_PARAMS + DIAGNOSTIC_PARAMS

# MERRA-2 cell size. Finer than the 1 degree radiation grid solar.py resolves,
# so two nearby AOIs can legitimately return different wind, and a cell-to-cell
# difference is still a difference between reanalysis cells, not between sites.
MERRA2_LON_STEP = 0.625
MERRA2_LAT_STEP = 0.5

GRID_NOTE = (
    "Wind comes from a 0.5 by 0.625 degree MERRA-2 cell, so the whole AOI "
    "falls in one cell and no structure within it is resolved. Two AOIs in "
    "different cells return different series, but a difference between cells "
    "is a difference between reanalysis cells and is not evidence of a "
    "difference between the sites."
)

# Heights the hourly product carries. The upper one is the ceiling on
# interpolation: above it the power law has no observational constraint.
HEIGHT_LOWER_M = 10.0
HEIGHT_UPPER_M = 50.0
INTERPOLATION_CEILING_M = HEIGHT_UPPER_M

# ISO 2533:1975 Standard Atmosphere, 287.05287 J kg-1 K-1 rounded. Equal to the
# CIPM-2007 value of R over the molar mass of dry air.
R_DRY = 287.05

# Density the published power curve is referenced to, read from the turbine
# definition file (air_density: 1.225) and equal to the ISO 2533 sea-level
# standard density.
RHO_REFERENCE = 1.225

# Density normalisation is applied to the wind speed with an exponent of 1/3,
# not to the power. The exponent follows from the cubic dependence of the
# kinetic flux and needs no standard to justify it; the attribution of the rule
# to a clause of IEC 61400-12-1 is the part that is not established here. The
# specification's own flagging of that gap is preserved verbatim:
#
#   "IEC 61400-12-1 power performance measurement: for active-power-controlled
#   (pitch-regulated, variable-speed) turbines the wind speed is normalised by
#   (rho/rho_0)^(1/3); power is normalised by (rho_0/rho) only for
#   stall-regulated turbines. The IEA-3.4-130 is pitch-regulated
#   variable-speed. NOT verifiable from within this environment; the
#   implementer must confirm the clause against the standard before the
#   citation appears in the UI."
#
#   "The IEC 61400-12-1 density-normalisation rule (speed by (rho/rho_0)^(1/3)
#   for active-pitch machines, power by rho_0/rho for stall-regulated) is
#   stated from recollection of the standard and could not be verified in this
#   environment. The physics of the (1/3) exponent is unambiguous and the
#   direction of the correction was checked numerically, but the clause
#   attribution must be confirmed against the standard text before it is shown
#   in the UI. Similarly, the widely reproduced Counihan (1975) empirical
#   relation alpha = 0.096*log10(z0) + 0.016*(log10 z0)^2 + 0.24 was evaluated
#   during analysis and agrees with the log-profile derivation to within 0.03,
#   but this specification deliberately uses only the log-profile inversion,
#   which requires no memorised coefficients. Do not introduce the Counihan
#   coefficients without checking the paper. The same applies to the IEC
#   61400-1 normal wind profile exponent of 0.2, which is quoted nowhere in the
#   assumptions for that reason."
#
# Consequence for this module: the exponent is applied to the SPEED, as
# (rho / 1.225)^(1/3), and follows from the cubic dependence of the wind power
# flux on speed. Attributing that rule, rather than a power-side correction, to
# a clause of IEC 61400-12-1 has not been checked against the standard text in
# this project, so no clause is cited anywhere for it.
DENSITY_EXPONENT = 1.0 / 3.0

# Humidity is not carried in the density calculation: air density uses the
# dry-air gas constant. The magnitude of the neglect was measured on one year
# of QV2M at one of the study cells: the virtual-temperature form lowers mean
# density by 0.765 percent, which is 0.256 percent on the normalised speed.
# Project conventions, editable by the caller. None is a measured value.
HUB_HEIGHT_M = 110.0            # the reference turbine hub
RECORD_YEARS = 10               # mirrors the hourly window of solar_resource
CALM_THRESHOLD_MS = 0.5         # taken from the project's existing diagnostic
# Open agricultural land with scattered buildings and windbreaks; an assumed
# land-cover property, not a measurement at any AOI. The shear plausibility
# band moves with it.
ROUGHNESS_BAND_M = (0.03, 0.10)
RECORD_MAX_FLOOR_MS = 10.0      # no published basis; see RECORD_MAX_FLOOR_NOTE
CALM_FRACTION_2M_FLAG_PCT = 50.0  # no published basis; see CALM_2M_NOTE

RECORD_MAX_FLOOR_NOTE = (
    "The floor of 10 m/s on the record maximum at 10 m is a project "
    "convention with no published basis. It exists to catch a near-surface "
    "field whose extremes are absent. Read the record maximum and the record "
    "length rather than the flag alone."
)

CALM_2M_NOTE = (
    "The 50 percent threshold on the 2 m calm fraction is a project "
    "convention with no published basis, set so that the field the project "
    "has already found implausible is flagged. The 2 m level is never used "
    "in this resource calculation."
)

# Roughness lengths the sensitivity sweep evaluates in addition to the band
# ends. Project conventions chosen to bracket the band from a smooth surface to
# a rough one, so the table shows the exponent the result is sensitive to rather
# than only the two values the band supplies. Each row states its roughness.
SENSITIVITY_ROUGHNESS_M = (0.01, 0.40)

# Mean Gregorian year. sidecar/solar.py divides by 8760 in its capacity-factor
# denominator, so a user comparing the two blocks sees a 0.07 percent
# difference. The solar constant is left alone: 8760 produced the capacity
# factors already stored in saved runs, and changing it would alter them.
HOURS_PER_YEAR = 8766.0

# Local time for the day/night shear split, derived from longitude rather than
# fixed, since the block runs for any AOI.
DAY_HOURS_LOCAL = (9, 15)
NIGHT_HOURS_LOCAL = (21, 3)

# Reference turbine.
#
# Bortolotti, P., Canet Tarres, H., Dykes, K., Merz, K., Sethuraman, L.,
# Verelst, D. and Zahle, F. (2019). IEA Wind Task 37 on Systems Engineering in
# Wind Energy, WP2.1 Reference Wind Turbines. NREL/TP-5000-73492.
# https://www.nrel.gov/docs/fy19osti/73492.pdf
#
# Specification fields read from
# https://raw.githubusercontent.com/IEAWindTask37/IEA-3.4-130-RWT/master/yaml/IEA-3.4-130-RWT.yaml
TURBINE_NAME = "IEA-3.4-130-RWT"
TURBINE_CITATION = (
    "Bortolotti, Canet Tarres, Dykes, Merz, Sethuraman, Verelst and Zahle "
    "(2019). IEA Wind Task 37 on Systems Engineering in Wind Energy, WP2.1 "
    "Reference Wind Turbines. NREL/TP-5000-73492."
)
TURBINE_CITATION_URL = "https://www.nrel.gov/docs/fy19osti/73492.pdf"
TURBINE_RATED_POWER_W = 3.37e6
TURBINE_ROTOR_DIAMETER_M = 130.0
TURBINE_HUB_HEIGHT_M = 110.0
TURBINE_BLADES = 3
TURBINE_CLASS = "IEC III"
TURBINE_TURBULENCE_CLASS = "A"
TURBINE_CUT_IN_MS = 3.0
TURBINE_CUT_OUT_MS = 25.0

# Published curve, vendored rather than fetched at runtime: the repository has
# already been renamed once (IEAWindTask37 redirects to IEAWindSystems) and the
# sidecar has no other third-party network dependency.
#
# Source file, column 1 (wind speed, m/s) and column 4 (rotor electrical power,
# W) of the 50-row, 12-column table:
# https://raw.githubusercontent.com/IEAWindTask37/IEA-3.4-130-RWT/master/performance/performance_ccblade.dat
# Commit d0e12b296d025a1c8aa99d5ba7630654837cc59e, 2020-09-23.
#
# The electrical column already carries drivetrain and generator loss: its
# maximum of 3.370105 MW against the aerodynamic maximum of 3.597987 MW is a
# ratio of 0.93666, consistent with the gearbox_efficiency of 0.955 in the
# turbine definition. It does not carry wake, availability, electrical
# collection, icing, soiling or curtailment loss.
POWER_CURVE_MS_W: tuple[tuple[float, float], ...] = (
    (3.000000, 51620.327), (3.539160, 123368.159),
    (4.048453, 213241.509), (4.526748, 318837.998),
    (4.972983, 435956.487), (5.386168, 560898.305),
    (5.765385, 688906.312), (6.109792, 819125.776),
    (6.418625, 949723.673), (6.691197, 1075927.005),
    (6.926904, 1193682.699), (7.125223, 1299172.102),
    (7.285712, 1388952.513), (7.408017, 1460081.742),
    (7.491864, 1510222.643), (7.537068, 1537725.022),
    (7.543529, 1541682.933), (7.575826, 1561569.465),
    (7.646809, 1605876.078), (7.756320, 1675862.931),
    (7.904116, 1773500.601), (8.089870, 1901498.529),
    (8.313168, 2063341.406), (8.573516, 2263331.677),
    (8.870334, 2506635.948), (9.202964, 2799332.771),
    (9.570668, 3148458.978), (9.812675, 3370000.000),
    (10.407953, 3370000.035), (10.875676, 3370000.717),
    (11.374758, 3370000.085), (11.904092, 3370000.018),
    (12.462503, 3370011.453), (13.048749, 3370000.030),
    (13.661530, 3370001.728), (14.299486, 3370008.641),
    (14.961199, 3370033.669), (15.645201, 3370000.061),
    (16.349973, 3370000.238), (17.073950, 3370001.502),
    (17.815525, 3370002.288), (18.573052, 3370002.284),
    (19.344847, 3370018.233), (20.129199, 3370034.011),
    (20.924365, 3370004.589), (21.728580, 3369999.956),
    (22.540058, 3370000.667), (23.356998, 3370003.948),
    (24.177586, 3370000.090), (25.000000, 3370104.925),
)

CURVE_SPEED_MS = np.array([p[0] for p in POWER_CURVE_MS_W], dtype=float)
CURVE_POWER_W = np.array([p[1] for p in POWER_CURVE_MS_W], dtype=float)

# Rated speed is not a field of the turbine definition; it is the first tabulated
# speed at which the electrical column reaches rated power. The plateau of the
# published table straddles 3.37 MW by fractions of a watt, so the comparison
# carries a relative tolerance: an exact one would depend on how many digits of
# each point were vendored above and could select a row far up the plateau.
RATED_SPEED_MS = float(
    CURVE_SPEED_MS[np.argmax(CURVE_POWER_W >= TURBINE_RATED_POWER_W * (1.0 - 1e-9))]
)

EXCLUDED_LOSSES = (
    "wake and array losses",
    "turbine availability",
    "electrical collection and transformer losses",
    "icing",
    "blade soiling",
    "curtailment",
    "high-wind hysteresis",
)

RESULT_QUALIFIER = (
    "Screening indication, not a resource assessment. The capacity factor and "
    "the annual energy are gross: they are the published power curve applied "
    "to a modelled free-stream series, with no allowance for "
    + ", ".join(EXCLUDED_LOSSES)
    + ". No figure here has been compared with an external wind reference "
    "such as the Global Wind Atlas, the Atlas do Potencial Eolico Brasileiro "
    "or the Atlas de Energia Eolica do Estado do Parana, so it carries none "
    "of the validation the photovoltaic result carries against the Global "
    "Solar Atlas. Energy is reported per turbine; array losses are not "
    "modelled, so it must not be multiplied by a plant size."
)

MEASURED_QUALIFIER = (
    "These are the quantities the reanalysis carries directly at 10 m and "
    "50 m. They involve no height extrapolation and no turbine model, but "
    "they are reanalysis output and have not been compared with a mast, a "
    "mesoscale product or a published wind atlas at this AOI. Read them with "
    "the data-quality diagnostics."
)

# Hourly reanalysis means do not resolve gusts or short-duration extremes.
# Nothing this module produces supports a turbine suitability or loads
# assessment, which requires turbulence intensity and extreme wind statistics
# that hourly means cannot supply. Kept as a boundary on what may be added
# here, not as a string for the caller.

DIRECTION_CONVENTION_NOTE = (
    "The direction is reported as the direction the wind comes from. The API "
    "publishes only the name 'Wind Direction at 10 Meters' and the unit "
    "'Degrees'; the convention was inferred from the sign of the turning "
    "between 10 m and 50 m and from the circular mean being physically "
    "plausible for the region. It was not read from the API."
)


def grid_key(lon: float, lat: float) -> tuple[float, float]:
    """
    Centre of the MERRA-2 cell a POWER request resolves to.

    Requests inside one cell return identical wind, temperature, pressure and
    elevation, so this is both the cache key and the statement a response has
    to carry about what the numbers describe.
    """
    return (
        round(round(float(lon) / MERRA2_LON_STEP) * MERRA2_LON_STEP, 6),
        round(round(float(lat) / MERRA2_LAT_STEP) * MERRA2_LAT_STEP, 6),
    )


def build_url(lon: float, lat: float, start: str, end: str,
              params: list[str] | None = None) -> str:
    """Hourly POWER point request, built the same way as sidecar/solar.py."""
    names = HOURLY_PARAMS if params is None else params
    return (
        f"{POWER_BASE}/hourly/point?"
        f"parameters={','.join(names)}"
        f"&community={POWER_COMMUNITY}"
        f"&longitude={lon}&latitude={lat}"
        f"&start={start}&end={end}"
        f"&format=JSON&time-standard={POWER_TIME_STANDARD}"
    )


def to_frame(payload: dict) -> pd.DataFrame:
    """POWER hourly payload to a UTC-indexed frame, with fill values as NaN."""
    param = payload["properties"]["parameter"]
    df = pd.DataFrame(param)
    df.index = pd.to_datetime(df.index, format="%Y%m%d%H", utc=True)
    df.index.name = "time"
    return df.replace(FILL_VALUE, np.nan).sort_index()


def record_period(end_year: int, n_years: int = RECORD_YEARS) -> tuple[str, str]:
    """
    First and last day of a whole-year window ending at `end_year`.

    Whole calendar years only, because a partial year biases both the annual
    means and the monthly climatology.
    """
    n = max(1, int(n_years))
    return f"{end_year - n + 1}0101", f"{end_year}1231"


def fetch(lon: float, lat: float, start: str, end: str, progress=None) -> pd.DataFrame:
    """
    The hourly wind and air series, requested one calendar year at a time.

    Chunked so a failure costs one year rather than the whole period, following
    sidecar/solar.py. This is the only function in the module that touches the
    network; everything below consumes the frame it returns.

    The whole-year chunking means a sub-year period is widened to the calendar
    years it falls in, which is the same behaviour the solar client has.
    """
    y0, y1 = int(start[:4]), int(end[:4])
    frames = []
    total = y1 - y0 + 1
    for i, year in enumerate(range(y0, y1 + 1)):
        if progress:
            progress(i, total, year)
        # Deliberately the solar client's retry loop rather than a second copy,
        # so the two blocks cannot drift apart in how they handle a transport
        # failure against the same endpoint.
        payload = solar._request(build_url(lon, lat, f"{year}0101", f"{year}1231"))
        frames.append(to_frame(payload))
    if not frames:
        raise RuntimeError("NASA POWER returned no data for this period")
    return pd.concat(frames).sort_index()


# Shear and extrapolation


def mean_speed(df: pd.DataFrame, column: str) -> float:
    """Arithmetic mean of an hourly speed column, NaN excluded."""
    return float(df[column].mean())


def shear_exponent_bulk(df: pd.DataFrame) -> float:
    """
    Power-law exponent between 10 m and 50 m, from the two long-term means.

    alpha = ln(mean(WS50M) / mean(WS10M)) / ln(50 / 10).

    The bulk form is used rather than the mean or median of the hourly
    exponents because it is the exponent that reproduces the long-term mean
    profile. The hourly forms belong in the diagnostic: applying an exponent
    per hour preferentially amplifies the stable night hours, which raises the
    capacity factor without any physical warrant.
    """
    v10 = mean_speed(df, "WS10M")
    v50 = mean_speed(df, "WS50M")
    if not np.isfinite(v10) or v10 <= 0 or not np.isfinite(v50) or v50 <= 0:
        return float("nan")
    return float(np.log(v50 / v10) / np.log(HEIGHT_UPPER_M / HEIGHT_LOWER_M))


def hourly_shear_exponent(df: pd.DataFrame) -> pd.Series:
    """Per-hour exponent ln(WS50M/WS10M)/ln(5), for the diagnostic only."""
    v10 = df["WS10M"].where(df["WS10M"] > 0)
    v50 = df["WS50M"].where(df["WS50M"] > 0)
    return np.log(v50 / v10) / np.log(HEIGHT_UPPER_M / HEIGHT_LOWER_M)


def utc_offset_hours(lon: float) -> int:
    """
    Nominal local-time offset from longitude.

    Derived rather than fixed so the day and night windows follow the AOI.
    Nominal solar offset, not the civil time zone, which is what the split
    needs: the point is the diurnal cycle of the boundary layer.
    """
    return int(round(float(lon) / 15.0))


def day_night_shear(df: pd.DataFrame, lon: float) -> tuple[float, float]:
    """
    Median hourly shear exponent by day and by night, in local hours.

    Reported because the single bulk exponent is a mixture of two regimes. A
    large day-night gap says that much of the bulk value is nocturnal
    stable-layer decoupling rather than surface roughness, which is the
    difference between a resource and an artefact of the boundary-layer scheme.
    """
    alpha_h = hourly_shear_exponent(df)
    local_hour = (df.index.hour + utc_offset_hours(lon)) % 24
    d0, d1 = DAY_HOURS_LOCAL
    n0, n1 = NIGHT_HOURS_LOCAL
    day = (local_hour >= d0) & (local_hour <= d1)
    night = (local_hour >= n0) | (local_hour <= n1)
    return (
        float(np.nanmedian(alpha_h[day])) if day.any() else float("nan"),
        float(np.nanmedian(alpha_h[night])) if night.any() else float("nan"),
    )


def alpha_from_roughness(z0: float,
                         z_lower: float = HEIGHT_LOWER_M,
                         z_upper: float = HEIGHT_UPPER_M) -> float:
    """
    Power-law exponent equivalent to a neutral logarithmic profile.

    alpha = ln[ ln(z_upper/z0) / ln(z_lower/z0) ] / ln(z_upper/z_lower).

    Uses only the neutral log profile, so it introduces no empirical
    coefficient that would have to be sourced.
    """
    if z0 <= 0 or z0 >= z_lower:
        return float("nan")
    ratio = np.log(z_upper / z0) / np.log(z_lower / z0)
    return float(np.log(ratio) / np.log(z_upper / z_lower))


def implied_roughness_length(alpha: float,
                             z_lower: float = HEIGHT_LOWER_M,
                             z_upper: float = HEIGHT_UPPER_M) -> float:
    """
    Surface roughness length that a neutral log profile would need to produce
    `alpha` between the two heights.

    The plausibility test that needs no fitted constant: the answer can be read
    against the land cover directly. Returns NaN when the exponent falls
    outside the range the relation can invert.
    """
    from scipy import optimize

    if not np.isfinite(alpha) or alpha <= 0:
        return float("nan")

    def residual(z0: float) -> float:
        return alpha_from_roughness(z0, z_lower, z_upper) - alpha

    lo, hi = 1e-6, 0.95 * z_lower
    try:
        if residual(lo) * residual(hi) > 0:
            return float("nan")
        return float(optimize.brentq(residual, lo, hi))
    except (ValueError, RuntimeError):
        return float("nan")


def shear_plausibility(alpha: float,
                       roughness_band_m: tuple[float, float] = ROUGHNESS_BAND_M) -> dict:
    """
    The observed exponent against the band the assumed land cover supports.

    Returns the observed exponent, the roughness it inverts to, the assumed
    roughness band and the exponent band that band maps to, together, so the
    flag carries its own justification instead of asserting a verdict.
    """
    z0_lo, z0_hi = float(roughness_band_m[0]), float(roughness_band_m[1])
    alpha_lo = alpha_from_roughness(z0_lo)
    alpha_hi = alpha_from_roughness(z0_hi)
    z0_implied = implied_roughness_length(alpha)
    consistent = bool(np.isfinite(alpha) and alpha_lo <= alpha <= alpha_hi)
    return {
        "shear_exponent": _round(alpha, 4),
        "implied_roughness_length_m": _round(z0_implied, 3),
        "assumed_roughness_band_m": [z0_lo, z0_hi],
        "expected_shear_exponent_band": [_round(alpha_lo, 4), _round(alpha_hi, 4)],
        "consistent_with_assumed_cover": consistent,
    }


def extrapolate_speed(v_upper: pd.Series, hub_height_m: float, alpha: float) -> pd.Series:
    """
    Power-law extrapolation of the 50 m series to hub height.

    v_hub(t) = WS50M(t) * (z_hub / 50)^alpha, with one exponent for the whole
    record. Extrapolation starts from the upper measured height so the distance
    travelled beyond the data is as short as it can be.
    """
    return v_upper * float(hub_height_m / HEIGHT_UPPER_M) ** float(alpha)


def extrapolation_status(hub_height_m: float, alpha: float,
                         roughness_band_m: tuple[float, float] = ROUGHNESS_BAND_M) -> dict:
    """
    Whether the hub height leaves the data, and by how much.

    The ceiling is set by the product, not by convention: 50 m is the highest
    level the hourly series carries. Below it the power law interpolates
    between two measured levels; above it nothing in the data constrains the
    result.
    """
    ratio = float(hub_height_m) / INTERPOLATION_CEILING_M
    is_extrapolation = float(hub_height_m) > INTERPOLATION_CEILING_M
    plaus = shear_plausibility(alpha, roughness_band_m)
    if not is_extrapolation:
        statement = (
            f"The hub height of {hub_height_m:.0f} m is at or below the 50 m "
            "level the reanalysis carries, so the profile is interpolated "
            "between two measured levels rather than extrapolated."
        )
    else:
        z0 = plaus["implied_roughness_length_m"]
        band = plaus["expected_shear_exponent_band"]
        z0_band = plaus["assumed_roughness_band_m"]
        # The inversion has no root when the exponent lies outside what a
        # neutral log profile can produce between 10 m and 50 m, which is
        # itself the finding and must not print as a missing value.
        if z0 is None:
            roughness_clause = (
                "That exponent lies outside the range a neutral logarithmic "
                "profile between 10 m and 50 m can produce for any roughness "
                "length, so it has no equivalent surface"
            )
        else:
            roughness_clause = (
                "That exponent corresponds to a neutral-equivalent roughness "
                f"length of {z0} m"
            )
        statement = (
            "Wind speed is carried by the reanalysis at 10 m and 50 m. The "
            f"value at {hub_height_m:.0f} m is a power-law extrapolation "
            f"{ratio:.1f} times above the highest level in the data, using a "
            f"shear exponent of {alpha:.3f} derived from those two levels. "
            + roughness_clause
            + f", whereas the assumed cover supports {z0_band[0]} to "
            f"{z0_band[1]} m and a shear exponent of {band[0]:.3f} to "
            f"{band[1]:.3f}. "
        )
        # The direction of the error is only assertable when the exponent is
        # outside the band. Inside it the extrapolation is still unconstrained
        # by data, and saying so without a direction is the accurate statement.
        if not plaus["consistent_with_assumed_cover"] and alpha > band[1]:
            statement += (
                "The exponent is above that band, so the hub-height speed and "
                "every quantity derived from it are likely to be overstated. "
            )
        elif not plaus["consistent_with_assumed_cover"]:
            statement += (
                "The exponent is outside that band, so the hub-height speed "
                "and every quantity derived from it rest on a profile that "
                "does not describe the assumed cover. "
            )
        statement += (
            "The sensitivity table gives the magnitude across the exponent "
            "range. A resource assessment at this hub height requires a met "
            "mast or a mesoscale product that resolves the hub level."
        )
    return {
        "hub_height_m": float(hub_height_m),
        "interpolation_ceiling_m": INTERPOLATION_CEILING_M,
        "height_ratio": _round(ratio, 3),
        "is_extrapolation": is_extrapolation,
        "statement": statement,
    }


# Distribution


def weibull_fit(speeds: pd.Series | np.ndarray) -> tuple[float, float]:
    """
    Two-parameter Weibull by maximum likelihood, returning (k, c).

    scipy.stats.weibull_min.fit with the location pinned to zero. Fitted at
    50 m, the level the data carries; the fit at another height is a rescaling,
    since a power-law height change multiplies c and leaves k unchanged.

    The estimator has to be named wherever k and c are shown: on the study
    series maximum likelihood, method of moments and the Justus empirical form
    disagree by up to 12 percent in k.
    """
    from scipy import stats

    v = np.asarray(speeds, dtype=float)
    v = v[np.isfinite(v) & (v > 0)]
    if v.size < 2:
        return float("nan"), float("nan")
    k, _loc, c = stats.weibull_min.fit(v, floc=0)
    return float(k), float(c)


def weibull_scale_at_height(c_upper: float, hub_height_m: float, alpha: float) -> float:
    """Weibull scale carried from 50 m to hub height by the same power law."""
    return float(c_upper) * float(hub_height_m / HEIGHT_UPPER_M) ** float(alpha)


def weibull_moment_check(k: float, c: float, speeds: pd.Series | np.ndarray) -> dict:
    """
    Fitted first and third moments against the empirical ones.

    The goodness-of-fit statement that has to travel with k and c. The third
    moment is the one that matters for energy, which is why it is reported
    rather than a distance statistic on the distribution.
    """
    from scipy.special import gamma

    v = np.asarray(speeds, dtype=float)
    v = v[np.isfinite(v)]
    if v.size == 0 or not np.isfinite(k) or not np.isfinite(c):
        return {}
    emp_mean = float(v.mean())
    emp_cube = float((v ** 3).mean())
    fit_mean = float(c * gamma(1.0 + 1.0 / k))
    fit_cube = float(c ** 3 * gamma(1.0 + 3.0 / k))
    return {
        "empirical_mean_ms": _round(emp_mean, 4),
        "weibull_mean_ms": _round(fit_mean, 4),
        "mean_error_pct": _round(100.0 * (fit_mean - emp_mean) / emp_mean, 3),
        "empirical_mean_cube_m3s3": _round(emp_cube, 3),
        "weibull_mean_cube_m3s3": _round(fit_cube, 3),
        "mean_cube_error_pct": _round(100.0 * (fit_cube - emp_cube) / emp_cube, 3),
        "estimator": "maximum likelihood, scipy.stats.weibull_min.fit with floc=0",
    }


def energy_pattern_factor(speeds: pd.Series | np.ndarray) -> float:
    """
    mean(v^3) / mean(v)^3.

    States how much of the resource sits in the tail, which is what a reader
    needs in order to see why a mean speed alone does not determine energy.
    """
    v = np.asarray(speeds, dtype=float)
    v = v[np.isfinite(v)]
    if v.size == 0:
        return float("nan")
    m = float(v.mean())
    if m <= 0:
        return float("nan")
    return float((v ** 3).mean() / m ** 3)


# Air density and the power curve


def air_density(df: pd.DataFrame) -> pd.Series:
    """
    Hourly dry-air density from surface pressure and temperature.

    rho = PS * 1000 / (R_dry * (T2M + 273.15)), with PS published in kPa and
    T2M in degrees Celsius. Pressure is a property of the same MERRA-2 cell as
    the wind, so the two are internally consistent. Humidity is neglected; see
    the constant block above for the measured magnitude.
    """
    return df["PS"] * 1000.0 / (R_DRY * (df["T2M"] + 273.15))


def equivalent_speed(v: pd.Series, rho: pd.Series,
                     rho_reference: float = RHO_REFERENCE) -> pd.Series:
    """
    Wind speed normalised to the density the power curve is referenced to.

    v_eq = v * (rho / rho_reference)^(1/3). At the elevations this project
    works at the site density is below the reference, so the correction reduces
    the speed and therefore the energy.
    """
    return v * (rho / float(rho_reference)) ** DENSITY_EXPONENT


def wind_power_density(v: pd.Series, rho: pd.Series) -> float:
    """
    0.5 * mean(rho * v^3), W/m2.

    The hourly product is averaged rather than the means multiplied, so the
    covariance between density and speed is retained.
    """
    x = (0.5 * rho * v ** 3).to_numpy(dtype=float)
    x = x[np.isfinite(x)]
    return float(x.mean()) if x.size else float("nan")


def turbine_power(v_eq: pd.Series) -> pd.Series:
    """
    Electrical power from the published curve, W.

    Linear interpolation between the 50 tabulated points, which is the
    convention in IEC-style annual energy calculations, and zero outside the
    cut-in and cut-out speeds. numpy.interp holds the end values beyond the
    table, so the zeroing outside the operating range is explicit.
    """
    v = v_eq.to_numpy(dtype=float)
    p = np.interp(v, CURVE_SPEED_MS, CURVE_POWER_W)
    # A missing speed compares false on both sides and stays NaN, so a gap in
    # the series reads as an unknown hour rather than as a stopped turbine.
    p = np.where((v < TURBINE_CUT_IN_MS) | (v > TURBINE_CUT_OUT_MS), 0.0, p)
    return pd.Series(p, index=v_eq.index)


def capacity_factor(power_w: pd.Series,
                    rated_power_w: float = TURBINE_RATED_POWER_W) -> float:
    """Mean electrical power over rated power, percent. Gross of all losses."""
    x = power_w.to_numpy(dtype=float)
    x = x[np.isfinite(x)]
    if x.size == 0:
        return float("nan")
    return float(100.0 * x.mean() / float(rated_power_w))


def annual_energy_mwh(power_w: pd.Series,
                      hours_per_year: float = HOURS_PER_YEAR) -> float:
    """
    Annual electrical energy per turbine, MWh.

    Per turbine only. Array wake losses are not modelled, so multiplying this
    by a plant size would be wrong by an amount this module cannot estimate.
    """
    x = power_w.to_numpy(dtype=float)
    x = x[np.isfinite(x)]
    if x.size == 0:
        return float("nan")
    return float(x.mean() * float(hours_per_year) / 1e6)


def operating_regime_fractions(v_eq: pd.Series) -> dict:
    """Share of hours above cut-in, at or above rated, and above cut-out."""
    v = v_eq.to_numpy(dtype=float)
    v = v[np.isfinite(v)]
    n = v.size
    if n == 0:
        return {}
    return {
        "above_cut_in_pct": _round(100.0 * float((v >= TURBINE_CUT_IN_MS).sum()) / n, 3),
        "at_or_above_rated_pct": _round(100.0 * float((v >= RATED_SPEED_MS).sum()) / n, 3),
        "above_cut_out_pct": _round(100.0 * float((v > TURBINE_CUT_OUT_MS).sum()) / n, 4),
        "cut_in_ms": TURBINE_CUT_IN_MS,
        "rated_ms": _round(RATED_SPEED_MS, 4),
        "cut_out_ms": TURBINE_CUT_OUT_MS,
    }


def shear_sensitivity(df: pd.DataFrame, alpha_bulk: float, hub_height_m: float,
                      roughness_band_m: tuple[float, float] = ROUGHNESS_BAND_M) -> list[dict]:
    """
    Hub speed, capacity factor and annual energy against the shear exponent.

    Every alternative exponent in the table is derived from a stated roughness
    length through the neutral log profile, so no exponent here is asserted
    without a surface it corresponds to. The table is the honest form of the
    hub-height result: the spread across it is larger than any other
    uncertainty the module can quantify.
    """
    rho = air_density(df)
    v50 = df["WS50M"]
    rows = []
    seen: set[float] = set()

    entries: list[tuple[float, float | None]] = [(alpha_bulk, None)]
    lengths = sorted({
        SENSITIVITY_ROUGHNESS_M[0],
        float(roughness_band_m[0]),
        float(roughness_band_m[1]),
        SENSITIVITY_ROUGHNESS_M[1],
    })
    for z0 in lengths:
        entries.append((alpha_from_roughness(z0), z0))

    for alpha, z0 in entries:
        if not np.isfinite(alpha):
            continue
        key = round(float(alpha), 6)
        if key in seen:
            continue
        seen.add(key)
        v_hub = extrapolate_speed(v50, hub_height_m, alpha)
        v_eq = equivalent_speed(v_hub, rho)
        power = turbine_power(v_eq)
        rows.append({
            "shear_exponent": _round(float(alpha), 4),
            "roughness_length_m": None if z0 is None else z0,
            "basis": "derived from the record" if z0 is None
                     else "neutral log profile at the stated roughness length",
            "hub_speed_ms": _round(float(v_hub.mean()), 4),
            "capacity_factor_pct": _round(capacity_factor(power), 3),
            "annual_energy_mwh": _round(annual_energy_mwh(power), 1),
        })
    return rows


# Data quality


def calm_fraction(speeds: pd.Series, threshold_ms: float = CALM_THRESHOLD_MS) -> float:
    """Share of hours below the calm threshold, percent."""
    v = speeds.to_numpy(dtype=float)
    v = v[np.isfinite(v)]
    if v.size == 0:
        return float("nan")
    return float(100.0 * (v < float(threshold_ms)).sum() / v.size)


def data_quality(df: pd.DataFrame, lon: float, alpha_bulk: float,
                 calm_threshold_ms: float = CALM_THRESHOLD_MS,
                 record_max_floor_ms: float = RECORD_MAX_FLOOR_MS,
                 roughness_band_m: tuple[float, float] = ROUGHNESS_BAND_M) -> dict:
    """
    The evidence a reader needs in order to decide whether the field is usable.

    Three independent tests, reported whether or not they fail:

    Calm fraction and record maximum at each height. A near-surface field that
    is calm almost always, or that never reaches a speed the region's frontal
    passages produce, is not a climatology. The calm fraction is reported at
    2 m, 10 m and 50 m separately because a high value at 2 m is a property of
    that level alone and does not by itself condemn the levels this module
    uses; the record maximum is what tests those.

    Shear plausibility. The exponent inverted to an equivalent roughness length
    and read against the assumed land cover.

    Completeness. Fill values replaced and hours present against hours
    expected. A mean of a cubed quantity is not robust to gaps, so a non-zero
    count has to be surfaced even though none is expected.
    """
    heights = {"2m": "WS2M", "10m": "WS10M", "50m": "WS50M"}
    calm = {}
    maxima = {}
    means = {}
    for label, column in heights.items():
        if column not in df:
            continue
        s = df[column]
        calm[label] = _round(calm_fraction(s, calm_threshold_ms), 3)
        maxima[label] = _round(float(s.max()), 3)
        means[label] = _round(float(s.mean()), 4)

    hours = int(len(df.index))
    expected = _expected_hours(df.index)
    fill = {c: int(df[c].isna().sum()) for c in df.columns}

    max_10m = maxima.get("10m")
    max_plausible = bool(max_10m is not None and max_10m >= float(record_max_floor_ms))

    day_alpha, night_alpha = day_night_shear(df, lon)
    alpha_h = hourly_shear_exponent(df)
    shear = shear_plausibility(alpha_bulk, roughness_band_m)
    shear.update({
        "shear_exponent_hourly_mean": _round(float(np.nanmean(alpha_h)), 4),
        "shear_exponent_hourly_median": _round(float(np.nanmedian(alpha_h)), 4),
        "shear_exponent_day": _round(day_alpha, 4),
        "shear_exponent_night": _round(night_alpha, 4),
        "local_utc_offset_hours": utc_offset_hours(lon),
    })

    flags = []
    if not shear["consistent_with_assumed_cover"]:
        band = shear["expected_shear_exponent_band"]
        z0_band = shear["assumed_roughness_band_m"]
        z0_implied = shear["implied_roughness_length_m"]
        inversion = (
            f"inverts to a neutral-equivalent roughness length of {z0_implied} m"
            if z0_implied is not None
            else "lies outside the range a neutral logarithmic profile between "
                 "these heights can produce for any roughness length"
        )
        flags.append(
            f"The shear exponent of {alpha_bulk:.4f} between 10 m and 50 m "
            + inversion
            + f". The assumed cover supports {z0_band[0]} to {z0_band[1]} m, "
            f"that is an exponent of {band[0]:.3f} to {band[1]:.3f}. The "
            "profile the extrapolation rests on is therefore not the profile "
            "of the surface the analysis assumes."
        )
    if max_10m is not None and not max_plausible:
        flags.append(
            f"The maximum 10 m wind speed over {hours} hours of record is "
            f"{max_10m} m/s, below the {float(record_max_floor_ms)} m/s floor "
            "this project applies. A record whose extremes are absent is "
            "evidence about the field rather than about the site. "
            + RECORD_MAX_FLOOR_NOTE
        )
    if calm.get("2m") is not None and calm["2m"] > CALM_FRACTION_2M_FLAG_PCT:
        flags.append(
            f"The 2 m field is below {float(calm_threshold_ms)} m/s in "
            f"{calm['2m']} percent of hours, with a record maximum of "
            f"{maxima.get('2m')} m/s. The 2 m level is not used here, but it "
            "is the field sidecar/solar.py feeds to the module temperature "
            "model, so a modelled performance ratio computed at this AOI "
            "carries the same defect. " + CALM_2M_NOTE
        )
    if expected and hours != expected:
        flags.append(
            f"{hours} hourly records against {expected} expected for the "
            "calendar years spanned by the record."
        )
    filled = {k: v for k, v in fill.items() if v}
    if filled:
        flags.append(
            "Fill values replaced by NaN: "
            + ", ".join(f"{k} {v}" for k, v in sorted(filled.items()))
            + ". The mean of a cubed quantity is not robust to gaps."
        )

    return {
        "record_hours": hours,
        "expected_hours": expected,
        "mean_speed_ms": means,
        "calm_fraction_pct": calm,
        "calm_threshold_ms": float(calm_threshold_ms),
        "record_maximum_ms": maxima,
        "record_maximum_floor_ms": float(record_max_floor_ms),
        "record_maximum_plausible": max_plausible,
        "calm_fraction_2m_flag_pct": CALM_FRACTION_2M_FLAG_PCT,
        "nan_count": fill,
        "shear": shear,
        "flags": flags,
        "all_checks_passed": bool(not flags),
    }


def monthly_mean_speed(df: pd.DataFrame, column: str = "WS50M") -> list[dict]:
    """
    Mean speed by calendar month at the given height.

    Reported at 50 m, the highest measured level, so the seasonal shape carries
    no extrapolation. Its phase against the monthly irradiation from
    sidecar/solar.py is the one complementarity statement this module can make
    from measured levels alone.
    """
    out = []
    for month, block in df.groupby(df.index.month):
        v = float(block[column].mean())
        out.append({"month": int(month), "mean_speed_ms": _round(v, 3)})
    return out


def prevailing_direction(df: pd.DataFrame) -> dict:
    """
    Circular mean wind direction at 10 m and 50 m, and the turning between them.

    Reported as the direction of origin, a convention that was inferred rather
    than read from the API. See DIRECTION_CONVENTION_NOTE.
    """
    from scipy import stats

    out: dict = {"convention_note": DIRECTION_CONVENTION_NOTE}
    for label, column in (("10m", "WD10M"), ("50m", "WD50M")):
        if column not in df:
            continue
        v = df[column].to_numpy(dtype=float)
        v = v[np.isfinite(v)]
        if v.size == 0:
            continue
        out[f"circular_mean_deg_{label}"] = _round(
            float(stats.circmean(v, high=360.0)), 2
        )
    if "WD10M" in df and "WD50M" in df:
        turn = ((df["WD50M"] - df["WD10M"] + 180.0) % 360.0) - 180.0
        out["median_turning_deg"] = _round(float(np.nanmedian(turn)), 2)
    return out


def direction_energy_rose(df: pd.DataFrame, n_sectors: int = 16,
                          column: str = "WD50M",
                          speed_column: str = "WS50M") -> list[dict]:
    """
    Share of the cubed-speed sum by direction sector, percent.

    Weighted by v^3 rather than by hour count because that is the quantity a
    layout decision depends on. Sectors are centred on north, so the first one
    spans the wrap.
    """
    if column not in df or speed_column not in df:
        return []
    wd = df[column].to_numpy(dtype=float)
    ws = df[speed_column].to_numpy(dtype=float)
    ok = np.isfinite(wd) & np.isfinite(ws)
    if not ok.any():
        return []
    width = 360.0 / n_sectors
    idx = (np.floor((wd[ok] + width / 2.0) % 360.0 / width)).astype(int) % n_sectors
    weight = ws[ok] ** 3
    total = float(weight.sum())
    rows = []
    for k in range(n_sectors):
        m = idx == k
        rows.append({
            "sector": k,
            "centre_deg": _round(k * width, 1),
            "energy_pct": _round(100.0 * float(weight[m].sum()) / total, 3) if total else 0.0,
            "hours_pct": _round(100.0 * float(m.sum()) / idx.size, 3),
        })
    return rows


# Assembly


def assess(df: pd.DataFrame, lon: float, lat: float,
           hub_height_m: float = HUB_HEIGHT_M,
           calm_threshold_ms: float = CALM_THRESHOLD_MS,
           record_max_floor_ms: float = RECORD_MAX_FLOOR_MS,
           roughness_band_m: tuple[float, float] = ROUGHNESS_BAND_M,
           hours_per_year: float = HOURS_PER_YEAR) -> dict:
    """
    The whole screening from a fetched frame, with every qualifier attached.

    Structured so that what the data measures and what the model extrapolates
    are separate keys: `measured` holds the 10 m and 50 m quantities, which
    involve no extrapolation, and `hub` holds everything above 50 m, each entry
    of which is conditional on the shear exponent the sensitivity table sweeps.
    A caller must not present the two at the same visual weight, and must not
    place the gross wind capacity factor beside the photovoltaic capacity
    factor, which carries an external benchmark this one does not.
    """
    alpha = shear_exponent_bulk(df)
    rho = air_density(df)
    v50 = df["WS50M"]
    n_years = len(df.index) / hours_per_year

    k50, c50 = weibull_fit(v50)
    v_hub = extrapolate_speed(v50, hub_height_m, alpha)
    v_eq = equivalent_speed(v_hub, rho)
    power = turbine_power(v_eq)
    power_uncorrected = turbine_power(v_hub)

    cf = capacity_factor(power)
    cf_uncorrected = capacity_factor(power_uncorrected)

    quality = data_quality(df, lon, alpha, calm_threshold_ms,
                           record_max_floor_ms, roughness_band_m)

    return {
        "grid_cell_centre": list(grid_key(lon, lat)),
        "grid_note": GRID_NOTE,
        "record_years": _round(n_years, 3),
        "qualifier": RESULT_QUALIFIER,

        "measured": {
            "qualifier": MEASURED_QUALIFIER,
            "mean_speed_10m_ms": _round(mean_speed(df, "WS10M"), 4),
            "mean_speed_50m_ms": _round(mean_speed(df, "WS50M"), 4),
            "shear_exponent": _round(alpha, 4),
            "weibull_k_50m": _round(k50, 4),
            "weibull_c_50m_ms": _round(c50, 4),
            "weibull_fit_check_50m": weibull_moment_check(k50, c50, v50),
            "energy_pattern_factor_50m": _round(energy_pattern_factor(v50), 4),
            "wind_power_density_50m_w_m2": _round(wind_power_density(v50, rho), 2),
            "air_density_mean_kg_m3": _round(float(rho.mean()), 4),
            "air_density_min_kg_m3": _round(float(rho.min()), 4),
            "air_density_max_kg_m3": _round(float(rho.max()), 4),
            "monthly_mean_speed_50m": monthly_mean_speed(df, "WS50M"),
            "direction": prevailing_direction(df),
            "direction_energy_rose_50m": direction_energy_rose(df),
        },

        "hub": {
            "qualifier": RESULT_QUALIFIER,
            "extrapolation": extrapolation_status(hub_height_m, alpha, roughness_band_m),
            "mean_speed_ms": _round(float(v_hub.mean()), 4),
            "weibull_k": _round(k50, 4),
            "weibull_c_ms": _round(weibull_scale_at_height(c50, hub_height_m, alpha), 4),
            "wind_power_density_w_m2": _round(wind_power_density(v_hub, rho), 2),
            "gross_capacity_factor_pct": _round(cf, 3),
            "gross_capacity_factor_no_density_correction_pct": _round(cf_uncorrected, 3),
            "gross_annual_energy_mwh_per_turbine": _round(
                annual_energy_mwh(power, hours_per_year), 1),
            "operating_regime": operating_regime_fractions(v_eq),
            "hours_per_year": float(hours_per_year),
            "excluded_losses": list(EXCLUDED_LOSSES),
        },

        "shear_sensitivity": shear_sensitivity(df, alpha, hub_height_m, roughness_band_m),
        "data_quality": quality,
        "turbine": turbine_specification(),
    }


def turbine_specification() -> dict:
    """The reference turbine, with the citation every turbine figure carries."""
    return {
        "name": TURBINE_NAME,
        "rated_power_w": TURBINE_RATED_POWER_W,
        "rotor_diameter_m": TURBINE_ROTOR_DIAMETER_M,
        "hub_height_m": TURBINE_HUB_HEIGHT_M,
        "blades": TURBINE_BLADES,
        "iec_class": TURBINE_CLASS,
        "turbulence_class": TURBINE_TURBULENCE_CLASS,
        "cut_in_ms": TURBINE_CUT_IN_MS,
        "rated_speed_ms": _round(RATED_SPEED_MS, 4),
        "cut_out_ms": TURBINE_CUT_OUT_MS,
        "power_curve_points": len(POWER_CURVE_MS_W),
        "power_curve_column": "rotor electrical power",
        "citation": TURBINE_CITATION,
        "citation_url": TURBINE_CITATION_URL,
        "curve_source_url": (
            "https://raw.githubusercontent.com/IEAWindTask37/IEA-3.4-130-RWT/"
            "master/performance/performance_ccblade.dat"
        ),
        "curve_source_commit": "d0e12b296d025a1c8aa99d5ba7630654837cc59e",
    }


def _expected_hours(index: pd.DatetimeIndex) -> int:
    """
    Hours a complete record would hold over the calendar years the index spans.

    Spanned rather than present, so a year missing from the middle of the
    record is counted as absent instead of being defined away.
    """
    years = [int(y) for y in index.year]
    if not years:
        return 0
    total = 0
    for y in range(min(years), max(years) + 1):
        leap = (y % 4 == 0 and y % 100 != 0) or y % 400 == 0
        total += 8784 if leap else 8760
    return total


def _round(value, digits: int):
    """Round for the response, keeping a non-finite value as null rather than
    letting it reach JSON, where it is not representable."""
    if value is None:
        return None
    v = float(value)
    return None if not np.isfinite(v) else round(v, digits)
