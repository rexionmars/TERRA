"""Unit tests for the solar resource helpers (offline)."""

from __future__ import annotations

import numpy as np
import pandas as pd

import solar


def test_fill_value_becomes_nan():
    """
    POWER writes -999 for a missing value. Left in place it would sink an
    annual total by hundreds of kWh, so it must not survive parsing.
    """
    payload = {
        "properties": {
            "parameter": {
                "ALLSKY_SFC_SW_DWN": {
                    "20240101": 5.5,
                    "20240102": -999.0,
                    "20240103": 6.1,
                }
            }
        }
    }
    df = solar.to_frame(payload, "daily")
    assert np.isnan(df["ALLSKY_SFC_SW_DWN"].iloc[1])
    assert df["ALLSKY_SFC_SW_DWN"].iloc[0] == 5.5


def test_request_url_carries_the_required_parameters():
    url = solar.build_url(
        "daily", -53.54, -25.1, ["ALLSKY_SFC_SW_DWN"], "20240101", "20241231"
    )
    assert url.startswith("https://power.larc.nasa.gov/api/temporal/daily/point?")
    assert "community=RE" in url
    assert "time-standard=UTC" in url
    assert "longitude=-53.54" in url and "latitude=-25.1" in url


def test_grid_key_rounds_to_the_cell():
    """
    The radiation grid is 1 degree, so nearby AOIs must resolve to the same
    request and reuse the same series.
    """
    a = solar.grid_key(-53.53612, -25.09721)
    b = solar.grid_key(-53.53588, -25.09744)
    assert a == b


def test_annual_totals_drops_incomplete_years():
    """A partial year would read as a low one and bias both spread and trend."""
    full = pd.date_range("2023-01-01", "2023-12-31", freq="D")
    partial = pd.date_range("2024-01-01", "2024-03-31", freq="D")
    idx = full.append(partial)
    df = pd.DataFrame({"ALLSKY_SFC_SW_DWN": np.ones(len(idx))}, index=idx)
    out = solar.annual_totals(df)
    assert list(out.index) == [2023]
    assert out.loc[2023] == 365.0


def test_linear_trend_reports_no_trend_for_too_few_points():
    s = pd.Series([1.0, 2.0], index=[2020, 2021])
    slope, p = solar.linear_trend(s)
    assert slope == 0.0 and p == 1.0


def test_linear_trend_recovers_a_known_slope():
    years = np.arange(2000, 2030)
    s = pd.Series(1000.0 + 2.0 * (years - 2000), index=years)
    slope, p = solar.linear_trend(s)
    assert abs(slope - 2.0) < 1e-6
    assert p < 0.01


def test_clear_sky_index_is_a_ratio_below_one():
    idx = pd.date_range("2024-01-01", periods=3, freq="D")
    df = pd.DataFrame(
        {
            "ALLSKY_SFC_SW_DWN": [4.0, 5.0, 6.0],
            "CLRSKY_SFC_SW_DWN": [8.0, 8.0, 8.0],
        },
        index=idx,
    )
    assert abs(solar.clear_sky_index(df) - (15.0 / 24.0)) < 1e-9


def test_clear_sky_index_absent_without_the_clear_sky_series():
    idx = pd.date_range("2024-01-01", periods=2, freq="D")
    df = pd.DataFrame({"ALLSKY_SFC_SW_DWN": [4.0, 5.0]}, index=idx)
    assert solar.clear_sky_index(df) is None


def test_monthly_climatology_covers_every_month_present():
    idx = pd.date_range("2024-01-01", "2024-12-31", freq="D")
    df = pd.DataFrame(
        {
            "ALLSKY_SFC_SW_DWN": np.linspace(4.0, 7.0, len(idx)),
            "ALLSKY_SFC_SW_DNI": np.linspace(3.0, 6.0, len(idx)),
            "ALLSKY_SFC_SW_DIFF": np.linspace(1.0, 2.0, len(idx)),
            "ALLSKY_KT": np.linspace(0.4, 0.6, len(idx)),
        },
        index=idx,
    )
    rows = solar.monthly_climatology(df)
    assert [r["month"] for r in rows] == list(range(1, 13))
    assert all(r["ghi"] is not None for r in rows)


def test_reference_performance_ratio_is_below_the_modelled_one():
    """
    The chain omits soiling, inter-row shading, degradation, availability and
    cabling, so what it models runs high. The reference applied by default must
    sit below it, or the calibration would not be doing anything.
    """
    assert solar.REFERENCE_PERFORMANCE_RATIO < 0.85
    assert 0.7 < solar.REFERENCE_PERFORMANCE_RATIO < 0.9


def test_modelled_performance_ratio_is_energy_over_reference_energy():
    p_ac = pd.Series([800.0, 800.0])
    poa = pd.Series([1000.0, 1000.0])
    # 1.6 kWh AC over 2.0 kWh at STC efficiency for a 1 kWp array.
    assert abs(solar.modelled_performance_ratio(p_ac, poa) - 0.8) < 1e-9


def test_modelled_performance_ratio_handles_no_irradiance():
    assert np.isnan(
        solar.modelled_performance_ratio(pd.Series([0.0]), pd.Series([0.0]))
    )


def test_grid_note_states_both_grids():
    """Every response carries this; it must name the resolution it describes."""
    assert "1 degree" in solar.GRID_NOTE
    assert "0.5" in solar.GRID_NOTE


# --------------------------------------------------------------- render scale
#
# None of the tests above touches rendering, which is how a vegetation ramp and
# a per-layer stretch reached a physical quantity unnoticed.


def test_seasons_share_one_colour_domain():
    """
    Winter and summer must be drawn on the same domain.

    Their spatial spread differs by about a factor of ten. Normalising each to
    its own range maps both onto the full ramp and draws them at identical
    contrast, which asserts the opposite of the measurement.
    """
    winter = np.array([[180.0, 300.0], [250.0, 405.0]])
    summer = np.array([[519.0, 540.0], [530.0, 554.0]])
    valid = np.ones_like(winter, dtype=bool)

    w = solar.render_scale("winter", winter, valid, summer, valid)
    s = solar.render_scale("summer", summer, valid, winter, valid)

    assert (w["min"], w["max"]) == (s["min"], s["max"])
    assert w["min"] == 180.0 and w["max"] == 554.0
    assert w["basis"] == "shared" and w["shared_with"] == "summer"
    assert s["shared_with"] == "winter"


def _colour_travel(rgba):
    """How far the colours of a layer travel along the ramp, in RGB units.

    Measured pixel to pixel rather than channel to channel: a single colour
    already spans a wide range across its three channels, which says nothing
    about how much the layer varies.
    """
    flat = rgba[..., :3].reshape(-1, 3).astype(int)
    return int(np.abs(flat.max(axis=0) - flat.min(axis=0)).max())


def _ramp_fraction(values, scale):
    """Fraction of the colour ramp a layer occupies on a given domain."""
    t = (values - scale["min"]) / (scale["max"] - scale["min"])
    return float(t.max() - t.min())


def test_a_flat_season_stays_flat_on_the_shared_domain():
    """
    On the shared domain the flat season must occupy a small slice of the ramp.

    This is the defect the shared domain exists to prevent. Asserted on the
    normalisation rather than on pixel colours, because a colour ramp is not
    linear per channel and a colour-space threshold would be testing the ramp
    instead of the domain.
    """
    winter = np.array([[178.0, 250.0, 330.0, 405.0]])
    summer = np.array([[519.0, 530.0, 545.0, 554.0]])
    valid = np.ones_like(summer, dtype=bool)

    shared = solar.render_scale("summer", summer, valid, winter, valid)
    summer_shared = _ramp_fraction(summer, shared)
    winter_shared = _ramp_fraction(winter, shared)
    assert summer_shared < 0.15, "the flat season stays in a narrow slice"
    assert winter_shared > 4 * summer_shared, (
        "on one domain the structured season occupies far more of the ramp"
    )

    own = solar.render_scale("annual", summer, valid)
    assert _ramp_fraction(summer, own) == 1.0, (
        "self-normalising spends the whole ramp on the flat season, "
        "which is the defect"
    )

    # and the colours follow: winter moves further than summer on one domain
    travel = lambda a: _colour_travel(solar.terrain_rgba(
        a, valid, shared["min"], shared["max"], shared["palette"]))
    assert travel(winter) > travel(summer)


def test_anisotropy_domain_keeps_the_parity_reference_visible():
    """
    Anisotropy is a ratio whose reference is one: the two seasons deliver the
    same irradiation. A percentile stretch of observed values, which never reach
    one, would drop that reference off the ramp.
    """
    scale = solar.render_scale("anisotropy")
    assert scale["basis"] == "fixed"
    assert scale["reference"] == 1.0
    assert scale["min"] < 1.0 < scale["max"]
    assert scale["palette"] == "rdbu_r"

    observed = np.array([[0.33, 0.57, 0.83]])
    valid = np.ones_like(observed, dtype=bool)
    rgba = solar.terrain_rgba(
        observed, valid, scale["min"], scale["max"], scale["palette"]
    )
    assert rgba[..., 3].all(), "every valid pixel is opaque"


def test_irradiation_does_not_use_the_vegetation_ramp():
    """
    RdYlGn is hue-coded for a judgement and sits on the red-green axis. It is
    wrong for a physical quantity and is the ramp NDVI already uses, so a solar
    overlay drawn with it is indistinguishable from a vegetation overlay.
    """
    import composite as comp

    assert solar.PALETTE_IRRADIATION == "inferno"
    assert solar.PALETTE_SHADING == "viridis"
    for name in (solar.PALETTE_IRRADIATION, solar.PALETTE_SHADING,
                 solar.PALETTE_ANISOTROPY):
        assert name in comp.CONTINUOUS_STOPS
        assert comp.CONTINUOUS_STOPS[name] is not comp._RDYLGN


def test_degenerate_domain_does_not_divide_by_zero():
    """A constant layer still has to render."""
    flat = np.full((3, 3), 42.0)
    valid = np.ones_like(flat, dtype=bool)
    rgba = solar.terrain_rgba(flat, valid, 42.0, 42.0, "inferno")
    assert rgba.shape == (3, 3, 4)
    assert np.isfinite(rgba).all()


# ------------------------------------------------------------ horizon shading


def _ridge(h=24, w=24, height=200.0):
    """Flat ground with a wall along the north edge."""
    z = np.zeros((h, w))
    z[0, :] = height
    return z


def _pit(h=16, w=16, height=200.0, floor=4):
    """A floor enclosed by walls on every side.

    Enclosed rather than one-sided so the test does not depend on where the
    synthetic Sun happens to be: whatever azimuth it rises at, the floor is
    looking up at something.
    """
    z = np.full((h, w), height)
    z[floor:h - floor, floor:w - floor] = 0.0
    return z


def test_horizon_sees_a_ridge_to_the_north():
    z = _ridge()
    horizon, az = solar.horizon_angles(z, 30.0, 30.0)
    north = int(np.argmin(np.abs(az - 0.0)))
    south = int(np.argmin(np.abs(az - 180.0)))
    # a pixel just south of the wall looks up at it, and sees nothing behind
    assert horizon[5, 12, north] > 20.0
    assert horizon[5, 12, south] == 0.0


def test_flat_ground_has_no_horizon():
    horizon, _ = solar.horizon_angles(np.zeros((16, 16)), 30.0, 30.0)
    assert horizon.max() == 0.0


def test_shading_loss_is_zero_without_relief_and_positive_with_it():
    idx = pd.date_range("2024-06-01", periods=240, freq="h", tz="UTC")
    df = pd.DataFrame({
        "dni": np.tile(np.r_[np.zeros(6), np.full(12, 600.0), np.zeros(6)], 10),
        "ghi": np.tile(np.r_[np.zeros(6), np.full(12, 700.0), np.zeros(6)], 10),
        "dhi": np.tile(np.r_[np.zeros(6), np.full(12, 200.0), np.zeros(6)], 10),
    }, index=idx)
    solpos = pd.DataFrame({
        "apparent_zenith": np.tile(
            np.r_[np.full(6, 95.0), np.linspace(80, 20, 6),
                  np.linspace(20, 80, 6), np.full(6, 95.0)], 10),
        "azimuth": np.tile(np.linspace(0, 359, 24), 10),
    }, index=idx)

    hist, edges = solar.beam_energy_histogram(df, solpos)
    assert hist.sum() > 0

    flat = solar.shading_loss_fraction(
        solar.horizon_angles(np.zeros((16, 16)), 30.0, 30.0)[0], hist, edges)
    assert flat.max() == 0.0

    walled = solar.shading_loss_fraction(
        solar.horizon_angles(_pit(), 30.0, 30.0)[0], hist, edges)
    assert walled.max() > 0.0
    assert walled.max() <= 1.0
    assert walled[8, 8] > 0.0, "the pit floor loses beam energy"


def test_beam_fraction_is_the_direct_share_of_the_horizontal_total():
    df = pd.DataFrame({"ghi": [100.0, 100.0], "dhi": [30.0, 30.0]})
    assert abs(solar.beam_fraction(df) - 0.7) < 1e-9
    assert solar.beam_fraction(pd.DataFrame({"ghi": [0.0], "dhi": [0.0]})) == 0.0
