"""
Analytic checks on the HAND chain: cases whose answer is known on paper.

These are the five self-checks the study E-hand-flood-baseline runs under
__main__, moved into the suite. There they were printed by a developer who
chose to run the module; here they run on every push, which is the point of
moving them. A terrain algorithm has no reference implementation to diff
against, so a case with a closed-form answer is the only check that is not
another opinion.
"""

import numpy as np
import pytest

from terra.terrain import hand


def test_flow_accumulation_on_a_plane_grows_by_one_per_row():
    """
    A ramp descending south: the flow is a column, accumulation grows linearly.

    Every cell drains into the one below it, so accumulation on row i must be
    exactly i+1. Any tie broken sideways, any border cell draining inward,
    shows up here as a column that does not count.
    """
    H, W = 20, 12
    z = np.tile(np.arange(H, 0, -1, dtype=float)[:, None], (1, W)) * 10.0

    r = hand.compute(z, dx=30.0, dy=30.0, drainage_km2=1e9)

    expected = np.tile(np.arange(1, H + 1)[:, None], (1, W - 2))
    # The two outer columns are excluded: their neighbours outside the domain
    # are the +inf frame, so they are outlets by construction and count only
    # themselves.
    assert np.array_equal(r["acc"][:, 1:-1], expected)


def test_filling_a_closed_depression_leaves_no_interior_minimum():
    """A 40 m pit: after filling, no cell is lower than all its neighbours."""
    z = np.tile(np.arange(30, 0, -1, dtype=float)[:, None], (1, 30)) * 5.0
    z[14:17, 14:17] -= 40.0

    zf = hand.fill_depressions(z)

    padded = np.full((32, 32), np.inf)
    padded[1:-1, 1:-1] = zf
    lower = np.zeros_like(zf, bool)
    for di, dj in hand.D8:
        lower |= padded[1 + di:31 + di, 1 + dj:31 + dj] < zf
    interior_pits = int((~lower[1:-1, 1:-1]).sum())

    assert interior_pits == 0
    # And the pit rose rather than the surface around it falling: filling must
    # add material, never carve.
    assert zf[14:17, 14:17].min() > z[14:17, 14:17].min()


def test_accumulation_at_the_outlets_accounts_for_every_cell():
    """
    Water does not disappear.

    Whatever the terrain, the accumulation summed over the outlets has to equal
    the cell count. A cell lost to a cycle, or counted twice by a receiver
    resolved out of order, breaks this and almost nothing else.
    """
    rng = np.random.default_rng(7)
    z = 100 + rng.normal(0, 3, (40, 40)).cumsum(axis=0) * 0.1

    r = hand.compute(z, dx=30.0, dy=30.0, drainage_km2=1e9)

    outlets = r["receivers"] < 0
    assert int(r["acc"].ravel()[outlets].sum()) == z.size


def test_hand_in_a_v_valley_is_the_height_above_the_thalweg():
    """
    A V-shaped valley, where HAND is known in closed form.

    The terrain drops 1 m per column towards the centre and 1 cm per row along
    it. The drainage is the central column, so a cell k columns from the centre
    sits exactly k metres above it -- and that is what HAND must return.
    """
    H, W = 40, 41
    centre = W // 2
    across = np.abs(np.arange(W) - centre).astype(float)
    along = np.arange(H, 0, -1, dtype=float) * 0.01
    z = 100.0 + across[None, :] + along[:, None]

    r = hand.compute(z, dx=30.0, dy=30.0, drainage_km2=0.02)

    # The first and last two rows are excluded: the valley has no upstream end
    # inside the domain, so the drainage there is decided by the border.
    err = np.abs(r["hand"][2:H - 2, :] - across[None, :])
    assert float(err.max()) < 0.05


def test_every_drainage_cell_has_hand_zero():
    """The definition, checked: a drainage cell is its own reference."""
    rng = np.random.default_rng(3)
    z = 200 - np.arange(50)[:, None] * 2.0 + rng.normal(0, 1.5, (50, 50))

    r = hand.compute(z, dx=30.0, dy=30.0, drainage_km2=0.05)

    assert r["drainage"].sum() > 0, "the threshold selected no drainage at all"
    assert np.all(r["hand"][r["drainage"]] == 0)


# NOT COVERED, AND THE ATTEMPT IS WORTH RECORDING. hand() documents that a cell
# inside a filled depression reports a negative height rather than a clipped
# zero, and that property matters here: the envelope thresholds HAND at 1 m,
# where a depression raised to zero would read as dry ground. Three synthetic
# terrains failed to exhibit it -- a pit on a ramp sits 25 m above its drainage
# and reports positive; a pit dug into the thalweg and a pit on the flank both
# collect enough flow to become drainage themselves, which is HAND zero by
# definition. Any depression deep enough to fall below the channel also gathers
# enough area to cross the threshold. Exhibiting it needs a real DEM, so the
# claim rests on reading hand() rather than on a test.


def test_a_cycle_in_the_flow_graph_is_reported_and_not_worked_around():
    """
    topological_order raises rather than returning a partial order.

    Reached by handing it a receiver map with a two-cell loop, which
    fill_depressions cannot produce. The value of the check is that a partial
    order would still run: accumulation would complete, HAND would come back,
    and the cells in the cycle would carry whatever the initialisation left.
    """
    receivers = np.array([1, 0, -1, 2], dtype=np.int64)

    with pytest.raises(ValueError, match="cycle"):
        hand.topological_order(receivers)


def test_pixel_size_shrinks_with_latitude():
    """
    dx follows the cosine of the latitude and dy does not.

    A product that compares DEM products cell by cell converts a drainage area
    in square kilometres into a cell count, so getting this wrong changes the
    drainage network rather than merely the units.
    """
    dx_eq, dy_eq = hand.pixel_size_m(0.0, 1 / 3600, 1 / 3600)
    dx_60, dy_60 = hand.pixel_size_m(60.0, 1 / 3600, 1 / 3600)

    assert dy_eq == pytest.approx(dy_60)
    assert dx_60 == pytest.approx(dx_eq * 0.5, rel=1e-3)
