"""
The statistics the terrain layer is reported by.

They were computed inside the payload literal of solar_terrain, where a
coefficient of variation, two loss reductions and the difference between a sky
view factor that was not applied and one applied at zero were unreachable by
any test.
"""

from __future__ import annotations

import numpy as np
import pytest

from terra.energy import terrain_irradiance as poa


def valid_of(shape, keep=None):
    mask = np.zeros(shape, dtype=bool)
    mask[keep if keep is not None else slice(None)] = True
    return mask


def test_the_spread_is_a_coefficient_of_variation():
    """
    In its own units the spread of one AOI says nothing about another at a
    different irradiation. As a percentage of the mean, the two compare.
    """
    values = np.array([90.0, 100.0, 110.0])
    out = poa.summarise(values, np.zeros(3), valid_of((3,)))

    assert out['poa_mean'] == 100.0
    assert out['poa_std_pct'] == pytest.approx(100.0 * np.std(values) / 100.0, abs=1e-2)


def test_reductions_are_over_the_valid_cells_and_not_the_read_window():
    """
    The window read is larger than the AOI by the buffer the horizon search
    needed. A mean over the window is a mean over ground the report is not
    about.
    """
    slope = np.array([[1.0, 90.0], [1.0, 90.0]])
    poa_values = np.array([[100.0, 999.0], [100.0, 999.0]])
    valid = np.array([[True, False], [True, False]])

    out = poa.summarise(poa_values, slope, valid)

    assert out['poa_max'] == 100.0
    assert out['slope_max_deg'] == 1.0
    assert out['pixels'] == 2


def test_a_sky_view_not_applied_is_not_a_sky_view_applied_at_zero():
    """Two different statements about the terrain, and the payload says which."""
    valid = valid_of((2, 2))

    absent = poa.summarise(np.ones((2, 2)), np.ones((2, 2)), valid)
    at_zero = poa.summarise(np.ones((2, 2)), np.ones((2, 2)), valid,
                            svf_loss=np.zeros((2, 2)))

    assert absent['sky_view']['applied'] is False
    assert absent['sky_view']['diffuse_loss_mean_pct'] is None
    assert at_zero['sky_view']['applied'] is True
    assert at_zero['sky_view']['diffuse_loss_mean_pct'] == 0.0


def test_the_losses_are_reported_as_percentages():
    valid = valid_of((2, 2))
    shading = np.full((2, 2), 0.013)

    out = poa.summarise(np.ones((2, 2)), np.ones((2, 2)), valid,
                        shading_loss=shading)

    assert out['shading_mean_pct'] == pytest.approx(1.3, abs=1e-6)
    assert out['shading_max_pct'] == pytest.approx(1.3, abs=1e-6)


def test_an_absent_enclosure_leaves_the_horizon_fields_empty_rather_than_raising():
    out = poa.summarise(np.ones((2, 2)), np.ones((2, 2)), valid_of((2, 2)))

    assert out['sky_view']['mean_horizon_deg'] is None
    assert out['sky_view']['threshold_deg'] is None


def test_the_scale_is_rounded_and_carries_what_it_was_drawn_on():
    """
    Without the domain a client can only guess, and two layers drawn on
    different domains would be compared as if they shared one.
    """
    scale = {'palette': 'inferno', 'min': 1.23456, 'max': 9.87654,
             'reference': 'annual', 'basis': 'kWh/m2', 'shared_with': ['summer'],
             'decimals': 1}

    out = poa.summarise(np.ones((2, 2)), np.ones((2, 2)), valid_of((2, 2)),
                        scale=scale)

    assert out['scale']['min'] == 1.2346
    assert out['scale']['shared_with'] == ['summer']
