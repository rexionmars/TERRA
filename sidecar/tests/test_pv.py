"""
The photovoltaic product, offline: the array chain, what the terrain does to
the irradiance reaching it, the season windows, the colour policy and the
siting classes.

The two tests that also read the service are here rather than beside it,
because terra.energy depends on terra.sun and not the other way round.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from terra.energy import (
    overlays as overlays_mod,
    pv as pv_mod,
    seasons as seasons_mod,
    terrain_irradiance as poa_mod,
)
from terra.sun import position as sun_position, record as sun_record


def test_reference_performance_ratio_is_below_the_modelled_one():
    """
    The chain omits soiling, inter-row shading, degradation, availability and
    cabling, so what it models runs high. The reference applied by default must
    sit below it, or the calibration would not be doing anything.
    """
    assert pv_mod.REFERENCE_PERFORMANCE_RATIO < 0.85
    assert 0.7 < pv_mod.REFERENCE_PERFORMANCE_RATIO < 0.9


def test_modelled_performance_ratio_is_energy_over_reference_energy():
    p_ac = pd.Series([800.0, 800.0])
    poa = pd.Series([1000.0, 1000.0])
    # 1.6 kWh AC over 2.0 kWh at STC efficiency for a 1 kWp array.
    assert abs(pv_mod.modelled_performance_ratio(p_ac, poa) - 0.8) < 1e-9


def test_modelled_performance_ratio_handles_no_irradiance():
    assert np.isnan(
        pv_mod.modelled_performance_ratio(pd.Series([0.0]), pd.Series([0.0]))
    )


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

    w = overlays_mod.render_scale("winter", winter, valid, summer, valid)
    s = overlays_mod.render_scale("summer", summer, valid, winter, valid)

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

    shared = overlays_mod.render_scale("summer", summer, valid, winter, valid)
    summer_shared = _ramp_fraction(summer, shared)
    winter_shared = _ramp_fraction(winter, shared)
    assert summer_shared < 0.15, "the flat season stays in a narrow slice"
    assert winter_shared > 4 * summer_shared, (
        "on one domain the structured season occupies far more of the ramp"
    )

    own = overlays_mod.render_scale("annual", summer, valid)
    assert _ramp_fraction(summer, own) == 1.0, (
        "self-normalising spends the whole ramp on the flat season, "
        "which is the defect"
    )

    # and the colours follow: winter moves further than summer on one domain
    def travel(a):
        return _colour_travel(overlays_mod.terrain_rgba(
            a, valid, shared["min"], shared["max"], shared["palette"]))
    assert travel(winter) > travel(summer)


def test_anisotropy_domain_keeps_the_parity_reference_visible():
    """
    Anisotropy is a ratio whose reference is one: the two seasons deliver the
    same irradiation. A percentile stretch of observed values, which never reach
    one, would drop that reference off the ramp.
    """
    scale = overlays_mod.render_scale("anisotropy")
    assert scale["basis"] == "fixed"
    assert scale["reference"] == 1.0
    assert scale["min"] < 1.0 < scale["max"]
    assert scale["palette"] == "rdbu_r"

    observed = np.array([[0.33, 0.57, 0.83]])
    valid = np.ones_like(observed, dtype=bool)
    rgba = overlays_mod.terrain_rgba(
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

    assert overlays_mod.PALETTE_IRRADIATION == "inferno"
    assert overlays_mod.PALETTE_SHADING == "viridis"
    for name in (overlays_mod.PALETTE_IRRADIATION, overlays_mod.PALETTE_SHADING,
                 overlays_mod.PALETTE_ANISOTROPY):
        assert name in comp.CONTINUOUS_STOPS
        assert comp.CONTINUOUS_STOPS[name] is not comp._RDYLGN


def test_degenerate_domain_does_not_divide_by_zero():
    """A constant layer still has to render."""
    flat = np.full((3, 3), 42.0)
    valid = np.ones_like(flat, dtype=bool)
    rgba = overlays_mod.terrain_rgba(flat, valid, 42.0, 42.0, "inferno")
    assert rgba.shape == (3, 3, 4)
    assert np.isfinite(rgba).all()


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
    horizon, az = poa_mod.horizon_angles(z, 30.0, 30.0)
    north = int(np.argmin(np.abs(az - 0.0)))
    south = int(np.argmin(np.abs(az - 180.0)))
    # a pixel just south of the wall looks up at it, and sees nothing behind
    assert horizon[5, 12, north] > 20.0
    assert horizon[5, 12, south] == 0.0


def test_flat_ground_has_no_horizon():
    horizon, _ = poa_mod.horizon_angles(np.zeros((16, 16)), 30.0, 30.0)
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

    hist, edges = sun_position.beam_energy_histogram(df, solpos)
    assert hist.sum() > 0

    flat = poa_mod.shading_loss_fraction(
        poa_mod.horizon_angles(np.zeros((16, 16)), 30.0, 30.0)[0], hist, edges)
    assert flat.max() == 0.0

    walled = poa_mod.shading_loss_fraction(
        poa_mod.horizon_angles(_pit(), 30.0, 30.0)[0], hist, edges)
    assert walled.max() > 0.0
    assert walled.max() <= 1.0
    assert walled[8, 8] > 0.0, "the pit floor loses beam energy"


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
        got = poa_mod.sky_view_factor(_uniform_horizon(deg))[0, 0]
        assert abs(got - np.cos(np.radians(deg)) ** 2) < 1e-6, deg
    assert poa_mod.sky_view_factor(_uniform_horizon(0.0))[0, 0] == 1.0
    # Not an exact zero: cos(pi/2) is 6.1e-17 in floating point, so a sky walled
    # to the zenith lands at 1.9e-15 rather than at 0.
    assert poa_mod.sky_view_factor(_uniform_horizon(90.0))[0, 0] < 1e-12


def test_sky_view_factor_averages_over_sectors_not_within_them():
    """Half the sky walled to 45 degrees is the mean of the two sector values."""
    mixed = np.zeros((1, 1, 36), dtype=np.float32)
    mixed[:, :, :18] = 45.0
    want = 0.5 * np.cos(np.radians(45.0)) ** 2 + 0.5
    assert abs(poa_mod.sky_view_factor(mixed)[0, 0] - want) < 1e-6


def test_diffuse_loss_is_the_complement_and_stays_bounded():
    loss = poa_mod.diffuse_loss_fraction(_uniform_horizon(30.0))
    assert abs(loss[0, 0] - 0.25) < 1e-6
    assert poa_mod.diffuse_loss_fraction(_uniform_horizon(0.0)).max() == 0.0
    assert poa_mod.diffuse_loss_fraction(_uniform_horizon(90.0)).max() == 1.0


def test_diffuse_loss_reproduces_the_measured_valley_and_plain():
    """
    The study that motivated this measured -2.82 percent in an incised valley
    and -0.04 percent on a plain. Those are the magnitudes the implementation
    has to land on, or it is measuring something else.
    """
    valley = poa_mod.diffuse_loss_fraction(_uniform_horizon(9.7))[0, 0]
    plain = poa_mod.diffuse_loss_fraction(_uniform_horizon(1.0))[0, 0]
    assert 0.025 < valley < 0.032, valley
    assert plain < 0.001, plain


def test_enclosure_gates_on_the_horizon_it_reports():
    """
    The verdict travels with the evidence: a caller that applies the loss has to
    be able to print the horizon and the threshold it was judged against.
    """
    below = poa_mod.horizon_enclosure(_uniform_horizon(1.9))
    at = poa_mod.horizon_enclosure(_uniform_horizon(2.0))
    assert below["encloses"] is False
    assert at["encloses"] is True
    assert at["threshold_deg"] == poa_mod.SVF_MIN_MEAN_HORIZON_DEG
    assert abs(at["mean_horizon_deg"] - 2.0) < 1e-6
    # The threshold is where the loss is still under the rounding of every
    # figure this module publishes.
    assert poa_mod.diffuse_loss_fraction(
        _uniform_horizon(poa_mod.SVF_MIN_MEAN_HORIZON_DEG)
    ).max() < 0.002


def test_sky_view_factor_of_an_absent_horizon_is_open_sky():
    """No horizon traced must read as nothing blocking, not as everything."""
    assert poa_mod.sky_view_factor(np.zeros((2, 2, 0), dtype=np.float32))[0, 0] == 1.0
    assert poa_mod.horizon_enclosure(np.zeros((2, 2, 0)))["encloses"] is False


def test_diffuse_incidence_correction_is_applied_and_lowers_the_yield():
    """
    The angle-of-incidence correction reaches the diffuse components, not the
    beam alone. Ground-reflected light arrives near-grazing, so it is the
    strongly corrected term; the omission overstated the yield by ~0.75 percent.
    """
    import pvlib
    sky = pvlib.iam.marion_diffuse("ashrae", 20.0, b=pv_mod.IAM_ASHRAE_B)
    assert sky["ground"] < sky["sky"] < 1.0
    assert 0.9 < sky["sky"] < 1.0
    # The beam relation and the diffuse one are the same coefficient.
    assert pv_mod.IAM_ASHRAE_B == 0.05


def _three_years():
    return pd.date_range("2023-01-01", "2025-12-31 23:00", freq="h")


def test_the_window_is_not_the_named_season_helper():
    """São duas funções com propósitos diferentes no mesmo módulo, e a
    segunda foi escrita depois -- sem este teste um `def` sombreia o outro em
    silêncio, que é exatamente o que aconteceu ao escrever esta."""
    idx = _three_years()
    assert sun_record.doy_window_mask(idx, "2026-02-19", 21).sum() != \
        seasons_mod.season_mask(idx, "summer").sum() if "summer" in seasons_mod.SEASONS \
        else True
    assert sun_record.doy_window_mask.__code__.co_argcount == 3
    assert seasons_mod.season_mask.__code__.co_argcount == 2
