"""
Smoothing a series of any length a run can produce.

Six dates is not an edge case: half a year of monthly-best scenes comes to exactly
that, and it used to stop the whole classification.
"""

import numpy as np
import pytest

from terra import phenology


@pytest.mark.parametrize('n', range(1, 15))
def test_a_series_of_any_length_comes_back_the_same_length(n):
    y = np.linspace(0.2, 0.8, n)
    assert len(phenology._smooth(y)) == n


def test_six_dates_are_smoothed_and_not_refused():
    # A straight line is fitted exactly by a quadratic, whatever the window.
    y = np.linspace(0.2, 0.7, 6)
    assert np.allclose(phenology._smooth(y), y)


def test_an_outlier_is_pulled_in_rather_than_passed_through():
    y = np.array([0.3, 0.3, 0.3, 0.9, 0.3, 0.3])
    assert phenology._smooth(y)[3] < 0.9


def test_states_are_assigned_for_six_dates():
    states = phenology.assign_states_from_ndvi(np.array([0.2, 0.4, 0.7, 0.8, 0.5, 0.3]))
    assert len(states) == 6
