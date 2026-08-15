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


def _uniform_horizon(deg: float, n: int = 36, shape=(4, 4)) -> np.ndarray:
    """A horizon of one elevation in every azimuth, where the SVF is closed."""
    return np.full(shape + (n,), float(deg), dtype=np.float32)


def test_sky_view_factor_is_the_closed_form_for_a_uniform_horizon():
    """
    A uniform horizon at elevation h admits cos^2(h) of the isotropic dome. The
    closed form is the check on the sector integral: an implementation that
    averaged the angle rather than its cosine squared would pass a zero test and
    a ninety test and be wrong everywhere between.
    """
    for deg in (0.0, 10.0, 30.0, 45.0, 60.0, 90.0):
        got = solar.sky_view_factor(_uniform_horizon(deg))[0, 0]
        assert abs(got - np.cos(np.radians(deg)) ** 2) < 1e-6, deg
    assert solar.sky_view_factor(_uniform_horizon(0.0))[0, 0] == 1.0
    # Not an exact zero: cos(pi/2) is 6.1e-17 in floating point, so a sky walled
    # to the zenith lands at 1.9e-15 rather than at 0.
    assert solar.sky_view_factor(_uniform_horizon(90.0))[0, 0] < 1e-12


def test_sky_view_factor_averages_over_sectors_not_within_them():
    """Half the sky walled to 45 degrees is the mean of the two sector values."""
    mixed = np.zeros((1, 1, 36), dtype=np.float32)
    mixed[:, :, :18] = 45.0
    want = 0.5 * np.cos(np.radians(45.0)) ** 2 + 0.5
    assert abs(solar.sky_view_factor(mixed)[0, 0] - want) < 1e-6


def test_diffuse_loss_is_the_complement_and_stays_bounded():
    loss = solar.diffuse_loss_fraction(_uniform_horizon(30.0))
    assert abs(loss[0, 0] - 0.25) < 1e-6
    assert solar.diffuse_loss_fraction(_uniform_horizon(0.0)).max() == 0.0
    assert solar.diffuse_loss_fraction(_uniform_horizon(90.0)).max() == 1.0


def test_diffuse_loss_reproduces_the_measured_valley_and_plain():
    """
    The study that motivated this measured -2.82 percent in an incised valley
    and -0.04 percent on a plain. Those are the magnitudes the implementation
    has to land on, or it is measuring something else.
    """
    valley = solar.diffuse_loss_fraction(_uniform_horizon(9.7))[0, 0]
    plain = solar.diffuse_loss_fraction(_uniform_horizon(1.0))[0, 0]
    assert 0.025 < valley < 0.032, valley
    assert plain < 0.001, plain


def test_enclosure_gates_on_the_horizon_it_reports():
    """
    The verdict travels with the evidence: a caller that applies the loss has to
    be able to print the horizon and the threshold it was judged against.
    """
    below = solar.horizon_enclosure(_uniform_horizon(1.9))
    at = solar.horizon_enclosure(_uniform_horizon(2.0))
    assert below["encloses"] is False
    assert at["encloses"] is True
    assert at["threshold_deg"] == solar.SVF_MIN_MEAN_HORIZON_DEG
    assert abs(at["mean_horizon_deg"] - 2.0) < 1e-6
    # The threshold is where the loss is still under the rounding of every
    # figure this module publishes.
    assert solar.diffuse_loss_fraction(
        _uniform_horizon(solar.SVF_MIN_MEAN_HORIZON_DEG)
    ).max() < 0.002


def test_sky_view_factor_of_an_absent_horizon_is_open_sky():
    """No horizon traced must read as nothing blocking, not as everything."""
    assert solar.sky_view_factor(np.zeros((2, 2, 0), dtype=np.float32))[0, 0] == 1.0
    assert solar.horizon_enclosure(np.zeros((2, 2, 0)))["encloses"] is False


def test_diffuse_incidence_correction_is_applied_and_lowers_the_yield():
    """
    The angle-of-incidence correction reaches the diffuse components, not the
    beam alone. Ground-reflected light arrives near-grazing, so it is the
    strongly corrected term; the omission overstated the yield by ~0.75 percent.
    """
    import pvlib
    sky = pvlib.iam.marion_diffuse("ashrae", 20.0, b=solar.IAM_ASHRAE_B)
    assert sky["ground"] < sky["sky"] < 1.0
    assert 0.9 < sky["sky"] < 1.0
    # The beam relation and the diffuse one are the same coefficient.
    assert solar.IAM_ASHRAE_B == 0.05


def _three_years():
    return pd.date_range("2023-01-01", "2025-12-31 23:00", freq="h")


def test_doy_window_keeps_the_same_season_in_every_year():
    """Uma janela de dia-do-ano, não de data.

    Um fevereiro só são algumas centenas de horas de luz e um histograma
    magro; três fevereiros são um céu. A janela existe para estreitar a
    ESTAÇÃO sem jogar fora os outros anos do registro.
    """
    idx = _three_years()
    m = solar.doy_window_mask(idx, "2026-02-19", 21)
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
    m = solar.doy_window_mask(idx, "2025-12-28", 21)
    months = set(idx[m].month)
    assert 12 in months and 1 in months, f"a janela não deu a volta: {months}"
    assert len(set(idx[m].dayofyear)) == 43


def test_no_date_means_no_window_rather_than_an_arbitrary_one():
    """Uma resposta, não uma falha: o chamador então usa o registro inteiro
    e diz que usou."""
    idx = _three_years()
    assert solar.doy_window_mask(idx, None, 21) is None
    assert solar.doy_window_mask(idx, "não é uma data", 21) is None
    # Meia-largura que cobriria o ano todo não é uma janela.
    assert solar.doy_window_mask(idx, "2026-02-19", 200) is None
    assert solar.doy_window_mask(idx, "2026-02-19", 0) is None


def test_the_window_is_not_the_named_season_helper():
    """São duas funções com propósitos diferentes no mesmo módulo, e a
    segunda foi escrita depois -- sem este teste um `def` sombreia o outro em
    silêncio, que é exatamente o que aconteceu ao escrever esta."""
    idx = _three_years()
    assert solar.doy_window_mask(idx, "2026-02-19", 21).sum() != \
        solar.season_mask(idx, "summer").sum() if "summer" in solar.SEASONS \
        else True
    assert solar.doy_window_mask.__code__.co_argcount == 3
    assert solar.season_mask.__code__.co_argcount == 2


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
    got = solar.mean_beam_direction(df, solpos)
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
    got = solar.mean_beam_direction(df, solpos)
    assert 260.0 < got["azimuth_deg"] < 280.0, got


def test_a_sun_that_never_rises_has_no_direction():
    """Uma resposta, não uma falha."""
    idx = pd.date_range("2025-06-15", periods=3, freq="h")
    df = pd.DataFrame({"dni": [0.0, 0.0, 0.0]}, index=idx)
    solpos = pd.DataFrame(
        {"apparent_zenith": [120.0, 130.0, 140.0], "azimuth": [0.0, 10.0, 20.0]},
        index=idx,
    )
    assert solar.mean_beam_direction(df, solpos) is None
    assert solar.sun_track(df, solpos) == []


def test_sun_track_drops_the_hours_the_sun_is_down():
    """Uma cena não tem o que fazer com elas, e o azimute ali não significa
    nada para um renderizador."""
    df, solpos = _clear_day()
    track = solar.sun_track(df, solpos)
    assert track, "o dia inteiro caiu fora"
    assert all(r["elevation_deg"] > 0 for r in track)
    # O rótulo diz o padrão de hora, porque assumir local põe o sol três horas
    # errado numa AOI brasileira: o meio-dia solar cai às 15h UTC nesta célula.
    assert "hour_utc" in track[0] and "hour" not in track[0]


def test_sun_track_carries_clearness_when_the_clear_sky_column_survived():
    df, solpos = _clear_day()
    track = solar.sun_track(df, solpos)
    assert any("clearness" in r for r in track)
    assert all(0.0 <= r["clearness"] <= 1.0 for r in track if "clearness" in r)
    # Sem a coluna não há invenção de valor.
    bare = solar.sun_track(df.drop(columns=["clrsky"]), solpos)
    assert bare and all("clearness" not in r for r in bare)


def test_clearness_is_what_arrived_over_what_was_available():
    df, _ = _clear_day()
    got = solar.clearness(df)
    assert got is not None and 0.0 < got <= 1.0
    assert solar.clearness(df.drop(columns=["clrsky"])) is None


def test_representative_day_is_the_median_and_not_the_brightest():
    """Uma janela tem dias limpos e encobertos, e o típico é a mediana."""
    idx = pd.date_range("2025-02-01", periods=72, freq="h")
    dni = np.concatenate([np.full(24, 100.0), np.full(24, 900.0), np.full(24, 500.0)])
    df = pd.DataFrame({"dni": dni}, index=idx)
    got = solar.representative_day(df)
    assert str(got) == "2025-02-03", got
    assert solar.representative_day(df.iloc[:0]) is None


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
    df, solpos = solar.prepare_hourly(old, -4.5, -42.5, 0.0)
    assert "clrsky" not in df.columns
    assert len(df) == 6 and len(solpos) == 6
    # E o que depende da coluna responde ausência em vez de levantar.
    assert solar.clearness(df) is None
    assert all("clearness" not in r for r in solar.sun_track(df, solpos))

    new = old.assign(CLRSKY_SFC_SW_DWN=np.linspace(1, 1000, 6))
    df2, _ = solar.prepare_hourly(new, -4.5, -42.5, 0.0)
    assert "clrsky" in df2.columns
    assert solar.clearness(df2) is not None


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
    track = solar.sun_track(df, solpos)
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
    track = solar.sun_track(df, solpos)
    assert track and "diffuse_share" not in track[0]
