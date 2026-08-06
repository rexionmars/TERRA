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
