"""
The NDVI inversion: what it recovers, where it stops measuring, and the two
ways a series can be smoothed into a different crop.
"""

from __future__ import annotations

import numpy as np
import pytest

import lai_ndvi


def test_bare_soil_gives_no_leaf():
    """The floor of the relation. A negative leaf area is not a small error."""
    assert lai_ndvi.lai_from_ndvi(lai_ndvi.NDVI_SOIL) == pytest.approx(0.0, abs=1e-12)
    assert lai_ndvi.lai_from_ndvi(0.05) == pytest.approx(0.0, abs=1e-12)


def test_the_inversion_is_the_forward_relation_read_backwards():
    """
    Round trip against the model it inverts: NDVI = inf - (inf - soil)*exp(-k*LAI).
    Checking against the closed form rather than against another call of the
    same function, which would agree with any coefficient.
    """
    k = lai_ndvi.K_EXTINCTION
    for lai in (0.2, 1.0, 2.5, 3.9):
        ndvi = lai_ndvi.NDVI_INF - (lai_ndvi.NDVI_INF - lai_ndvi.NDVI_SOIL) * np.exp(-k * lai)
        np.testing.assert_allclose(lai_ndvi.lai_from_ndvi(ndvi), lai, rtol=1e-10)


def test_the_ceiling_is_clamped_rather_than_divergent():
    """
    The logarithm diverges at the closed-canopy value, and a pixel one
    thousandth above it is not an infinite canopy -- it is noise on a saturated
    index.
    """
    assert lai_ndvi.lai_from_ndvi(lai_ndvi.NDVI_INF) == pytest.approx(lai_ndvi.MAX_LAI)
    assert lai_ndvi.lai_from_ndvi(0.99) == pytest.approx(lai_ndvi.MAX_LAI)
    assert np.isfinite(lai_ndvi.lai_from_ndvi(1.0))


def test_saturation_is_reported_not_only_returned():
    """
    Above roughly LAI 4 the index barely moves, so the answer is extrapolation.
    A caller handed only the number cannot tell which part of a series is in
    that regime, and the whole point is that it looks like a measurement.
    """
    high = lai_ndvi.NDVI_INF - (lai_ndvi.NDVI_INF - lai_ndvi.NDVI_SOIL) * np.exp(-0.65 * 5.0)
    out = lai_ndvi.invert_series([0.3, 0.5, high, high])
    assert out["n_saturated"] == 2
    assert out["saturation_lai"] == lai_ndvi.SATURATION_LAI


def test_how_much_a_hundredth_of_ndvi_is_worth_at_the_top():
    """
    The reason saturation has to be surfaced, as a number rather than a caution:
    the same measurement error buys an order of magnitude more LAI near the
    ceiling than in the middle.
    """
    def sensitivity(ndvi):
        return lai_ndvi.lai_from_ndvi(ndvi + 0.005) - lai_ndvi.lai_from_ndvi(ndvi - 0.005)

    assert sensitivity(0.50) < 0.1
    assert sensitivity(0.85) > 2 * sensitivity(0.50)


def test_a_series_is_smoothed_by_date_and_not_by_position():
    """
    A cloud-screened series is irregular, so a window counted in samples
    averages whatever survived -- which on a gappy series mixes observations
    that are a season apart into one number.

    Here two clusters sit three months from each other. Smoothed by date they
    stay distinct; smoothed by position the gap would pull them together.
    """
    days = [0, 4, 8, 100, 104, 108]
    ndvi = [0.30, 0.32, 0.31, 0.75, 0.77, 0.76]
    out = lai_ndvi.invert_series(ndvi, days=days, window_days=12)

    early = np.array(out["ndvi"][:3])
    late = np.array(out["ndvi"][3:])
    np.testing.assert_allclose(early, 0.31, atol=0.01)
    np.testing.assert_allclose(late, 0.76, atol=0.01)
    assert late.min() - early.max() > 0.4, "the two clusters were averaged together"


def test_without_dates_the_series_is_left_alone_rather_than_smoothed_wrongly():
    ndvi = [0.30, 0.75, 0.31]
    out = lai_ndvi.invert_series(ndvi)
    np.testing.assert_allclose(out["ndvi"], ndvi)


def test_mismatched_dates_are_refused():
    with pytest.raises(ValueError, match="against"):
        lai_ndvi.invert_series([0.3, 0.4, 0.5], days=[0, 5])


def test_a_range_that_leaves_no_room_is_refused():
    """Soil above the ceiling is a calibration mistake, not an edge case."""
    with pytest.raises(ValueError, match="exceed"):
        lai_ndvi.lai_from_ndvi(0.5, ndvi_soil=0.9, ndvi_inf=0.2)


def test_the_parameters_travel_with_the_answer():
    """
    None of the three is universal -- soil, ceiling and coefficient are that
    field and that crop. A series reporting an LAI without saying which
    calibration produced it cannot be compared with another one.
    """
    out = lai_ndvi.invert_series([0.4, 0.6], k=0.55, ndvi_soil=0.12)
    assert out["parameters"]["k"] == 0.55
    assert out["parameters"]["ndvi_soil"] == 0.12


def test_this_k_is_not_the_canopy_extinction_coefficient():
    """
    The inversion's k and the engines' G sit in the same place in two
    exponentials and are different quantities. Substituting one for the other
    moved a published interception comparison by 22 percentage points and
    reversed its sign, which is why both modules say so in prose -- and why this
    asserts they are not silently the same number.
    """
    import canopy_voxel

    assert lai_ndvi.K_EXTINCTION != canopy_voxel.G_LEAF
