"""Management zones: the clustering and its indices, without the network."""

from __future__ import annotations

import numpy as np
import pytest

from terra.zones import actions, cluster, seasons


def three_groups(n: int = 300, seasons_: int = 4, spread: float = 0.05) -> tuple[np.ndarray, np.ndarray]:
    """Cells of three levels, each level the same in every season, with noise."""
    rng = np.random.default_rng(1)
    truth = np.repeat([0, 1, 2], n)
    levels = np.array([0.6, 0.75, 0.9])[truth]
    x = levels[:, None] + rng.normal(0, spread, size=(3 * n, seasons_))
    return x, truth


def test_the_indices_at_their_two_extremes():
    crisp = np.eye(3)[np.repeat([0, 1, 2], 10)]
    even = np.full((30, 3), 1 / 3)
    assert cluster.fpi(crisp) == pytest.approx(0.0)
    assert cluster.fpi(even) == pytest.approx(1.0)
    assert cluster.nce(crisp) == pytest.approx(0.0)
    assert cluster.nce(even) == pytest.approx(np.log(3) * 30 / 27)


def test_three_levels_come_out_as_three_zones():
    x, truth = three_groups()
    z = cluster.standardise(x)
    parts = {c: cluster.fuzzy_c_means(z, c) for c in (3, 4, 5)}
    labels = parts[3].u.argmax(axis=1)
    # Each true level falls in one zone, whatever its number, but for the few
    # cells the noise (sd 0.05 against levels 0.15 apart) carries across.
    zone_of = []
    for level in range(3):
        counts = np.bincount(labels[truth == level], minlength=3)
        assert counts.max() >= 0.98 * counts.sum()
        zone_of.append(int(counts.argmax()))
    assert len(set(zone_of)) == 3
    assert cluster.suggest(parts) == 3
    assert parts[3].fpi < parts[5].fpi


def test_float32_layers_near_a_centre_do_not_overflow():
    # NDVI layers arrive as float32. A cell on a centre has a squared distance
    # near zero, which raised to -1/(m-1) overflowed float32 into NaN.
    x, _ = three_groups()
    z = cluster.standardise(x.astype(np.float32))
    p = cluster.fuzzy_c_means(z, 3)
    assert np.isfinite(p.u).all()
    assert np.isfinite(p.fpi) and np.isfinite(p.nce)


def test_a_repeated_run_gives_the_same_zones():
    x, _ = three_groups()
    z = cluster.standardise(x)
    a = cluster.fuzzy_c_means(z, 4).u.argmax(axis=1)
    b = cluster.fuzzy_c_means(z, 4).u.argmax(axis=1)
    assert (a == b).all()


def test_a_season_layer_needs_enough_clear_dates():
    clear = np.full((2, 2), 0.8, dtype=np.float32)
    cloudy = np.full((2, 2), np.nan, dtype=np.float32)
    cloudy_some = clear.copy()
    cloudy_some[0, 0] = np.nan
    layer, count = seasons.season_layer([clear, clear, cloudy_some, cloudy])
    assert count[0, 0] == 2 and np.isnan(layer[0, 0])
    assert count[1, 1] == 3 and layer[1, 1] == pytest.approx(0.8)


def test_the_windows_are_the_period_and_the_seasons_before_it():
    assert seasons.windows('2025-10-01', '2026-03-31', 2) == [
        ('2025-10-01', '2026-03-31'),
        ('2024-10-01', '2025-03-31'),
        ('2023-10-01', '2024-03-31'),
    ]
    assert seasons.shift_years('2024-02-29', -1) == '2023-02-28'


def test_zones_are_numbered_from_the_lowest_ndvi_and_small_patches_merged():
    shape = (40, 40)
    valid = np.ones(shape, dtype=bool)
    labels2d = np.zeros(shape, dtype=np.int64)
    labels2d[:, 20:] = 1
    labels2d[5:7, 5:7] = 1  # a 4-cell patch, 0.04 ha, inside the other zone
    labels = labels2d[valid]
    # Cluster 1 is the lower NDVI, so it becomes zone 1.
    order = np.array([1, 0])
    raster = actions.zone_raster(labels, valid, shape, order)
    assert raster[0, 30] == 1 and raster[0, 0] == 2
    assert raster[5, 5] == 2  # the patch merged into its surroundings
