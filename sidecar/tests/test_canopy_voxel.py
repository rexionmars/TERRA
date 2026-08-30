"""
The limit cases of the voxel canopy engine -- measured here, not inherited.

WHY THIS FILE IS NOT A PORT. `test_canopy.py` beside it ports a `self_check()`
the origin enforces. This module has no such guard: its limit cases are `print()`
calls in a notebook, graded by eye. Read against its own committed output, the
narrative disagrees with the numbers:

  - the notebook prints "the residual of 0.3 to 0.7% is voxelisation noise, not
    the march: refining the step from half a cell to a quarter does not move
    it" -- directly under an output line reading -2.07% at cos z = 0.7, and
    refining the step does move it, to +0.44%;
  - the module docstring says a half-cell step keeps the oblique error "below
    0.5%", where at the notebook's own cell size it is 2.07%;
  - the handoff that asked for this port quotes "error < 0.7%" and proposes
    those cases as the acceptance bar for the WebGL shader.

Adopting any of those would have written a check that does not check. So the
error was re-measured, and what it actually is turns out to be simpler and
sharper than any of the three claims.

WHAT THE ERROR IS. The march accumulates a whole number of fixed steps, so it
quantises the optical path: it charges ceil(M - 0.5) steps for a path of M. The
deviation is therefore at most half a step of optical depth,

    |ln(tau_march / tau_exact)|  <=  G * rho * step / 2

and `test_march_error_fits_in_half_a_step` finds that bound saturating exactly
at 1.000 rather than merely holding. That is a bar worth giving a shader,
because it says what to do: it scales with the step and with the density, and it
does not depend on the geometry happening to be lucky.

WHY REFINING DOES NOT MONOTONICALLY HELP. Halving the step halves the BOUND, but
the realised error depends on where M falls relative to an integer. Geometries
where M lands on one are near-exact at any step -- which is why the notebook's
cos z = 1.0 and 0.4 read +0.06% and +0.09% and looked like confirmation, while
the one oblique case that did not land on an integer read -2.07%.
"""

from __future__ import annotations

import numpy as np
import pytest

import canopy_voxel as cv

SPACING = 6.0
Z_TOP = 3.0


def homogeneous(density, cell=0.30, spacing=SPACING, z_top=Z_TOP):
    """
    A canopy of exactly uniform density, with no leaves in it.

    Filling the grid directly is deliberate: dropping random leaves into cells
    adds sampling noise on top of the march, and the two error sources are what
    the origin conflated. This isolates the march.
    """
    canopy = cv.Canopy(np.zeros((0, 3)), np.zeros(0), spacing=spacing,
                       cell=cell, z_max=z_top)
    canopy.grid[:] = density
    return canopy


def ground_points(n=2000, seed=0, spacing=SPACING):
    rng = np.random.default_rng(seed)
    return np.stack([rng.uniform(0, spacing, n), rng.uniform(0, spacing, n),
                     np.full(n, 1e-3)], axis=1)


def direction(cos_zenith):
    return np.array([0.0, np.sqrt(1.0 - cos_zenith ** 2), cos_zenith])


# ---------------------------------------------------------------------------
# The bar
# ---------------------------------------------------------------------------

def test_march_error_fits_in_half_a_step():
    """
    Across cell size, density, step and sun angle, the march never deviates
    from Beer-Lambert by more than half a step of optical depth.

    This is the acceptance bar for anything that reimplements this extinction
    elsewhere -- the shader in particular. It is stated as a ratio to the bound
    rather than as a percentage precisely because a percentage is what went
    wrong: 2% is not a property of the method, it is a property of one geometry
    at one step size.
    """
    points = ground_points()
    worst = 0.0
    worst_case = None

    for cell in (0.15, 0.30, 0.50):
        for density in (1 / 3, 2 / 3, 4 / 3):
            canopy = homogeneous(density, cell=cell)
            for step_frac in (1.0, 0.5, 0.25):
                bound = cv.G_LEAF * density * (cell * step_frac) / 2
                for cos_zenith in (0.95, 0.8, 0.7, 0.55, 0.4, 0.3, 0.2):
                    got = float(canopy.transmittance(
                        points, direction(cos_zenith), step_frac=step_frac).mean())
                    exact = float(np.exp(
                        -cv.G_LEAF * density * canopy.z_top / cos_zenith))
                    ratio = abs(np.log(got / exact)) / bound
                    if ratio > worst:
                        worst, worst_case = ratio, (cell, density, step_frac, cos_zenith)

    assert worst <= 1.0 + 1e-9, (
        f"march exceeded half a step at cell/density/step_frac/cos z = {worst_case}: "
        f"{worst:.3f} of the bound")
    # And it does saturate, so the bound is tight rather than generous. If this
    # ever falls well below 1, the march changed and the bound is now describing
    # something else.
    assert worst > 0.9, f"bound no longer tight ({worst:.3f}); the march changed"


@pytest.mark.parametrize("cos_zenith", [1.0, 0.4])
def test_geometries_that_land_on_a_whole_step_are_near_exact(cos_zenith):
    """
    When the optical path is an exact multiple of the step, quantisation has
    nothing to round and the march reproduces Beer-Lambert to machine noise.

    These are the two angles the notebook happened to pick alongside 0.7, and
    they are why the method looked verified. Kept here to show that passing
    them proves nothing about the oblique case.
    """
    canopy = homogeneous(2 / 3, cell=0.30)
    steps = canopy.z_top / (0.30 * 0.5 * cos_zenith)
    assert steps == pytest.approx(round(steps)), "this angle is aligned by construction"

    got = float(canopy.transmittance(ground_points(), direction(cos_zenith)).mean())
    exact = float(np.exp(-cv.G_LEAF * (2 / 3) * canopy.z_top / cos_zenith))
    np.testing.assert_allclose(got, exact, rtol=1e-9)


def test_oblique_case_reproduces_the_origins_number():
    """
    The notebook's own cell 15, re-run: 400k leaves, LAI 2, 6 m module, 30 cm
    cells, half-cell steps. The committed output reads 0.234701 at cos z = 0.7,
    a deviation of -2.07%, and this reproduces it to six figures.

    Two things are pinned at once. That the mirrored module still computes what
    the origin computed -- the point of a mirror. And the actual size of the
    oblique error at that configuration, so that the "< 0.7%" in the handoff
    cannot be quoted at a shader as though it had been measured.
    """
    rng = np.random.default_rng(0)
    n = 400_000
    leaves = np.stack([rng.uniform(0, SPACING, n), rng.uniform(0, SPACING, n),
                       rng.uniform(0, Z_TOP, n)], axis=1)
    lai = 2.0
    canopy = cv.Canopy(leaves, np.full(n, lai * SPACING ** 2 / n),
                       spacing=SPACING, cell=0.30, z_max=Z_TOP)
    points = np.stack([rng.uniform(0, SPACING, 20_000),
                       rng.uniform(0, SPACING, 20_000),
                       np.full(20_000, 1e-3)], axis=1)

    got = float(canopy.transmittance(points, direction(0.7)).mean())
    np.testing.assert_allclose(got, 0.234701, rtol=0, atol=5e-7)

    exact = float(np.exp(-cv.G_LEAF * lai / 0.7))
    deviation = 100 * (got / exact - 1)
    assert -2.2 < deviation < -1.9, f"expected the origin's -2.07%, got {deviation:+.2f}%"


def test_refining_the_step_moves_the_oblique_error():
    """
    The notebook asserts refining from half a cell to a quarter "does not move
    it". At the oblique angle it moves it from -2.07% to about +0.4%, sign
    included -- because a quarter step lands on the other side of the nearest
    whole step.

    The claim mattered: it was the stated reason for believing the residual was
    voxelisation noise rather than the march.
    """
    canopy = homogeneous(2 / 3, cell=0.30)
    points = ground_points()
    exact = float(np.exp(-cv.G_LEAF * (2 / 3) * canopy.z_top / 0.7))

    half = float(canopy.transmittance(points, direction(0.7), step_frac=0.5).mean())
    quarter = float(canopy.transmittance(points, direction(0.7), step_frac=0.25).mean())

    assert 100 * (half / exact - 1) < -1.5
    assert 100 * (quarter / exact - 1) > 0.0
    assert abs(half - quarter) > 0.004, "refining the step changed nothing; march changed"


# ---------------------------------------------------------------------------
# Structure
# ---------------------------------------------------------------------------

def test_empty_canopy_transmits_everything():
    """No leaves, no extinction. Exactly one, not nearly one."""
    canopy = cv.Canopy(np.zeros((0, 3)), np.zeros(0), spacing=SPACING,
                       cell=0.30, z_max=Z_TOP)
    got = canopy.transmittance(np.array([[3.0, 3.0, 0.0]]), np.array([0.0, 0.0, 1.0]))
    assert got.tolist() == [1.0]


def test_sun_at_or_below_the_horizon_transmits_nothing():
    """
    The guard returns zero rather than dividing by a vanishing cosine. Worth
    pinning because it is a discontinuity: at cos z = 1e-2 the march still runs
    and returns a very small number, and one step further it returns exactly
    zero by a different code path.
    """
    canopy = homogeneous(1.0)
    point = np.array([[3.0, 3.0, 0.0]])

    at_horizon = canopy.transmittance(point, np.array([1.0, 0.0, 1e-9]))
    assert at_horizon.tolist() == [0.0]

    just_above = canopy.transmittance(point, np.array([np.sqrt(1 - 1e-4), 0.0, 0.01]))
    assert 0.0 < float(just_above[0]) < 1e-4


def test_grid_preserves_the_leaf_area_it_was_given():
    """
    Integrating the density grid back over its volume returns the leaf area that
    went in. The origin checks this and it holds exactly -- voxelisation moves
    leaf area around, it does not create or destroy it.

    Which is the point worth keeping separate: the -2% oblique deviation is NOT
    lost leaf area, so no amount of checking LAI recovery would have caught it.
    """
    rng = np.random.default_rng(0)
    lai = 2.0
    leaves = rng.uniform(0, 1, (1000, 3)) * np.array([SPACING, SPACING, Z_TOP])
    canopy = cv.Canopy(leaves, np.full(1000, lai * SPACING ** 2 / 1000),
                       spacing=SPACING, cell=0.30, z_max=Z_TOP)

    np.testing.assert_allclose(canopy.lai_ground, lai, rtol=0, atol=1e-12)
    integrated = canopy.grid.sum() * canopy.cell ** 3 / SPACING ** 2
    np.testing.assert_allclose(integrated, lai, rtol=1e-12)


def test_orchard_is_periodic_so_a_ray_returns_on_the_opposite_side():
    """
    A ray leaving the module re-enters it, which is what represents an infinite
    orchard without replicating a tree.

    Density is confined to a strip near x = 0 and the ray starts at x = 5.5
    heading towards +x at a shallow angle. Inside a single finite module it
    would exit into open air and be fully transmitted; wrapping is the only way
    it meets the strip.
    """
    canopy = cv.Canopy(np.zeros((0, 3)), np.zeros(0), spacing=SPACING,
                       cell=0.30, z_max=Z_TOP)
    canopy.grid[0:2, :, :] = 5.0

    shallow = np.array([np.sqrt(1 - 0.3 ** 2), 0.0, 0.3])
    start = np.array([[5.5, 3.0, 0.0]])
    got = float(canopy.transmittance(start, shallow)[0])

    assert got < 0.1, f"ray never wrapped into the strip (tau={got:.4f})"


def test_ground_shadow_is_a_square_map_of_transmittance():
    """The projected-shadow map is the same march from the ground, reshaped."""
    canopy = homogeneous(2 / 3)
    shadow = canopy.ground_shadow(direction(0.7), n=24)

    assert shadow.shape == (24, 24)
    assert np.all((shadow >= 0.0) & (shadow <= 1.0))
    # Uniform density means a uniform shadow, up to the grid it marches through.
    assert shadow.std() < 1e-9, "uniform canopy cast a non-uniform shadow"
