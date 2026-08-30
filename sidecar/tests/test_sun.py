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


def test_doy_window_keeps_the_same_season_in_every_year():
    """Uma janela de dia-do-ano, não de data.

    Um fevereiro só são algumas centenas de horas de luz e um histograma
    magro; três fevereiros são um céu. A janela existe para estreitar a
    ESTAÇÃO sem jogar fora os outros anos do registro.
    """
    idx = _three_years()
    m = sun_record.doy_window_mask(idx, "2026-02-19", 21)
    assert m.sum() > 3000, "a janela deveria somar as três estações"
    assert set(idx[m].year) == {2023, 2024, 2025}
    assert set(idx[m].month) <= {1, 2, 3}
    # 43 dias de calendário distintos: o centro mais 21 de cada lado.
    assert len(set(idx[m].dayofyear)) == 43


def test_the_window_wraps_at_the_new_year():
    """Não é detalhe no hemisfério sul.

    A janela de fim de dezembro cobre o pico da safra de verão brasileira, e
    um `abs(doy - centro)` ingênuo a cortaria ao meio guardando o lado errado.
    """
    idx = _three_years()
    m = sun_record.doy_window_mask(idx, "2025-12-28", 21)
    months = set(idx[m].month)
    assert 12 in months and 1 in months, f"a janela não deu a volta: {months}"
    assert len(set(idx[m].dayofyear)) == 43


def test_no_date_means_no_window_rather_than_an_arbitrary_one():
    """Uma resposta, não uma falha: o chamador então usa o registro inteiro
    e diz que usou."""
    idx = _three_years()
    assert sun_record.doy_window_mask(idx, None, 21) is None
    assert sun_record.doy_window_mask(idx, "não é uma data", 21) is None
    # Meia-largura que cobriria o ano todo não é uma janela.
    assert sun_record.doy_window_mask(idx, "2026-02-19", 200) is None
    assert sun_record.doy_window_mask(idx, "2026-02-19", 0) is None


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


def test_mean_beam_direction_is_a_vector_mean_not_an_angle_mean():
    """A média de 350° e 10° é 0°, e nunca 180°.

    Azimute é grandeza circular. Somar os ângulos e dividir devolve exatamente
    o lado oposto do céu, e a cena iluminada por ele projetaria toda sombra na
    direção errada -- um erro que não parece erro nenhum numa imagem.
    """
    idx = pd.date_range("2025-06-15 09:00", periods=2, freq="h")
    df = pd.DataFrame({"dni": [500.0, 500.0]}, index=idx)
    solpos = pd.DataFrame(
        {"apparent_zenith": [45.0, 45.0], "azimuth": [350.0, 10.0]}, index=idx
    )
    got = sun_position.mean_beam_direction(df, solpos)
    assert got is not None
    # O norte, e não o sul.
    assert min(got["azimuth_deg"], 360 - got["azimuth_deg"]) < 1.0, got


def test_mean_beam_direction_leans_towards_the_energy():
    """Não é o sol do meio-dia, é o sol que trouxe a energia."""
    idx = pd.date_range("2025-06-15 09:00", periods=2, freq="h")
    df = pd.DataFrame({"dni": [10.0, 900.0]}, index=idx)
    solpos = pd.DataFrame(
        {"apparent_zenith": [45.0, 45.0], "azimuth": [90.0, 270.0]}, index=idx
    )
    got = sun_position.mean_beam_direction(df, solpos)
    assert 260.0 < got["azimuth_deg"] < 280.0, got


def test_a_sun_that_never_rises_has_no_direction():
    """Uma resposta, não uma falha."""
    idx = pd.date_range("2025-06-15", periods=3, freq="h")
    df = pd.DataFrame({"dni": [0.0, 0.0, 0.0]}, index=idx)
    solpos = pd.DataFrame(
        {"apparent_zenith": [120.0, 130.0, 140.0], "azimuth": [0.0, 10.0, 20.0]},
        index=idx,
    )
    assert sun_position.mean_beam_direction(df, solpos) is None
    assert sun_position.sun_track(df, solpos) == []


def test_sun_track_drops_the_hours_the_sun_is_down():
    """Uma cena não tem o que fazer com elas, e o azimute ali não significa
    nada para um renderizador."""
    df, solpos = _clear_day()
    track = sun_position.sun_track(df, solpos)
    assert track, "o dia inteiro caiu fora"
    assert all(r["elevation_deg"] > 0 for r in track)
    # O rótulo diz o padrão de hora, porque assumir local põe o sol três horas
    # errado numa AOI brasileira: o meio-dia solar cai às 15h UTC nesta célula.
    assert "hour_utc" in track[0] and "hour" not in track[0]


def test_sun_track_carries_clearness_when_the_clear_sky_column_survived():
    df, solpos = _clear_day()
    track = sun_position.sun_track(df, solpos)
    assert any("clearness" in r for r in track)
    assert all(0.0 <= r["clearness"] <= 1.0 for r in track if "clearness" in r)
    # Sem a coluna não há invenção de valor.
    bare = sun_position.sun_track(df.drop(columns=["clrsky"]), solpos)
    assert bare and all("clearness" not in r for r in bare)


def test_clearness_is_what_arrived_over_what_was_available():
    df, _ = _clear_day()
    got = sun_record.clearness(df)
    assert got is not None and 0.0 < got <= 1.0
    assert sun_record.clearness(df.drop(columns=["clrsky"])) is None


def test_representative_day_is_the_median_and_not_the_brightest():
    """Uma janela tem dias limpos e encobertos, e o típico é a mediana."""
    idx = pd.date_range("2025-02-01", periods=72, freq="h")
    dni = np.concatenate([np.full(24, 100.0), np.full(24, 900.0), np.full(24, 500.0)])
    df = pd.DataFrame({"dni": dni}, index=idx)
    got = sun_position.representative_day(df)
    assert str(got) == "2025-02-03", got
    assert sun_position.representative_day(df.iloc[:0]) is None


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
    # E o que depende da coluna responde ausência em vez de levantar.
    assert sun_record.clearness(df) is None
    assert all("clearness" not in r for r in sun_position.sun_track(df, solpos))

    new = old.assign(CLRSKY_SFC_SW_DWN=np.linspace(1, 1000, 6))
    df2, _ = sun_position.prepare_hourly(new, -4.5, -42.5, 0.0)
    assert "clrsky" in df2.columns
    assert sun_record.clearness(df2) is not None


def test_diffuse_share_is_clamped_because_the_record_is_not_bounded_by_one():
    """dhi/ghi passa de 1 em sol rasante, e o excesso não é pequeno.

    Medido em três anos na célula deste projeto: chega a 1.531, e 4,2% das
    horas de sol passam de 1 -- todas com elevação mediana de 3,3 graus. Os
    próprios componentes do POWER não fecham ali: (DHI + DNI cos z)/GHI tem
    mediana 1,17 nessas horas. É artefato de origem, e clampar no sidecar evita
    que todo consumidor precise saber disso para não escrever "120% difuso".
    """
    idx = pd.date_range("2025-02-19 08:00", periods=3, freq="h")
    df = pd.DataFrame(
        {
            "ghi": [100.0, 500.0, 100.0],
            "dni": [10.0, 700.0, 10.0],
            # A primeira hora é a rasante: mais difuso do que global.
            "dhi": [153.0, 150.0, 50.0],
        },
        index=idx,
    )
    solpos = pd.DataFrame(
        {"apparent_zenith": [89.0, 30.0, 88.0], "azimuth": [80.0, 180.0, 280.0]},
        index=idx,
    )
    track = sun_position.sun_track(df, solpos)
    shares = [r["diffuse_share"] for r in track]
    assert shares[0] == 1.0, f"a hora rasante saiu como {shares[0]}"
    assert all(0.0 <= s <= 1.0 for s in shares)
    # E a hora do meio não é achatada junto: o clamp é um teto, não uma média.
    assert abs(shares[1] - 0.3) < 1e-9


def test_an_hour_with_no_global_has_no_diffuse_share():
    """Dividir por zero devolveria infinito, e ausência é a resposta certa."""
    idx = pd.date_range("2025-02-19 08:00", periods=1, freq="h")
    df = pd.DataFrame({"ghi": [0.0], "dni": [0.0], "dhi": [0.0]}, index=idx)
    solpos = pd.DataFrame(
        {"apparent_zenith": [89.0], "azimuth": [80.0]}, index=idx
    )
    track = sun_position.sun_track(df, solpos)
    assert track and "diffuse_share" not in track[0]
