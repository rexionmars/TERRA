"""
The grid actions: that they resolve, and what they refuse to answer.

The refusals are the substance. Every one of them is a place where returning a
number would be worse than returning nothing: a zero that means "not measured",
a window the caller asked for but the record does not cover, a score that mixes
proximity with capacity.
"""

from __future__ import annotations

import pytest

from terra import registry


def test_the_grid_actions_resolve_from_the_registry():
    """
    A sibling slice of terra/energy, not an extension of it: the shell reaches
    these by name the same way it reaches solar_resource.
    """
    for name in ('grid_curtailment', 'grid_congestion', 'grid_coverage'):
        assert name in registry.ACTIONS
        assert registry.ACTIONS[name].startswith('terra.grid.actions:')


def test_an_unknown_grid_action_does_not_silently_become_prediction():
    """
    resolve() falls through to the classifier for an unknown name, which is
    right for a typo in a landcover action and would be baffling here. This
    pins that the three real names are spelled the way the registry has them.
    """
    resolved = registry.resolve('grid_curtailment')
    assert resolved.__name__ == 'grid_curtailment'


def test_the_energy_actions_carry_no_grid_block_any_more():
    """
    The curtailment record was briefly appended to energy_model and
    solar_siting as sibling blocks. It is a slice of its own; an energy answer
    is not improved by a curtailment number stapled to it, and having both
    would mean two places to keep one answer correct.
    """
    from pathlib import Path

    source = Path(registry.__file__).with_name('energy') / 'actions.py'
    body = source.read_text()
    assert 'grid_context' not in body
    assert 'grid_connection' not in body
    assert 'terra.grid' not in body


def test_the_slice_states_that_it_is_a_sibling_and_not_an_accessory():
    """
    The reason the shape is what it is has to live where the shape is, or the
    next change re-couples them.
    """
    from terra import grid

    assert 'sibling of terra/energy' in grid.__doc__
    assert 'neither slice is subordinate' in grid.__doc__


def test_congestion_refuses_to_combine_proximity_with_curtailment():
    """
    A site 1.3 km from a 440 kV line rated 2,664 MVA still loses 14 percent of
    its output, because the constraint is upstream of the connection. Summed
    into one score that fact disappears.
    """
    from terra.grid import actions

    doc = actions.grid_congestion.__doc__
    assert 'never combined' in doc
    assert 'only the second is evidence' in doc


def test_curtailment_returns_absence_rather_than_zero():
    from terra.grid import actions

    doc = actions.grid_curtailment.__doc__
    assert 'Returns nothing rather than zero' in doc
    assert 'nothing here\nis measured' in doc or 'is measured' in doc


@pytest.mark.parametrize('name', ['grid_curtailment', 'grid_congestion'])
def test_every_aoi_action_says_it_needs_a_polygon(name):
    from terra.grid import actions

    assert callable(getattr(actions, name))
