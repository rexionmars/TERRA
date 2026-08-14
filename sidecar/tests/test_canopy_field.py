"""
The field builder: what it conserves, what it refuses, and what it reports.

`canopy.py` and `canopy_voxel.py` are mirrors and are tested as mirrors. This
module is not -- it is the new code where the two engines meet parameters a user
can move, so it is tested for the things a field can get wrong without looking
wrong: leaf area that does not survive voxelisation, a grid whose reported shape
does not match its contents, and a reference fixture that would pass a shader
which had the sampling convention wrong.
"""

from __future__ import annotations

import numpy as np
import pytest

import canopy_field as cf
import canopy_voxel as cv


SPACING, LAI, CELL = 6.0, 2.0, 0.30
CROWN = dict(crown_a=1.8, crown_b=1.2, crown_z=1.6)


@pytest.fixture
def field():
    return cf.ellipsoid_field(spacing=SPACING, lai=LAI, cell=CELL, **CROWN)


# ---------------------------------------------------------------------------
# What the field conserves
# ---------------------------------------------------------------------------

def test_voxelising_preserves_the_leaf_area_asked_for(field):
    """
    Integrating the density over the grid returns LAI times the ground area.

    A continuum ellipsoid does not tile into cubes, so the naive voxelisation
    lands a few percent off and the builder rescales. Without the rescale the
    canopy would hold less leaf than it claims, and since the field is compared
    against analytic Beer-Lambert elsewhere, that shortfall would read as a
    march error rather than as the bookkeeping error it is.
    """
    grid, meta = field
    integrated = grid.sum() * CELL ** 3
    np.testing.assert_allclose(integrated, LAI * SPACING ** 2, rtol=1e-12)
    np.testing.assert_allclose(meta["leaf_area"], LAI * SPACING ** 2, rtol=1e-12)


def test_the_crowns_occupy_part_of_the_module_not_all_of_it(field):
    """
    Both bounds matter. An empty field integrates to zero and would be caught
    by the test above; a field filling every cell integrates correctly and is
    still a uniform slab rather than an orchard, which is the model this exists
    to be an alternative to.
    """
    _, meta = field
    assert 0.05 < meta["occupancy"] < 0.5
    assert meta["density_in_crown"] > LAI / (CROWN["crown_b"] * 2), (
        "density inside a crown must exceed the slab average, or the crowns "
        "are not concentrating anything"
    )


def test_density_is_zero_outside_the_crowns(field):
    """
    The gaps are empty, which is what makes an orchard an orchard. A field with
    a floor of density everywhere would transmit like a slab no matter how the
    crowns were shaped.
    """
    grid, _ = field
    assert np.any(grid == 0.0)
    corner = grid[0, 0, :]
    assert np.all(corner == 0.0), "the module corner sits between crowns"


def test_a_crown_wider_than_the_spacing_wraps_instead_of_being_clipped():
    """
    Periodic images are summed rather than truncated at the module edge.

    Clipping would silently lose the leaf area that belongs to the neighbouring
    tree, and the loss would grow with crown width -- so a closed orchard, the
    case where the geometry matters most, would be the case the model was worst
    at while still integrating to the leaf area it was handed.
    """
    grid, meta = cf.ellipsoid_field(spacing=4.0, lai=3.0, cell=0.2,
                                    crown_a=2.4, crown_b=1.0, crown_z=1.4)
    np.testing.assert_allclose(grid.sum() * 0.2 ** 3, 3.0 * 4.0 ** 2, rtol=1e-12)
    assert meta["occupancy"] > 0.4, "a crown 4.8 m across in a 4 m module must overlap itself"

    # The proof of wrapping is that some cells were claimed by more than one
    # image, so their density is a whole multiple of a single crown's. Total
    # leaf area cannot show this: the builder rescales, so a version that
    # clipped at the module edge would still integrate correctly while packing
    # the same leaf into a smaller volume.
    occupied = np.unique(np.round(grid[grid > 0] / grid[grid > 0].min(), 6))
    assert occupied.max() >= 2.0, (
        f"no cell received density from two crowns (multiples seen: {occupied})")

    # The diagonal gap is still open, and that is geometry rather than a defect:
    # circular crowns on a square lattice close the corner only once the
    # horizontal semi-axis reaches spacing/sqrt(2) = 2.83 m, and this one is
    # 2.4 m. A test asserting a closed canopy here would be asserting something
    # the planting does not do.
    mid = int(1.4 / 0.2)
    assert grid[0, 0, mid] == 0.0


def test_leaf_cloud_and_ellipsoid_produce_the_same_kind_of_object():
    """
    Both sources return a grid and a meta of the same shape, so a consumer
    switches between them by reading `source` and changes nothing else.
    """
    rng = np.random.default_rng(0)
    n = 5000
    pos = rng.uniform(0, 1, (n, 3)) * np.array([SPACING, SPACING, 2.8])
    area = np.full(n, LAI * SPACING ** 2 / n)
    grid, meta = cf.leaf_cloud_field(pos, area, spacing=SPACING, cell=CELL, z_top=2.8)

    ellipsoid_meta = cf.ellipsoid_field(spacing=SPACING, lai=LAI, cell=CELL, **CROWN)[1]
    assert set(meta) - {"leaves"} <= set(ellipsoid_meta) | {"leaves"}
    assert meta["source"] == "leaves" and ellipsoid_meta["source"] == "ellipsoid"
    np.testing.assert_allclose(grid.sum() * CELL ** 3, LAI * SPACING ** 2, rtol=1e-9)


# ---------------------------------------------------------------------------
# What it refuses
# ---------------------------------------------------------------------------

def test_a_grid_too_large_is_refused_before_it_is_allocated():
    """
    A 40 m module at 1 cm cells is 6.4e9 cells, which is 51 GB of float64. The
    refusal has to happen on the arithmetic, not after the allocation, or the
    request takes the machine down instead of returning an error.
    """
    with pytest.raises(ValueError, match="cells"):
        cf.ellipsoid_field(spacing=40.0, lai=2.0, cell=0.01,
                           crown_a=3.0, crown_b=2.0, crown_z=2.0)


def test_the_refusal_names_both_numbers_that_disagree():
    """A message saying only 'too large' leaves the user guessing which of the
    two parameters to change."""
    with pytest.raises(ValueError) as excinfo:
        cf.ellipsoid_field(spacing=40.0, lai=2.0, cell=0.01,
                           crown_a=3.0, crown_b=2.0, crown_z=2.0)
    message = str(excinfo.value)
    assert "40" in message and "0.01" in message


@pytest.mark.parametrize("bad", [
    dict(spacing=0.0), dict(cell=0.0), dict(crown_a=0.0), dict(crown_b=-1.0),
])
def test_degenerate_geometry_is_refused(bad):
    params = dict(spacing=SPACING, lai=LAI, cell=CELL, **CROWN)
    params.update(bad)
    with pytest.raises(ValueError):
        cf.ellipsoid_field(**params)


def test_an_unknown_source_is_refused_by_name():
    with pytest.raises(ValueError, match="helios"):
        cf.build({"source": "helios"})


# ---------------------------------------------------------------------------
# The reference the shader is held to
# ---------------------------------------------------------------------------

def test_canopy_of_reproduces_the_grid_it_was_given(field):
    """
    Wrapping a field in the marcher must not go back through leaf positions.
    `Canopy` builds its grid from a cloud, which would re-voxelise something
    already voxelised and lose the ellipsoid's shape.
    """
    grid, meta = field
    canopy = cf.canopy_of(grid, meta)
    np.testing.assert_array_equal(canopy.grid, grid)
    np.testing.assert_allclose(canopy.leaf_area, meta["leaf_area"])
    np.testing.assert_allclose(canopy.lai_ground, LAI, rtol=1e-12)


def test_reference_cases_are_the_numpy_march_and_nothing_else(field):
    """
    The fixture must be produced by the same function the application runs, not
    by a reimplementation of it. Recomputing one sun here and comparing exactly
    is what proves that.
    """
    grid, meta = field
    canopy = cf.canopy_of(grid, meta)
    cases = cf.reference_cases(canopy, n_points=16, seed=0)

    points = np.array(cases["points"])
    sun = cases["suns"][2]
    direct = canopy.transmittance(points, np.array(sun["direction"]),
                                  step_frac=cases["step_frac"])
    np.testing.assert_allclose(sun["transmittance"], direct, rtol=0, atol=0)


def test_reference_points_are_not_on_a_lattice(field):
    """
    Points on a lattice would sample the same phase of every cell, so a shader
    whose sampling convention was off by half a cell could agree with all of
    them. The offsets within a cell have to be spread.
    """
    grid, meta = field
    cases = cf.reference_cases(cf.canopy_of(grid, meta), n_points=64, seed=0)
    phase = np.array(cases["points"])[:, 0] % CELL / CELL
    assert phase.std() > 0.2, "the sample points share a cell phase"
    assert phase.max() - phase.min() > 0.8


def test_reference_suns_include_low_and_off_axis_ones(field):
    """
    The choice of suns is what gives the fixture its power, and getting it wrong
    is the documented failure of the notebook this work came from: it checked
    cos z of 1.0, 0.7 and 0.4, two of which land on whole marching steps, and
    concluded the method was verified.

    Mutating the periodic wrap out of the GLSL march passes the overhead suns
    and fails only the low and off-axis ones, so their presence is load-bearing
    rather than decorative.
    """
    grid, meta = field
    cases = cf.reference_cases(cf.canopy_of(grid, meta), n_points=8, seed=0)
    cos_zeniths = [s["cos_zenith"] for s in cases["suns"]]
    azimuths = [s["azimuth"] for s in cases["suns"]]

    assert min(cos_zeniths) <= 0.3, "no low sun; a broken wrap would go unnoticed"
    assert sum(1 for a in azimuths if a != 0.0) >= 3, "too few off-axis suns"
    assert all(0.0 < c <= 1.0 for c in cos_zeniths)


def test_reference_carries_everything_needed_to_check_against_it(field):
    """
    A fixture whose consumer has to supply the step, the projection coefficient
    or the tolerance is a fixture that can be checked against the wrong ones.
    """
    grid, meta = field
    cases = cf.reference_cases(cf.canopy_of(grid, meta), n_points=8)
    assert cases["step_frac"] > 0
    assert cases["g_leaf"] == cv.G_LEAF
    assert cases["tolerance"] == cf.SHADER_TOLERANCE
    for sun in cases["suns"]:
        assert len(sun["direction"]) == 3
        np.testing.assert_allclose(np.linalg.norm(sun["direction"]), 1.0, atol=1e-12)
        assert sun["why"], "every sun states what it is in the fixture for"


def test_points_inside_the_canopy_are_included(field):
    """
    A fixture sampling only the ground would never exercise a ray that starts
    already surrounded by leaf area, which is the case the half-step entry
    offset exists for -- and the case a shader forgetting it still passes.
    """
    grid, meta = field
    cases = cf.reference_cases(cf.canopy_of(grid, meta), n_points=64)
    heights = np.array(cases["points"])[:, 2]
    assert np.any(heights > 0.25 * meta["z_top"])


# ---------------------------------------------------------------------------
# The null model
# ---------------------------------------------------------------------------

def test_the_field_passes_more_light_than_a_uniform_canopy_of_equal_area(field):
    """
    Transmittance is exp(-x) in optical depth and exp is convex, so by Jensen
    the mean over a canopy with gaps exceeds the value at the mean depth.
    Clumping can only raise mean transmittance -- this is a theorem, and it is
    also the entire reason for voxelising rather than treating the orchard as a
    slab of uniform LAI.
    """
    grid, meta = field
    for row in cf.analytic_check(cf.canopy_of(grid, meta)):
        assert row["field"] > row["uniform"], (
            f"cos z={row['cos_zenith']}: field {row['field']:.4f} is not above "
            f"uniform {row['uniform']:.4f}")
        assert row["ratio"] > 1.0


def test_the_uniform_null_model_is_monotonic_in_the_sun_angle(field):
    """
    The slab's path is z_top/cos z and nothing else varies, so it can only
    darken as the sun drops. The field itself is NOT monotonic and must not be
    asserted to be: an oblique ray through a clumped canopy can leave by the gap
    between two crowns where a vertical one from the same point goes straight
    through the crown above it.
    """
    grid, meta = field
    rows = cf.analytic_check(cf.canopy_of(grid, meta))
    uniform = [r["uniform"] for r in rows]
    assert uniform == sorted(uniform, reverse=True)


def test_build_returns_a_grid_matching_the_shape_it_reports():
    """
    The grid leaves the process as bytes and its shape travels separately as
    JSON. If they disagreed, the consumer would upload a canopy rotated into its
    own depth axis -- which renders as a plausible canopy and is wrong at every
    point.
    """
    grid, payload = cf.build({"spacing": SPACING, "lai": LAI, "cell": CELL})
    meta = payload["field"]
    assert grid.shape == (meta["n_xy"], meta["n_xy"], meta["n_z"])
    assert grid.dtype.kind == "f"
    assert np.all(np.isfinite(grid)) and np.all(grid >= 0.0)


def test_build_reports_progress_in_order():
    seen = []
    cf.build({"spacing": SPACING, "lai": LAI, "cell": CELL},
             progress=lambda p, m: seen.append((p, m)))
    assert seen, "a build that reports nothing leaves the progress bar empty"
    assert [p for p, _ in seen] == sorted(p for p, _ in seen)
    assert all(0 <= p <= 100 for p, _ in seen)
