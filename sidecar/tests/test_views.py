"""The composition kinds that are computed here: components, clusters, change, median, canopy."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from terra.imagery import composite as comp
from terra.scenes import decompose, median, sl2p, views


def _two_groups(n: int = 400) -> tuple[np.ndarray, np.ndarray]:
    """A stack of three bands over 20 x 20 cells: dark water on the left, bright soil on the right."""
    rng = np.random.default_rng(7)
    stack = np.empty((3, 20, 20), dtype=np.float32)
    stack[:, :, :10] = np.array([0.03, 0.02, 0.01])[:, None, None]
    stack[:, :, 10:] = np.array([0.20, 0.25, 0.30])[:, None, None]
    stack += rng.normal(0, 0.002, stack.shape).astype(np.float32)
    return stack, np.ones((20, 20), dtype=bool)


def test_the_first_component_carries_the_variance_that_separates_the_two_halves():
    stack, mask = _two_groups()
    pcs = decompose.principal_components(stack, mask)
    assert pcs.explained[0] > 0.9
    left, right = pcs.scores[0][:, :10].mean(), pcs.scores[0][:, 10:].mean()
    assert np.sign(left) != np.sign(right)


def test_components_are_the_same_every_time():
    stack, mask = _two_groups()
    a = decompose.principal_components(stack, mask)
    b = decompose.principal_components(stack, mask)
    assert np.array_equal(a.scores, b.scores, equal_nan=True)


def test_two_clusters_split_the_two_halves_and_number_the_larger_first():
    stack, mask = _two_groups()
    mask[:, :3] = False  # the left group is now the smaller
    labels = decompose.kmeans(stack, mask, 2)
    assert set(np.unique(labels[mask])) == {0, 1}
    assert np.all(labels[:, 10:] == 0)
    assert np.all(labels[:, 3:10] == 1)
    assert np.all(labels[~mask] == -1)


def test_clusters_are_the_same_every_time():
    stack, mask = _two_groups()
    assert np.array_equal(decompose.kmeans(stack, mask, 3), decompose.kmeans(stack, mask, 3))


def test_the_cluster_legend_gives_each_groups_share_and_area():
    stack, mask = _two_groups()
    view = views.cluster_view(stack, mask, 2, cell_ha=0.01)
    entries = view.meta['legend']['entries']
    assert [e['pct'] for e in entries] == [50.0, 50.0]
    assert [e['area_ha'] for e in entries] == [2.0, 2.0]
    assert entries[0]['color'] == comp.CATEGORICAL[0]


def test_no_change_is_drawn_white_and_the_scale_is_symmetric():
    before = np.full((4, 4), 0.5, dtype=np.float32)
    after = before.copy()
    after[0, 0] = 0.1  # one cell fell
    after[3, 3] = 0.9  # one rose by the same amount
    mask = np.ones((4, 4), dtype=bool)
    view = views.change_view(before, after, mask, 'NDVI', '2026-01-10', '2026-07-31')
    white = comp.scaled_to_rgba(np.array([[0.5]]), np.array([[True]]), 'rdbu')[0, 0]
    assert tuple(view.rgba[1, 1]) == tuple(white)
    fell, rose = view.rgba[0, 0, :3].astype(int), view.rgba[3, 3, :3].astype(int)
    assert fell[0] > fell[2] and rose[2] > rose[0]  # red for a fall, blue for a rise
    assert view.values is not None and view.values[0, 0] == pytest.approx(-0.4)


def test_the_change_scale_ignores_the_most_extreme_two_percent():
    diff = np.zeros(1000, dtype=np.float32)
    diff[:10] = 5.0  # one per cent of cells far off
    diff[10:] = np.linspace(-0.2, 0.2, 990)
    assert views.change_scale(diff, np.ones(1000, dtype=bool)) == pytest.approx(0.2, abs=0.01)


def test_a_water_index_is_read_only_where_mndwi_finds_water():
    spec = comp.COMPOSITE_INDICES['ndci']
    shape = (2, 2)
    red_edge = np.full(shape, 0.05, dtype=np.float32)
    red = np.full(shape, 0.04, dtype=np.float32)
    green = np.array([[0.08, 0.08], [0.05, 0.05]], dtype=np.float32)
    swir1 = np.array([[0.01, 0.01], [0.20, 0.20]], dtype=np.float32)  # water on top, land below
    _, mask = views.index_values(spec, [red_edge, red], np.ones(shape, dtype=bool), green, swir1)
    assert mask.tolist() == [[True, True], [False, False]]


def test_a_water_index_without_the_bands_to_find_water_is_refused():
    spec = comp.COMPOSITE_INDICES['ndti']
    a = np.ones((1, 1), dtype=np.float32)
    with pytest.raises(ValueError, match='B03 and B11'):
        views.index_values(spec, [a, a], np.ones((1, 1), dtype=bool))


def test_the_median_ignores_dates_a_cell_was_not_seen():
    layers = np.array(
        [[[0.1, np.nan]], [[0.3, np.nan]], [[0.2, 0.5]]], dtype=np.float32
    )
    out = median.median_ignoring_gaps(layers)
    assert out[0, 0] == pytest.approx(0.2) and out[0, 1] == pytest.approx(0.5)


def test_a_cell_never_seen_has_no_median():
    layers = np.full((3, 1, 1), np.nan, dtype=np.float32)
    assert np.isnan(median.median_ignoring_gaps(layers)[0, 0])


def test_a_canopy_variable_is_drawn_on_a_fixed_scale_in_the_units_shown():
    rows = np.loadtxt(Path(__file__).parent / 'data' / 'sl2p_snap_cases_S2A.csv', delimiter=',')
    case = rows[1]  # LAI 5.33, LAI_Cab 294 ug/cm2 in SNAP's cases
    reflectance = np.broadcast_to(case[:8, None, None], (8, 2, 2)).copy()
    mask = np.ones((2, 2), dtype=bool)
    view = views.biophysical_view(reflectance, mask, case[8:11], 'S2A', 'ccc', None)
    assert view.values is not None
    assert view.values[0, 0] == pytest.approx(case[14] * 0.01, rel=1e-3)  # g/m2
    assert view.meta['legend']['high'] == '6 g/m²'


def test_a_sentinel_2c_scene_says_which_network_ran_on_it():
    sensor, note = sl2p.sensor_for('Sentinel-2C')
    reflectance = np.full((8, 1, 1), 0.1)
    view = views.biophysical_view(
        reflectance, np.ones((1, 1), dtype=bool), np.ones(3), sensor, 'lai', note, 'Sentinel-2C'
    )
    legend = view.meta['legend']
    assert 'Sentinel-2C' in legend['note']
    assert {'label': 'Network', 'value': 'SL2P S2A on S2C'} in legend['rows']


def test_a_scene_with_its_own_network_names_only_that_network():
    view = views.biophysical_view(
        np.full((8, 1, 1), 0.1), np.ones((1, 1), dtype=bool), np.ones(3), 'S2B', 'lai', None, 'Sentinel-2B'
    )
    assert {'label': 'Network', 'value': 'SL2P S2B'} in view.meta['legend']['rows']
