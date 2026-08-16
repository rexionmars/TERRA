"""Unit tests for the wind resource helpers (offline)."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
from scipy import stats

import wind


HOURLY_COLUMNS = ("WS2M", "WS10M", "WS50M", "WD10M", "WD50M", "T2M", "PS")


def _frame(v10, alpha=0.16, direction_10=45.0, direction_50=45.0,
           t2m=20.0, ps=95.0, start="2024-01-01"):
    """An hourly frame with the seven columns POWER returns.

    The two upper levels are built from one exponent so a test can state the
    exponent it expects to recover. WS2M follows the same profile downward,
    which is not what the reanalysis does but keeps the diagnostic level
    consistent with the rest of the frame unless a test overrides it.
    """
    v10 = np.asarray(v10, dtype=float)
    n = v10.size
    idx = pd.date_range(start, periods=n, freq="h", tz="UTC")
    return pd.DataFrame(
        {
            "WS2M": v10 * (2.0 / 10.0) ** alpha,
            "WS10M": v10,
            "WS50M": v10 * 5.0 ** alpha,
            "WD10M": np.full(n, float(direction_10)),
            "WD50M": np.full(n, float(direction_50)),
            "T2M": np.full(n, float(t2m)),
            "PS": np.full(n, float(ps)),
        },
        index=idx,
    )


def _year_of_speeds(k=2.2, c=5.0, seed=11, hours=8784):
    """A whole leap year of 10 m speeds from a fixed seed."""
    return stats.weibull_min.rvs(
        k, loc=0, scale=c, size=hours, random_state=np.random.default_rng(seed)
    )


# ------------------------------------------------------------------- parsing


def test_fill_value_becomes_nan():
    """
    POWER writes -999 for a missing hour. Energy is the mean of a cubed speed,
    so one fill value left in place moves the annual figure by far more than
    one hour of record.
    """
    payload = {
        "properties": {
            "parameter": {
                "WS50M": {
                    "2024010100": 4.2,
                    "2024010101": -999.0,
                    "2024010102": 4.8,
                }
            }
        }
    }
    df = wind.to_frame(payload)
    assert np.isnan(df["WS50M"].iloc[1])
    assert df["WS50M"].iloc[0] == 4.2
    assert str(df.index.tz) == "UTC"


def test_request_url_carries_the_hourly_parameters():
    url = wind.build_url(-53.54, -25.1, "20240101", "20241231")
    assert url.startswith("https://power.larc.nasa.gov/api/temporal/hourly/point?")
    assert "community=RE" in url
    assert "time-standard=UTC" in url
    assert "longitude=-53.54" in url and "latitude=-25.1" in url
    for name in wind.HOURLY_PARAMS:
        assert name in url


def test_url_requests_the_two_measured_heights_and_both_density_inputs():
    """
    The shear exponent needs both levels and the density needs both of PS and
    T2M. A parameter dropped from the request would surface as a KeyError deep
    in the chain rather than at the request.
    """
    assert set(wind.RESOURCE_PARAMS) == {"WS10M", "WS50M", "WD10M", "WD50M",
                                         "T2M", "PS"}
    assert wind.DIAGNOSTIC_PARAMS == ["WS2M"]
    assert len(wind.HOURLY_PARAMS) == 7


def test_grid_key_rounds_to_the_merra2_cell():
    """
    Two AOIs a few hundred metres apart fall in one MERRA-2 cell and must
    resolve to the same request, or the response would report a difference
    between sites where there is only one series.
    """
    a = wind.grid_key(-53.54, -25.10)
    b = wind.grid_key(-53.5244, -25.1263)
    c = wind.grid_key(-53.60, -25.05)
    assert a == b == c == (-53.75, -25.0)


def test_grid_key_separates_cells_that_are_genuinely_different():
    assert wind.grid_key(-53.20, -25.10) == (-53.125, -25.0)
    assert wind.grid_key(-53.5048, -25.7434) == (-53.75, -25.5)


def test_record_period_spans_whole_calendar_years():
    """A partial year biases the monthly climatology and the annual means."""
    assert wind.record_period(2024, 10) == ("20150101", "20241231")
    assert wind.record_period(2024, 1) == ("20240101", "20241231")


# --------------------------------------------------------------------- shear


def test_shear_exponent_recovers_a_known_alpha():
    df = _frame(np.full(240, 4.0), alpha=0.2)
    assert abs(wind.shear_exponent_bulk(df) - 0.2) < 1e-9


def test_shear_exponent_is_the_bulk_form_and_not_the_hourly_mean():
    """
    Averaging the per-hour exponent weights the stable, low-speed night hours
    equally with the windy ones and returns an exponent that does not
    reproduce the measured mean profile. On this two-regime frame the hourly
    mean is 0.300 against a bulk 0.175, and carrying it up to hub height would
    raise the speed with no physical warrant.
    """
    half = 500
    v10 = np.r_[np.full(half, 6.0), np.full(half, 1.0)]
    alpha_hourly = np.r_[np.full(half, 0.10), np.full(half, 0.50)]
    idx = pd.date_range("2024-01-01", periods=2 * half, freq="h", tz="UTC")
    df = pd.DataFrame(
        {"WS10M": v10, "WS50M": v10 * 5.0 ** alpha_hourly}, index=idx
    )

    bulk = wind.shear_exponent_bulk(df)
    hourly_mean = float(wind.hourly_shear_exponent(df).mean())
    assert abs(hourly_mean - 0.300) < 1e-9
    assert abs(bulk - 0.1754) < 1e-3

    mean_10, mean_50 = df["WS10M"].mean(), df["WS50M"].mean()
    assert abs(mean_10 * 5.0 ** bulk - mean_50) < 1e-9
    assert mean_10 * 5.0 ** hourly_mean > mean_50


def test_shear_exponent_is_nan_without_a_positive_lower_speed():
    """A zero mean at 10 m would divide by zero and reach the response."""
    df = _frame(np.zeros(24), alpha=0.2)
    assert np.isnan(wind.shear_exponent_bulk(df))


# ------------------------------------------------------------ roughness


def test_roughness_inversion_returns_the_roughness_it_came_from():
    """
    The inversion is what lets a reader judge the exponent against the land
    cover, so it has to be the exact inverse of the relation that produced it
    rather than an approximation fitted to it.
    """
    for z0 in (0.005, 0.03, 0.10, 0.40, 1.50):
        alpha = wind.alpha_from_roughness(z0)
        assert abs(wind.implied_roughness_length(alpha) - z0) < 1e-6


def test_roughness_inversion_reproduces_the_study_cell_exponent():
    """
    The exponent measured at the A/C cell inverts to 1.48 m, a roughness of
    forest rather than of cropland. That number is the evidence the
    extrapolation is unsupported, so it is pinned here.
    """
    assert abs(wind.implied_roughness_length(0.3797) - 1.480) < 5e-3
    assert abs(wind.implied_roughness_length(0.5210) - 2.935) < 5e-3


def test_roughness_band_maps_to_the_published_exponent_band():
    band = [wind.alpha_from_roughness(z) for z in (0.03, 0.05, 0.10, 0.40)]
    assert [round(a, 4) for a in band] == [0.1520, 0.1648, 0.1862, 0.2519]


def test_alpha_from_roughness_is_undefined_at_or_above_the_lower_height():
    """
    A roughness length at or above the lower measurement height has no
    logarithmic profile between the two levels. Returning a number there would
    put a meaningless exponent into the sensitivity table.
    """
    assert np.isnan(wind.alpha_from_roughness(0.0))
    assert np.isnan(wind.alpha_from_roughness(-0.1))
    assert np.isnan(wind.alpha_from_roughness(10.0))
    assert np.isnan(wind.alpha_from_roughness(25.0))


def test_shear_plausibility_reports_the_band_it_judged_against():
    """
    A bare consistency verdict would be an assertion the reader cannot check.
    The band and the inverted roughness travel with it.
    """
    inside = wind.shear_plausibility(0.17)
    assert inside["consistent_with_assumed_cover"] is True
    assert inside["assumed_roughness_band_m"] == [0.03, 0.10]
    assert inside["expected_shear_exponent_band"] == [0.1520, 0.1862]

    outside = wind.shear_plausibility(0.3797)
    assert outside["consistent_with_assumed_cover"] is False
    assert outside["implied_roughness_length_m"] > 0.10


def test_shear_plausibility_survives_an_undefined_exponent():
    """A NaN must reach the response as null, not as a NaN JSON cannot hold."""
    out = wind.shear_plausibility(float("nan"))
    assert out["shear_exponent"] is None
    assert out["implied_roughness_length_m"] is None
    assert out["consistent_with_assumed_cover"] is False


# ------------------------------------------------------------- extrapolation


def test_extrapolated_speed_follows_the_power_law_from_the_upper_level():
    v50 = pd.Series([4.0, 8.0])
    out = wind.extrapolate_speed(v50, 110.0, 0.2)
    expected = v50 * (110.0 / 50.0) ** 0.2
    assert np.allclose(out.to_numpy(), expected.to_numpy())


def test_hub_above_the_measured_ceiling_is_marked_as_extrapolation():
    """
    50 m is the highest level the hourly product carries. Above it nothing in
    the data constrains the profile, and the response must say so rather than
    presenting the hub speed at the same standing as the measured one.
    """
    status = wind.extrapolation_status(110.0, 0.3797)
    assert status["is_extrapolation"] is True
    assert status["interpolation_ceiling_m"] == 50.0
    assert status["height_ratio"] == 2.2
    assert "extrapolation" in status["statement"]
    assert "0.380" in status["statement"]
    assert "met mast" in status["statement"] or "mesoscale" in status["statement"]


def test_hub_at_or_below_the_ceiling_is_not_an_extrapolation():
    for height in (50.0, 30.0):
        status = wind.extrapolation_status(height, 0.3797)
        assert status["is_extrapolation"] is False
        assert "interpolated" in status["statement"]


def test_extrapolation_asserts_a_direction_of_error_only_above_the_band():
    """
    The specification's text says the hub speed is likely to be overstated.
    That is only true when the exponent sits above the band the assumed cover
    supports; inside the band the extrapolation is still unconstrained but the
    sign is unknown, and asserting one would be a fabricated claim.
    """
    above = wind.extrapolation_status(110.0, 0.3797)["statement"]
    inside = wind.extrapolation_status(110.0, 0.17)["statement"]
    assert "overstated" in above
    assert "overstated" not in inside


# ------------------------------------------------------------------- Weibull


def test_weibull_fit_recovers_known_k_and_c():
    """
    Maximum likelihood with the location pinned to zero. A free location would
    absorb part of the scale and return a k that no longer describes the
    distribution the speeds were drawn from.
    """
    sample = stats.weibull_min.rvs(
        2.5, loc=0, scale=6.0, size=8784, random_state=np.random.default_rng(7)
    )
    k, c = wind.weibull_fit(pd.Series(sample))
    assert abs(k - 2.5) < 0.02
    assert abs(c - 6.0) < 0.02


def test_weibull_fit_is_undefined_for_too_few_speeds():
    k, c = wind.weibull_fit(pd.Series([4.0]))
    assert np.isnan(k) and np.isnan(c)


def test_weibull_scale_moves_with_height_and_k_does_not():
    """
    A power-law height change multiplies every speed by one factor, so it
    scales c and leaves k alone. Refitting at hub height would be fitting to
    an extrapolation.
    """
    c_hub = wind.weibull_scale_at_height(4.3516, 110.0, 0.3797)
    assert abs(c_hub - 4.3516 * (110.0 / 50.0) ** 0.3797) < 1e-9
    assert abs(c_hub - 5.8705) < 1e-3


def test_weibull_moment_check_names_its_estimator_and_the_third_moment():
    """
    Maximum likelihood, method of moments and the Justus form disagree in k on
    this project's series, so a k and c shown without the estimator are not
    reproducible. The third moment is reported because that is the one energy
    depends on.
    """
    sample = pd.Series(_year_of_speeds(k=2.5, c=6.0, seed=7))
    k, c = wind.weibull_fit(sample)
    check = wind.weibull_moment_check(k, c, sample)
    assert "maximum likelihood" in check["estimator"]
    assert "floc=0" in check["estimator"]
    assert abs(check["mean_error_pct"]) < 1.0
    assert abs(check["mean_cube_error_pct"]) < 2.0


def test_energy_pattern_factor_is_one_for_a_constant_speed():
    """
    mean(v^3)/mean(v)^3 is 1 when nothing varies and rises with the tail. It
    is the statement of why a mean speed alone does not fix the energy.
    """
    assert abs(wind.energy_pattern_factor(pd.Series([5.0] * 10)) - 1.0) < 1e-12
    varied = wind.energy_pattern_factor(pd.Series(_year_of_speeds()))
    assert varied > 1.0


# --------------------------------------------------------------- power curve


def test_power_curve_is_the_published_table():
    """
    The curve is vendored, so nothing at runtime would notice if a point were
    edited. These are the figures the citation and the verification report.
    """
    assert len(wind.POWER_CURVE_MS_W) == 50
    assert wind.CURVE_SPEED_MS[0] == 3.0
    assert wind.CURVE_SPEED_MS[-1] == 25.0
    assert abs(wind.CURVE_POWER_W.max() - 3370104.925) < 1e-3
    spec = wind.turbine_specification()
    assert spec["curve_source_commit"] == "d0e12b296d025a1c8aa99d5ba7630654837cc59e"
    assert "NREL/TP-5000-73492" in spec["citation"]
    assert spec["power_curve_column"] == "rotor electrical power"


def test_rated_speed_is_read_from_the_curve_not_asserted():
    """
    Rated speed is not a field of the turbine definition. It is the first
    tabulated speed reaching rated power, so it stays consistent with whatever
    the vendored points say.
    """
    assert abs(wind.RATED_SPEED_MS - 9.812675) < 1e-6
    assert wind.TURBINE_RATED_POWER_W == 3.37e6


def test_power_curve_is_monotonic_below_rated():
    """
    A transcription error in the vendored table would most likely show as a
    non-monotonic segment, and it would move the capacity factor without
    moving anything a reader can see.
    """
    below = wind.CURVE_SPEED_MS < wind.RATED_SPEED_MS
    assert np.all(np.diff(wind.CURVE_POWER_W[below]) > 0)

    sampled = wind.turbine_power(
        pd.Series(np.linspace(wind.TURBINE_CUT_IN_MS, wind.RATED_SPEED_MS, 200))
    )
    assert np.all(np.diff(sampled.to_numpy()) > 0)


def test_turbine_power_is_zero_outside_the_operating_range():
    """
    numpy.interp holds the end values beyond the table, so without the
    explicit zeroing a 30 m/s hour would be credited with rated power instead
    of a shutdown.
    """
    v = pd.Series([2.9, 3.0, 25.0, 25.1, 40.0])
    p = wind.turbine_power(v)
    assert p.iloc[0] == 0.0
    assert abs(p.iloc[1] - 51620.327) < 1e-3
    assert abs(p.iloc[2] - 3370104.925) < 1e-3
    assert p.iloc[3] == 0.0
    assert p.iloc[4] == 0.0


def test_turbine_power_keeps_a_missing_hour_missing():
    """A gap must read as an unknown hour, not as a stopped turbine."""
    p = wind.turbine_power(pd.Series([np.nan, 10.0]))
    assert np.isnan(p.iloc[0])
    assert p.iloc[1] > 0.0


def test_capacity_factor_and_annual_energy_at_a_known_power():
    assert abs(wind.capacity_factor(pd.Series([3.37e6] * 3)) - 100.0) < 1e-9
    assert abs(wind.annual_energy_mwh(pd.Series([1e6, 1e6])) - 8766.0) < 1e-9


def test_operating_regime_reports_the_thresholds_it_counted_against():
    v = pd.Series([1.0, 4.0, 10.0, 30.0])
    out = wind.operating_regime_fractions(v)
    assert out["above_cut_in_pct"] == 75.0
    assert out["at_or_above_rated_pct"] == 50.0
    assert out["above_cut_out_pct"] == 25.0
    assert out["cut_in_ms"] == 3.0
    assert out["cut_out_ms"] == 25.0
    assert abs(out["rated_ms"] - 9.8127) < 1e-4


# ---------------------------------------------------------------- air density


def test_air_density_falls_with_temperature_and_rises_with_pressure():
    """
    The direction of the density correction sets the direction of the energy
    correction. An inverted sign here would raise the capacity factor at a
    high, warm site instead of lowering it.
    """
    warm = wind.air_density(_frame(np.full(24, 4.0), t2m=35.0, ps=95.0))
    cool = wind.air_density(_frame(np.full(24, 4.0), t2m=5.0, ps=95.0))
    assert float(warm.mean()) < float(cool.mean())

    high = wind.air_density(_frame(np.full(24, 4.0), t2m=20.0, ps=101.3))
    low = wind.air_density(_frame(np.full(24, 4.0), t2m=20.0, ps=90.0))
    assert float(high.mean()) > float(low.mean())


def test_air_density_is_the_dry_air_relation_in_the_published_units():
    """PS arrives in kPa and T2M in degrees Celsius, not in Pa and kelvin."""
    df = _frame(np.full(4, 4.0), t2m=20.0, ps=95.0)
    expected = 95.0 * 1000.0 / (wind.R_DRY * (20.0 + 273.15))
    assert abs(float(wind.air_density(df).iloc[0]) - expected) < 1e-9
    assert 1.0 < expected < 1.3


def test_equivalent_speed_reduces_the_speed_below_reference_density():
    """
    The curve is referenced to 1.225 kg/m3. At the elevations this project
    works at the site density is lower, so the normalisation must reduce the
    speed and therefore the energy.
    """
    v = pd.Series([8.0, 8.0])
    thin = pd.Series([1.13, 1.13])
    assert float(wind.equivalent_speed(v, thin).iloc[0]) < 8.0

    at_reference = pd.Series([wind.RHO_REFERENCE] * 2)
    assert abs(float(wind.equivalent_speed(v, at_reference).iloc[0]) - 8.0) < 1e-12

    dense = pd.Series([1.30, 1.30])
    assert float(wind.equivalent_speed(v, dense).iloc[0]) > 8.0


def test_density_normalisation_applies_the_cube_root_to_the_speed():
    """
    The exponent follows from the cubic dependence of the power flux on speed.
    Its attribution to a clause of IEC 61400-12-1 was never checked against the
    standard, which is why no clause is cited for it anywhere.
    """
    assert abs(wind.DENSITY_EXPONENT - 1.0 / 3.0) < 1e-12


def test_wind_power_density_averages_the_product_not_the_means():
    """
    Averaging rho and v separately and multiplying would drop the covariance
    between them, which is the part that distinguishes a cold windy hour from
    a warm calm one.
    """
    v = pd.Series([10.0, 10.0])
    rho = pd.Series([1.225, 1.225])
    assert abs(wind.wind_power_density(v, rho) - 612.5) < 1e-9

    varying_v = pd.Series([5.0, 15.0])
    varying_rho = pd.Series([1.0, 1.4])
    exact = float((0.5 * varying_rho * varying_v ** 3).mean())
    assert abs(wind.wind_power_density(varying_v, varying_rho) - exact) < 1e-9
    assert exact != 0.5 * 1.2 * 10.0 ** 3


# ----------------------------------------------------------- data quality


def test_calm_near_surface_field_is_flagged():
    """
    This is the field the project's research report used to discard the wind
    estimate at one site: 97 percent of hours below 0.5 m/s at 2 m with a
    ten-year maximum near 1 m/s. The judgement was made by reading numbers;
    the flag has to fire on its own.
    """
    idx = pd.date_range("2024-01-01", "2024-12-31 23:00", freq="h", tz="UTC")
    n = len(idx)
    position = np.arange(n) % 100
    calm = position < 97
    v10 = np.where(calm, 0.9, 3.5)
    df = pd.DataFrame(
        {
            "WS2M": np.where(calm, 0.2, 1.0),
            "WS10M": v10,
            "WS50M": v10 * 5.0 ** 0.52,
            "WD10M": np.full(n, 45.0),
            "WD50M": np.full(n, 45.0),
            "T2M": np.full(n, 20.0),
            "PS": np.full(n, 95.0),
        },
        index=idx,
    )

    quality = wind.data_quality(df, -53.54, wind.shear_exponent_bulk(df))
    assert abs(quality["calm_fraction_pct"]["2m"] - 97.0) < 0.1
    assert quality["all_checks_passed"] is False

    text = " ".join(quality["flags"])
    assert "97.0" in text
    assert "sidecar/solar.py" in text, (
        "the 2 m field is what the module temperature model is fed, so the "
        "flag must say the modelled performance ratio carries the same defect"
    )
    assert quality["record_maximum_plausible"] is False
    assert "convention with no published basis" in text


def test_a_complete_and_plausible_record_raises_no_flag():
    """
    Guards the other direction: a diagnostic that always fires carries no
    information. This frame has an exponent inside the assumed band, a 10 m
    maximum above the floor, a low 2 m calm fraction and no gaps.
    """
    df = _frame(_year_of_speeds(), alpha=0.16)
    quality = wind.data_quality(df, -53.54, wind.shear_exponent_bulk(df))
    assert quality["flags"] == []
    assert quality["all_checks_passed"] is True
    assert quality["record_hours"] == quality["expected_hours"] == 8784
    assert quality["record_maximum_plausible"] is True


def test_missing_years_are_counted_as_absent():
    """
    Hours expected are counted over the years the record spans, not over the
    years present, so a year missing from the middle is not defined away.
    """
    present = pd.date_range("2016-01-01", "2016-12-31 23:00", freq="h", tz="UTC")
    present = present.append(
        pd.date_range("2018-01-01", "2018-12-31 23:00", freq="h", tz="UTC")
    )
    n = len(present)
    df = pd.DataFrame(
        {c: np.full(n, 3.0 if c.startswith("WS") else 20.0) for c in HOURLY_COLUMNS},
        index=present,
    )
    df["WS10M"] = 12.0
    df["WS50M"] = 12.0 * 5.0 ** 0.16
    df["PS"] = 95.0

    quality = wind.data_quality(df, -53.54, 0.16)
    assert quality["record_hours"] == 17544
    assert quality["expected_hours"] == 26304
    assert any("26304 expected" in f for f in quality["flags"])


def test_fill_values_are_reported_even_though_none_are_expected():
    """
    The mean of a cubed quantity is not robust to gaps, so a non-zero count
    has to reach the reader rather than being counted and discarded.
    """
    df = _frame(_year_of_speeds(), alpha=0.16)
    df.iloc[:5, :] = np.nan
    quality = wind.data_quality(df, -53.54, 0.16)
    assert quality["nan_count"]["WS50M"] == 5
    assert any("Fill values replaced by NaN" in f for f in quality["flags"])


def test_calm_fraction_counts_below_the_stated_threshold():
    speeds = pd.Series([0.1, 0.4, 0.5, 2.0])
    assert wind.calm_fraction(speeds, 0.5) == 50.0


def test_utc_offset_is_derived_from_longitude():
    """
    Fixed rather than derived, the day and night windows would be wrong for
    any AOI outside western Parana. The offset is the nominal solar one, which
    is what a boundary-layer diurnal cycle follows, not the civil time zone.
    """
    assert wind.utc_offset_hours(-53.54) == -4
    assert wind.utc_offset_hours(0.0) == 0
    assert wind.utc_offset_hours(135.0) == 9


def test_day_and_night_shear_are_separated():
    """
    A single bulk exponent mixes two regimes. The split is what tells a reader
    how much of the shear is nocturnal decoupling rather than roughness.
    """
    idx = pd.date_range("2024-01-01", periods=24 * 30, freq="h", tz="UTC")
    local_hour = (idx.hour - 4) % 24
    night = (local_hour >= 21) | (local_hour <= 3)
    alpha_hourly = np.where(night, 0.50, 0.12)
    df = pd.DataFrame(
        {"WS10M": np.full(len(idx), 3.0),
         "WS50M": 3.0 * 5.0 ** alpha_hourly},
        index=idx,
    )
    day_alpha, night_alpha = wind.day_night_shear(df, -53.54)
    assert abs(day_alpha - 0.12) < 1e-9
    assert abs(night_alpha - 0.50) < 1e-9


# ------------------------------------------------------------------ direction


def test_direction_energy_rose_sums_to_one_hundred_and_centres_on_north():
    """
    Sectors are centred on the cardinal directions, so the first one spans the
    wrap at 360. A rose built on sector edges instead would split a northerly
    resource across two sectors and understate it.
    """
    df = _frame(np.full(96, 6.0), direction_50=1.0)
    rows = wind.direction_energy_rose(df)
    assert len(rows) == 16
    assert rows[0]["centre_deg"] == 0.0
    assert rows[0]["energy_pct"] == 100.0
    assert abs(sum(r["energy_pct"] for r in rows) - 100.0) < 0.01

    wrapped = wind.direction_energy_rose(_frame(np.full(96, 6.0), direction_50=359.0))
    assert wrapped[0]["energy_pct"] == 100.0


def test_direction_convention_states_that_it_was_inferred():
    """
    The API publishes only the unit. Reporting a direction of origin without
    saying the convention was inferred would present an assumption as a
    documented fact.
    """
    df = _frame(np.full(48, 6.0), direction_10=45.0, direction_50=50.0)
    out = wind.prevailing_direction(df)
    assert abs(out["circular_mean_deg_10m"] - 45.0) < 1e-6
    assert abs(out["median_turning_deg"] - 5.0) < 1e-6
    assert "inferred" in out["convention_note"]
    assert "not read from the API" in out["convention_note"]


def test_monthly_mean_speed_covers_every_month_present():
    df = _frame(_year_of_speeds(), alpha=0.16)
    rows = wind.monthly_mean_speed(df)
    assert [r["month"] for r in rows] == list(range(1, 13))
    assert all(r["mean_speed_ms"] is not None for r in rows)


# ------------------------------------------------------------------ assembly


def test_every_result_carries_the_gross_and_unvalidated_qualifier():
    """
    Nothing in this chain is benchmarked against an external wind reference,
    unlike the photovoltaic chain, and the capacity factor is gross of every
    plant loss. The qualifier is the only thing separating the number from an
    assessment, so it is asserted at each place a caller might render from.
    """
    df = _frame(_year_of_speeds(), alpha=0.16)
    out = wind.assess(df, -53.54, -25.10)

    assert out["qualifier"] == wind.RESULT_QUALIFIER
    assert out["hub"]["qualifier"] == wind.RESULT_QUALIFIER
    assert out["measured"]["qualifier"] == wind.MEASURED_QUALIFIER

    assert "Screening indication" in wind.RESULT_QUALIFIER
    assert "gross" in wind.RESULT_QUALIFIER
    assert "Global Wind Atlas" in wind.RESULT_QUALIFIER
    assert "per turbine" in wind.RESULT_QUALIFIER
    assert "not been compared" in wind.MEASURED_QUALIFIER


def test_qualifier_names_every_excluded_loss():
    """
    A gross figure that does not say what it is gross of is not qualified. If
    a loss term is added to EXCLUDED_LOSSES it has to reach the text as well.
    """
    assert len(wind.EXCLUDED_LOSSES) == 7
    emitted = wind.assess(_frame(_year_of_speeds()), -53.54, -25.10)
    for loss in wind.EXCLUDED_LOSSES:
        assert loss in wind.RESULT_QUALIFIER
        assert loss in emitted["hub"]["excluded_losses"]


def test_qualifier_survives_a_record_that_passes_every_check():
    """
    The qualifier is a property of the method, not of the data. A clean record
    must not be presented as a validated one.
    """
    df = _frame(_year_of_speeds(), alpha=0.16)
    out = wind.assess(df, -53.54, -25.10)
    assert out["data_quality"]["all_checks_passed"] is True
    assert out["hub"]["qualifier"] == wind.RESULT_QUALIFIER


def test_hub_above_fifty_metres_is_marked_as_extrapolation_in_the_response():
    df = _frame(_year_of_speeds(), alpha=0.16)
    out = wind.assess(df, -53.54, -25.10, hub_height_m=110.0)
    assert out["hub"]["extrapolation"]["is_extrapolation"] is True
    assert out["hub"]["extrapolation"]["height_ratio"] == 2.2


def test_hub_at_the_measured_ceiling_returns_the_measured_quantities():
    """
    With the hub at 50 m the power law is the identity, so the hub block must
    equal the measured block. A height factor applied in the wrong direction
    would show here and nowhere else.
    """
    df = _frame(_year_of_speeds(), alpha=0.16)
    out = wind.assess(df, -53.54, -25.10, hub_height_m=50.0)
    assert out["hub"]["extrapolation"]["is_extrapolation"] is False
    assert out["hub"]["extrapolation"]["height_ratio"] == 1.0
    assert out["hub"]["mean_speed_ms"] == out["measured"]["mean_speed_50m_ms"]
    assert out["hub"]["weibull_c_ms"] == out["measured"]["weibull_c_50m_ms"]
    assert (out["hub"]["wind_power_density_w_m2"]
            == out["measured"]["wind_power_density_50m_w_m2"])


def test_shear_sensitivity_names_a_surface_for_every_exponent():
    """
    The spread across this table is larger than any other uncertainty the
    module can quantify, so no row may assert a bare exponent. Each one either
    comes from the record or from a stated roughness length.
    """
    df = _frame(_year_of_speeds(), alpha=0.16)
    rows = wind.shear_sensitivity(df, wind.shear_exponent_bulk(df), 110.0)
    assert len(rows) >= 4
    derived = [r for r in rows if r["roughness_length_m"] is None]
    assert len(derived) == 1
    assert derived[0]["basis"] == "measured"
    for row in rows:
        assert row["basis"]
        assert row["capacity_factor_pct"] is not None
        assert row["annual_energy_mwh"] is not None
    # Above the measured ceiling a larger exponent lifts the hub speed, so the
    # capacity factor has to rise with the exponent. A row computed from the
    # wrong exponent would break the ordering.
    ordered = sorted(rows, key=lambda r: r["shear_exponent"])
    factors = [r["capacity_factor_pct"] for r in ordered]
    assert factors == sorted(factors)
    assert max(factors) > min(factors), "the table has to show a spread"


def test_response_is_json_serialisable_with_no_non_finite_values():
    """
    NaN is not representable in JSON and would break the sidecar protocol at
    the point where the response crosses to Go. Asserted with allow_nan=False,
    which raises on a non-finite value, rather than by searching the text: the
    string "NaN" appears legitimately in the fill-value flag.
    """
    df = _frame(_year_of_speeds(), alpha=0.16)
    df.iloc[:5, :] = np.nan
    out = wind.assess(df, -53.54, -25.10)
    json.dumps(out, allow_nan=False)
    assert out["grid_cell_centre"] == [-53.75, -25.0]
    assert "MERRA-2" in out["grid_note"]


def test_analysis_touches_no_network():
    """
    fetch is the only function that goes to POWER. Everything downstream reads
    the frame it returns, which is what makes the chain testable offline and
    keeps a re-analysis from re-requesting the record.
    """
    import solar

    original = solar._request
    solar._request = lambda url: (_ for _ in ()).throw(
        AssertionError(f"analysis requested {url}")
    )
    try:
        out = wind.assess(_frame(_year_of_speeds(), alpha=0.16), -53.54, -25.10)
        assert out["hub"]["gross_capacity_factor_pct"] is not None
    finally:
        solar._request = original


def test_project_conventions_are_labelled_as_conventions():
    """
    None of these is a measured or published value. Each has to carry the note
    saying so, or a reader takes a threshold this project chose for a
    threshold the literature supports.
    """
    assert wind.HUB_HEIGHT_M == 110.0
    assert wind.RECORD_YEARS == 10
    assert wind.CALM_THRESHOLD_MS == 0.5
    assert wind.ROUGHNESS_BAND_M == (0.03, 0.10)
    assert wind.RECORD_MAX_FLOOR_MS == 10.0
    assert wind.CALM_FRACTION_2M_FLAG_PCT == 50.0
    assert wind.SENSITIVITY_ROUGHNESS_M == (0.01, 0.40)
    assert "no published basis" in wind.RECORD_MAX_FLOOR_NOTE
    assert "no published basis" in wind.CALM_2M_NOTE


def test_grid_note_states_what_the_cell_does_and_does_not_resolve():
    """Every response carries this; it must name the resolution it describes."""
    assert "0.5 by 0.625 degree" in wind.GRID_NOTE
    assert "MERRA-2" in wind.GRID_NOTE
    assert "is not evidence of a difference between the sites" in wind.GRID_NOTE
