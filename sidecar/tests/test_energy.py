"""Unit tests for the energy analysis helpers (offline).

The synthetic site below is a clear-sky series, not a measurement, so no test
here pins an energy figure that depends on the weather. What is pinned is the
arithmetic that must hold on any site: the telescoping identity, what the
waterfall is referenced to, which steps sit inside the performance ratio, the
exceedance convention, and the rule that the two suitable classes are never
summed. The reference-site section at the end pins the stored figures for
Propriedade B and is skipped where that series is not on disk.
"""

from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import energy
import solar


SITE_LAT = -25.0
SITE_LON = -53.5


@lru_cache(maxsize=None)
def _synthetic_site() -> dict:
    """Two complete calendar years of hourly irradiance, solar position and
    photovoltaic output, built the way infer.py builds them.

    Clear-sky irradiance attenuated by a seasonal clearness factor, so the
    series is deterministic and offline while still varying over the day and
    the year. Two whole years, because season_years and annual_totals both read
    complete calendar years and a partial one would be dropped.

    Cached: every test below reads the same chain, and rebuilding it per test
    would recompute the solar position for 17520 hours each time.
    """
    import pvlib

    index = pd.date_range("2021-01-01", "2022-12-31 23:00", freq="h", tz="UTC")
    mid = index + pd.Timedelta(minutes=solar.HOUR_LABEL_OFFSET_MIN)
    solpos = pvlib.solarposition.get_solarposition(mid, SITE_LAT, SITE_LON)
    clear = pvlib.clearsky.simplified_solis(solpos["apparent_elevation"])

    doy = index.dayofyear.to_numpy(dtype=float)
    hour = index.hour.to_numpy(dtype=float)
    clearness = 0.80 - 0.10 * np.cos(2.0 * np.pi * (doy - 15.0) / 365.0)

    hourly = pd.DataFrame(
        {
            "ALLSKY_SFC_SW_DWN": clear["ghi"].to_numpy() * clearness,
            "ALLSKY_SFC_SW_DNI": clear["dni"].to_numpy() * clearness,
            "ALLSKY_SFC_SW_DIFF": clear["dhi"].to_numpy() * clearness,
            "T2M": (
                20.0
                + 6.0 * np.cos(2.0 * np.pi * (doy - 15.0) / 365.0)
                + 5.0 * np.sin(2.0 * np.pi * (hour - 9.0) / 24.0)
            ),
            # The pvlib module-height reference wind, so the temperature step is
            # not driven by a fabricated wind field.
            "WS2M": np.full(len(index), 1.0),
        },
        index=index,
    )

    df, solpos = solar.prepare_hourly(hourly, SITE_LAT, SITE_LON, 0.0)
    n_years = float(len(set(df.index.year)))
    tilt, azimuth = 25.0, 0.0
    poa = solar.transpose(df, solpos, tilt, azimuth)
    poa_horizontal = solar.transpose(df, solpos, 0.0, azimuth)
    frame = solar.pv_yield_frame(poa, df, solpos, tilt, azimuth)
    return {
        "df": df,
        "solpos": solpos,
        "poa": poa,
        "frame": frame,
        "n_years": n_years,
        "tilt": tilt,
        "azimuth": azimuth,
        "ghi_hourly_kwh_m2_year": float(df["ghi"].sum()) / 1000.0 / n_years,
        "poa_horizontal_kwh_m2_year": (
            float(poa_horizontal["poa_global"].sum()) / 1000.0 / n_years
        ),
    }


def _ratio(**kwargs) -> dict:
    site = _synthetic_site()
    return energy.resolve_performance_ratio(
        site["frame"], site["n_years"], **kwargs
    )


def _waterfall(ratio: dict | None = None) -> dict:
    site = _synthetic_site()
    return energy.loss_waterfall(
        site["frame"],
        site["ghi_hourly_kwh_m2_year"],
        site["poa_horizontal_kwh_m2_year"],
        site["n_years"],
        ratio or _ratio(),
        hourly_window="2021-2022 hourly, synthetic",
        # Deliberately different from the hourly window, which is the situation
        # the base rule exists for.
        ghi_climatology_kwh_m2_year=site["ghi_hourly_kwh_m2_year"] - 40.0,
        climatology_window="1993-2022 daily, synthetic",
    )


def _annual_totals() -> pd.Series:
    """Ten annual irradiation totals, spread like a measured record.

    Deliberately asymmetric about the mean so the empirical and normal-fit
    percentiles differ and a test can tell which estimator was applied.
    """
    values = [
        1700.0, 1752.0, 1806.0, 1823.0, 1688.0,
        1771.0, 1764.0, 1741.0, 1812.0, 1602.0,
    ]
    return pd.Series(values, index=range(2013, 2023))


def _leaves(node, path=""):
    """Every leaf of a payload with the dotted path that reaches it."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield from _leaves(value, f"{path}.{key}" if path else str(key))
    elif isinstance(node, (list, tuple)):
        for i, value in enumerate(node):
            yield from _leaves(value, f"{path}[{i}]")
    else:
        yield path, node


# Modelled factors and the telescoping identity


def test_modelled_factors_telescope_into_the_performance_ratio():
    """
    The three factors are consecutive ratios of the same annual energy sums, so
    their product is the plane-of-array to AC ratio identically. A non-zero
    residual means the stages did not come from one chain, and every ratio built
    on them is then wrong with nothing on screen to say so.
    """
    site = _synthetic_site()
    f = energy.modelled_factors(site["frame"], site["n_years"])
    product = f["f_iam"] * f["f_temp"] * f["f_inverter"]
    assert abs(product - f["performance_ratio_modelled"]) < 1e-12
    # Not exact zero: the residual is a difference of products, so its last bit
    # depends on the order the platform BLAS multiplies them. It came out at
    # -1.1e-16 on CI numpy against 0.0 here, which is one ULP and not a defect.
    # energy.py declares the tolerance the module itself checks against, and the
    # two assertions either side of this one already use it.
    assert abs(f["telescoping_residual"]) <= energy.TELESCOPING_TOLERANCE
    assert abs(
        f["performance_ratio_modelled"]
        - f["energy_ac_kwh_kwp_year"] / f["energy_poa_kwh_m2_year"]
    ) < energy.TELESCOPING_TOLERANCE


def test_modelled_factors_agree_with_the_ratio_solar_reports():
    """
    Two modules must not report two performance ratios for one frame. The
    waterfall decomposition has to land on solar.modelled_performance_ratio,
    which is what the resource card already ships.
    """
    site = _synthetic_site()
    f = energy.modelled_factors(site["frame"], site["n_years"])
    reported = solar.modelled_performance_ratio(
        site["frame"]["p_ac"], site["frame"]["poa_global"]
    )
    assert abs(f["performance_ratio_modelled"] - reported) < 1e-12


def test_modelled_factors_refuse_a_frame_that_is_not_one_chain():
    """
    The identity is algebraic, so it cannot detect a rescaled stage; what it
    does detect is a stage that is absent or degenerate, which is what a frame
    assembled from two different runs looks like. It raises rather than
    returning a ratio with a non-finite factor hidden inside it.
    """
    site = _synthetic_site()
    broken = site["frame"].copy()
    broken["g_eff"] = 0.0
    with pytest.raises(ValueError, match="telescope"):
        energy.modelled_factors(broken, site["n_years"])


def test_cell_temperature_is_weighted_by_the_irradiance_that_produces_energy():
    """
    An unweighted mean over all hours includes the night, which contributes no
    energy and no temperature loss, so it reads far below the temperature the
    reported factor is a function of.
    """
    site = _synthetic_site()
    f = energy.modelled_factors(site["frame"], site["n_years"])
    unweighted = float(site["frame"]["temp_cell"].mean())
    assert f["temp_cell_irradiance_weighted_c"] > unweighted
    assert f["temp_cell_irradiance_weighted_c"] < float(
        site["frame"]["temp_cell"].max()
    )


# The resolved performance ratio


def test_applied_ratio_defaults_to_the_benchmarked_reference():
    """
    The waterfall exists to make the reference auditable, not to replace it.
    The applied value is the one with an external benchmark, and it stays the
    default whatever the derived value comes out at, because the derived value
    has no benchmark of its own.
    """
    ratio = _ratio()
    assert ratio["applied"] == solar.REFERENCE_PERFORMANCE_RATIO
    assert ratio["applied_source"] == "reference"
    low, high = ratio["gsa_implied_band"]
    assert low <= ratio["reference"] <= high
    assert ratio["applied"] != ratio["derived"]
    assert "no external benchmark" in ratio["derived_source"]
    assert "Global Solar Atlas" in ratio["reference_source"]


def test_user_override_is_recorded_as_a_user_value():
    ratio = _ratio(override=0.77)
    assert ratio["applied"] == 0.77
    assert ratio["applied_source"] == "user"
    assert ratio["reference"] == solar.REFERENCE_PERFORMANCE_RATIO


def test_declared_losses_are_the_pvwatts_default_stack():
    """
    Six terms the chain does not model, each carrying its own source and marked
    editable. Their product is the only thing separating the modelled ratio from
    the derived one, so it is pinned rather than left to the sum of six rows.
    """
    ratio = _ratio()
    assert len(ratio["declared_losses"]) == 6
    assert abs(ratio["declared_loss_factor"] - 0.913214) < 5e-7
    assert abs(
        ratio["derived"] - ratio["modelled"] * ratio["declared_loss_factor"]
    ) < 1e-12
    for row in ratio["declared_losses"]:
        assert row["user_editable"] is True
        assert row["kind"] == "assumed"
        assert "Dobos" in row["source"]
        assert abs(row["factor"] - (1.0 - row["loss_pct"] / 100.0)) < 1e-12


def test_inter_row_shading_and_availability_default_to_zero_with_the_reason():
    """
    Neither is modelled: no row geometry exists in this chain, so an inter-row
    shading loss cannot be computed from it, and no availability record exists
    for the site. Setting them to the PVWatts suggested 3 percent each would
    push the derived ratio below the external band the applied ratio is
    calibrated against, which the payload states so the user enabling them can
    see where it lands first.
    """
    ratio = _ratio()
    assert energy.OPTIONAL_LOSS_PCT == {
        "interrow_shading": 0.0, "availability": 0.0
    }
    assert ratio["optional_loss_factor"] == 1.0
    for row in ratio["optional_losses"]:
        assert row["loss_pct"] == 0.0
        assert row["factor"] == 1.0
        assert row["pvwatts_suggested_pct"] == 3.0
        assert row["user_editable"] is True
        assert "defaults to zero" in row["source"]
    assert (
        ratio["derived_if_optional_at_pvwatts_defaults"]
        < ratio["gsa_implied_band"][0]
    )


def test_a_bare_performance_ratio_is_refused():
    """
    A float carries neither provenance nor reporting basis, so a figure computed
    from one cannot be labelled and two products fed different literals would
    disagree with nothing on screen to explain it.
    """
    with pytest.raises(TypeError, match="resolved performance ratio"):
        energy.specific_yield(1884.6, 0.80)
    with pytest.raises(TypeError):
        energy.plant_energy([], _annual_totals(), 1884.6, 0.80)


def test_specific_yield_is_the_plane_of_array_energy_times_the_applied_ratio():
    ratio = _ratio()
    assert abs(energy.specific_yield(1000.0, ratio) - 800.0) < 1e-9


# Reporting basis


def test_year_one_basis_applies_no_degradation():
    assert energy.degradation_factor("year_one") == 1.0
    assert _ratio()["degradation_factor"] == 1.0


def test_lifetime_mean_basis_is_the_published_median_over_the_period():
    """Mean of (1 - 0.005)^t over 25 years, at the Jordan and Kurtz median."""
    assert abs(energy.degradation_factor("lifetime_mean") - 0.942238) < 5e-7
    assert energy.degradation_factor("lifetime_mean", 0.0, 25) == 1.0


def test_an_unknown_reporting_basis_is_refused():
    with pytest.raises(ValueError, match="reporting basis"):
        energy.degradation_factor("lifetime")


def test_reporting_basis_travels_with_every_energy_figure():
    """
    A lifetime-mean yield read against a year-one exceedance band multiplies two
    different bases with no label. Every block that reports an energy therefore
    echoes the basis it was computed on, and the basis moves the figure.
    """
    year_one = _ratio()
    lifetime = _ratio(reporting_basis="lifetime_mean")
    deg = lifetime["degradation_factor"]
    assert deg < 1.0

    poa = year_one["factors"]["energy_poa_kwh_m2_year"]
    assert abs(
        energy.specific_yield(poa, lifetime)
        - energy.specific_yield(poa, year_one) * deg
    ) < 1e-9

    areas = [{"code": 4, "area_ha": 100.0}, {"code": 3, "area_ha": 40.0}]
    a = energy.plant_energy(areas, _annual_totals(), poa, year_one)
    b = energy.plant_energy(areas, _annual_totals(), poa, lifetime)
    assert a["reporting_basis"] == "year_one"
    assert b["reporting_basis"] == "lifetime_mean"
    for block in ("suitable", "cropland_conflict"):
        assert a[block]["reporting_basis"] == "year_one"
        assert b[block]["reporting_basis"] == "lifetime_mean"
        assert abs(
            b[block]["specific_yield_kwh_kwp_year"]
            - a[block]["specific_yield_kwh_kwp_year"] * deg
        ) < 0.02
        for level, gwh in b[block]["energy"].items():
            assert abs(gwh - a[block]["energy"][level] * deg) < 0.02


# The loss waterfall


def test_waterfall_base_is_the_hourly_window_not_the_climatology():
    """
    The photovoltaic chain runs on the hourly series. Starting the account from
    the multi-decade daily climatology, which is a different product over a
    different window, would make every ratio below it wrong by the difference
    between the two windows. The climatology is carried as labelled context.
    """
    site = _synthetic_site()
    wf = _waterfall()
    base = [r for r in wf["steps"] if r["kind"] == "base"]
    assert len(base) == 1
    assert base[0]["energy_after"] == site["ghi_hourly_kwh_m2_year"]
    assert wf["base"]["ghi_hourly_kwh_m2_year"] == site["ghi_hourly_kwh_m2_year"]

    context = [r for r in wf["steps"] if r["kind"] == "context"]
    assert len(context) == 1
    assert context[0]["energy_after"] != base[0]["energy_after"]
    assert context[0]["factor"] is None
    assert context[0]["in_performance_ratio"] is False
    assert context[0]["step"] < base[0]["step"]


def test_component_closure_residual_sits_outside_the_performance_ratio():
    """
    NASA POWER's published GHI and the horizontal plane rebuilt from its DNI and
    DHI do not close. That is a property of the radiation product, not a loss
    the plant suffers, so it must not enter the performance-ratio chain where it
    would be read as one.
    """
    wf = _waterfall()
    closure = [r for r in wf["steps"] if r["kind"] == "data_product"]
    assert len(closure) == 1
    row = closure[0]
    assert row["in_performance_ratio"] is False
    assert row["cumulative_ratio"] is None
    assert abs(row["factor"] - 1.0) > 1e-4, "the step is not a no-op"
    assert row["label"] in wf["outside_performance_ratio"]
    assert "not a plant loss" in row["note"]


def test_the_performance_ratio_chain_multiplies_to_the_derived_ratio():
    """
    Every step flagged as inside the ratio, and only those, accounts for the
    difference between the plane-of-array energy and the delivered energy. If a
    step outside the chain were flagged as inside it, this product would move
    away from the ratio the resolver reports.
    """
    wf = _waterfall()
    ratio = _ratio()
    product = 1.0
    for row in wf["steps"]:
        if row["in_performance_ratio"] and row["factor"] is not None:
            product *= row["factor"]
    assert abs(product - ratio["derived"]) < 1e-12

    modelled = [r for r in wf["steps"] if r["kind"] == "modelled"
                and r["in_performance_ratio"]]
    assert abs(
        math.prod(r["factor"] for r in modelled) - ratio["modelled"]
    ) < 1e-12
    names = {c["name"]: c for c in wf["checkpoints"]}
    # See the note in test_modelled_factors_telescope_into_the_performance_ratio:
    # one ULP of float noise, not a broken chain.
    assert abs(
        names["performance_ratio_modelled"]["residual"]
    ) <= energy.TELESCOPING_TOLERANCE
    assert abs(
        names["performance_ratio_derived"]["value"] - ratio["derived"]
    ) < 1e-12


def test_the_change_of_unit_creates_no_energy():
    """
    The rows change from irradiation per square metre to energy per kWp midway.
    They are numerically continuous only because the reference array is rated at
    1000 W/m2, so the step carries a factor of exactly one and says so.
    """
    wf = _waterfall()
    change = [r for r in wf["steps"] if r["kind"] == "unit_change"]
    assert len(change) == 1
    assert change[0]["factor"] == 1.0
    before = [r for r in wf["steps"] if r["step"] < change[0]["step"]]
    after = [r for r in wf["steps"] if r["step"] > change[0]["step"]]
    assert {r["units"] for r in before} == {"kWh/m2/yr"}
    assert {r["units"] for r in after} == {"kWh/kWp/yr"}


def test_degradation_is_a_basis_row_and_not_a_loss():
    wf = _waterfall()
    basis = [r for r in wf["steps"] if r["kind"] == "basis"]
    assert len(basis) == 1
    assert basis[0]["in_performance_ratio"] is False
    assert basis[0]["factor"] == 1.0, "year one applies no degradation"
    assert "Not a loss row" in basis[0]["note"]


def test_delivered_reports_both_ratios_with_the_difference_between_them():
    """
    Two defensible yields exist for one site and both are shipped, so the reader
    is not left to discover the gap. Which of the two is the larger is a
    property of the site and is pinned on the reference series, not here; what
    is pinned here is that each yield is computed on its own ratio and that the
    stated difference is the difference between them.
    """
    wf = _waterfall()
    ratio = _ratio()
    delivered = wf["delivered"]
    poa = ratio["factors"]["energy_poa_kwh_m2_year"]
    assert abs(
        delivered["applied_kwh_kwp_year"] - poa * ratio["applied"]
    ) < 1e-9
    assert abs(delivered["derived_kwh_kwp_year"] - poa * ratio["derived"]) < 1e-9
    assert abs(
        delivered["difference_pct"]
        - 100.0 * (ratio["derived"] / ratio["applied"] - 1.0)
    ) < 1e-9
    assert abs(
        delivered["applied_capacity_factor_pct"]
        - 100.0 * delivered["applied_kwh_kwp_year"] / 8760.0
    ) < 1e-9
    assert delivered["reporting_basis"] == "year_one"
    assert wf["assumptions"]["module_type"]["module_type"] == "premium"
    assert wf["assumptions"]["albedo"]["value"] == solar.ALBEDO


# Tracking


def test_tracker_is_stowed_flat_while_the_sun_is_below_the_horizon():
    """
    pvlib returns NaN for the rotation of a tracker with no sun to track.
    Dropping those hours would break alignment with the meteorology and leaving
    them NaN would make the annual sum NaN, so they are filled. The fill cannot
    change the result because the irradiance in those hours is zero.
    """
    site = _synthetic_site()
    tilt, azimuth = energy.tracker_orientation(site["solpos"], 0.35)
    night = site["solpos"]["apparent_zenith"] > 90.0
    assert night.any()
    assert not tilt.isna().any() and not azimuth.isna().any()
    assert (tilt[night] == 0.0).all()
    assert float(site["df"]["ghi"][night].sum()) < 1e-6


def test_tracker_rotation_stays_within_the_limit_on_a_north_south_axis():
    site = _synthetic_site()
    tilt, azimuth = energy.tracker_orientation(site["solpos"], 0.35, 45.0)
    assert tilt.max() <= 45.0 + 1e-9
    day = site["solpos"]["apparent_zenith"] <= 90.0
    assert set(np.round(azimuth[day].to_numpy(), 6)) <= {90.0, 270.0}


def test_backtracking_is_not_a_request_parameter():
    """
    With backtrack disabled pvlib ignores the ground coverage ratio and stops
    the rotation without removing the irradiance the shaded rows no longer
    receive, so the reported gain would exceed what a plant delivers. The flag
    is a module constant and no caller can reach the wrong branch.
    """
    import inspect

    assert energy.TRACKER_BACKTRACK is True
    for fn in (energy.tracker_orientation, energy.tracking_comparison):
        assert "backtrack" not in inspect.signature(fn).parameters
    site = _synthetic_site()
    result = energy.tracking_comparison(
        site["df"], site["solpos"], site["n_years"], site["poa"],
        site["tilt"], site["azimuth"], _ratio(), solve_parity=False,
    )
    assert result["configuration"]["backtrack"] is True


_AREA_DENOMINATED = re.compile(r"(mw|gwh|mwh)[a-z_]*_(ha|acre)")


def test_tracking_emits_no_absolute_capacity_or_energy_density():
    """
    The per-hectare comparison is a ratio and the ratio is unaffected by the
    density basis, while an absolute density emitted here could disagree with
    the one resolve_capacity_density gives the plant block for the same area.
    The only area-denominated figures allowed are the published measurements,
    which are data carried with their source.
    """
    # The scan is worthless if it cannot fire, so it is first shown against the
    # keys the density resolver emits.
    for key in energy.resolve_capacity_density():
        if key in ("value_mw_per_ha", "value_mw_dc_per_ha"):
            assert _AREA_DENOMINATED.search(key)

    site = _synthetic_site()
    result = energy.tracking_comparison(
        site["df"], site["solpos"], site["n_years"], site["poa"],
        site["tilt"], site["azimuth"], _ratio(), solve_parity=False,
    )
    offenders = [
        path for path, _ in _leaves(result)
        if _AREA_DENOMINATED.search(path.rsplit(".", 1)[-1])
        and not path.startswith("per_hectare.published_measurements")
    ]
    assert offenders == []
    assert "capacity_density" not in result
    derived = result["per_hectare"]["model_derived"]
    assert set(derived) >= {"energy_per_hectare_ratio", "change_pct",
                            "gcr_fixed", "gcr_tracker"}
    assert not any(_AREA_DENOMINATED.search(k) for k in derived)


def test_per_hectare_leads_with_the_published_measurements():
    """
    Both cited papers measure the per-hectare question directly on built plants
    and they disagree on its sign, which the model-derived figure cannot settle
    because that figure moves with the ground coverage pair. The measurements
    are therefore reported first, with their sources, and are not averaged.
    """
    site = _synthetic_site()
    result = energy.tracking_comparison(
        site["df"], site["solpos"], site["n_years"], site["poa"],
        site["tilt"], site["azimuth"], _ratio(), solve_parity=False,
    )
    block = result["per_hectare"]
    assert list(block)[:2] == ["published_measurements", "model_derived"]
    published = block["published_measurements"]
    assert published["bolinger_2022"]["change_pct"] == -11.9
    assert "Bolinger" in published["bolinger_2022"]["source"]
    table5 = published["ong_2013_table5"]
    low, high = table5["band_pct"]
    assert low <= high
    published_rows = [r["land_use_change_pct"] for r in energy.ONG_TABLE5]
    assert low in published_rows and high in published_rows
    assert len(table5["nearest_rows"]) == 3
    assert "disagree" in published["disagreement"]
    assert block["inverts"] is True
    assert result["per_kwp"]["inverts"] is False


def test_performance_ratio_transfer_is_measured_across_wind_assumptions():
    """
    The applied ratio was calibrated on a fixed-tilt benchmark and is reused for
    the tracker. How far it transfers depends on the wind field: where the wind
    is near zero the cell temperature saturates and the tracker's higher
    irradiance barely moves it, so a single-site difference understates the
    spread. The range across the assumption is reported instead.
    """
    site = _synthetic_site()
    result = energy.tracking_comparison(
        site["df"], site["solpos"], site["n_years"], site["poa"],
        site["tilt"], site["azimuth"], _ratio(), solve_parity=False,
    )
    transfer = result["performance_ratio"]["transfer_between_configurations"]
    assert len(transfer) == 3
    assert [row["wind"] for row in transfer][1:] == [
        "fixed 1 m/s", "fixed 2 m/s"
    ]
    low, high = result["performance_ratio"]["transfer_range_pct"]
    deltas = [row["difference_pct"] for row in transfer]
    assert low == min(deltas) and high == max(deltas)
    assert abs(high) < 1.0, "the transfer stays inside one percent"
    assert "motor consumption" in result["performance_ratio"]["note"]


def test_seasonal_gain_is_reported_beside_the_annual_one():
    """
    The annual gain of a tracker is a summer gain. A user sizing for a
    winter-limited load who reads only the annual figure reads a season in which
    the comparison is close to neutral.
    """
    site = _synthetic_site()
    result = energy.tracking_comparison(
        site["df"], site["solpos"], site["n_years"], site["poa"],
        site["tilt"], site["azimuth"], _ratio(), solve_parity=False,
    )
    rows = {r["season"]: r for r in result["seasonal"]["rows"]}
    assert set(rows) == set(solar.SEASONS)
    assert rows["summer"]["gain_pct"] > rows["annual"]["gain_pct"]
    assert rows["winter"]["gain_pct"] < rows["annual"]["gain_pct"]


# Generation profile


def test_generation_profile_states_the_time_standard_it_is_drawn_on():
    """
    POWER labels an hour-averaged flux by the hour it begins, on UTC. A profile
    presented without that stated puts the midday peak in the wrong hour for any
    reader who assumes local time.
    """
    site = _synthetic_site()
    profile = energy.generation_profile(site["frame"], site["n_years"])
    assert profile["time_standard"]["source_standard"] == "UTC"
    assert profile["time_standard"]["utc_offset_hours"] is None
    assert "start of the averaging interval" in profile["time_standard"]["note"]

    shifted = energy.generation_profile(site["frame"], site["n_years"], -3.0)
    assert shifted["time_standard"]["utc_offset_hours"] == -3.0
    assert "local time" in shifted["time_standard"]["note"]

    def peak_hour(payload):
        rows = payload["share_of_annual_generation_by_hour"]["rows"]
        return max(rows, key=lambda r: r["share_pct"])["hour"]

    assert (peak_hour(profile) - 3) % 24 == peak_hour(shifted)


def test_hourly_shares_account_for_the_whole_year():
    site = _synthetic_site()
    profile = energy.generation_profile(site["frame"], site["n_years"])
    rows = profile["share_of_annual_generation_by_hour"]["rows"]
    assert [r["hour"] for r in rows] == list(range(24))
    assert abs(sum(r["share_pct"] for r in rows) - 100.0) < 0.01


def test_peak_sun_hours_are_stated_on_the_module_plane():
    """
    Peak sun hours computed from horizontal irradiation would not match the
    yield, which is computed on the tilted plane. The units field says which
    plane, and the value is the monthly plane-of-array total over its days.
    """
    site = _synthetic_site()
    profile = energy.generation_profile(site["frame"], site["n_years"])
    assert "module plane" in profile["monthly"]["units"]["peak_sun_hours_day"]
    rows = profile["monthly"]["rows"]
    assert [r["month"] for r in rows] == list(range(1, 13))
    january = rows[0]
    days = 31.0
    assert abs(
        january["peak_sun_hours_day"] - january["poa_kwh_m2_month"] / days
    ) < 0.01
    poa_year = sum(r["poa_kwh_m2_month"] for r in rows)
    expected = _ratio()["factors"]["energy_poa_kwh_m2_year"]
    assert abs(poa_year - expected) < 0.2


# Capacity density


def test_the_total_site_basis_is_the_direct_array_basis_derated():
    """
    A siting raster classifies whole terrain, including what becomes roads,
    spacing and substation, so its hectares are a total-site quantity. Applying
    the direct-array density to them treats the entire polygon as array
    footprint and overstates the capacity by 1/0.75.
    """
    direct = energy.resolve_capacity_density("bolinger_fixed_direct")
    total = energy.resolve_capacity_density("bolinger_fixed_total_site")
    assert direct["area_basis"] == "direct_array"
    assert total["area_basis"] == "total_site"
    assert abs(
        total["value_mw_dc_per_ha"] - direct["value_mw_dc_per_ha"] * 0.75
    ) < 1e-12
    assert abs(total["value_mw_dc_per_ha"] - 0.648652) < 5e-7
    assert total["buildable_fraction"] == 0.75
    assert direct["buildable_fraction"] is None
    assert energy.DEFAULT_CAPACITY_DENSITY_BASIS == "bolinger_fixed_total_site"


def test_the_fleet_dc_ac_ratio_is_not_the_inverter_oversize_constant():
    """
    Converting a published MW_AC density to MW_DC needs a fleet ratio. The
    inverter oversizing constant in solar.py is a model-internal sizing
    multiplier for one reference array and is an unrelated quantity; reusing it
    here would move every capacity built on an alternating-current source.
    """
    density = energy.resolve_capacity_density("nrel_large_fixed_total")
    assert density["units"] == "ac"
    assert density["ac_to_dc_conversion_applied"] is True
    assert energy.FLEET_DC_AC_RATIO != solar.INVERTER_OVERSIZE_RATIO
    assert abs(energy.FLEET_DC_AC_RATIO - 35482.0 / 27001.0) < 1e-12
    assert "not the model-internal inverter" in density["fleet_dc_ac_ratio_source"]
    dc_denominated = energy.resolve_capacity_density("bolinger_fixed_direct")
    assert dc_denominated["ac_to_dc_conversion_applied"] is False


def test_an_unknown_capacity_density_basis_is_refused():
    with pytest.raises(ValueError, match="capacity density basis"):
        energy.resolve_capacity_density("bolinger_fixed")


# Exceedance


def test_p90_is_below_p50_under_the_exceedance_convention():
    """
    P90 is the value exceeded in 90 percent of years. The resource card reports
    statistical percentiles, in which the 90th is the high value, so both
    conventions appear on one screen and the direction has to be pinned here.
    """
    table = energy.exceedance_table(_annual_totals())
    rows = {r["level"]: r for r in table["levels"]}
    assert table["convention"] == "exceedance"
    assert (
        rows[90]["ghi_empirical_kwh_m2_year"]
        < rows[75]["ghi_empirical_kwh_m2_year"]
        < rows[50]["ghi_empirical_kwh_m2_year"]
    )
    assert rows[90]["factor_empirical"] < 1.0
    assert "below P50" in table["convention_note"]


def test_the_applied_estimator_is_empirical_and_the_normal_fit_sits_beside_it():
    """
    The stored resource percentiles are empirical. Applying a normal fit here
    would put two different estimates of the same quantity on one screen. The
    fit is reported next to the applied column, with a test of the normality it
    assumes rather than an assertion of it.
    """
    values = _annual_totals()
    table = energy.exceedance_table(values)
    assert table["method_applied"] == "empirical"
    rows = {r["level"]: r for r in table["levels"]}
    for level in (50, 75, 90):
        assert abs(
            rows[level]["ghi_empirical_kwh_m2_year"]
            - float(np.percentile(values.to_numpy(), 100 - level))
        ) < 0.01
    assert rows[90]["ghi_normal_kwh_m2_year"] != rows[90][
        "ghi_empirical_kwh_m2_year"
    ]
    assert rows[90]["normal_fit_standard_error_kwh_m2"] > 0.0
    assert table["normality"]["test"] == "Shapiro-Wilk"
    assert table["normality"]["p_value"] is not None
    assert table["n_years"] == len(values)


def test_the_p50_factor_is_reported_as_measured_rather_than_forced_to_unity():
    """
    The empirical P50 is the median and the specific yield is built on the mean
    year, so the factor is not exactly one. Rounding it to one would hide a real
    property of the record; it is stated instead.
    """
    table = energy.exceedance_table(_annual_totals())
    p50 = [r for r in table["levels"] if r["level"] == 50][0]
    assert p50["factor_empirical"] != 1.0
    assert "median" in table["p50_note"]


def test_the_crosswalk_shows_the_two_conventions_are_one_number():
    table = energy.exceedance_table(_annual_totals())
    cross = table["crosswalk"]
    assert cross["exceedance_p90_kwh_m2_year"] == cross[
        "statistical_p10_kwh_m2_year"
    ]
    assert cross["exceedance_p10_kwh_m2_year"] == cross[
        "statistical_p90_kwh_m2_year"
    ]


def test_an_empty_annual_record_is_refused():
    with pytest.raises(ValueError, match="no complete year"):
        energy.exceedance_table(pd.Series([np.nan, np.nan]))


# Plant energy over the suitable area


def _siting_stats(area4=121.4, area3=550.0, area2=28.4):
    """Class areas in the shape solar.suitability_stats produces.

    Classes 3 and 4 are both suitable ground and differ only in the land-use
    conflict, which is exactly the pair a total would silently merge.
    """
    return [
        {"code": 4, "name": "Suitable", "area_ha": area4},
        {"code": 3, "name": "Suitable, cropland", "area_ha": area3},
        {"code": 2, "name": "Restrictive", "area_ha": area2},
    ]


def test_cropland_conflict_is_never_summed_into_the_suitable_area():
    """
    Class 3 is not additional capacity: it is the same suitable ground counted
    against annual food production. A total of the two classes reads as a larger
    plant and erases the trade-off that is the result. Asserted on areas that
    would sum silently, by checking that neither the summed capacity nor the
    summed energy appears anywhere in the payload.
    """
    ratio = _ratio()
    poa = ratio["factors"]["energy_poa_kwh_m2_year"]
    stats = _siting_stats()
    result = energy.plant_energy(stats, _annual_totals(), poa, ratio)

    density = result["capacity_density"]["value_mw_dc_per_ha"]
    assert abs(result["suitable"]["capacity_dc_mw"] - 121.4 * density) < 0.01
    assert abs(
        result["cropland_conflict"]["capacity_dc_mw"] - 550.0 * density
    ) < 0.01

    summed_capacity = (121.4 + 550.0) * density
    summed_energy = (
        summed_capacity
        * result["suitable"]["specific_yield_kwh_kwp_year"]
        / 1000.0
    )
    for path, value in _leaves(result):
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            assert abs(value - summed_capacity) > 0.01, path
            assert abs(value - summed_energy) > 0.01, path
    assert "never summed" in result["cropland_conflict"]["note"]
    assert "never summed" in result["areas_note"]


def test_the_restrictive_class_is_reported_as_area_without_a_capacity():
    """
    Slopes near the limit would need racking the capacity density references do
    not cover, so converting their area at the same density would report a
    capacity that no cited source supports.
    """
    result = energy.plant_energy(
        _siting_stats(), _annual_totals(),
        _ratio()["factors"]["energy_poa_kwh_m2_year"], _ratio(),
    )
    assert result["restrictive"]["area_ha"] == 28.4
    assert result["restrictive"]["capacity_dc_mw"] is None
    assert "racking" in result["restrictive"]["note"]


def test_plant_energy_applies_the_empirical_exceedance_factors():
    ratio = _ratio()
    poa = ratio["factors"]["energy_poa_kwh_m2_year"]
    result = energy.plant_energy(_siting_stats(), _annual_totals(), poa, ratio)
    block = result["suitable"]
    factors = {
        r["level"]: r["factor_empirical"] for r in result["exceedance"]["levels"]
    }
    for level, factor in factors.items():
        expected = (
            block["capacity_dc_mw"]
            * block["specific_yield_kwh_kwp_year"]
            * factor
            / 1000.0
        )
        assert abs(block["energy"][f"p{level}_exceedance_gwh_year"] - expected) < 0.01
    assert (
        block["energy"]["p90_exceedance_gwh_year"]
        < block["energy"]["p50_exceedance_gwh_year"]
    )


def test_the_band_states_what_it_does_not_contain():
    """
    A band labelled P90 is read as a bankable one. This one propagates measured
    interannual variability of the resource and nothing else, and the density
    basis moves the answer further than the whole band does.
    """
    result = energy.plant_energy(
        _siting_stats(), _annual_totals(),
        _ratio()["factors"]["energy_poa_kwh_m2_year"], _ratio(),
    )
    excluded = result["uncertainty"]["excluded"]
    assert "performance ratio uncertainty" in excluded
    assert "degradation over plant life" in excluded
    assert "the capacity density basis" in excluded
    assert "project finance" in result["uncertainty"]["statement"]


def test_shading_is_reported_as_not_applied_when_it_was_not_computed():
    """
    A derate of 1.0 is indistinguishable from an unshaded site unless the
    payload says which of the two it is.
    """
    result = energy.plant_energy(
        _siting_stats(), _annual_totals(),
        _ratio()["factors"]["energy_poa_kwh_m2_year"], _ratio(),
    )
    assert result["shading"]["derate"] == 1.0
    assert result["shading"]["applied"] is False


def test_the_shading_derate_is_scaled_from_the_beam_basis_to_the_yield():
    """
    solar.shading_loss_fraction returns the share of BEAM energy the horizon
    removes and the terrain product publishes it unscaled. A plane-of-array
    total is beam plus diffuse, so applying that fraction straight onto the
    alternating-current yield overstates the loss by the diffuse share. The
    payload already claimed the scaling; nothing performed it.
    """
    ratio = _ratio()
    poa = ratio["factors"]["energy_poa_kwh_m2_year"]
    unshaded = energy.plant_energy(_siting_stats(), _annual_totals(), poa, ratio)
    beam_share = 0.6425
    shaded = energy.plant_energy(
        _siting_stats(), _annual_totals(), poa, ratio,
        shading_derate=0.97, shading_applied=True, beam_share=beam_share,
    )
    block = shaded["shading"]
    assert block["beam_basis_derate"] == 0.97
    assert block["beam_share"] == beam_share
    assert block["derate"] == round(1.0 - 0.03 * beam_share, 5) == 0.98072
    assert block["applied"] is True

    base = unshaded["suitable"]["specific_yield_kwh_kwp_year"]
    # What the chain shipped: the beam-basis derate applied to the whole yield.
    unscaled = round(base * 0.97, 2)
    assert shaded["suitable"]["specific_yield_kwh_kwp_year"] > unscaled
    correction = shaded["suitable"]["specific_yield_kwh_kwp_year"] / unscaled - 1
    assert abs(correction - 0.011) < 5e-4

    for level in ("p50", "p75", "p90"):
        key = f"{level}_exceedance_gwh_year"
        assert shaded["suitable"]["energy"][key] > round(
            unshaded["suitable"]["energy"][key] * 0.97, 2
        )


def test_a_shading_derate_without_a_beam_share_is_refused_not_applied():
    """
    The derate is a fraction of beam irradiance and there is nothing to convert
    it with. Applying it unscaled would be the defect this fix removes, so the
    record reports it as not applied and says why.
    """
    ratio = _ratio()
    poa = ratio["factors"]["energy_poa_kwh_m2_year"]
    result = energy.plant_energy(
        _siting_stats(), _annual_totals(), poa, ratio,
        shading_derate=0.97, shading_applied=True,
    )
    assert result["shading"]["applied"] is False
    assert result["shading"]["derate"] == 1.0
    assert result["shading"]["beam_basis_derate"] == 0.97
    assert "wrong base" in result["shading"]["note"]
    assert result["suitable"]["specific_yield_kwh_kwp_year"] == round(
        energy.specific_yield(poa, ratio), 2
    )


def test_the_energy_density_cross_check_uses_the_published_area_basis():
    """
    The published energy density is measured on direct array area. Comparing it
    against a figure built on the total-site basis would compare two different
    quantities and read as a resource difference.
    """
    result = energy.plant_energy(
        _siting_stats(), _annual_totals(),
        _ratio()["factors"]["energy_poa_kwh_m2_year"], _ratio(),
    )
    check = result["energy_density_cross_check"]
    assert check["area_basis"] == "direct_array"
    direct = energy.resolve_capacity_density("bolinger_fixed_direct")
    expected = (
        direct["value_mw_dc_per_ha"]
        * result["suitable"]["specific_yield_kwh_kwp_year"]
    )
    assert abs(check["site_mwh_ha_year"] - expected) < 0.1
    assert abs(check["reference_mwh_ha_year"] - 447.0 / 0.40468564224) < 0.1


def test_contiguity_is_reported_with_the_capacity():
    """
    Capacity from a total area assumes the area is buildable as one block. An
    equal area scattered over many small patches does not host the plant the
    arithmetic implies.
    """
    suitability = np.full((10, 10), 1)
    suitability[0:4, 0:4] = 4
    suitability[8, 8] = 4
    result = energy.plant_energy(
        _siting_stats(), _annual_totals(),
        _ratio()["factors"]["energy_poa_kwh_m2_year"], _ratio(),
        suitability=suitability, pixel_area_ha=0.09,
    )
    contiguity = result["suitable"]["contiguity"]
    assert contiguity["n_patches"] == 2
    assert abs(contiguity["largest_ha"] - 16 * 0.09) < 1e-9
    assert contiguity["largest_ha"] < result["suitable"]["area_ha"]


def test_a_diagonal_chain_counts_as_one_block():
    """Eight-connectivity: pixels touching at a corner are one patch."""
    diagonal = np.zeros((5, 5), dtype=int)
    diagonal[0, 0] = diagonal[1, 1] = diagonal[2, 2] = 4
    assert energy.largest_contiguous_area_ha(diagonal, 1.0)["n_patches"] == 1
    assert energy.largest_contiguous_area_ha(diagonal, 1.0)["largest_ha"] == 3.0
    assert energy.largest_contiguous_area_ha(np.zeros((4, 4)), 1.0) == {
        "largest_ha": 0.0, "n_patches": 0, "connectivity": 8
    }


# Assumptions carried with the figures


def test_the_module_type_is_named_as_a_selection_not_a_source():
    """
    PVWatts publishes one temperature coefficient per module type and the
    project selected the least conservative crystalline one. Presenting that as
    a source would read as a measured property of this site.
    """
    assumption = energy.module_type_assumption()
    assert assumption["gamma_pdc_per_c"] == solar.GAMMA_PDC
    assert assumption["module_type"] == "premium"
    assert assumption["alternatives"]["standard"] == -0.0047
    assert assumption["alternatives"]["thin_film"] == -0.0020
    assert assumption["user_editable"] is True
    assert "selection, not a measurement" in assumption["source"]
    # Every alternative it offers appears in the source with its coefficient,
    # so the choice can be read without opening PVWatts.
    for name, gamma in energy.PVWATTS_MODULE_TYPES.items():
        assert f"{gamma:g}" in assumption["source"]
        assert name.replace("_", " ") in assumption["source"]


def test_the_module_type_is_editable_because_a_request_field_reaches_the_chain():
    """
    user_editable was emitted as true with no request field and no control
    anywhere, so the least conservative crystalline coefficient was fixed while
    being presented as a choice. The claim is only true if selecting a type
    changes the frame every product runs on.
    """
    assert energy.module_type_assumption()["request_field"] == (
        energy.MODULE_TYPE_REQUEST_FIELD
    )
    assert energy.resolve_module_type(None) == ("premium", solar.GAMMA_PDC)
    assert energy.resolve_module_type("STANDARD") == ("standard", -0.0047)
    with pytest.raises(ValueError):
        energy.resolve_module_type("perovskite")

    site = _synthetic_site()
    frame = site["frame"]
    for name, gamma in energy.PVWATTS_MODULE_TYPES.items():
        moved = energy.apply_module_type(frame, gamma)
        assumption = energy.module_type_assumption(gamma)
        assert assumption["module_type"] == name
        assert assumption["gamma_pdc_per_c"] == gamma
        # The coefficient-free stages are carried through untouched, so the two
        # paths cannot disagree about irradiance or cell temperature.
        for col in ("poa_global", "g_eff", "temp_cell"):
            assert moved[col].equals(frame[col])
        ratio = energy.resolve_performance_ratio(moved, site["n_years"])
        assert abs(ratio["factors"]["telescoping_residual"]) <= (
            energy.TELESCOPING_TOLERANCE
        )
        if gamma == solar.GAMMA_PDC:
            assert moved["p_ac"].equals(frame["p_ac"])
        else:
            assert not moved["p_ac"].equals(frame["p_ac"])

    # A cooler coefficient loses less to temperature, so the modelled ratio is
    # ordered by the coefficient rather than merely different from it.
    def modelled(gamma):
        return energy.resolve_performance_ratio(
            energy.apply_module_type(frame, gamma), site["n_years"]
        )["modelled"]

    assert modelled(-0.0047) < modelled(-0.0035) < modelled(-0.0020)


def test_the_tracking_comparison_runs_on_the_selected_module_type():
    """
    tracking_comparison built its own alternating-current series from
    solar.pv_yield, which reads the module default. A caller who selected
    another type would have read a waterfall on one coefficient beside two
    performance ratios on another, on the same screen, with nothing saying so.
    """
    site = _synthetic_site()
    common = (site["df"], site["solpos"], site["n_years"], site["poa"],
              site["tilt"], site["azimuth"], _ratio())
    default = energy.tracking_comparison(*common, solve_parity=False)
    standard = energy.tracking_comparison(
        *common, solve_parity=False, gamma_pdc=-0.0047
    )
    for key in ("fixed", "tracking"):
        a = default["per_kwp"][key]["performance_ratio_modelled"]
        b = standard["per_kwp"][key]["performance_ratio_modelled"]
        assert b < a
    # The plane-of-array totals are geometry and must not move with it.
    assert (default["per_kwp"]["tracking"]["poa_kwh_m2_year"]
            == standard["per_kwp"]["tracking"]["poa_kwh_m2_year"])


def test_the_ground_coverage_defaults_carry_the_derivation_that_produced_them():
    """
    GCR_TRACKER = 0.35 carried no source and no convention marking while the
    payload beside it named a paper implying 0.295 at the same efficiency. Both
    defaults now report what they approximate and by how much they miss it.
    """
    record = energy.gcr_defaults()
    assert record["gcr_fixed"] == energy.GCR_FIXED == 0.435
    assert record["gcr_tracker"] == energy.GCR_TRACKER == 0.295
    assert record["user_editable"] is True
    assert "Bolinger" in record["source"]
    assert energy.CONVENTION in record["source"]
    implied = record["implied"]
    assert implied["module_efficiency"] == energy.GCR_MODULE_EFFICIENCY == 0.20
    # Reproduced from the published capacity densities, not asserted.
    assert abs(
        implied["gcr_fixed"]
        - (energy.BOLINGER_MW_DC_ACRE_FIXED / energy.ACRE_HA) / 2.0
    ) < 1e-12
    assert abs(implied["gcr_tracker"] - 0.29652645776) < 5e-9
    assert abs(record["residual_pct"]["gcr_tracker"]) < 1.0
    assert abs(record["residual_pct"]["gcr_fixed"]) < 1.0


def test_module_efficiency_cancels_from_the_ground_coverage_ratio():
    """
    The note claimed the derived per-hectare change moves by about 0.7
    percentage points with module efficiency. The same efficiency divides both
    ratios, so it cancels and the change does not move at all.
    """
    a = energy.bolinger_implied_gcr(0.20)
    b = energy.bolinger_implied_gcr(0.17)
    assert b["gcr_fixed"] > a["gcr_fixed"]
    assert b["gcr_tracker"] > a["gcr_tracker"]
    assert abs(a["gcr_ratio"] - b["gcr_ratio"]) < 1e-12
    assert abs(
        a["gcr_ratio"]
        - energy.BOLINGER_MW_DC_ACRE_TRACKING / energy.BOLINGER_MW_DC_ACRE_FIXED
    ) < 1e-12
    with pytest.raises(ValueError):
        energy.bolinger_implied_gcr(0.0)

    note = energy._module_efficiency_note()
    assert f"{a['gcr_ratio']:.4f} at both" in note
    assert "does not move with it" in note
    assert "0.7 percentage points" not in note


def test_every_payload_crosses_the_sidecar_boundary_as_json():
    """
    The sidecar returns these payloads over stdout. A numpy scalar or a NaN
    survives every test above and fails only at the boundary, where the failure
    reads as a broken sidecar rather than as a serialisation defect.
    """
    site = _synthetic_site()
    ratio = _ratio()
    poa = ratio["factors"]["energy_poa_kwh_m2_year"]
    payloads = [
        ratio,
        _waterfall(ratio),
        energy.tracking_comparison(
            site["df"], site["solpos"], site["n_years"], site["poa"],
            site["tilt"], site["azimuth"], ratio, solve_parity=False,
        ),
        energy.generation_profile(site["frame"], site["n_years"]),
        energy.plant_energy(_siting_stats(), _annual_totals(), poa, ratio),
    ]
    for payload in payloads:
        json.dumps(payload, allow_nan=False)


# Reference site.
#
# The figures below are the stored run for Propriedade B, lon and lat rounded to
# the POWER grid cell, over the 10 year hourly window and the 30 year daily
# record. They pin the chain against a measurement rather than against synthetic
# irradiance, and they are skipped where that series is not on disk, since it is
# a research dataset outside this repository and no test may fetch it.

REFERENCE_DIR = Path(
    "/Users/rexionmars/estudos/UTFPr/geosense/mestrado/experiments/"
    "solar_resource/data"
)
REFERENCE_HOURLY = REFERENCE_DIR / "power_hourly_B_2016_2025.parquet"
REFERENCE_DAILY = REFERENCE_DIR / "power_daily_B_1996_2025.parquet"
# The centroid of areas/B.geojson, to full precision. Rounding it here is what
# put this fixture on a different POWER cell from the one the shipped run used:
# -53.5048 rounds to -53.5, the true -53.50504 rounds to -53.51, and the two
# cells give plane-of-array totals that differ in the fifth digit.
REFERENCE_LAT, REFERENCE_LON = -25.74386918888456, -53.5050376824829

# The cell the shipped actions resolve that centroid to. Both solar_resource
# and energy_model call solar.grid_key on the polygon centroid and hand the
# ROUNDED pair to solar.prepare_hourly, so the solar position, and with it the
# transposition, is evaluated at the cell rather than at the centroid. Evaluated
# at the centroid this fixture reports 1884.6204 against the 1884.6070 the
# shipped chain returns on the identical hourly series: the global horizontal
# sum is a column total and matches to the last digit under both, so the whole
# difference is the solar position. Routing the fixture through solar.grid_key
# is what stops the pinned figures and the shipped ones from being two
# different quantities under one label.
REFERENCE_CELL_LON, REFERENCE_CELL_LAT = solar.grid_key(
    REFERENCE_LON, REFERENCE_LAT
)

requires_reference_series = pytest.mark.skipif(
    not (REFERENCE_HOURLY.exists() and REFERENCE_DAILY.exists()),
    reason="the stored Propriedade B series is not on this machine",
)


@lru_cache(maxsize=None)
def _reference_site() -> dict:
    hourly = pd.read_parquet(REFERENCE_HOURLY)
    daily = pd.read_parquet(REFERENCE_DAILY)
    df, solpos = solar.prepare_hourly(
        hourly, REFERENCE_CELL_LAT, REFERENCE_CELL_LON, 0.0
    )
    n_years = float(len(set(df.index.year)))
    sweep = solar.sweep_tilt(df, solpos, 0.0, n_years)
    best = max(sweep, key=lambda r: r["poa_kwh_m2_year"])
    poa = solar.transpose(df, solpos, best["tilt_deg"], 0.0)
    frame = solar.pv_yield_frame(poa, df, solpos, best["tilt_deg"], 0.0)
    return {
        "df": df,
        "solpos": solpos,
        "poa": poa,
        "frame": frame,
        "n_years": n_years,
        "tilt": best["tilt_deg"],
        "annual_totals": solar.annual_totals(daily),
        "ratio": energy.resolve_performance_ratio(frame, n_years),
    }


@requires_reference_series
def test_the_reference_chain_is_evaluated_where_the_shipped_actions_evaluate_it():
    """
    solar_resource and energy_model both hand solar.prepare_hourly the cell
    solar.grid_key returns, not the polygon centroid. Evaluated at the centroid
    this fixture pins 1884.6204, which no shipped action produces; the cell the
    stored Propriedade B run resolved to gives 1884.6070, and that is the figure
    the run recorded.

    The whole difference is the solar position. Global horizontal is a column
    sum and is identical to the last digit under both, which is why the
    disagreement looked like a transposition defect and was not one.
    """
    site = _reference_site()
    assert (REFERENCE_CELL_LON, REFERENCE_CELL_LAT) == solar.grid_key(
        REFERENCE_LON, REFERENCE_LAT
    )
    hourly = pd.read_parquet(REFERENCE_HOURLY)
    centroid_df, centroid_solpos = solar.prepare_hourly(
        hourly, REFERENCE_LAT, REFERENCE_LON, 0.0
    )
    n_years = site["n_years"]

    def annual(df, solpos):
        poa = solar.transpose(df, solpos, site["tilt"], 0.0)
        return float(poa["poa_global"].sum()) / 1000.0 / n_years

    def ghi(df):
        return float(df["ghi"].sum()) / 1000.0 / n_years

    cell_poa = site["ratio"]["factors"]["energy_poa_kwh_m2_year"]
    centroid_poa = annual(centroid_df, centroid_solpos)
    assert ghi(site["df"]) == ghi(centroid_df)
    assert abs(centroid_poa - 1884.6204) < 5e-5
    assert abs(cell_poa - 1884.6070) < 5e-5
    assert 0 < abs(centroid_poa / cell_poa - 1.0) < 1e-5
    # The solar position is the only thing that moved.
    assert not site["solpos"]["apparent_zenith"].equals(
        centroid_solpos["apparent_zenith"]
    )


@requires_reference_series
def test_reference_site_reproduces_the_stored_factor_stack():
    site = _reference_site()
    f = site["ratio"]["factors"]
    assert site["tilt"] == 26.0
    assert abs(f["energy_poa_kwh_m2_year"] - 1884.6070) < 5e-5
    assert abs(f["f_iam"] - 0.986940) < 5e-7
    assert abs(f["f_temp"] - 0.907776) < 5e-7
    assert abs(f["f_inverter"] - 0.956416) < 5e-7
    assert abs(f["temp_cell_irradiance_weighted_c"] - 51.350) < 5e-4
    assert abs(f["performance_ratio_modelled"] - 0.856873) < 5e-7
    # The module's own tolerance, not exact zero: the residual is a difference
    # of floating point sums and lands at 1.1e-16 on this series. Pinning it to
    # exactly 0.0 would fail on a rounding change that modelled_factors itself
    # accepts, and modelled_factors raises above TELESCOPING_TOLERANCE anyway.
    assert abs(f["telescoping_residual"]) <= energy.TELESCOPING_TOLERANCE
    assert abs(site["ratio"]["derived"] - 0.7825084) < 5e-7


@requires_reference_series
def test_reference_site_reproduces_the_stored_yield_and_capacity_factor():
    """
    Both yields are shipped: the applied one on the benchmarked reference ratio,
    and the derived one on this chain plus its declared assumptions. The gap
    between them is the reason both are labelled.
    """
    site = _reference_site()
    ghi_hourly = float(site["df"]["ghi"].sum()) / 1000.0 / site["n_years"]
    horizontal = solar.transpose(site["df"], site["solpos"], 0.0, 0.0)
    waterfall = energy.loss_waterfall(
        site["frame"], ghi_hourly,
        float(horizontal["poa_global"].sum()) / 1000.0 / site["n_years"],
        site["n_years"], site["ratio"], hourly_window="2016-2025 hourly",
        ghi_climatology_kwh_m2_year=float(site["annual_totals"].mean()),
        climatology_window="1996-2025 daily",
    )
    assert abs(waterfall["base"]["ghi_hourly_kwh_m2_year"] - 1783.27) < 0.01
    assert abs(waterfall["base"]["ghi_climatology_kwh_m2_year"] - 1771.68) < 0.01
    delivered = waterfall["delivered"]
    assert abs(delivered["applied_kwh_kwp_year"] - 1507.69) < 0.01
    assert abs(delivered["applied_capacity_factor_pct"] - 17.2111) < 5e-4
    assert abs(delivered["derived_kwh_kwp_year"] - 1474.73) < 0.01
    assert abs(delivered["derived_capacity_factor_pct"] - 16.8348) < 5e-4
    assert abs(delivered["difference_pct"] - (-2.1864)) < 5e-4


@requires_reference_series
def test_reference_site_reproduces_the_stored_tracking_comparison():
    site = _reference_site()
    result = energy.tracking_comparison(
        site["df"], site["solpos"], site["n_years"], site["poa"],
        site["tilt"], 0.0, site["ratio"],
    )
    tracking = result["per_kwp"]["tracking"]
    assert tracking["gcr"] == energy.GCR_TRACKER == 0.295
    assert abs(tracking["poa_kwh_m2_year"] - 2248.646) < 5e-5
    assert abs(tracking["specific_yield_kwh_kwp_year"] - 1798.92) < 0.01
    assert abs(tracking["capacity_factor_pct"] - 20.536) < 5e-4
    assert abs(tracking["performance_ratio_modelled"] - 0.85827) < 5e-7
    assert abs(result["per_kwp"]["gain_pct"] - 19.316) < 5e-4
    assert result["performance_ratio"]["transfer_range_pct"] == [0.1631, 0.4742]
    seasons = {r["season"]: r["gain_pct"] for r in result["seasonal"]["rows"]}
    assert seasons == {
        "annual": 19.32, "winter": 0.5, "summer": 36.4, "winter_crop": 3.46
    }
    parity = result["per_hectare"]["model_derived"]["parity"]
    assert abs(parity["gcr_ratio"] - 0.849) < 5e-4
    assert result["per_hectare"]["model_derived"]["change_pct"] == -19.08


@requires_reference_series
def test_the_annual_seasonal_row_and_the_per_kwp_block_agree_on_the_year():
    """
    Both report the annual fixed-tilt plane-of-array total for one array in one
    payload. The seasonal block divided by solar.season_years, an 8766 hour
    year that returns 10.0014 for a ten calendar year record, so the same
    quantity appeared twice as 1884.3 and 1884.6. The calendar-year count wins,
    because it is what the per-kWp block and the shipped solar_resource action
    divide by.
    """
    site = _reference_site()
    result = energy.tracking_comparison(
        site["df"], site["solpos"], site["n_years"], site["poa"],
        site["tilt"], 0.0, site["ratio"], solve_parity=False,
    )
    annual = next(
        r for r in result["seasonal"]["rows"] if r["season"] == "annual"
    )
    per_kwp = result["per_kwp"]
    assert annual["years"] == site["n_years"] == 10.0
    assert annual["years_basis"] == "calendar years in the record"
    assert annual["fixed_poa_kwh_m2_season"] == round(
        per_kwp["fixed"]["poa_kwh_m2_year"], 1
    )
    assert annual["tracker_poa_kwh_m2_season"] == round(
        per_kwp["tracking"]["poa_kwh_m2_year"], 1
    )
    # The mean-year convention is still what a season is measured on, since a
    # season is not a calendar year, and each row says which one applied.
    winter = next(
        r for r in result["seasonal"]["rows"] if r["season"] == "winter"
    )
    assert winter["years"] != site["n_years"]
    assert winter["years_basis"].startswith("season occurrences")


@requires_reference_series
def test_the_tracker_ground_coverage_default_reproduces_its_cited_source():
    """
    The tracker default was 0.35, which reproduced from nothing, while the
    payload beside it named Bolinger and Bolinger (2022) at 20 percent module
    efficiency. On this site that unsourced value put the per-hectare headline
    at -4.88 percent against the -19.08 the cited derivation gives, a gap of
    14.2 percentage points on the figure the user reads.
    """
    site = _reference_site()
    implied = energy.bolinger_implied_gcr(0.20)
    assert abs(implied["gcr_tracker"] - 0.2965) < 5e-5
    assert abs(implied["gcr_fixed"] - 0.4324) < 5e-5
    assert abs(energy.GCR_TRACKER / implied["gcr_tracker"] - 1.0) < 0.006
    assert abs(energy.GCR_FIXED / implied["gcr_fixed"] - 1.0) < 0.006

    def change(gcr_tracker):
        return energy.tracking_comparison(
            site["df"], site["solpos"], site["n_years"], site["poa"],
            site["tilt"], 0.0, site["ratio"], solve_parity=False,
            gcr_tracker=gcr_tracker,
        )["per_hectare"]["model_derived"]["change_pct"]

    assert change(energy.GCR_TRACKER) == -19.08
    assert change(0.35) == -4.88


@requires_reference_series
def test_reference_site_reproduces_the_stored_plant_energy():
    site = _reference_site()
    poa = site["ratio"]["factors"]["energy_poa_kwh_m2_year"]
    result = energy.plant_energy(
        _siting_stats(area4=121.4, area3=550.9, area2=28.4),
        site["annual_totals"], poa, site["ratio"],
    )
    assert abs(result["suitable"]["capacity_dc_mw"] - 78.75) < 0.01
    assert abs(result["suitable"]["specific_yield_kwh_kwp_year"] - 1507.70) < 0.01
    assert result["suitable"]["energy"] == {
        "p50_exceedance_gwh_year": 118.75,
        "p75_exceedance_gwh_year": 116.17,
        "p90_exceedance_gwh_year": 113.56,
    }
    cropland = result["cropland_conflict"]
    assert abs(cropland["capacity_dc_mw"] - 357.34) < 0.01
    assert abs(cropland["energy"]["p50_exceedance_gwh_year"] - 538.87) < 0.01
    exceedance = result["exceedance"]
    assert exceedance["n_years"] == 30
    assert abs(exceedance["mean_kwh_m2_year"] - 1771.68) < 0.01
    assert abs(exceedance["cv_pct"] - 3.449) < 5e-4
    assert exceedance["normality"]["statistic"] == 0.98385
    assert exceedance["normality"]["p_value"] == 0.916
    assert abs(result["energy_density_cross_check"]["ratio"] - 1.181) < 5e-4


@requires_reference_series
def test_reference_site_lifetime_basis_moves_every_plant_figure():
    """
    The basis is not cosmetic: on the lifetime mean the same site reports a
    yield 5.8 percent lower. Both figures are correct under their stated basis,
    which is why the basis is echoed beside each of them.
    """
    site = _reference_site()
    poa = site["ratio"]["factors"]["energy_poa_kwh_m2_year"]
    lifetime = energy.resolve_performance_ratio(
        site["frame"], site["n_years"], reporting_basis="lifetime_mean"
    )
    result = energy.plant_energy(
        _siting_stats(area4=121.4, area3=550.9, area2=28.4),
        site["annual_totals"], poa, lifetime,
    )
    assert abs(
        result["suitable"]["specific_yield_kwh_kwp_year"] - 1420.61
    ) < 0.01
    assert abs(
        result["suitable"]["energy"]["p50_exceedance_gwh_year"] - 111.89
    ) < 0.01
    assert result["reporting_basis"] == "lifetime_mean"
