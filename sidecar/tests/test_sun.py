"""
The sun as a service, offline: the POWER reader, the record it returns, and the
position of the sun over it.

Nothing here reaches the network. The reader is exercised on the URL it builds
and the payload it decodes, and everything downstream is given a frame.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from terra.sun import (
    nasa_power as sun_power,
    position as sun_position,
    record as sun_record,
)


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
    df = sun_power.to_frame(payload, "daily")
    assert np.isnan(df["ALLSKY_SFC_SW_DWN"].iloc[1])
    assert df["ALLSKY_SFC_SW_DWN"].iloc[0] == 5.5


def test_request_url_carries_the_required_parameters():
    url = sun_power.build_url(
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
    a = sun_power.request_point(-53.53612, -25.09721)
    b = sun_power.request_point(-53.53588, -25.09744)
    assert a == b


def test_annual_totals_drops_incomplete_years():
    """A partial year would read as a low one and bias both spread and trend."""
    full = pd.date_range("2023-01-01", "2023-12-31", freq="D")
    partial = pd.date_range("2024-01-01", "2024-03-31", freq="D")
    idx = full.append(partial)
    df = pd.DataFrame({"ALLSKY_SFC_SW_DWN": np.ones(len(idx))}, index=idx)
    out = sun_record.annual_totals(df)
    assert list(out.index) == [2023]
    assert out.loc[2023] == 365.0


def test_linear_trend_reports_no_trend_for_too_few_points():
    s = pd.Series([1.0, 2.0], index=[2020, 2021])
    slope, p = sun_record.linear_trend(s)
    assert slope == 0.0 and p == 1.0


def test_linear_trend_recovers_a_known_slope():
    years = np.arange(2000, 2030)
    s = pd.Series(1000.0 + 2.0 * (years - 2000), index=years)
    slope, p = sun_record.linear_trend(s)
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
    assert abs(sun_record.clear_sky_index(df) - (15.0 / 24.0)) < 1e-9


def test_clear_sky_index_absent_without_the_clear_sky_series():
    idx = pd.date_range("2024-01-01", periods=2, freq="D")
    df = pd.DataFrame({"ALLSKY_SFC_SW_DWN": [4.0, 5.0]}, index=idx)
    assert sun_record.clear_sky_index(df) is None


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
    rows = sun_record.monthly_climatology(df)
    assert [r["month"] for r in rows] == list(range(1, 13))
    assert all(r["ghi"] is not None for r in rows)


def test_grid_note_states_both_grids():
    """Every response carries this; it must name the resolution it describes."""
    assert "1 degree" in sun_power.GRID_NOTE
    assert "0.5" in sun_power.GRID_NOTE


def test_beam_fraction_is_the_direct_share_of_the_horizontal_total():
    df = pd.DataFrame({"ghi": [100.0, 100.0], "dhi": [30.0, 30.0]})
    assert abs(sun_record.beam_fraction(df) - 0.7) < 1e-9
    assert sun_record.beam_fraction(pd.DataFrame({"ghi": [0.0], "dhi": [0.0]})) == 0.0


def _three_years():
    return pd.date_range("2023-01-01", "2025-12-31 23:00", freq="h")


def _clear_day(hours=24, lat=-4.5, lon=-42.5):
    idx = pd.date_range("2025-02-19", periods=hours, freq="h")
    df = pd.DataFrame(
        {
            "ghi": np.linspace(0, 900, hours),
            "dni": np.linspace(0, 800, hours),
            "dhi": np.linspace(0, 200, hours),
            "clrsky": np.linspace(1, 1000, hours),
        },
        index=idx,
    )
    solpos = pd.DataFrame(
        {
            "apparent_zenith": np.linspace(100, 10, hours),
            "azimuth": np.linspace(80, 280, hours),
        },
        index=idx,
    )
    return df, solpos


def test_prepare_hourly_survives_a_cache_written_before_clear_sky_was_asked_for():
    """O cache do POWER não expira por design.

    Uma série gravada antes deste parâmetro entrar em HOURLY_PARAMS continua
    sendo lida hoje e não tem a coluna. Exigi-la transformava um cache que
    funcionava num KeyError -- e o mesmo vale para qualquer chamador que monte
    o frame à mão, que é o caso de todo teste deste módulo.
    """
    idx = pd.date_range("2025-02-19", periods=6, freq="h")
    old = pd.DataFrame(
        {
            "ALLSKY_SFC_SW_DWN": np.linspace(0, 900, 6),
            "ALLSKY_SFC_SW_DNI": np.linspace(0, 800, 6),
            "ALLSKY_SFC_SW_DIFF": np.linspace(0, 200, 6),
            "T2M": np.full(6, 28.0),
            "WS2M": np.full(6, 2.0),
        },
        index=idx,
    )
    df, solpos = sun_position.prepare_hourly(old, -4.5, -42.5, 0.0)
    assert "clrsky" not in df.columns
    assert len(df) == 6 and len(solpos) == 6

    new = old.assign(CLRSKY_SFC_SW_DWN=np.linspace(1, 1000, 6))
    df2, _ = sun_position.prepare_hourly(new, -4.5, -42.5, 0.0)
    assert "clrsky" in df2.columns
