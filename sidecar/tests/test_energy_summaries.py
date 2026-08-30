"""
The two summaries the energy actions used to assemble inside json.dumps.

A point resource reported by its geometry and yield, and the assumptions block
the plant response repeats at its top level. Both computed inside a dict
literal, where a division, a capacity factor and a restatement that can
disagree with its own source were unreachable by any test.
"""

from __future__ import annotations

import pytest

from terra.energy import pv, pv_plant

BEST = {'tilt_deg': 22.4, 'poa_kwh_m2_year': 2100.0}


def point(**over):
    args = dict(yield_year=1700.0, pr_applied=0.83, pr_source='reference',
                pr_modelled=0.877, n_years=10)
    args.update(over)
    return pv.summarise_point(BEST, 1900.0, {'band_deg': 5}, 0.0, **args)


def test_the_gain_is_against_the_horizontal_plane():
    out = point()

    assert out['geometry']['gain_over_horizontal_pct'] == pytest.approx(
        100.0 * (2100.0 / 1900.0 - 1.0), abs=1e-2)


def test_no_horizontal_total_reports_no_gain_rather_than_dividing_by_zero():
    """
    A polar winter, or a record that returned no radiation. A run that got this
    far has a resource answer worth returning, and the division is the only
    thing that cannot be done.
    """
    out = pv.summarise_point(BEST, 0.0, None, 0.0, yield_year=1700.0,
                             pr_applied=0.83, pr_source='reference',
                             pr_modelled=0.877, n_years=10)

    assert out['geometry']['gain_over_horizontal_pct'] == 0.0


def test_the_capacity_factor_is_the_yield_over_the_hours_in_a_year():
    """What makes a site comparable with a plant of any size."""
    out = point(yield_year=1752.0)

    assert out['pv']['capacity_factor_pct'] == pytest.approx(20.0, abs=1e-2)


def test_both_ratios_are_reported_so_the_assumption_is_visible():
    out = point()

    assert out['pv']['performance_ratio'] == 0.83
    assert out['pv']['performance_ratio_modelled'] == 0.877
    assert out['pv']['performance_ratio_source'] == 'reference'


RATIO = {'applied': 0.83, 'applied_source': 'reference', 'modelled': 0.8771234567,
         'derived': 0.8412345678, 'degradation_factor': 0.94}
DENSITY = {'value_mw_dc_per_ha': 0.6543210987}


def assumptions(**over):
    args = dict(reporting_basis='lifetime_mean', degradation_rate=0.005,
                analysis_period=25, module_type='premium', gamma_pdc=-0.0035,
                gcr_fixed=0.4, gcr_tracker=0.33, density_basis='mw_dc',
                shading_applied=True, shading_derate=0.98)
    args.update(over)
    return pv_plant.assumptions(RATIO, DENSITY, **args)


def test_the_block_echoes_the_ratio_record_rather_than_recomputing_it():
    """
    resolve_performance_ratio is where a ratio is decided. Three products
    computing a yield from three different ratios would disagree on the same
    screen with no visible cause.
    """
    out = assumptions()

    assert out['performance_ratio_applied'] == RATIO['applied']
    assert out['performance_ratio_source'] == RATIO['applied_source']
    assert out['degradation_factor'] == RATIO['degradation_factor']


def test_the_derived_and_modelled_ratios_are_reported_to_six_places():
    out = assumptions()

    assert out['performance_ratio_modelled'] == 0.877123
    assert out['performance_ratio_derived'] == 0.841235


def test_the_note_says_a_figure_copied_out_alone_is_not_interpretable():
    assert 'not interpretable' in assumptions()['note']


def test_the_reporting_basis_travels_with_the_figures():
    """
    Degradation is a basis for the whole chain, not a loss row: a lifetime-mean
    yield cannot be read against a year-one exceedance band.
    """
    assert assumptions(reporting_basis='year_one')['reporting_basis'] == 'year_one'
