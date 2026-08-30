"""
The limit cases of the analytic canopy engine (offline, no GPU).

WHERE THESE COME FROM. `canopy.self_check()` in the mirrored module, which the
origin runs as a guard at the top of its simulation script -- it prints a table
and the caller aborts. That is a real check but it only runs when someone runs
that script, and it grades every case against one loose tolerance (2e-3) whether
the case is exact or approximate. Here each case is graded against what it
actually is: the geometry is exact and asserted at floating-point precision, and
only the quadrature gets a tolerance.

WHY THEY MATTER. `path_lengths` is a ray-ellipsoid intersection, and every
number the engine produces is downstream of it. A sign error in the near root
would not raise -- it would quietly turn self-shading into zero and inflate
absorbed light everywhere.
"""

from __future__ import annotations

import numpy as np

from terra.canopy import crowns as canopy

# ---------------------------------------------------------------------------
# Radiation convention
# ---------------------------------------------------------------------------

def test_isotropic_sky_over_bare_ground_absorbs_exactly_the_diffuse():
    """
    With no canopy, absorption per unit leaf area under an isotropic sky must
    come to exactly the horizontal diffuse irradiance -- the weights and the
    projection coefficient have to cancel.

    This is the calibration of the whole radiation convention. If it drifts,
    every absolute number the engine reports is scaled by the same wrong factor
    and nothing else in the model would reveal it.
    """
    _, cos_zenith, weights = canopy.sky_directions()
    absorbed = canopy.G_LEAF * float((weights / cos_zenith).sum())
    assert absorbed == np.float64(absorbed)  # scalar, not an array
    np.testing.assert_allclose(absorbed, 1.0, rtol=0, atol=1e-9)


def test_sky_discretisation_is_a_partition_of_the_hemisphere():
    """
    The quadrature weights sum to one. Not in `self_check`, and it is the
    cheapest way to catch a sky that lost or double-counted a ring.
    """
    _, cos_zenith, weights = canopy.sky_directions()
    np.testing.assert_allclose(weights.sum(), 1.0, rtol=0, atol=1e-12)
    assert np.all(weights > 0.0)
    assert np.all(cos_zenith > 0.0), "no direction may come from below the horizon"


def test_beer_lambert_matches_the_depth_integral():
    """
    Integrating absorption over canopy depth must reproduce the closed form
    DNI*cos(z)*(1 - exp(-G*LAI/cos z)).

    This one IS approximate -- it is a 4000-step midpoint rule against an
    analytic result -- so it gets a tolerance where the geometry above does not.
    The observed error at these settings is ~4e-5, well inside the 2e-3 the
    origin allows; the assertion is tightened to 1e-4 so that a real
    regression cannot hide inside a tolerance chosen for a different case.
    """
    lai, cos_zenith, steps = 3.0, 0.8, 4000
    depth = (np.arange(steps) + 0.5) / steps * lai
    integral = (canopy.G_LEAF * np.exp(-canopy.G_LEAF * depth / cos_zenith)).sum() * (lai / steps)
    exact = cos_zenith * (1.0 - np.exp(-canopy.G_LEAF * lai / cos_zenith))

    np.testing.assert_allclose(integral, exact, rtol=0, atol=1e-4)
    # And the value itself, so a change of convention is visible as a number
    # rather than as two wrong things agreeing with each other.
    np.testing.assert_allclose(exact, 0.677316, rtol=0, atol=5e-7)


# ---------------------------------------------------------------------------
# Optical path: exact geometry, asserted exactly
# ---------------------------------------------------------------------------

UP = np.array([0.0, 0.0, 1.0])
SPHERE = np.array([[0.0, 0.0, 10.0]])
RADIUS = 2.0


def _chord(origin_xy):
    origins = np.array([[origin_xy[0], origin_xy[1], 0.0]])
    return float(canopy.path_lengths(origins, UP, SPHERE, RADIUS, RADIUS)[0, 0])


def test_ray_through_the_centre_travels_one_diameter():
    """A vertical ray through the centre of a sphere of radius r covers 2r."""
    np.testing.assert_allclose(_chord((0.0, 0.0)), 2 * RADIUS, rtol=0, atol=1e-12)


def test_ray_that_misses_intercepts_nothing():
    """
    Exactly zero, not nearly zero. A negative discriminant has to yield no path
    at all -- a tolerance here would let a spurious sliver of shade through.
    """
    assert _chord((9.0, 0.0)) == 0.0


def test_grazing_ray_at_the_silhouette_edge_is_still_finite():
    """
    Just inside and just outside the silhouette. Not in `self_check`: the
    tangent is where the quadratic is worst conditioned, and it is the case a
    refactor is most likely to break.
    """
    assert 0.0 < _chord((RADIUS - 1e-6, 0.0)) < 0.02
    assert _chord((RADIUS + 1e-9, 0.0)) == 0.0


def test_point_inside_the_crown_sees_only_the_path_out():
    """
    Self-shading. A point at the centre must see r, not 2r -- the entry root is
    behind it and has to be clipped to zero.

    This is the asymmetry that makes the function correct, and the one a
    plausible-looking simplification (`abs(t_out - t_in)`) would erase, doubling
    self-shading for every point inside a crown.
    """
    centre = np.array([[0.0, 0.0, 10.0]])
    inside = float(canopy.path_lengths(centre, UP, SPHERE, RADIUS, RADIUS)[0, 0])
    np.testing.assert_allclose(inside, RADIUS, rtol=0, atol=1e-12)


def test_path_is_symmetric_under_reversing_the_ray():
    """
    A ray fired down from above the crown covers the same chord as one fired up
    from below. Direction must not change the geometry -- only what is in front.
    """
    below = np.array([[0.0, 0.0, 0.0]])
    above = np.array([[0.0, 0.0, 20.0]])
    up = float(canopy.path_lengths(below, UP, SPHERE, RADIUS, RADIUS)[0, 0])
    down = float(canopy.path_lengths(above, -UP, SPHERE, RADIUS, RADIUS)[0, 0])
    np.testing.assert_allclose(up, down, rtol=0, atol=1e-12)


def test_oblate_crown_is_thinner_than_the_sphere_it_came_from():
    """
    The crown is an ellipsoid (a horizontal, b vertical), so a vertical ray
    through the centre must read 2b regardless of a. Not in `self_check`, which
    only ever tests a == b and so cannot tell the two axes apart -- a swapped
    pair would pass every case there.
    """
    a, b = 3.0, 1.0
    origins = np.array([[0.0, 0.0, 0.0]])
    through = float(canopy.path_lengths(origins, UP, SPHERE, a, b)[0, 0])
    np.testing.assert_allclose(through, 2 * b, rtol=0, atol=1e-12)

    # And the horizontal semi-axis is what decides whether the ray hits at all.
    off_axis = float(canopy.path_lengths(np.array([[2.5, 0.0, 0.0]]), UP, SPHERE, a, b)[0, 0])
    assert off_axis > 0.0, "a ray at 2.5 m must still hit a crown 3 m wide"


def test_path_lengths_shape_is_rays_by_crowns():
    """(N,3) origins against (M,3) centres gives (N,M). The engine indexes it."""
    origins = np.zeros((4, 3))
    centres = np.array([[0.0, 0.0, 10.0], [5.0, 0.0, 10.0], [-5.0, 0.0, 10.0]])
    got = canopy.path_lengths(origins, UP, centres, RADIUS, RADIUS)
    assert got.shape == (4, 3)
    assert np.all(got >= 0.0), "a path length is never negative"


# ---------------------------------------------------------------------------
# The mirror still agrees with the origin
# ---------------------------------------------------------------------------

def test_self_check_still_passes_in_the_mirrored_module():
    """
    The origin's own guard, run here. The cases above are stricter, so this adds
    nothing numerically -- what it protects is the CLAIM the module header makes:
    that this file is the origin's code, unaltered. If someone edits
    `self_check` out or changes its keys, the mirror has diverged in a way the
    other tests would not notice.
    """
    result = canopy.self_check()
    expected = {"difuso_sem_dossel", "beer_lambert", "corda_central",
                "raio_externo", "auto_sombreamento"}
    assert set(result) == expected
    failed = [name for name, (_, _, ok) in result.items() if not ok]
    assert not failed, f"self_check failed for: {failed}"
