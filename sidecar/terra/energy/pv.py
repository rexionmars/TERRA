"""
The photovoltaic chain for one array, at one place: irradiance to alternating
current.

    pvlib           Perez transposition to a tilted plane, the ASHRAE incidence
                    modifier, Faiman module temperature, PVWatts DC and inverter

Everything here is per kWp of a 1 kWp reference array, so a figure produced from
it is independent of PDC0_W and a plant is a multiplication away, in pv_plant.

YIELD CALIBRATION. The modelled performance ratio runs near 0.877 because this
chain omits soiling, inter-row shading, degradation, availability and cabling.
Against the Global Solar Atlas that makes the specific yield high by roughly 3
to 7 percent. The reported yield is therefore computed at a reference ratio, and
both the applied and the modelled ratio are returned so the assumption is
visible. See report.md section 9.1.

pvlib is imported inside the function bodies that use it and must stay that
way: this module sits under an action that the registry reaches, and the
canopy, water and land-cover runs that never touch an array would otherwise pay
for it.
"""

from __future__ import annotations

import functools

import numpy as np
import pandas as pd

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
