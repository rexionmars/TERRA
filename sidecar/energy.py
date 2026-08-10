"""
Solar energy analysis beyond the point resource: where the energy is lost,
what tracking changes, when it is generated, and what the suitable area
supports.

Consumes what solar.py already produces (the hourly frame, the plane-of-array
transposition, the PVWatts chain) and adds no data source of its own.

ONE APPLIED PERFORMANCE RATIO. resolve_performance_ratio is the only place a
performance ratio is decided, and every other function here takes the resolved
record rather than a literal. Three products computing a yield from three
different ratios would disagree on the same screen with no visible cause.

WHAT THE DEFAULT IS. The applied ratio still defaults to
solar.REFERENCE_PERFORMANCE_RATIO, the value benchmarked against the Global
Solar Atlas. The waterfall exists to make that number auditable, not to replace
it: the derived ratio is reported next to it and the response carries both,
each with its provenance.

REPORTING BASIS. Degradation is a basis for the whole chain, not a loss row.
Every energy figure produced here echoes the basis it was computed on, so a
lifetime-mean yield cannot be read against a year-one exceedance band.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import solar

# Citations carried with the numbers they produced, so a figure cannot be read
# without its source.
SOURCE_DOBOS = (
    "Dobos, A. P. (2014), PVWatts Version 5 Manual, NREL/TP-6A20-62641, "
    "doi:10.2172/1158421"
)
SOURCE_JORDAN_KURTZ = (
    "Jordan, D. C. and Kurtz, S. R. (2013), Photovoltaic degradation rates: an "
    "analytical review, Prog. Photovolt. 21(1):12-29, crystalline silicon median"
)
SOURCE_BOLINGER = (
    "Bolinger, M. and Bolinger, G. (2022), Land requirements for utility-scale "
    "PV: an empirical update on power and energy density, IEEE J. Photovolt. "
    "12(2):589-594, doi:10.1109/JPHOTOV.2021.3136805; n=736 plants, "
    "35482 MW_DC, commercial operation 2007-2019, United States"
)
SOURCE_ONG = (
    "Ong, S., Campbell, C., Denholm, P., Margolis, R. and Heath, G. (2013), "
    "Land-use requirements for solar power plants in the United States, "
    "NREL/TP-6A20-56290"
)
SOURCE_PEREZ = (
    "Perez, R. et al. (1990), Modeling daylight availability and irradiance "
    "components from direct and global irradiance, Solar Energy 44(5):271-289"
)
SOURCE_FAIMAN = (
    "Faiman, D. (2008), Assessing the outdoor operating temperature of "
    "photovoltaic modules, Prog. Photovolt. 16(4):307-315; the pvlib defaults "
    "u0=25.0, u1=6.84 were determined for seven silicon modules on an open "
    "rack at 30.9 degrees tilt in the Negev desert"
)
SOURCE_ASHRAE_IAM = (
    "Souka, A. F. and Safwat, H. H. (1966), as implemented by pvlib.iam.ashrae "
    "with the default coefficient b=0.05"
)
SOURCE_IEC_61724 = (
    "IEC 61724-1, which defines the performance ratio against the "
    "plane-of-array irradiation on the module plane"
)
SOURCE_NIST_ACRE = (
    "international yard and pound agreement (1959): 1 acre = 4046.8564224 m2, "
    "exact"
)
CONVENTION = "project convention, user-editable"

# Cited on the waterfall row that applies it. A module constant rather than a
# payload field because the degradation row is the only thing that ever asked.
DEGRADATION_SOURCE = (
    f"{SOURCE_JORDAN_KURTZ}; the analysis period is a {CONVENTION}"
)

# Exact by definition, so it is written out rather than rounded.
ACRE_HA = 0.40468564224

# Bolinger and Bolinger (2022), concluding benchmark 1: fleet capacity density
# in MW_DC per acre of direct array area, fixed tilt and one-axis tracking.
# Declared here rather than beside the capacity-density resolver because the
# ground coverage ratios are derived from them and Python binds a default
# argument at definition time, which is above that block.
BOLINGER_MW_DC_ACRE_FIXED = 0.35
BOLINGER_MW_DC_ACRE_TRACKING = 0.24

# Module efficiency the ground coverage ratios are derived at. Utility-scale
# crystalline silicon; not read from Bolinger, which publishes capacity per
# acre and not the efficiency behind it, so it is a convention the caller can
# change. bolinger_implied_gcr reports what it produces.
GCR_MODULE_EFFICIENCY = 0.20

# Nameplate power of a fully covered hectare at standard test conditions:
# 10000 m2 times 1000 W/m2 is 10 MW at unit efficiency, so a hectare at
# efficiency eta and ground coverage g carries 10 * eta * g MW_DC.
STC_MW_PER_HA_AT_UNIT_EFFICIENCY = 10.0

# The three modelled factors are consecutive ratios of annual energy sums, so
# their product is the modelled performance ratio by construction. A non-zero
# residual means the frame was not produced by one chain and every ratio below
# it is wrong; it raises rather than warns.
TELESCOPING_TOLERANCE = 1e-9


# PVWatts v5 module types and their DC power temperature coefficients.
# solar.GAMMA_PDC = -0.0035 is the "Premium" selection. That is a choice of
# module type, not a measured property of this site, and it is the least
# conservative of the crystalline options, so the selection is named in every
# response and the alternatives are carried with it.
PVWATTS_MODULE_TYPES = {
    "standard": -0.0047,
    "premium": -0.0035,
    "thin_film": -0.0020,
}
GAMMA_PDC_MODULE_TYPE = "premium"


# PVWatts v5 default loss terms that this chain does not model. They enter the
# waterfall as declared assumptions, each editable, never as measurements.
DECLARED_LOSS_ORDER = (
    "soiling",
    "mismatch",
    "wiring",
    "connections",
    "nameplate_rating",
    "lid",
)
DECLARED_LOSS_PCT = {
    "soiling": 2.0,
    "mismatch": 2.0,
    "wiring": 2.0,
    "connections": 0.5,
    "nameplate_rating": 1.0,
    "lid": 1.5,
}
DECLARED_LOSS_LABEL = {
    "soiling": "Soiling",
    "mismatch": "DC module mismatch",
    "wiring": "DC ohmic wiring",
    "connections": "Connections",
    "nameplate_rating": "Nameplate rating tolerance",
    "lid": "Light-induced degradation",
}

# Both default to zero. Applying them at the PVWatts v5 suggested 3 percent
# drives the derived ratio 5 to 8 percent below the Global Solar Atlas implied
# band, which is the external reference the applied 0.80 is calibrated against,
# so enabling them moves the derived ratio away from that band rather than
# toward it. No row geometry is modelled in this chain, so there is nothing
# here from which an inter-row shading loss could be computed.
OPTIONAL_LOSS_ORDER = ("interrow_shading", "availability")
OPTIONAL_LOSS_PCT = {"interrow_shading": 0.0, "availability": 0.0}
PVWATTS_SUGGESTED_PCT = {"interrow_shading": 3.0, "availability": 3.0}
OPTIONAL_LOSS_LABEL = {
    "interrow_shading": "Inter-row self-shading",
    "availability": "Plant availability",
}

# Global Solar Atlas implied performance ratio over the three study sites,
# computed as PVOUT_csi / GTI_opta in outputs/tables/benchmark_global_solar_atlas.csv.
# Used only as an external consistency band; it is itself a modelled quantity
# from an undisclosed loss stack, so no term here is justified by matching it.
GSA_IMPLIED_PR_BAND = (0.796, 0.801)

# Losses are shown multiplied onto the AC total rather than at their physical
# position in the chain. Measured at the reference site (Propriedade B, 10 year
# hourly series): placing them physically gives 1476.20 against 1474.73
# kWh/kWp/yr flat, so the flat presentation is conservative by 0.10 percent,
# and soiling alone 1585.39 against 1582.58, 0.178 percent. The step energies
# are therefore a presentation of the factor stack, not a re-simulation.
FLAT_PLACEMENT_BIAS_PCT = 0.10

REPORTING_BASES = ("year_one", "lifetime_mean")
DEGRADATION_RATE_PER_YEAR = 0.005
ANALYSIS_PERIOD_YEARS = 25


MODULE_TYPE_REQUEST_FIELD = "module_type"


def resolve_module_type(module_type: str | None = None) -> tuple[str, float]:
    """
    The selected PVWatts v5 module type and its DC temperature coefficient.

    One resolver, so the request field, the frame the chain runs on and the
    record that reports the selection cannot name three different types.
    """
    name = (module_type or GAMMA_PDC_MODULE_TYPE)
    name = str(name).strip().lower()
    if name not in PVWATTS_MODULE_TYPES:
        raise ValueError(
            f"unknown module type: {module_type}; PVWatts v5 publishes "
            + ", ".join(sorted(PVWATTS_MODULE_TYPES))
        )
    return name, float(PVWATTS_MODULE_TYPES[name])


def apply_module_type(frame: pd.DataFrame, gamma_pdc: float) -> pd.DataFrame:
    """
    The frame re-evaluated at another module type's temperature coefficient.

    solar.pv_yield_frame reads the module-level solar.GAMMA_PDC, so a selected
    type reaches the chain only by recomputing the two steps that depend on the
    coefficient. Plane-of-array irradiance, the angle-of-incidence loss and the
    cell temperature are functions of geometry and meteorology, not of the
    coefficient, so they are carried through untouched and the two paths cannot
    disagree about them. Same pvlib calls and same array constants as
    solar.pv_yield_frame, so the selected type is a re-evaluation of that chain
    rather than a second one.
    """
    import pvlib

    if abs(float(gamma_pdc) - float(solar.GAMMA_PDC)) < 1e-12:
        return frame
    out = frame.copy()
    out["p_dc"] = pvlib.pvsystem.pvwatts_dc(
        frame["g_eff"], frame["temp_cell"], solar.PDC0_W, float(gamma_pdc)
    )
    out["p_ac"] = pvlib.inverter.pvwatts(
        out["p_dc"],
        solar.PDC0_W * solar.INVERTER_OVERSIZE_RATIO,
        eta_inv_nom=solar.INVERTER_ETA_NOM,
    )
    return out


def module_type_assumption(gamma_pdc: float = solar.GAMMA_PDC) -> dict:
    """
    The module-type selection behind the DC temperature coefficient.

    Named rather than sourced: PVWatts v5 publishes one coefficient per module
    type and the caller selects one. The selection is a request field and
    apply_module_type re-evaluates the chain on it, so the editable claim below
    is a statement about a control that exists.
    """
    selected = None
    for name, value in PVWATTS_MODULE_TYPES.items():
        if abs(value - float(gamma_pdc)) < 1e-12:
            selected = name
            break
    return {
        "gamma_pdc_per_c": float(gamma_pdc),
        "module_type": selected,
        "default_module_type": GAMMA_PDC_MODULE_TYPE,
        "alternatives": dict(PVWATTS_MODULE_TYPES),
        "request_field": MODULE_TYPE_REQUEST_FIELD,
        "source": (
            f"{SOURCE_DOBOS}; the direct-current power temperature "
            "coefficient it publishes per module type, in 1/C: standard "
            f"{PVWATTS_MODULE_TYPES['standard']:g}, premium "
            f"{PVWATTS_MODULE_TYPES['premium']:g}, thin film "
            f"{PVWATTS_MODULE_TYPES['thin_film']:g}. Module type is a "
            "selection, not a measurement of this site; selecting another type "
            f"re-runs the photovoltaic chain on the '"
            f"{MODULE_TYPE_REQUEST_FIELD}' request field."
        ),
        "user_editable": True,
    }


def modelled_factors(frame: pd.DataFrame, n_years: float) -> dict:
    """
    The three factors the existing chain models, and the energies behind them.

    Each factor is a ratio of consecutive annual energy sums taken from one
    solar.pv_yield_frame call, so the product telescopes into
    solar.modelled_performance_ratio exactly. Energies are per kWp of the
    reference array, so they are independent of solar.PDC0_W.

    Denominator convention follows IEC 61724-1: the plane-of-array irradiation
    on the module plane, not the horizontal irradiation.
    """
    kwp = solar.PDC0_W / 1000.0

    def energy_irradiance(col: str) -> float:
        return float(frame[col].sum()) / 1000.0 / n_years

    def energy_power(col: str) -> float:
        return float(frame[col].sum()) / kwp / 1000.0 / n_years

    e_poa = energy_irradiance("poa_global")
    e_geff = energy_irradiance("g_eff")
    e_dc = energy_power("p_dc")
    e_ac = energy_power("p_ac")

    f_iam = e_geff / e_poa if e_poa > 0 else float("nan")
    f_temp = e_dc / e_geff if e_geff > 0 else float("nan")
    f_inverter = e_ac / e_dc if e_dc > 0 else float("nan")

    product = f_iam * f_temp * f_inverter
    direct = e_ac / e_poa if e_poa > 0 else float("nan")
    residual = float(product - direct)
    if not np.isfinite(residual) or abs(residual) > TELESCOPING_TOLERANCE:
        raise ValueError(
            "the modelled factors do not telescope into the performance ratio "
            f"(residual {residual:.3e}); the frame is not one chain"
        )

    # Irradiance-weighted cell temperature, which is what the temperature
    # factor is a function of. An unweighted mean would be dominated by hours
    # that produce no energy.
    weight = frame["g_eff"].sum()
    temp_cell_weighted = (
        float((frame["temp_cell"] * frame["g_eff"]).sum() / weight)
        if float(weight) > 0
        else float("nan")
    )

    return {
        "energy_poa_kwh_m2_year": e_poa,
        "energy_effective_kwh_m2_year": e_geff,
        "energy_dc_kwh_kwp_year": e_dc,
        "energy_ac_kwh_kwp_year": e_ac,
        "f_iam": f_iam,
        "f_temp": f_temp,
        "f_inverter": f_inverter,
        "performance_ratio_modelled": product,
        "telescoping_residual": residual,
        "temp_cell_irradiance_weighted_c": temp_cell_weighted,
    }


def degradation_factor(
    reporting_basis: str = "year_one",
    rate_per_year: float = DEGRADATION_RATE_PER_YEAR,
    period_years: int = ANALYSIS_PERIOD_YEARS,
) -> float:
    """
    Mean of (1 - rate)^t over t = 0 .. period-1, or 1.0 on the year-one basis.

    A basis for the whole chain rather than a loss row: the two bases are not
    comparable with each other or with an external reference on the other
    basis, so the caller states which one it asked for.
    """
    if reporting_basis == "year_one":
        return 1.0
    if reporting_basis != "lifetime_mean":
        raise ValueError(f"unknown reporting basis: {reporting_basis}")
    n = max(int(period_years), 1)
    return float(np.mean([(1.0 - float(rate_per_year)) ** t for t in range(n)]))


def resolve_performance_ratio(
    frame: pd.DataFrame,
    n_years: float,
    override: float | None = None,
    declared_loss_pct: dict | None = None,
    optional_loss_pct: dict | None = None,
    reporting_basis: str = "year_one",
    degradation_rate_per_year: float = DEGRADATION_RATE_PER_YEAR,
    analysis_period_years: int = ANALYSIS_PERIOD_YEARS,
) -> dict:
    """
    The performance ratio every product in this module applies, with its
    provenance and the full factor stack behind it.

    Three ratios exist and are all returned. The MODELLED ratio is what this
    chain computes. The DERIVED ratio is the modelled ratio times the declared
    PVWatts v5 loss terms the chain does not model. The APPLIED ratio is what
    a yield is actually computed from, and it defaults to
    solar.REFERENCE_PERFORMANCE_RATIO, the value benchmarked against the Global
    Solar Atlas; a caller override replaces it and is recorded as such. The
    default is not changed by the presence of the derived ratio, because the
    derived one has no external benchmark.

    Callers pass the returned record to every other function here rather than
    a bare float, so the applied value, its source and the reporting basis
    travel together.
    """
    factors = modelled_factors(frame, n_years)

    declared = dict(DECLARED_LOSS_PCT)
    if declared_loss_pct:
        declared.update({k: float(v) for k, v in declared_loss_pct.items()})
    optional = dict(OPTIONAL_LOSS_PCT)
    if optional_loss_pct:
        optional.update({k: float(v) for k, v in optional_loss_pct.items()})

    declared_factor = 1.0
    declared_rows = []
    for key in DECLARED_LOSS_ORDER:
        pct = float(declared[key])
        f = 1.0 - pct / 100.0
        declared_factor *= f
        declared_rows.append({
            "key": key,
            "label": DECLARED_LOSS_LABEL[key],
            "loss_pct": pct,
            "factor": f,
            "kind": "assumed",
            "source": f"{SOURCE_DOBOS}, default value",
            "user_editable": True,
        })

    optional_factor = 1.0
    optional_rows = []
    for key in OPTIONAL_LOSS_ORDER:
        pct = float(optional[key])
        f = 1.0 - pct / 100.0
        optional_factor *= f
        optional_rows.append({
            "key": key,
            "label": OPTIONAL_LOSS_LABEL[key],
            "loss_pct": pct,
            "factor": f,
            "kind": "assumed",
            "default_pct": OPTIONAL_LOSS_PCT[key],
            "pvwatts_suggested_pct": PVWATTS_SUGGESTED_PCT[key],
            "source": (
                f"{CONVENTION}; defaults to zero. Suggested non-zero value "
                f"from {SOURCE_DOBOS}."
            ),
            "user_editable": True,
        })

    modelled = factors["performance_ratio_modelled"]
    derived = modelled * declared_factor * optional_factor
    reference = float(solar.REFERENCE_PERFORMANCE_RATIO)

    if isinstance(override, (int, float)):
        applied = float(override)
        source = "user"
    else:
        applied = reference
        source = "reference"

    deg = degradation_factor(
        reporting_basis, degradation_rate_per_year, analysis_period_years
    )

    # What the derived ratio would become if the two optional terms were set to
    # the PVWatts suggested values, reported so the user who enables them can
    # see where that lands relative to the external band before doing it.
    suggested_factor = 1.0
    for key in OPTIONAL_LOSS_ORDER:
        suggested_factor *= 1.0 - PVWATTS_SUGGESTED_PCT[key] / 100.0
    derived_if_suggested = modelled * declared_factor * suggested_factor

    return {
        "applied": applied,
        "applied_source": source,
        "reference": reference,
        "modelled": modelled,
        "derived": derived,
        "derived_if_optional_at_pvwatts_defaults": derived_if_suggested,
        "declared_loss_factor": declared_factor,
        "optional_loss_factor": optional_factor,
        "factors": factors,
        "declared_losses": declared_rows,
        "optional_losses": optional_rows,
        "reporting_basis": reporting_basis,
        "degradation_factor": deg,
        "degradation_rate_per_year": float(degradation_rate_per_year),
        "analysis_period_years": int(analysis_period_years),
        "gsa_implied_band": list(GSA_IMPLIED_PR_BAND),
    }


def _require_resolved(ratio) -> dict:
    """
    Reject a bare performance ratio at the boundary of every product.

    A float carries no provenance and no reporting basis, so a figure computed
    from one cannot be labelled and two products fed different literals would
    disagree with nothing on screen to explain it.
    """
    required = ("applied", "applied_source", "reporting_basis",
                "degradation_factor", "factors")
    if not isinstance(ratio, dict) or any(k not in ratio for k in required):
        raise TypeError(
            "a resolved performance ratio record from "
            "resolve_performance_ratio is required, not a bare value"
        )
    return ratio


def specific_yield(poa_kwh_m2_year: float, ratio: dict) -> float:
    """
    Specific yield on the applied ratio and the resolved reporting basis.

    Specific yield is plane-of-array irradiation times the performance ratio by
    construction, so applying the ratio is exact rather than a correction. The
    degradation factor is 1.0 on the year-one basis.
    """
    _require_resolved(ratio)
    return (
        float(poa_kwh_m2_year)
        * float(ratio["applied"])
        * float(ratio["degradation_factor"])
    )


def loss_waterfall(
    frame: pd.DataFrame,
    ghi_hourly_kwh_m2_year: float,
    poa_horizontal_kwh_m2_year: float,
    n_years: float,
    ratio: dict,
    hourly_window: str,
    ghi_climatology_kwh_m2_year: float | None = None,
    climatology_window: str | None = None,
    wind_source: str = "NASA POWER WS2M (MERRA-2), 2 m above ground",
    gamma_pdc: float = solar.GAMMA_PDC,
) -> dict:
    """
    Stepwise account from horizontal irradiation to delivered AC energy per kWp.

    The base is the global horizontal irradiation over the HOURLY window, which
    is the series the photovoltaic chain runs on. The multi-decade daily
    climatology is a different product over a different window and is carried
    as context only; starting the waterfall from it would make every ratio
    below wrong by the difference between the two windows.

    Rows report the energy after the step, the step factor, the cumulative
    performance ratio where one applies, whether the step is modelled or
    assumed, and the source. The three modelled factors telescope into the
    modelled performance ratio exactly; modelled_factors raises if they do not.

    Losses are applied multiplicatively to the AC total rather than at their
    physical position in the chain. See FLAT_PLACEMENT_BIAS_PCT for the
    measured cost of that presentation.
    """
    f = _require_resolved(ratio)["factors"]
    e_poa = f["energy_poa_kwh_m2_year"]
    e_geff = f["energy_effective_kwh_m2_year"]
    e_dc = f["energy_dc_kwh_kwp_year"]
    e_ac = f["energy_ac_kwh_kwp_year"]

    ghi = float(ghi_hourly_kwh_m2_year)
    poa0 = float(poa_horizontal_kwh_m2_year)

    rows: list[dict] = []

    def add(step, label, factor, energy_after, units, cumulative, kind,
            in_pr, source, note=None):
        rows.append({
            "step": step,
            "label": label,
            "factor": None if factor is None else float(factor),
            "energy_after": float(energy_after),
            "units": units,
            "cumulative_ratio": None if cumulative is None else float(cumulative),
            "kind": kind,
            "in_performance_ratio": bool(in_pr),
            "source": source,
            "note": note,
        })

    if ghi_climatology_kwh_m2_year is not None:
        add(
            0, "Global horizontal irradiation, daily climatology", None,
            float(ghi_climatology_kwh_m2_year), "kWh/m2/yr", None,
            "context", False,
            "NASA POWER daily product, "
            f"{climatology_window or 'climatology window'}",
            "Context, not the base of this waterfall: it is a different "
            "product over a different window from the series the "
            "photovoltaic chain runs on.",
        )

    add(
        1, "Global horizontal irradiation, hourly window (waterfall base)",
        None, ghi, "kWh/m2/yr", None, "base", False,
        f"NASA POWER hourly product, {hourly_window}",
        "Every ratio below is referenced to this window.",
    )

    add(
        2, "Component-closure residual between the published GHI and the "
        "horizontal plane rebuilt from DNI and DHI",
        poa0 / ghi if ghi > 0 else None, poa0, "kWh/m2/yr", None,
        "data_product", False,
        "NASA POWER GHI, DNI and DHI do not close; pvlib rebuilds the "
        "horizontal plane as DNI*cos(zenith) + DHI",
        "A property of the radiation product, not a plant loss, so it is "
        "carried outside the performance-ratio chain. It is not a low-sun "
        "artefact: restricting to sun elevations above 10 degrees leaves a "
        "residual of the same order.",
    )

    add(
        3, "Transposition to the module plane (Perez)",
        e_poa / poa0 if poa0 > 0 else None, e_poa, "kWh/m2/yr", None,
        "modelled", False, SOURCE_PEREZ,
        "Plane-of-array irradiation on the module plane is the denominator of "
        f"the performance ratio. {SOURCE_IEC_61724}.",
    )

    add(
        4, "Angle of incidence on the beam component (ASHRAE)",
        f["f_iam"], e_geff, "kWh/m2/yr", f["f_iam"], "modelled", True,
        SOURCE_ASHRAE_IAM,
        "Applied to the beam component only. The diffuse component receives "
        "no incidence-angle correction in this chain, which is a "
        "simplification inside the modelled ratio.",
    )

    add(
        5, "Standard test condition conversion, irradiance to DC nameplate",
        1.0, e_geff, "kWh/kWp/yr", f["f_iam"], "unit_change", True,
        f"definitional at solar.PDC0_W = {solar.PDC0_W:g} W and 1000 W/m2",
        "The unit changes here from kWh/m2/yr to kWh/kWp/yr. The rows are "
        "numerically continuous only because the reference array is rated at "
        "1000 W/m2.",
    )

    # THE WIND HEIGHT BIAS SITS IN THIS STEP. The Faiman u1 coefficient is
    # calibrated against wind measured at MODULE HEIGHT (pvlib documents the
    # 1.0 m/s default as the module-height wind used to determine NOCT), while
    # the chain feeds it WS2M, a 2 metre wind. Even with a credible wind field
    # that is the wrong measurement height for u1, so this is a systematic bias
    # independent of any site defect, and it sits inside the modelled ratio
    # that every figure in this module is anchored on.
    add(
        6, "Cell temperature (Faiman) into the PVWatts DC model",
        f["f_temp"], e_dc, "kWh/kWp/yr", f["f_iam"] * f["f_temp"],
        "modelled", True, f"{SOURCE_FAIMAN}; {SOURCE_DOBOS}",
        "Largest modelled loss. Irradiance-weighted cell temperature "
        f"{f['temp_cell_irradiance_weighted_c']:.3f} C from {wind_source}. "
        "The Faiman wind coefficient u1 is calibrated against module-height "
        "wind and this chain supplies a 2 metre wind, so the step carries a "
        "systematic bias of unquantified size in addition to any error in the "
        "wind field itself.",
    )

    add(
        7, "Inverter (PVWatts)",
        f["f_inverter"], e_ac, "kWh/kWp/yr", f["performance_ratio_modelled"],
        "modelled", True, SOURCE_DOBOS,
        "The inverter oversizing factor solar.INVERTER_OVERSIZE_RATIO sets the "
        "pvlib DC input limit; see its comment for what it does and does not "
        "mean.",
    )

    checkpoints = [{
        "name": "performance_ratio_modelled",
        "value": float(f["performance_ratio_modelled"]),
        "residual": float(f["telescoping_residual"]),
        "note": (
            "Product of the three modelled factors, identical to AC energy "
            "over plane-of-array energy. The identity holds by construction "
            "and is enforced rather than assumed."
        ),
    }]

    energy = e_ac
    cumulative = f["performance_ratio_modelled"]
    step = 8
    for row in ratio["declared_losses"]:
        energy *= row["factor"]
        cumulative *= row["factor"]
        add(
            step, row["label"], row["factor"], energy, "kWh/kWp/yr",
            cumulative, "assumed", True, row["source"],
            "Not modelled by this chain. Declared assumption, editable.",
        )
        step += 1

    checkpoints.append({
        "name": "performance_ratio_derived",
        "value": float(ratio["derived"]),
        "note": (
            "Modelled ratio times the declared terms. Reported next to the "
            "applied ratio, which it does not replace: the applied ratio is "
            "the one with an external benchmark."
        ),
        "external_band": list(GSA_IMPLIED_PR_BAND),
    })

    for row in ratio["optional_losses"]:
        energy *= row["factor"]
        cumulative *= row["factor"]
        add(
            step, row["label"], row["factor"], energy, "kWh/kWp/yr",
            cumulative, "assumed", True, row["source"],
            "Defaults to zero. At the PVWatts suggested values the two "
            "together take the derived ratio to "
            f"{ratio['derived_if_optional_at_pvwatts_defaults']:.4f}, below "
            f"the external band {GSA_IMPLIED_PR_BAND[0]:.3f} to "
            f"{GSA_IMPLIED_PR_BAND[1]:.3f}.",
        )
        step += 1

    deg = float(ratio["degradation_factor"])
    add(
        step, "Degradation, reporting basis", deg, energy * deg, "kWh/kWp/yr",
        cumulative * deg, "basis", False, DEGRADATION_SOURCE,
        f"Reporting basis '{ratio['reporting_basis']}'. Not a loss row: the "
        "two bases are not comparable with each other or with an external "
        "reference computed on the other basis, so the basis is printed with "
        "every energy figure.",
    )

    poa_year = e_poa
    applied_yield = specific_yield(poa_year, ratio)
    derived_ratio_on_basis = float(ratio["derived"]) * deg
    derived_yield = poa_year * derived_ratio_on_basis

    return {
        "base": {
            "ghi_hourly_kwh_m2_year": ghi,
            "hourly_window": hourly_window,
            "ghi_climatology_kwh_m2_year": (
                None if ghi_climatology_kwh_m2_year is None
                else float(ghi_climatology_kwh_m2_year)
            ),
            "climatology_window": climatology_window,
            "note": (
                "The waterfall base is the hourly window. The climatology is a "
                "different product over a different window and the two differ; "
                "they are labelled rather than reconciled."
            ),
        },
        "steps": rows,
        "checkpoints": checkpoints,
        "outside_performance_ratio": [
            r["label"] for r in rows if not r["in_performance_ratio"]
        ],
        "performance_ratio": {
            "applied": float(ratio["applied"]),
            "applied_source": ratio["applied_source"],
            "modelled": float(ratio["modelled"]),
            "derived": float(ratio["derived"]),
            "reporting_basis": ratio["reporting_basis"],
            "degradation_factor": deg,
        },
        "delivered": {
            "applied_kwh_kwp_year": float(applied_yield),
            "applied_capacity_factor_pct": float(100.0 * applied_yield / 8760.0),
            "derived_kwh_kwp_year": float(derived_yield),
            "derived_capacity_factor_pct": float(
                100.0 * derived_yield / 8760.0
            ),
            "difference_pct": (
                float(100.0 * (derived_yield / applied_yield - 1.0))
                if applied_yield > 0 else None
            ),
            "reporting_basis": ratio["reporting_basis"],
            "note": (
                "Both figures are correct under their own stated assumption. "
                "The applied ratio is the one the resource card ships and the "
                "one benchmarked externally; the derived ratio is the "
                "decomposition of this chain plus its declared assumptions."
            ),
        },
        "assumptions": {
            # The coefficient the caller's frame was actually evaluated at.
            # Called bare, this reported the default premium type even for a
            # frame re-evaluated at another one, so the assumptions block named
            # a coefficient that produced none of the figures above it.
            "module_type": module_type_assumption(gamma_pdc),
            "albedo": {
                "value": solar.ALBEDO,
                "source": (
                    f"{CONVENTION}; the pvlib get_total_irradiance default is "
                    "0.25, so this is a deliberate override"
                ),
            },
            "transposition_model": {
                "value": solar.TRANSPOSITION_MODEL,
                "source": SOURCE_PEREZ,
            },
            "wind_source": {
                "value": wind_source,
                "source": (
                    "NASA POWER meteorology. The Faiman coefficient u1 expects "
                    "a module-height wind; WS2M is a 2 metre wind."
                ),
            },
            "flat_placement_bias_pct": {
                "value": FLAT_PLACEMENT_BIAS_PCT,
                "source": (
                    "measured at the reference site: physically placed losses "
                    "give 1476.20 against 1474.73 kWh/kWp/yr flat"
                ),
            },
        },
    }


# Horizontal single-axis tracking.
#
# The axis is horizontal and runs north-south, which is the configuration
# Bolinger and Bolinger (2022) measure. axis_azimuth is measured east of north,
# matching the convention solar.py already uses; for a symmetric rotation limit
# 0 and 180 give identical surface orientations.
AXIS_TILT_DEG = 0.0
AXIS_AZIMUTH_DEG = 0.0
TRACKER_MAX_ANGLE_DEG = 60.0

# Backtracking is always on and is not exposed. With backtrack=False pvlib
# ignores the ground coverage ratio entirely and stops the rotation without
# removing the row-shaded irradiance, so the result reads as a larger gain than
# a plant would deliver. Offering the flag without a shading correction would
# return a silently wrong number.
TRACKER_BACKTRACK = True

# Ground coverage ratios. Both are request parameters because the per-hectare
# sign is set by their ratio and the published ranges straddle the parity point.
#
# DERIVATION, so neither default is an unsourced number. Bolinger and Bolinger
# (2022), concluding benchmark 1, publishes 0.35 MW_DC per acre of direct array
# area for fixed tilt and 0.24 for one-axis tracking. Converting to a hectare
# with the exact 1959 acre and dividing by the nameplate power of a fully
# covered hectare at GCR_MODULE_EFFICIENCY = 0.20 gives 0.4324 fixed and 0.2965
# tracking. bolinger_implied_gcr computes exactly that; the two defaults below
# are those values at three decimals, and gcr_defaults reports the residual.
#
# The tracker default was 0.35 before this pair was reconciled. That value had
# no source and sits 18 percent above the tracking figure the same paper this
# module cites implies, which moved the per-hectare headline by about 14
# percentage points, so a reader comparing the derived line against the
# published measurements above it was comparing two different assumptions.
GCR_FIXED = 0.435
GCR_TRACKER = 0.295


def bolinger_implied_gcr(module_efficiency: float = GCR_MODULE_EFFICIENCY) -> dict:
    """
    Ground coverage ratios implied by the published capacity densities.

    The same efficiency sets both, so it cancels from their ratio: changing it
    moves each ratio but not the per-hectare comparison, which depends on the
    ratio alone. Reported rather than asserted, so the defaults above can be
    checked against the source at any efficiency the caller states.
    """
    eta = float(module_efficiency)
    denom = STC_MW_PER_HA_AT_UNIT_EFFICIENCY * eta
    if denom <= 0:
        raise ValueError("module efficiency must be positive")
    fixed = (BOLINGER_MW_DC_ACRE_FIXED / ACRE_HA) / denom
    tracking = (BOLINGER_MW_DC_ACRE_TRACKING / ACRE_HA) / denom
    return {
        "module_efficiency": eta,
        "gcr_fixed": float(fixed),
        "gcr_tracker": float(tracking),
        "gcr_ratio": float(tracking / fixed),
        "source": f"{SOURCE_BOLINGER}, concluding benchmark 1",
        "note": (
            "Derived from the published capacity densities at the stated "
            "module efficiency, which is a project convention. The efficiency "
            "cancels from the ratio, so it moves both ratios and leaves the "
            "per-hectare comparison unchanged."
        ),
    }


def gcr_defaults(module_efficiency: float = GCR_MODULE_EFFICIENCY) -> dict:
    """
    The two shipped defaults beside the values they approximate.

    Both are user-editable request parameters. The residual against the
    published derivation is emitted rather than left for the reader to compute,
    because the per-hectare sign is set by the pair and a default that does not
    reproduce its stated source would be indistinguishable from one that does.
    """
    implied = bolinger_implied_gcr(module_efficiency)
    return {
        "gcr_fixed": GCR_FIXED,
        "gcr_tracker": GCR_TRACKER,
        "implied": implied,
        "residual_pct": {
            "gcr_fixed": round(
                100.0 * (GCR_FIXED / implied["gcr_fixed"] - 1.0), 3
            ),
            "gcr_tracker": round(
                100.0 * (GCR_TRACKER / implied["gcr_tracker"] - 1.0), 3
            ),
        },
        "source": (
            f"{implied['source']}, at module efficiency "
            f"{implied['module_efficiency']:g}; the defaults themselves are a "
            f"{CONVENTION}"
        ),
        "user_editable": True,
    }


# Published per-hectare energy densities, which are direct measurements of the
# question the per-hectare comparison asks. Carried as data, not derived.
BOLINGER_ENERGY_MWH_ACRE_FIXED = 447.0
BOLINGER_ENERGY_MWH_ACRE_TRACKING = 394.0
BOLINGER_ENERGY_GWH_HA_FIXED = 1.10
BOLINGER_ENERGY_GWH_HA_TRACKING = 0.97

# Ong et al. (2013) Table 5: change in land-use intensity of one-axis tracking
# relative to fixed tilt against site direct normal irradiation. Negative means
# tracking uses less land per unit of energy.
ONG_TABLE5 = (
    {"site": "Seattle", "dni_kwh_m2_year": 1112, "land_use_change_pct": -0.6},
    {"site": "Newark", "dni_kwh_m2_year": 1263, "land_use_change_pct": 0.7},
    {"site": "Jacksonville", "dni_kwh_m2_year": 1507, "land_use_change_pct": -4.9},
    {"site": "San Francisco", "dni_kwh_m2_year": 1883, "land_use_change_pct": -4.4},
    {"site": "San Diego", "dni_kwh_m2_year": 1965, "land_use_change_pct": -2.7},
    {"site": "Phoenix", "dni_kwh_m2_year": 2519, "land_use_change_pct": -8.0},
    {"site": "Alamosa", "dni_kwh_m2_year": 2530, "land_use_change_pct": -7.5},
)

# Wind speeds substituted into the temperature step to measure how far the
# performance ratio transfers between the two configurations. The 1.0 m/s case
# is pvlib's documented module-height reference for the NOCT determination.
PR_TRANSFER_WIND_SPEEDS = (1.0, 2.0)


def tracker_orientation(solpos: pd.DataFrame, gcr: float,
                        max_angle_deg: float = TRACKER_MAX_ANGLE_DEG):
    """
    Per-hour surface tilt and azimuth of a horizontal north-south tracker.

    Rotation is undefined while the sun is below the horizon and pvlib returns
    NaN there. The rows are filled rather than dropped: dropping them would
    break index alignment with the meteorology, and leaving them NaN would
    propagate into the transposition and make the annual sum NaN.

    The fill is a flat surface, which is the physical stow of most horizontal
    trackers, and it is NOT chosen because those hours carry no irradiance.
    They carry a little: measured on the reference site's 10 year series at the
    default ground coverage ratio, 43926 of 87672 hours are NaN and hold 0.659
    kWh/m2/yr of global horizontal, 2.081 direct normal and 0.776 diffuse. A
    flat stow collects 0.0 kWh/m2/yr of that against 0.407 at a 30 degree fill
    and 0.749 at 60, moving the annual tracker total from 2248.653 to 2249.060
    and 2249.403 kWh/m2/yr, up to 0.033 percent. Stating the reason correctly
    matters because the previous reason, zero irradiance in those hours, would
    license any fill value.
    """
    import pvlib

    tr = pvlib.tracking.singleaxis(
        apparent_zenith=solpos["apparent_zenith"],
        solar_azimuth=solpos["azimuth"],
        axis_tilt=AXIS_TILT_DEG,
        axis_azimuth=AXIS_AZIMUTH_DEG,
        max_angle=float(max_angle_deg),
        backtrack=TRACKER_BACKTRACK,
        gcr=float(gcr),
    )
    return tr["surface_tilt"].fillna(0.0), tr["surface_azimuth"].fillna(90.0)


def _annual(series: pd.Series, n_years: float) -> float:
    return float(series.sum()) / 1000.0 / n_years


def tracking_comparison(
    df: pd.DataFrame,
    solpos: pd.DataFrame,
    n_years: float,
    poa_fixed: pd.DataFrame,
    fixed_tilt_deg: float,
    fixed_azimuth_deg: float,
    ratio: dict,
    gcr_fixed: float = GCR_FIXED,
    gcr_tracker: float = GCR_TRACKER,
    max_angle_deg: float = TRACKER_MAX_ANGLE_DEG,
    solve_parity: bool = True,
    gamma_pdc: float = solar.GAMMA_PDC,
) -> dict:
    """
    Horizontal single-axis tracking against the fixed tilt, per kWp and per
    hectare.

    Per kWp the comparison is a measurement on this site's hourly series. Per
    hectare it is not: the sign is set by the ratio of the two ground coverage
    ratios, and published measurements of the same question exist, so those are
    reported first and the model-derived figure is a third line shown with the
    pair that produced it.

    Both bases are reported. Per kWp does not invert at this site; per hectare
    does, at a ground-coverage ratio the published ranges straddle.

    No absolute capacity or energy density is emitted here. Density on a
    declared area basis belongs to resolve_capacity_density, and emitting a
    second one from this block would let the two disagree.
    """
    _require_resolved(ratio)
    tilt_t, azim_t = tracker_orientation(solpos, gcr_tracker, max_angle_deg)
    poa_track = solar.transpose(df, solpos, tilt_t, azim_t)

    # Both configurations run on the module type the caller selected. Taking
    # solar.pv_yield here instead would evaluate the tracker and the fixed
    # array at the default coefficient while the waterfall beside them used the
    # selected one, and the two performance ratios would disagree with nothing
    # on screen to explain it.
    def _p_ac(poa, tilt, azimuth):
        return apply_module_type(
            solar.pv_yield_frame(poa, df, solpos, tilt, azimuth), gamma_pdc
        )["p_ac"]

    p_ac_track = _p_ac(poa_track, tilt_t, azim_t)
    p_ac_fixed = _p_ac(poa_fixed, fixed_tilt_deg, fixed_azimuth_deg)

    poa_fixed_year = _annual(poa_fixed["poa_global"], n_years)
    poa_track_year = _annual(poa_track["poa_global"], n_years)
    pr_fixed = solar.modelled_performance_ratio(
        p_ac_fixed, poa_fixed["poa_global"]
    )
    pr_track = solar.modelled_performance_ratio(
        p_ac_track, poa_track["poa_global"]
    )

    yield_fixed = specific_yield(poa_fixed_year, ratio)
    yield_track = specific_yield(poa_track_year, ratio)
    gain_kwp_pct = 100.0 * (yield_track / yield_fixed - 1.0)

    # ONE YEAR LENGTH FOR THE ANNUAL ROW. solar.season_years divides the hours
    # in a season by a mean Gregorian year of 8766 hours, which returns 10.0014
    # rather than 10 for a whole ten-year record and made the annual seasonal
    # row report 1884.3 against the 1884.6 the per-kWp block reports for the
    # same array. The calendar-year count the caller supplies wins, because it
    # is what the per-kWp block, the headline yield and the shipped
    # solar_resource action all divide by. The other rows keep the mean-year
    # convention: a season is not a calendar year and has no such count.
    seasons = []
    for name in solar.SEASONS:
        mask = solar.season_mask(df.index, name)
        whole_year = list(solar.SEASONS[name]) == list(range(1, 13))
        years = float(n_years) if whole_year else solar.season_years(
            df.index, name
        )
        f_season = _annual(poa_fixed["poa_global"][mask], years)
        t_season = _annual(poa_track["poa_global"][mask], years)
        seasons.append({
            "season": name,
            "months": list(solar.SEASONS[name]),
            "years": round(float(years), 5),
            "years_basis": (
                "calendar years in the record"
                if whole_year else
                "season occurrences, hours over a mean Gregorian year"
            ),
            "fixed_poa_kwh_m2_season": round(f_season, 1),
            "tracker_poa_kwh_m2_season": round(t_season, 1),
            "gain_pct": round(100.0 * (t_season / f_season - 1.0), 2)
            if f_season > 0 else None,
        })

    # How far the applied ratio transfers between the two configurations. The
    # site value alone understates the spread: where the wind field is near
    # zero the cell temperature saturates and the tracker's higher irradiance
    # barely moves it, so the transfer is measured across wind assumptions.
    transfer = [{
        "wind": "series as supplied",
        "performance_ratio_fixed": round(float(pr_fixed), 6),
        "performance_ratio_tracker": round(float(pr_track), 6),
        "difference_pct": round(100.0 * (pr_track / pr_fixed - 1.0), 4),
    }]
    for speed in PR_TRANSFER_WIND_SPEEDS:
        alt = df.copy()
        alt["wind"] = float(speed)
        a = apply_module_type(
            solar.pv_yield_frame(poa_fixed, alt, solpos, fixed_tilt_deg,
                                 fixed_azimuth_deg),
            gamma_pdc,
        )["p_ac"]
        b = apply_module_type(
            solar.pv_yield_frame(poa_track, alt, solpos, tilt_t, azim_t),
            gamma_pdc,
        )["p_ac"]
        pa = solar.modelled_performance_ratio(a, poa_fixed["poa_global"])
        pb = solar.modelled_performance_ratio(b, poa_track["poa_global"])
        transfer.append({
            "wind": f"fixed {speed:g} m/s",
            "performance_ratio_fixed": round(float(pa), 6),
            "performance_ratio_tracker": round(float(pb), 6),
            "difference_pct": round(100.0 * (pb / pa - 1.0), 4),
        })
    deltas = [row["difference_pct"] for row in transfer]

    dni_year = _annual(df["dni"], n_years)
    published = _published_land_use(dni_year)

    derived_ratio = (gcr_tracker * yield_track) / (gcr_fixed * yield_fixed)
    derived = {
        "energy_per_hectare_ratio": round(float(derived_ratio), 4),
        "change_pct": round(100.0 * (derived_ratio - 1.0), 2),
        "gcr_fixed": float(gcr_fixed),
        "gcr_tracker": float(gcr_tracker),
        "gcr_ratio": round(float(gcr_tracker / gcr_fixed), 4),
        "gcr_source": gcr_defaults(),
        "basis": (
            "derived from this site's specific yields and the two ground "
            "coverage ratios above, not measured"
        ),
        "note": (
            "Third line, not the answer. The published measurements above "
            "answer the same question directly on a fleet of built plants. "
            "The derived figure moves with the ground coverage pair, and the "
            "published pairs span the point at which the sign inverts."
        ),
    }

    if solve_parity:
        derived["parity"] = _parity_ground_coverage(
            df, solpos, n_years, gcr_fixed, yield_fixed, ratio, max_angle_deg
        )

    return {
        "configuration": {
            "axis_tilt_deg": AXIS_TILT_DEG,
            "axis_azimuth_deg": AXIS_AZIMUTH_DEG,
            "axis_azimuth_convention": "degrees east of north",
            "max_angle_deg": float(max_angle_deg),
            "backtrack": TRACKER_BACKTRACK,
            "terrain": (
                "Flat ground. Slope-aware backtracking on sloping terrain "
                "would change the result and is not modelled here."
            ),
        },
        "per_kwp": {
            "fixed": {
                "tilt_deg": float(fixed_tilt_deg),
                "azimuth_deg": float(fixed_azimuth_deg),
                "poa_kwh_m2_year": round(poa_fixed_year, 4),
                "specific_yield_kwh_kwp_year": round(yield_fixed, 2),
                "capacity_factor_pct": round(100.0 * yield_fixed / 8760.0, 3),
                "performance_ratio_modelled": round(float(pr_fixed), 6),
            },
            "tracking": {
                "gcr": float(gcr_tracker),
                "poa_kwh_m2_year": round(poa_track_year, 4),
                "specific_yield_kwh_kwp_year": round(yield_track, 2),
                "capacity_factor_pct": round(100.0 * yield_track / 8760.0, 3),
                "performance_ratio_modelled": round(float(pr_track), 6),
            },
            "gain_pct": round(gain_kwp_pct, 3),
            "inverts": False,
            "note": (
                "Measured on this site's hourly series. Per kWp the tracker is "
                "ahead in every configuration tested here; this is the basis "
                "that does not invert."
            ),
        },
        "seasonal": {
            "rows": seasons,
            "note": (
                "The annual gain is a summer gain. A user sizing for a "
                "winter-limited load reads the annual figure for a season in "
                "which the comparison is close to neutral or negative."
            ),
            "year_length_note": (
                "The annual row divides by the calendar years in the record, "
                "the same denominator the per-kWp block above uses, so the two "
                "report one plane-of-array total for one array. Each other row "
                "divides by the season occurrences its months cover, which is "
                "the record hours over a mean Gregorian year and is not a "
                "count of calendar years; the 'years' and 'years_basis' fields "
                "on each row state which applied."
            ),
        },
        "per_hectare": {
            "published_measurements": published,
            "model_derived": derived,
            "inverts": True,
            "note": (
                "This is the basis that inverts. Per kWp and per hectare "
                "answer different questions and the published sources measure "
                "the per-hectare one directly, so they lead here."
            ),
        },
        "performance_ratio": {
            "applied": float(ratio["applied"]),
            "applied_source": ratio["applied_source"],
            "reporting_basis": ratio["reporting_basis"],
            "transfer_between_configurations": transfer,
            "transfer_range_pct": [
                round(min(deltas), 4), round(max(deltas), 4)
            ],
            "note": (
                "The applied ratio was calibrated against a fixed-tilt "
                "benchmark. The modelled ratio moves by "
                f"{min(deltas):+.2f} to {max(deltas):+.2f} percent between the "
                "two configurations depending on the wind assumption, which is "
                "the evidence for transferring it, and it is measured within "
                "this model only. Neither configuration models tracker motor "
                "consumption, controller availability or mechanical downtime, "
                "all of which the tracker carries and the fixed array does not."
            ),
        },
        "excluded": (
            "Capital cost, operation and maintenance, and the mechanism itself "
            "are not modelled. This compares energy only and cannot support a "
            "siting decision on its own."
        ),
    }


def _published_land_use(dni_kwh_m2_year: float) -> dict:
    """
    Published per-hectare measurements of tracking against fixed tilt.

    Both sources measure the per-hectare question directly on built plants.
    They do not agree, and the disagreement is reported rather than averaged.
    """
    bolinger_change = 100.0 * (
        BOLINGER_ENERGY_MWH_ACRE_TRACKING / BOLINGER_ENERGY_MWH_ACRE_FIXED - 1.0
    )

    ordered = sorted(ONG_TABLE5, key=lambda r: abs(
        r["dni_kwh_m2_year"] - float(dni_kwh_m2_year)
    ))
    nearest = sorted(ordered[:3], key=lambda r: r["dni_kwh_m2_year"])
    band = [r["land_use_change_pct"] for r in nearest]

    return {
        "bolinger_2022": {
            "fixed_gwh_ha_year": BOLINGER_ENERGY_GWH_HA_FIXED,
            "tracking_gwh_ha_year": BOLINGER_ENERGY_GWH_HA_TRACKING,
            "fixed_mwh_acre_year": BOLINGER_ENERGY_MWH_ACRE_FIXED,
            "tracking_mwh_acre_year": BOLINGER_ENERGY_MWH_ACRE_TRACKING,
            "change_pct": round(bolinger_change, 1),
            "source": SOURCE_BOLINGER,
            "note": (
                "Energy density on direct array area, measured over the "
                "sample. The tracking plants in that sample sit at higher "
                "irradiance sites than the fixed-tilt plants, which the paper "
                "states, so the per-kWp and per-hectare comparisons in it are "
                "not drawn from matched populations."
            ),
        },
        "ong_2013_table5": {
            "site_dni_kwh_m2_year": round(float(dni_kwh_m2_year), 1),
            "nearest_rows": list(nearest),
            "band_pct": [round(min(band), 1), round(max(band), 1)],
            "source": f"{SOURCE_ONG}, Table 5",
            "note": (
                "Change in land-use intensity of one-axis tracking relative to "
                "fixed tilt. Negative means tracking uses less land per unit "
                "of energy, the opposite sign to the Bolinger measurement."
            ),
        },
        "disagreement": (
            "The two published measurements disagree on the sign. They are "
            "reported separately, at their own precision, and not averaged."
        ),
    }


def _parity_ground_coverage(
    df: pd.DataFrame,
    solpos: pd.DataFrame,
    n_years: float,
    gcr_fixed: float,
    yield_fixed: float,
    ratio: dict,
    max_angle_deg: float,
) -> dict:
    """
    Tracker ground coverage ratio at which the two configurations deliver the
    same energy per hectare.

    Solved numerically because the tracker yield itself depends on the ground
    coverage ratio through backtracking, so the condition is not a closed form.
    """
    from scipy import optimize

    target = float(gcr_fixed) * float(yield_fixed)

    def residual(gcr: float) -> float:
        tilt, azim = tracker_orientation(solpos, gcr, max_angle_deg)
        poa = solar.transpose(df, solpos, tilt, azim)
        y = specific_yield(_annual(poa["poa_global"], n_years), ratio)
        return gcr * y - target

    lo, hi = 0.15, 0.95
    try:
        root = float(optimize.brentq(residual, lo, hi, xtol=1e-4))
    except ValueError:
        return {
            "gcr_tracker": None,
            "gcr_ratio": None,
            "note": (
                "No parity point inside the searched ground coverage range "
                f"{lo} to {hi}."
            ),
        }
    return {
        "gcr_tracker": round(root, 4),
        "gcr_ratio": round(root / float(gcr_fixed), 4),
        "search_range": [lo, hi],
        "note": (
            "Tracking delivers more energy per hectare only when its ground "
            "coverage ratio reaches this fraction of the fixed-tilt one. The "
            "published ground coverage ranges span this point, so the "
            "literature does not settle the sign; the specific pair does."
        ),
    }


# Generation profile.
#
# NASA POWER hourly values are hour-averaged fluxes labelled by the hour they
# begin, on UTC. Anything presented on local time must be converted explicitly
# and the offset reported, or a midday peak lands in the wrong hour.
PROFILE_TIME_STANDARD = "UTC"
PROFILE_HOUR_LABEL = "start of the averaging interval"


def generation_profile(
    frame: pd.DataFrame,
    n_years: float,
    utc_offset_hours: float | None = None,
) -> dict:
    """
    When the energy arrives: mean AC power by month and hour, peak sun hours by
    month, and the share of annual generation by hour.

    Power is per kWp of the reference array, so the profile is independent of
    plant size. Peak sun hours are on the module plane, which is the plane the
    yield is computed on, not the horizontal.

    The hour axis is UTC unless an offset is supplied, in which case the shift
    is applied here and reported in the payload rather than left to the reader.
    """
    kwp = solar.PDC0_W / 1000.0
    index = frame.index
    offset_note = (
        f"Hours are {PROFILE_TIME_STANDARD}, labelled by the "
        f"{PROFILE_HOUR_LABEL}."
    )
    if utc_offset_hours is not None:
        index = index + pd.Timedelta(hours=float(utc_offset_hours))
        offset_note = (
            f"Hours are local time, {PROFILE_TIME_STANDARD} shifted by "
            f"{float(utc_offset_hours):+g} h, labelled by the "
            f"{PROFILE_HOUR_LABEL}."
        )

    p_ac = (frame["p_ac"] / kwp).to_numpy(dtype=float)
    poa = frame["poa_global"].to_numpy(dtype=float)
    month = np.asarray(index.month)
    hour = np.asarray(index.hour)

    table = []
    for m in range(1, 13):
        row = []
        for h in range(24):
            sel = (month == m) & (hour == h)
            row.append(
                round(float(np.nanmean(p_ac[sel])), 2) if sel.any() else None
            )
        table.append({"month": m, "mean_ac_w_kwp": row})

    monthly = []
    for m in range(1, 13):
        sel = month == m
        n_hours = int(sel.sum())
        if n_hours == 0:
            monthly.append({
                "month": m, "peak_sun_hours_day": None,
                "poa_kwh_m2_month": None, "ac_kwh_kwp_month": None,
            })
            continue
        days = n_hours / 24.0 / float(n_years)
        poa_month = float(np.nansum(poa[sel])) / 1000.0 / float(n_years)
        ac_month = float(np.nansum(p_ac[sel])) / 1000.0 / float(n_years)
        monthly.append({
            "month": m,
            "peak_sun_hours_day": round(poa_month / days, 3) if days else None,
            "poa_kwh_m2_month": round(poa_month, 2),
            "ac_kwh_kwp_month": round(ac_month, 2),
        })

    total = float(np.nansum(p_ac))
    by_hour = []
    for h in range(24):
        sel = hour == h
        share = 100.0 * float(np.nansum(p_ac[sel])) / total if total > 0 else 0.0
        by_hour.append({"hour": h, "share_pct": round(share, 3)})

    return {
        "time_standard": {
            "source_standard": PROFILE_TIME_STANDARD,
            "hour_label": PROFILE_HOUR_LABEL,
            "utc_offset_hours": (
                None if utc_offset_hours is None else float(utc_offset_hours)
            ),
            "note": offset_note,
        },
        "mean_ac_power_by_month_and_hour": {
            "units": "W per kWp",
            "rows": table,
        },
        "monthly": {
            "units": {
                "peak_sun_hours_day": "h/day at 1000 W/m2, module plane",
                "poa_kwh_m2_month": "kWh/m2 per month",
                "ac_kwh_kwp_month": "kWh/kWp per month",
            },
            "rows": monthly,
            "note": (
                "Peak sun hours are the plane-of-array irradiation divided by "
                "the days in the month, so they are stated on the module "
                "plane rather than the horizontal."
            ),
        },
        "share_of_annual_generation_by_hour": {
            "units": "percent of annual AC energy",
            "rows": by_hour,
        },
        "note": (
            "Computed on the modelled AC series before any performance ratio "
            "is applied, so the shape is the model's and the level is not a "
            "reported yield."
        ),
    }


# Capacity density.
#
# One resolver, so the plant block and anything else that needs a density read
# the same value on the same declared area basis. Two blocks carrying their own
# defaults disagreed by the direct-to-total-site derate, which is a third of
# the answer.
# BOLINGER_MW_DC_ACRE_FIXED and BOLINGER_MW_DC_ACRE_TRACKING are declared at the
# head of this module, because the ground coverage ratios are derived from them
# and are bound as default arguments above this point.
BOLINGER_SAMPLE_MW_DC = 35482.0
BOLINGER_SAMPLE_MW_AC = 27001.0

# Fleet direct-current to alternating-current ratio, used ONLY to convert a
# published MW_AC density to MW_DC. It is not solar.INVERTER_OVERSIZE_RATIO:
# that constant is a model-internal inverter sizing multiplier and the two are
# unrelated quantities.
FLEET_DC_AC_RATIO = BOLINGER_SAMPLE_MW_DC / BOLINGER_SAMPLE_MW_AC

# The buildable share of a site, applied to go from direct array area to total
# site area. The paper's own worked example, not a measured median.
BUILDABLE_FRACTION = 0.75

CAPACITY_DENSITY_BASES = {
    "bolinger_fixed_direct": {
        "mw_per_acre": BOLINGER_MW_DC_ACRE_FIXED,
        "units": "dc",
        "area_basis": "direct_array",
        "mounting": "fixed_tilt",
        "source": f"{SOURCE_BOLINGER}, concluding benchmark 1",
    },
    "bolinger_fixed_total_site": {
        "mw_per_acre": BOLINGER_MW_DC_ACRE_FIXED,
        "units": "dc",
        "area_basis": "total_site",
        "mounting": "fixed_tilt",
        "buildable_derate": True,
        "source": (
            f"{SOURCE_BOLINGER}, concluding benchmark 1, derated to a total "
            "site basis by the buildable fraction the paper itself gives as a "
            "worked example"
        ),
    },
    "bolinger_tracking_direct": {
        "mw_per_acre": BOLINGER_MW_DC_ACRE_TRACKING,
        "units": "dc",
        "area_basis": "direct_array",
        "mounting": "tracking",
        "source": f"{SOURCE_BOLINGER}, concluding benchmark 1",
    },
    "nrel_large_fixed_total": {
        "acres_per_mw": 7.5,
        "units": "ac",
        "area_basis": "total_site",
        "mounting": "fixed_tilt",
        "source": f"{SOURCE_ONG}, Table 3, plants above 20 MW",
    },
    "nrel_large_fixed_direct": {
        "acres_per_mw": 5.8,
        "units": "ac",
        "area_basis": "direct_array",
        "mounting": "fixed_tilt",
        "source": f"{SOURCE_ONG}, Table 4, plants above 20 MW",
    },
    "nrel_small_fixed_total": {
        "acres_per_mw": 7.6,
        "units": "ac",
        "area_basis": "total_site",
        "mounting": "fixed_tilt",
        "source": f"{SOURCE_ONG}, Table 3, plants below 20 MW",
    },
    "nrel_small_fixed_direct": {
        "acres_per_mw": 5.5,
        "units": "ac",
        "area_basis": "direct_array",
        "mounting": "fixed_tilt",
        "source": f"{SOURCE_ONG}, Table 4, plants below 20 MW",
    },
}

DEFAULT_CAPACITY_DENSITY_BASIS = "bolinger_fixed_total_site"


def resolve_capacity_density(
    basis: str = DEFAULT_CAPACITY_DENSITY_BASIS,
    buildable_fraction: float = BUILDABLE_FRACTION,
    fleet_dc_ac_ratio: float = FLEET_DC_AC_RATIO,
) -> dict:
    """
    Installed capacity per hectare on one declared area basis.

    Returns the value, the units it is published in, the area basis it applies
    to and the source. A siting raster classifies whole terrain including what
    would become roads, spacing and substation, so its hectares are a total
    site quantity; applying a direct-array density to them treats the whole
    polygon as array footprint.
    """
    if basis not in CAPACITY_DENSITY_BASES:
        raise ValueError(f"unknown capacity density basis: {basis}")
    spec = CAPACITY_DENSITY_BASES[basis]

    if "mw_per_acre" in spec:
        value = float(spec["mw_per_acre"]) / ACRE_HA
    else:
        value = 1.0 / (float(spec["acres_per_mw"]) * ACRE_HA)

    derated = bool(spec.get("buildable_derate"))
    if derated:
        value *= float(buildable_fraction)

    if spec["units"] == "dc":
        value_dc = value
        converted = False
    else:
        value_dc = value * float(fleet_dc_ac_ratio)
        converted = True

    return {
        "basis": basis,
        "value_mw_per_ha": float(value),
        "units": spec["units"],
        "value_mw_dc_per_ha": float(value_dc),
        "area_basis": spec["area_basis"],
        "mounting": spec["mounting"],
        "source": spec["source"],
        "acre_conversion": SOURCE_NIST_ACRE,
        "buildable_fraction": float(buildable_fraction) if derated else None,
        "fleet_dc_ac_ratio": float(fleet_dc_ac_ratio),
        "ac_to_dc_conversion_applied": converted,
        "note": (
            "The choice of basis moves the answer further than the exceedance "
            "band does. Report the density with every capacity figure."
        ),
    }


# Plant energy over the suitable area.
#
# Exceedance convention: P90 is the value exceeded in 90 percent of years, so
# it is BELOW P50. The resource card reports statistical percentiles, in which
# the 90th is the high value, so both conventions appear on one screen and the
# crosswalk below makes the identity between them visible.
EXCEEDANCE_LEVELS = (50, 75, 90)

# The stored resource percentiles are empirical, and this block uses the same
# estimator so the two products cannot contradict each other. The normal fit is
# reported beside it, not applied.
EXCEEDANCE_METHOD = "empirical"

# What the band contains and what it does not. Stated in the payload, not only
# in documentation, because a band labelled P90 is read as a bankable one.
UNCERTAINTY_INCLUDED = (
    "measured interannual variability of annual global horizontal irradiation "
    "over the complete calendar years in the daily record",
)
UNCERTAINTY_EXCLUDED = (
    "radiation product bias against ground measurement",
    "transposition and photovoltaic model error",
    "performance ratio uncertainty",
    "soiling variability",
    "degradation over plant life",
    "availability and curtailment",
    "inter-row shading",
    "the capacity density basis",
)


def exceedance_table(
    annual_totals: pd.Series,
    levels=EXCEEDANCE_LEVELS,
) -> dict:
    """
    Exceedance factors on annual irradiation, empirical and normal-fit.

    Empirical is applied, matching the estimator the resource card already
    uses for its percentiles, so the two cannot disagree on screen. The normal
    fit is reported beside it together with a Shapiro-Wilk test of the
    normality it assumes, which is run rather than assumed either way.

    Energy is treated as linear in annual irradiation. That is first order
    only: the plane-of-array to horizontal ratio depends on the diffuse
    fraction, which varies between years, and photovoltaic output is slightly
    sub-linear in irradiance through cell temperature.
    """
    from scipy import stats

    values = np.asarray(annual_totals, dtype=float)
    values = values[np.isfinite(values)]
    n = int(values.size)
    if n == 0:
        raise ValueError("no complete year in the annual totals")

    mean = float(values.mean())
    std = float(values.std(ddof=1)) if n > 1 else 0.0
    cv = std / mean if mean else 0.0

    rows = []
    for level in levels:
        empirical = float(np.percentile(values, 100.0 - float(level)))
        z = float(stats.norm.ppf(1.0 - float(level) / 100.0))
        normal = mean * (1.0 + z * cv)
        se = std * float(np.sqrt(1.0 / n + z * z / (2.0 * (n - 1)))) if n > 2 else None
        rows.append({
            "level": int(level),
            "ghi_empirical_kwh_m2_year": round(empirical, 2),
            "factor_empirical": round(empirical / mean, 6) if mean else None,
            "ghi_normal_kwh_m2_year": round(normal, 2),
            "factor_normal": round(normal / mean, 6) if mean else None,
            "normal_fit_standard_error_kwh_m2": (
                None if se is None else round(se, 2)
            ),
        })

    if n >= 3:
        sw = stats.shapiro(values)
        normality = {
            "test": "Shapiro-Wilk",
            "statistic": round(float(sw.statistic), 5),
            "p_value": round(float(sw.pvalue), 4),
        }
    else:
        normality = {
            "test": "Shapiro-Wilk",
            "statistic": None,
            "p_value": None,
        }

    return {
        "method_applied": EXCEEDANCE_METHOD,
        "convention": "exceedance",
        "convention_note": (
            "P90 is the value exceeded in 90 percent of years and is therefore "
            "below P50. The resource card reports statistical percentiles, in "
            "which the 90th is the high value; the crosswalk below shows the "
            "two are the same numbers under opposite labels."
        ),
        "n_years": n,
        "mean_kwh_m2_year": round(mean, 2),
        "std_kwh_m2_year": round(std, 2),
        "cv_pct": round(100.0 * cv, 3),
        "levels": rows,
        "normality": normality,
        "crosswalk": {
            "exceedance_p90_kwh_m2_year": round(
                float(np.percentile(values, 10.0)), 2
            ),
            "statistical_p10_kwh_m2_year": round(
                float(np.percentile(values, 10.0)), 2
            ),
            "exceedance_p10_kwh_m2_year": round(
                float(np.percentile(values, 90.0)), 2
            ),
            "statistical_p90_kwh_m2_year": round(
                float(np.percentile(values, 90.0)), 2
            ),
            "note": (
                "The exceedance P90 and the card's statistical 10th percentile "
                "are the same estimate of the same quantity."
            ),
        },
        "linearity_assumption": (
            "energy is treated as linear in annual global horizontal "
            "irradiation; first order only"
        ),
    }


def largest_contiguous_area_ha(
    suitability: np.ndarray,
    pixel_area_ha: float,
    code: int = 4,
) -> dict:
    """
    Largest connected block of one siting class, and how many blocks there are.

    Reported with every capacity figure: an area scattered across many small
    patches does not host the plant the arithmetic implies. Eight-connectivity,
    so a diagonal chain of pixels counts as one block.
    """
    from scipy import ndimage

    mask = np.asarray(suitability) == int(code)
    if not mask.any():
        return {"largest_ha": 0.0, "n_patches": 0, "connectivity": 8}
    structure = ndimage.generate_binary_structure(2, 2)
    labels, n = ndimage.label(mask, structure=structure)
    sizes = np.bincount(labels.ravel())[1:]
    return {
        "largest_ha": round(float(sizes.max()) * float(pixel_area_ha), 3),
        "n_patches": int(n),
        "connectivity": 8,
        "note": (
            "Capacity computed from a total area assumes it is buildable as "
            "one block. Read this figure next to the capacity."
        ),
    }


def _class_area(class_areas, code: int) -> float:
    """Area of one siting class from either a stats list or a code map."""
    if isinstance(class_areas, dict):
        return float(class_areas.get(code, class_areas.get(str(code), 0.0)) or 0.0)
    for row in class_areas:
        if int(row.get("code", -1)) == code:
            return float(row.get("area_ha", 0.0) or 0.0)
    return 0.0


def _applied_shading_derate(
    beam_basis_derate: float,
    beam_share: float | None,
    applied: bool,
) -> dict:
    """
    The horizon shading derate converted from the beam basis to a yield basis.

    solar.shading_loss_fraction returns the share of BEAM energy a pixel loses
    to its own horizon, and the terrain product publishes that fraction
    unscaled, which is what the research figures report. A plane-of-array total
    carries beam and diffuse together, so a beam-basis loss L reduces the total
    by L times the beam share, not by L:

        applied_derate = 1 - (1 - beam_basis_derate) * beam_share

    Applying the beam-basis derate straight onto the alternating-current yield
    overstates the loss by the diffuse share. Measured at the reference site,
    where the beam share is 0.6425, a 3 percent mean beam loss gives 0.98072
    applied against 0.97000 unscaled, so every capacity-class energy figure was
    1.09 percent low whenever the user enabled shading. solar.beam_fraction
    already computes the share and the terrain response already carries it, so
    the correction is a conversion, not a new assumption.

    With no beam share supplied there is nothing to convert with, so the derate
    is refused rather than applied on the wrong base: the record reports 1.0,
    not applied, and says why.
    """
    d = float(beam_basis_derate)
    if not applied or abs(d - 1.0) < 1e-12:
        return {
            "derate": 1.0,
            "applied": False,
            "beam_basis_derate": round(d, 5),
            "beam_share": None if beam_share is None else round(
                float(beam_share), 4
            ),
            "basis": "not applied",
            "note": (
                "Set to 1.0 and reported as not applied. The terrain field was "
                "not supplied, or it reported no horizon loss."
            ),
        }
    if beam_share is None:
        return {
            "derate": 1.0,
            "applied": False,
            "beam_basis_derate": round(d, 5),
            "beam_share": None,
            "basis": "not applied",
            "note": (
                "A horizon shading derate was supplied without the beam share "
                "it is a fraction of. It is a share of beam irradiance and a "
                "plane-of-array total is beam plus diffuse, so applying it "
                "unscaled would overstate the loss by the diffuse share. "
                "Reported as not applied rather than applied on the wrong base."
            ),
        }
    share = float(np.clip(float(beam_share), 0.0, 1.0))
    applied_derate = 1.0 - (1.0 - d) * share
    return {
        "derate": round(float(applied_derate), 5),
        "applied": True,
        "beam_basis_derate": round(d, 5),
        "beam_share": round(share, 4),
        "basis": "beam-basis loss scaled to the plane-of-array total",
        "note": (
            "Horizon shading over the suitable pixels. The published loss is a "
            "fraction of beam irradiance, because the horizon removes beam "
            "energy only, so it is scaled by the beam share "
            f"{share:.4f} of the plane-of-array total before it reaches the "
            f"yield: {d:.5f} on the beam basis becomes "
            f"{applied_derate:.5f} on the yield."
        ),
    }


def plant_energy(
    class_areas,
    annual_totals: pd.Series,
    poa_kwh_m2_year: float,
    ratio: dict,
    density: dict | None = None,
    shading_derate: float = 1.0,
    shading_applied: bool = False,
    beam_share: float | None = None,
    suitability: np.ndarray | None = None,
    pixel_area_ha: float | None = None,
    levels=EXCEEDANCE_LEVELS,
    thresholds: dict | None = None,
) -> dict:
    """
    Installed capacity and annual energy over the suitable area, at exceedance
    levels taken from the measured interannual spread.

    Class 4, suitable with no land-use conflict, is the only area that feeds
    the headline figure. Class 3, suitable but in conflict with annual
    cropping, is computed in a sibling object under its own key prefix and is
    never summed into it: it is not additional capacity but the same land
    priced in food production. Class 2, restrictive slope, is a third separate
    figure and is not converted to capacity, because the density references do
    not cover the racking it would need.

    Every energy figure carries the reporting basis it was computed on, so a
    lifetime-mean yield cannot be read against a year-one exceedance band.

    shading_derate is on the BEAM basis, which is what the terrain product
    publishes; beam_share converts it. See _applied_shading_derate.
    """
    _require_resolved(ratio)
    dens = density or resolve_capacity_density()
    density_mw_dc_ha = float(dens["value_mw_dc_per_ha"])

    shading = _applied_shading_derate(
        shading_derate, beam_share, shading_applied
    )
    derate = float(shading["derate"])
    yield_applied = specific_yield(poa_kwh_m2_year, ratio) * derate

    exceedance = exceedance_table(annual_totals, levels)
    factors = {
        row["level"]: row["factor_empirical"] for row in exceedance["levels"]
    }

    def block(area_ha: float, label: str, note: str | None = None) -> dict:
        capacity_dc = float(area_ha) * density_mw_dc_ha
        # Alternating-current capacity is grid-connection context only and does
        # not enter the energy, because the specific yield is already AC energy
        # per kWp of direct-current nameplate.
        capacity_ac = capacity_dc / float(dens["fleet_dc_ac_ratio"])
        energy = {}
        for level, factor in factors.items():
            gwh = capacity_dc * yield_applied * float(factor) / 1000.0
            energy[f"p{level}_exceedance_gwh_year"] = round(gwh, 2)
        out = {
            "label": label,
            "area_ha": round(float(area_ha), 3),
            "capacity_dc_mw": round(capacity_dc, 2),
            "capacity_ac_mw": None if capacity_ac is None else round(capacity_ac, 2),
            "specific_yield_kwh_kwp_year": round(yield_applied, 2),
            "energy": energy,
            "reporting_basis": ratio["reporting_basis"],
            "performance_ratio": float(ratio["applied"]),
            "performance_ratio_source": ratio["applied_source"],
        }
        if note:
            out["note"] = note
        return out

    area4 = _class_area(class_areas, 4)
    area3 = _class_area(class_areas, 3)
    area2 = _class_area(class_areas, 2)

    suitable = block(area4, "Suitable, no land-use conflict")
    if suitability is not None and pixel_area_ha:
        suitable["contiguity"] = largest_contiguous_area_ha(
            suitability, pixel_area_ha, 4
        )

    cropland = block(
        area3,
        "Suitable, conflicts with annual cropping",
        "Not additional capacity. This is the same land counted against its "
        "current use, and realising it would take annual cropland out of food "
        "production. It is never summed with the suitable area.",
    )
    if suitability is not None and pixel_area_ha:
        cropland["contiguity"] = largest_contiguous_area_ha(
            suitability, pixel_area_ha, 3
        )

    # Cross-check against the published energy density. Bolinger's figure is on
    # direct array area, so the comparison is made on that basis whatever basis
    # was selected for the headline, or it compares two different quantities.
    direct = resolve_capacity_density("bolinger_fixed_direct")
    energy_density = (
        float(direct["value_mw_dc_per_ha"]) * yield_applied
    )
    reference_density = BOLINGER_ENERGY_MWH_ACRE_FIXED / ACRE_HA

    return {
        "suitable": suitable,
        "cropland_conflict": cropland,
        "restrictive": {
            "label": "Restrictive, slope near the limit",
            "area_ha": round(area2, 3),
            "capacity_dc_mw": None,
            "note": (
                "Reported as area only. Siting here would need non-standard "
                "racking, which the capacity density references do not cover."
            ),
        },
        "areas_note": (
            "The three areas are reported apart and are never summed. The "
            "trade-off between them is the result, and a total would erase it."
        ),
        "capacity_density": dens,
        "shading": shading,
        "exceedance": exceedance,
        "uncertainty": {
            "included": list(UNCERTAINTY_INCLUDED),
            "excluded": list(UNCERTAINTY_EXCLUDED),
            "statement": (
                "This band propagates measured year-to-year variability in the "
                "solar resource only. It does not include model, performance "
                "ratio, soiling, degradation or availability uncertainty, and "
                "it is therefore narrower than a P90 used for project finance."
            ),
            "dominant_term": (
                "The capacity density basis moves the answer further than the "
                "whole exceedance band does."
            ),
        },
        "energy_density_cross_check": {
            "site_mwh_ha_year": round(energy_density, 1),
            "reference_mwh_ha_year": round(reference_density, 1),
            "ratio": round(energy_density / reference_density, 3)
            if reference_density else None,
            "area_basis": "direct_array",
            "source": f"{SOURCE_BOLINGER}, concluding benchmark 2",
            "note": (
                "Computed on the direct array basis whatever basis the "
                "headline uses, because the published reference is on that "
                "basis. A ratio far from one indicates a unit error before it "
                "indicates a resource difference."
            ),
        },
        "reporting_basis": ratio["reporting_basis"],
        "limitations": (
            "A resource and land ceiling, not an interconnectable or permitted "
            "capacity. Grid connection is not consulted, and the class areas "
            "inherit the siting conventions they were produced under."
        ),
        "thresholds": thresholds,
    }
