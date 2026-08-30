"""
The leaf-area-density field an orchard puts in the air, and the reference
transmittances anything that marches it has to reproduce.

WHY THIS MODULE EXISTS. `canopy.py` and `canopy_voxel.py` are the two engines,
mirrored from the studies repository and deliberately unaltered. This is the
module that makes a field out of parameters a user can move -- spacing, LAI,
crown shape -- and hands it to whoever is going to consume it. It is new code,
not a mirror, and it is where the two engines meet.

TWO SOURCES FOR THE SAME FIELD. The crowns are ellipsoids of uniform density
computed here, or they are explicit leaves grown by Helios and voxelised. The
first needs nothing but numpy and is what almost every install will run; the
second needs pyhelios3d, an optional extra held in requirements-helios.txt
rather than requirements.txt, and so absent by default. The ellipsoid is not a placeholder for the leaves -- it is a coarser
model of the same thing, and the studies repository measured what the difference
costs: an ellipsoid preserving total leaf area and crown envelope assimilates
about 44% more than the architecture it replaces, because Beer-Lambert is not
linear in density and a medium with gaps passes far more light than a uniform
one of the same total area. So the field carries which source produced it, and
a surface that reports numbers from the ellipsoid should say so.

WHAT `reference_cases` IS FOR. The interactive shading in the front end marches
this same field in a fragment shader, which makes the GLSL a second
implementation of `canopy_voxel.Canopy.transmittance`. A second implementation
of a numerical method drifts unless something compares them, and this repository
has already shipped one hand-copied table that drifted on every stop while
nothing failed. `reference_cases` is the comparison: it evaluates the numpy
march at explicit points and directions and emits the answers, so the shader can
be held to them rather than to a screenshot.

The accompanying bar is measured rather than assumed. See
sidecar/tests/test_canopy_voxel.py: the march quantises the optical path to a
whole number of steps, so it deviates from Beer-Lambert by at most half a step
of optical depth, and that bound saturates. A shader reproducing the march
should agree far more tightly than that -- it is running the same algorithm, not
an independent approximation -- so `SHADER_TOLERANCE` below is set from what
float32 arithmetic costs, not from what the method costs.
"""

from __future__ import annotations

import numpy as np

import canopy_voxel as cv


# How far a shader marching this field may drift from the numpy march before it
# counts as a different algorithm rather than the same one in single precision.
#
# The march is a sum of a few dozen products, so float32 rounding is of order
# 1e-6 relative. The one place the two can genuinely disagree is the cell index
# at an exact grid boundary, where float64 and float32 can land on either side
# and the ray picks up a different cell for one step. That is a real difference
# of one step's optical depth, not rounding, so the bar is stated in absolute
# transmittance and is loose enough to survive a single boundary disagreement in
# a sparse field but far too tight to survive a wrong sampling convention -- the
# filtering mistake alone moves transmittance by 2 to 4%.
SHADER_TOLERANCE = 2.0e-3


# The largest grid this module will allocate.
#
# Mirrored by maxCanopyFieldCells in backend/sidecar.go, which guards what comes
# back; this one guards what gets built, and it is the one that matters. A 40 m
# module at 1 cm cells is 4000 x 4000 x 400 = 6.4e9 cells, which is 51 GB of
# float64 before anything is asked of it -- so a request with a cell size
# mistake in it takes the machine down rather than returning an error. Refusing
# on the arithmetic costs nothing and names the two numbers that disagree.
MAX_FIELD_CELLS = 8 << 20


# The longest march either implementation will run, in steps.
#
# Mirrored by CANOPY_MAX_STEPS in frontend/src/lib/canopyShader.ts, where it is
# the compile-time loop bound a fragment shader needs. The two have to be the
# same number, and the field builder is the side that has to respect it: numpy
# will happily march ten thousand steps and the GLSL loop simply stops at the
# bound, so a field needing more produces two different answers with nothing
# raised. Measured, a 1.5 cm cell under a 6 m canopy needs 3311 steps at the
# lowest reference sun and the shader ran 2048, disagreeing by 7e-2 -- thirty
# times the tolerance the gate allows.
#
# Refusing rather than silently truncating is the choice, and the constraint is
# real: this many texture fetches per fragment is already a heavy interactive
# budget, and a canopy resolved that finely is asking the viewport for something
# it cannot do at frame rate. The remedy is a coarser cell, which the message
# says.
MAX_MARCH_STEPS = 2048

# What canopy_voxel.Canopy.transmittance caps the path at, and what the shader
# is given as uMaxPath. Stated here because the step count depends on it and a
# consumer that guessed a different one would compare against a different march.
MAX_PATH = 25.0


def _march_steps(z_top, cell, step_frac, cos_zenith):
    """Steps `canopy_voxel.Canopy.transmittance` runs, by its own arithmetic."""
    step = cell * step_frac
    return int(min(MAX_PATH, (z_top + step) / cos_zenith) / step) + 1


def _check_march(z_top, cell, step_frac=0.5):
    lowest = min(sun[0] for sun in REFERENCE_SUNS)
    steps = _march_steps(z_top, cell, step_frac, lowest)
    if steps > MAX_MARCH_STEPS:
        raise ValueError(
            f"a {z_top:g} m canopy at {cell:g} m cells needs {steps:,} marching "
            f"steps at the lowest reference sun, over the {MAX_MARCH_STEPS:,} a "
            f"fragment shader runs. Coarsen the cell to at least "
            f"{8 * z_top / MAX_MARCH_STEPS:.3f} m."
        )
    return steps


def _check_tiles(spacing, cell):
    """
    The grid has to tile the module exactly, or the march reads a canopy
    narrower than the one that was built.

    `Canopy.transmittance` wraps with `int(mod(x, spacing) / cell) % n_xy`. When
    spacing is not a whole number of cells the grid spans n_xy * cell, which is
    wider than the module, and the last column is reached only over the leftover
    strip -- so it carries a full cell of leaf area while receiving less than a
    cell of rays. The rescale then normalises over the grid rather than over the
    module and hides the difference: at 4 m in 15 cm cells the field reports LAI
    3.50 and the march integrates 3.43, a 1.9% overstatement that no other check
    would show.

    Refusing rather than snapping, because the two nearest cell sizes are worth
    seeing: which one to take is a resolution decision, not arithmetic.
    """
    exact = spacing / cell
    n = round(exact)
    if n < 1 or abs(exact - n) > 1e-9:
        below = spacing / (int(np.floor(exact)) + 1)
        above = spacing / max(int(np.floor(exact)), 1)
        raise ValueError(
            f"a {spacing:g} m module is {exact:.4f} cells wide at {cell:g} m, and "
            f"the periodic wrap needs a whole number of them. Use {below:.4f} m "
            f"or {above:.4f} m."
        )
    return n


def _check_extent(n_xy, n_z, spacing, cell):
    cells = n_xy * n_xy * n_z
    if cells > MAX_FIELD_CELLS:
        raise ValueError(
            f"a {spacing:g} m module at {cell:g} m cells is "
            f"{n_xy}x{n_xy}x{n_z} = {cells:,} cells, over the {MAX_FIELD_CELLS:,} "
            f"this builds. Coarsen the cell or shrink the module."
        )
    return cells


def ellipsoid_field(spacing, lai, crown_a, crown_b, crown_z, cell=0.30,
                    z_top=None, images=None):
    """
    Voxelise one periodic orchard module whose crowns are uniform ellipsoids.

    A cell belongs to a crown when its centre is inside the ellipsoid, and the
    density is the crown's leaf area over its volume. Cells are tested against
    the crown's periodic images as well, so a canopy wider than the spacing
    overlaps itself and the densities add -- which is what a closed orchard
    does, and it keeps total leaf area right instead of clipping it at the
    module edge.

    Returns (grid, meta). `grid` is (n_xy, n_xy, n_z) in m2 of leaf per m3.
    """
    spacing = float(spacing)
    cell = float(cell)
    crown_a, crown_b, crown_z = float(crown_a), float(crown_b), float(crown_z)
    if spacing <= 0 or cell <= 0:
        raise ValueError("spacing and cell must be positive")
    if crown_a <= 0 or crown_b <= 0:
        raise ValueError("crown semi-axes must be positive")

    z_top = float(z_top) if z_top is not None else crown_z + crown_b
    n_xy = _check_tiles(spacing, cell)
    n_z = max(int(np.ceil(z_top / cell)), 1)
    _check_extent(n_xy, n_z, spacing, cell)
    _check_march(n_z * cell, cell)

    # Cell centres, which is what the march samples -- a cell either counts
    # whole or not at all, so testing the centre is the consistent choice.
    axis_xy = (np.arange(n_xy) + 0.5) * cell
    axis_z = (np.arange(n_z) + 0.5) * cell
    gx, gy, gz = np.meshgrid(axis_xy, axis_xy, axis_z, indexing="ij")

    leaf_area = float(lai) * spacing ** 2
    volume = 4.0 / 3.0 * np.pi * crown_a ** 2 * crown_b
    density = leaf_area / volume if volume > 0 else 0.0

    # How far the periodic sum has to reach. A cell at the far edge of the
    # module is crown_a + spacing/2 from the nearest centre it can still belong
    # to, so a fixed range of one image silently truncates the sum as soon as
    # the crown is wider than 1.5 modules -- measured, up to 31% of the density
    # in a cell for a 5 m crown on 3 m spacing. Deriving it costs nothing.
    if images is None:
        images = int(np.ceil((crown_a + spacing / 2.0) / spacing))
    centre = np.array([spacing / 2.0, spacing / 2.0])
    inside = np.zeros_like(gx, dtype=bool)
    count = np.zeros_like(gx, dtype=np.float64)
    for ix in range(-images, images + 1):
        for iy in range(-images, images + 1):
            dx = gx - (centre[0] + ix * spacing)
            dy = gy - (centre[1] + iy * spacing)
            dz = gz - crown_z
            hit = (dx / crown_a) ** 2 + (dy / crown_a) ** 2 + (dz / crown_b) ** 2 <= 1.0
            inside |= hit
            count += hit

    grid = count * density

    # The ellipsoid is a continuum and the grid is not, so the voxelised leaf
    # area is not exactly the leaf area asked for. Rescale rather than leave the
    # discrepancy in: the field is compared against analytic Beer-Lambert, and a
    # canopy holding 3% less leaf than it claims would read as a march error.
    voxel_area = grid.sum() * cell ** 3
    if voxel_area <= 0:
        # No cell centre landed inside any crown, so there is nothing to rescale
        # and nothing to march. Left through, the payload would carry the LAI
        # that was asked for beside a leaf area of zero and a canopy that
        # intercepts no light -- self-contradictory, and accepted by every
        # downstream check, since the cell count and the byte count are both
        # right.
        raise ValueError(
            f"a crown of {crown_a:g} x {crown_b:g} m at {crown_z:g} m contains no "
            f"cell centre at {cell:g} m cells, so the field is empty. Refine the "
            f"cell below {min(crown_a, crown_b):g} m or enlarge the crown."
        )
    grid *= leaf_area / voxel_area
    voxel_area = leaf_area

    meta = {
        "source": "ellipsoid",
        "spacing": spacing,
        "cell": cell,
        "z_top": n_z * cell,
        "n_xy": n_xy,
        "n_z": n_z,
        "lai": float(lai),
        "leaf_area": float(voxel_area),
        "crown_a": crown_a,
        "crown_b": crown_b,
        "crown_z": crown_z,
        "occupancy": float(inside.mean()),
        "density_in_crown": float(grid[grid > 0].mean()) if np.any(grid > 0) else 0.0,
    }
    return grid, meta


def row_field(spacing, lai, height, row_width_frac=0.6, base=0.0, cell=0.05,
              z_top=None):
    """
    Voxelise one periodic module of a row crop.

    WHY THIS EXISTS BESIDE THE ELLIPSOID. A field of soy or maize is neither a
    set of discrete crowns nor a uniform mat: it is a strip of vegetation of
    width `row_width_frac * spacing` repeating every `spacing`, standing
    `height` tall. All of the module's leaf area lives inside those strips, so
    the density there is higher than the field average by the reciprocal of the
    width fraction -- and that is precisely what Beer's law applied to the whole
    field ignores.

    THE STRIP IS UNIFORM ALONG ITSELF, so the geometry is really two-dimensional
    in (x, z). It is stored as the same three-dimensional grid every other
    source produces, replicated along y, because the consumer is a 3D texture
    and a second field layout would mean a second shader. Verified against the
    studies repository's own 2D row engine: replicated along y and marched by
    canopy_voxel, the two agree to zero -- not approximately, bit for bit,
    across twelve sun positions. Rows therefore run along the field's y axis,
    and a planting at an angle is expressed by rotating the sun rather than the
    grid, which costs nothing and avoids resampling a field to turn it.

    `lai` is leaf area per unit GROUND, which is what an NDVI inversion gives.
    """
    spacing, cell = float(spacing), float(cell)
    lai, height, base = float(lai), float(height), float(base)
    width = float(row_width_frac) * spacing
    if spacing <= 0 or cell <= 0:
        raise ValueError("spacing and cell must be positive")
    if height <= 0:
        raise ValueError("row height must be positive")
    if not 0 < row_width_frac <= 1:
        raise ValueError("row_width_frac must be above zero and at most one, "
                         "since the strip cannot be wider than its own spacing")

    top = float(z_top) if z_top is not None else base + height
    n_xy = _check_tiles(spacing, cell)
    n_z = max(int(np.ceil(top / cell)), 1)
    _check_extent(n_xy, n_z, spacing, cell)
    _check_march(n_z * cell, cell)

    # All the module's leaf area inside the strip's volume, not the module's.
    # This one line is the whole difference from a slab, and with the strip at
    # full width it reduces to one -- which is the acceptance test.
    density = lai * spacing / (width * height)

    axis_xy = (np.arange(n_xy) + 0.5) * cell
    axis_z = (np.arange(n_z) + 0.5) * cell
    in_x = np.abs(axis_xy - spacing / 2) <= width / 2
    in_z = (axis_z >= base) & (axis_z <= base + height)

    grid = np.zeros((n_xy, n_xy, n_z))
    grid[np.ix_(in_x, np.ones(n_xy, bool), in_z)] = density

    # The strip does not tile into cells any more than an ellipsoid does, so the
    # voxelised area is a little off what was asked for. Rescaled for the same
    # reason: the field is compared against analytic Beer-Lambert, and a canopy
    # holding less leaf than it claims would read as a march error.
    voxel_area = grid.sum() * cell ** 3
    if voxel_area <= 0:
        raise ValueError(
            f"a strip {width:g} m wide and {height:g} m tall contains no cell "
            f"centre at {cell:g} m cells, so the field is empty. Refine the "
            f"cell below {min(width, height):g} m."
        )
    grid *= (lai * spacing ** 2) / voxel_area

    meta = {
        "source": "rows",
        "spacing": spacing,
        "cell": cell,
        "z_top": n_z * cell,
        "n_xy": n_xy,
        "n_z": n_z,
        "lai": lai,
        "leaf_area": lai * spacing ** 2,
        "row_width": width,
        "row_width_frac": float(row_width_frac),
        "height": height,
        "base": base,
        "occupancy": float((grid > 0).mean()),
        "density_in_crown": float(grid[grid > 0].mean()),
    }
    return grid, meta


def leaf_cloud_field(pos, area, spacing, cell=0.30, z_top=None):
    """
    Voxelise an explicit leaf cloud -- what `helios_bridge.leaf_cloud` returns.

    Kept beside the ellipsoid so both sources produce the same object, and the
    only difference a consumer sees is `meta["source"]`.
    """
    pos = np.asarray(pos, float)
    spacing, cell = float(spacing), float(cell)
    top = float(z_top) if z_top is not None else (
        float(pos[:, 2].max()) + cell if len(pos) else cell)
    n_z = max(int(np.ceil(top / cell)), 1)
    _check_extent(_check_tiles(spacing, cell), n_z, spacing, cell)
    _check_march(n_z * cell, cell)

    canopy = cv.Canopy(pos, np.asarray(area, float),
                       spacing=spacing, cell=cell, z_max=z_top)
    meta = {
        "source": "leaves",
        "spacing": float(spacing),
        "cell": float(cell),
        "z_top": canopy.z_top,
        "n_xy": canopy.n_xy,
        "n_z": canopy.n_z,
        "lai": canopy.lai_ground,
        "leaf_area": canopy.leaf_area,
        "occupancy": float((canopy.grid > 0).mean()),
        "density_in_crown": (float(canopy.grid[canopy.grid > 0].mean())
                             if np.any(canopy.grid > 0) else 0.0),
        "leaves": int(len(area)),
    }
    return canopy.grid, meta


def canopy_of(grid, meta):
    """
    Wrap a field in the marcher, without going back through leaf positions.

    `Canopy` builds its grid from a leaf cloud, which is the wrong way round
    here -- the field is already the answer. Constructing empty and assigning
    keeps one marching implementation instead of two.
    """
    # Not `z_max=meta["z_top"]`, which looks like the obvious argument and is
    # wrong. `z_top` is n_z * cell, and Canopy recovers the depth by taking
    # ceil(z_max / cell) -- a round trip that is not a fixed point in binary
    # floating point. ceil(2.4 / 0.1) is 24, 24 * 0.1 is 2.4000000000000004, and
    # ceil of that over 0.1 is 25. The field then fails its own shape check.
    # Measured over ordinary parameters this fired on about 7% of requests, and
    # the tests missed it because their cell sizes happened to round exactly.
    #
    # Any height strictly inside the top cell recovers n_z, so the midpoint of
    # that cell is the argument furthest from either boundary rather than the
    # one sitting on it.
    canopy = cv.Canopy(np.zeros((0, 3)), np.zeros(0), spacing=meta["spacing"],
                       cell=meta["cell"],
                       z_max=(meta["n_z"] - 0.5) * meta["cell"])
    if canopy.grid.shape != grid.shape:
        raise ValueError(f"field {grid.shape} does not fit a canopy "
                         f"{canopy.grid.shape} built from its own meta")
    canopy.grid = np.asarray(grid, float)
    canopy.leaf_area = float(meta["leaf_area"])
    canopy.lai_ground = canopy.leaf_area / meta["spacing"] ** 2
    return canopy


# ---------------------------------------------------------------------------
# The cases a second implementation has to reproduce
# ---------------------------------------------------------------------------

def _sun(cos_zenith, azimuth_rad=0.0):
    sin_zenith = np.sqrt(max(0.0, 1.0 - cos_zenith ** 2))
    return np.array([sin_zenith * np.cos(azimuth_rad),
                     sin_zenith * np.sin(azimuth_rad),
                     cos_zenith])


REFERENCE_SUNS = (
    # cos z, azimuth, and why this one is in the list.
    (1.00, 0.0, "overhead: the shortest path, and the only one aligned with the grid"),
    (0.85, 0.7, "high sun off both axes, so x and y wrap independently"),
    (0.70, 0.0, "the angle whose optical path lands between whole steps"),
    (0.55, 2.4, "oblique and reversed in x, which exercises the periodic wrap"),
    (0.40, 1.2, "low sun: the longest path and the most steps"),
    (0.25, 3.9, "very low, where the march is nearly horizontal through the module"),
)


def reference_cases(canopy, n_points=64, seed=0, step_frac=0.5):
    """
    Evaluate the numpy march at explicit points and directions.

    The points are pseudo-random within the module rather than on a lattice, on
    purpose: a lattice would sample the same phase of every cell and could agree
    with a shader that had the sampling convention wrong by half a cell.
    Deterministic through `seed`, so the fixture is stable across runs.

    Points sit just above the ground because that is the question the shading
    view asks -- how much direct light reaches a point on the floor of the
    orchard. Two points are placed inside the canopy as well, where the ray
    starts already surrounded by leaf area.
    """
    rng = np.random.default_rng(seed)
    spacing = canopy.spacing
    ground = np.stack([rng.uniform(0, spacing, n_points),
                       rng.uniform(0, spacing, n_points),
                       np.full(n_points, 1e-3)], axis=1)
    aloft = np.stack([rng.uniform(0, spacing, max(n_points // 4, 1)),
                      rng.uniform(0, spacing, max(n_points // 4, 1)),
                      rng.uniform(0.25 * canopy.z_top, 0.75 * canopy.z_top,
                                  max(n_points // 4, 1))], axis=1)
    points = np.concatenate([ground, aloft])

    cases = []
    for cos_zenith, azimuth, why in REFERENCE_SUNS:
        direction = _sun(cos_zenith, azimuth)
        tau = canopy.transmittance(points, direction, step_frac=step_frac)
        cases.append({
            "cos_zenith": float(cos_zenith),
            "azimuth": float(azimuth),
            "why": why,
            "direction": [float(v) for v in direction],
            "transmittance": [float(v) for v in tau],
        })

    return {
        "points": [[float(v) for v in p] for p in points],
        "step_frac": float(step_frac),
        "g_leaf": float(cv.G_LEAF),
        "max_path": MAX_PATH,
        "max_steps": MAX_MARCH_STEPS,
        "tolerance": SHADER_TOLERANCE,
        "suns": cases,
        "ground": ground_reference(canopy, step_frac=step_frac),
    }


# How many samples across the module the ground reference carries.
GROUND_SAMPLES = 48


def ground_reference(canopy, n=GROUND_SAMPLES, step_frac=0.5):
    """
    Direct light reaching the orchard floor, on a regular grid of the module.

    WHY THIS IS SEPARATE FROM THE SCATTERED POINTS ABOVE. Those verify the
    march. This verifies the mapping into it -- which is a different layer, and
    it is the one that has broken. A view drawing this floor has to turn a
    fragment's position on a piece of geometry into a position in the field,
    and a mapping that is transposed, offset by half a module or reading the
    wrong pair of axes produces a picture that is smooth, plausible and wrong
    everywhere. Scattered points cannot catch it, because a consumer comparing
    against them is handed the field coordinates directly and never performs
    the mapping under test.

    The grid is stated in the field's own metres so that a consumer has to
    arrive at the same places by its own arithmetic: sample (i, j) is the
    centre of cell (i, j) of an n-by-n division of [0, spacing] squared, with i
    running along x and j along y.
    """
    axis = (np.arange(n) + 0.5) / n * canopy.spacing
    gx, gy = np.meshgrid(axis, axis, indexing="ij")
    points = np.stack([gx.ravel(), gy.ravel(),
                       np.full(gx.size, 1e-3)], axis=1)

    out = []
    for cos_zenith, azimuth, why in REFERENCE_SUNS:
        direction = _sun(cos_zenith, azimuth)
        tau = canopy.transmittance(points, direction, step_frac=step_frac)
        out.append({
            "cos_zenith": float(cos_zenith),
            "azimuth": float(azimuth),
            "why": why,
            "direction": [float(v) for v in direction],
            # Row-major over (i, j), i along x.
            "transmittance": [float(v) for v in tau],
        })
    return {"n": int(n), "suns": out}


# The extinction coefficient a crop model holds fixed.
#
# STICS uses 0.7 for sorghum and the same order for maize and soy. It is the
# number the comparison below exists to test, and it is NOT this module's
# G_LEAF: G is the projection coefficient of a spherical leaf angle
# distribution, a property of the geometry, while k is a bulk fitted constant
# standing in for the whole canopy. Two exponentials, two different quantities.
# Substituting one for the other is not a small error -- on a real series it
# moved an interception comparison by 22 percentage points and reversed its
# sign.
CROP_MODEL_K = 0.7


def analytic_check(canopy, step_frac=0.5, fixed_k=CROP_MODEL_K):
    """
    What the same leaf area would intercept under two coarser models, and the
    extinction coefficient this canopy actually behaves as.

    THE EMERGENT k IS THE POINT. A crop model treats the canopy as a slab with
    one fitted k and holds it constant all season. Inverting Beer on what the
    resolved canopy actually intercepts -- k = -ln(1 - faPAR) / LAI, equation 29
    of Braud et al. (2026) -- gives the coefficient it behaves as, and that
    coefficient is not constant.

    WHAT THIS ENGINE CAN AND CANNOT SHOW, stated because the difference is easy
    to overclaim. Measured in studies/E-archicrop-sorghum-growth of the
    numerical-studies repository, on the paper's own sorghum case driven by
    STICS, the emergent k falls from 1.05 to 0.73 across the season while STICS
    holds 0.7 throughout, so a fixed k underestimates interception by 32% at LAI
    0.11 and converges to about 1% past LAI 2.

    This engine does NOT reproduce that fall, and cannot. There the canopy's
    architecture develops -- leaves are added, the plant rises, the angle
    distribution changes -- and the seasonal drift in k comes from that
    development, not from LAI. Here the geometry is held and only leaf area
    scales, so the emergent k barely moves with LAI (0.58 to 0.57 over a
    tenfold range, in a soy row canopy). Producing the seasonal curve needs
    architecture that grows.

    THAT LAST CLAUSE USED TO SAY the sidecar could not carry such architecture,
    since ArchiCrop is conda-only, invokes a compiled binary as a subprocess,
    and is CeCILL-C. That remains true of ArchiCrop and is no longer true of
    the sidecar: helios_grow.py grows architecture by species and age through
    pyhelios3d, which is pip-installable and GPL-2. What is still absent is a
    growth curve DRIVEN BY A CROP MODEL -- Helios grows to its own schedule,
    not to a given LAI and height -- so the seasonal k of a stressed season is
    still out of reach here, for a different reason than the one recorded
    before.

    Measured with that architecture, in studies/E-architecture-vs-slab of the
    numerical-studies repository: at matched LAI, an ellipsoid overstates faPAR
    by 35-48% and a row strip by 58-61%, against the explicit leaves. The
    clumping index behind it is 0.40-0.56, so the same leaf area passes roughly
    twice the light a random medium would. That is the same comparison the
    44% above records, measured again rather than inherited.

    WHAT IT DOES SHOW is a second and independent failure of the same
    assumption: k is not constant across SUN ANGLE either. In that same soy
    canopy it reads 0.58 at cos z 0.85 and 0.90 at cos z 0.55, so a fixed 0.7
    overstates interception by 18% at a high sun and understates it by 20% at a
    low one -- the error changes sign within a single day. A slab cannot express
    that, and this engine measures it without needing any architecture at all.

    `uniform` remains the slab this engine's own G would give, which is the
    null model the voxelisation exists to be an alternative to.
    """
    rng = np.random.default_rng(1)
    points = np.stack([rng.uniform(0, canopy.spacing, 2000),
                       rng.uniform(0, canopy.spacing, 2000),
                       np.full(2000, 1e-3)], axis=1)
    density = canopy.leaf_area / (canopy.spacing ** 2 * canopy.z_top)

    out = []
    for cos_zenith, azimuth, _ in REFERENCE_SUNS:
        direction = _sun(cos_zenith, azimuth)
        field = float(canopy.transmittance(points, direction,
                                           step_frac=step_frac).mean())
        uniform = float(np.exp(-cv.G_LEAF * density * canopy.z_top / cos_zenith))
        # Not `field / uniform` unguarded, and not a NaN sentinel. A uniform
        # canopy at high LAI underflows to exactly zero, and json.dumps writes
        # NaN and Infinity as bare tokens that Go's encoding/json refuses --
        # discarding an otherwise complete payload with a message about a
        # character. The ratio is reported as None where it does not exist,
        # which survives the boundary as null.
        ratio = field / uniform if uniform > 1e-300 else None

        # The coefficient this canopy behaves as, by inverting Beer on what it
        # actually intercepts. Undefined where there is too little leaf to
        # invert or where the canopy is closed: at faPAR of 1 the logarithm
        # diverges, and below LAI 0.1 the quotient is noise over a vanishing
        # denominator. Reported as null rather than as a large number, because
        # a large number there would be read as a measurement.
        fapar_field = 1.0 - field
        lai = canopy.lai_ground
        emergent = (-np.log(1.0 - fapar_field) / lai
                    if lai > 0.1 and 0.0 < fapar_field < 1.0 else None)

        # And what a crop model holding k fixed would have said instead.
        fapar_fixed = 1.0 - float(np.exp(-fixed_k * lai))

        out.append({
            "cos_zenith": float(cos_zenith),
            "field": field,
            "uniform": uniform,
            "ratio": ratio,
            "fapar": float(fapar_field),
            "fapar_fixed_k": fapar_fixed,
            "k_emergent": float(emergent) if emergent is not None else None,
            "fixed_k": float(fixed_k),
            # Signed, and the sign is the finding: negative means the fixed
            # coefficient fell short of what the resolved canopy intercepts.
            "fixed_k_error_pct": (100.0 * (fapar_fixed / fapar_field - 1.0)
                                  if fapar_field > 1e-9 else None),
        })
    return out


def build(request, progress=None):
    """
    The whole field from one request dict, for the sidecar action.

    Returns (grid, payload). The grid is left as an array because it leaves the
    process as a binary file rather than as JSON -- a 40x40x20 field is 128 kB
    of float32 and would be several times that as decimal text.
    """
    def step(pct, msg):
        if progress:
            progress(pct, msg)

    source = request.get("source", "ellipsoid")
    spacing = float(request.get("spacing", 6.0))
    cell = float(request.get("cell", 0.30))
    lai = float(request.get("lai", 2.0))

    if source == "rows":
        step(20, "laying the rows")
        grid, meta = row_field(
            spacing=spacing, lai=lai,
            height=float(request.get("height", 0.9)),
            row_width_frac=float(request.get("row_width_frac", 0.6)),
            base=float(request.get("base", 0.0)),
            cell=cell, z_top=request.get("z_top"))
    elif source == "ellipsoid":
        step(20, "placing the crowns")
        grid, meta = ellipsoid_field(
            spacing=spacing, lai=lai,
            crown_a=float(request.get("crown_a", 1.8)),
            crown_b=float(request.get("crown_b", 1.2)),
            crown_z=float(request.get("crown_z", 1.6)),
            cell=cell, z_top=request.get("z_top"))
    elif source == "leaves":
        step(20, "voxelising the leaf cloud")
        grid, meta = leaf_cloud_field(
            request["leaf_positions"], request["leaf_areas"],
            spacing=spacing, cell=cell, z_top=request.get("z_top"))
    else:
        raise ValueError(f"unknown canopy source: {source!r}")

    step(55, "marching the reference directions")
    canopy = canopy_of(grid, meta)
    cases = reference_cases(canopy, n_points=int(request.get("n_reference", 64)),
                            step_frac=float(request.get("step_frac", 0.5)))

    step(80, "comparing against a uniform canopy of the same leaf area")
    payload = {
        "field": meta,
        "reference": cases,
        "against_uniform": analytic_check(canopy,
                                          step_frac=float(request.get("step_frac", 0.5))),
    }
    return grid, payload


# ---------------------------------------------------------------------------
# Light under the AOI's own sun, rather than under six directions chosen to
# exercise a shader.
# ---------------------------------------------------------------------------

def _canopy_azimuth(compass_deg, row_azimuth_deg=0.0):
    """A compass bearing, in the canopy's own frame.

    TWO CONVENTIONS MEET HERE AND NEITHER IS WRONG. Solar azimuth is clockwise
    from north, which is what `solar.py` produces and what the aspect raster
    uses. `_sun` measures anticlockwise from the field's +x axis, because the
    field has no north -- it has a module with two axes.

    What joins them is the direction the rows run, which is a real agronomic
    choice and not a convention: rows laid north-south intercept differently
    from rows laid east-west, and a canopy lit without that stated is answering
    for an orientation nobody picked. `row_azimuth_deg` is the bearing of the
    row direction, so the sun's bearing relative to the rows is the difference,
    and the sign flips because one convention turns the other way.
    """
    return np.radians(90.0 - (float(compass_deg) - float(row_azimuth_deg)))


def _hemisphere(n_azimuth=8, n_elevation=6):
    """Directions and cosine-weights for an isotropic sky.

    Diffuse light arrives from the whole hemisphere, so a canopy lit only by the
    beam is lit by roughly a fifth of what reaches it on a clear day and by
    almost nothing under cloud. The weight is cos(zenith) times the solid angle
    of the band, which is what makes the sum an irradiance rather than a count
    of directions.

    Coarse on purpose: 48 directions is the order Caribu's turtle sky uses, and
    the march is the cost here.
    """
    dirs, weights = [], []
    el_edges = np.linspace(0.0, 90.0, n_elevation + 1)
    for i in range(n_elevation):
        lo, hi = np.radians(el_edges[i]), np.radians(el_edges[i + 1])
        # Solid angle of the band, times the cosine projection onto the ground,
        # integrated analytically over the band: ∫ cos·sin dθ = (sin²hi-sin²lo)/2
        band = (np.sin(hi) ** 2 - np.sin(lo) ** 2) / 2.0
        elev = 0.5 * (el_edges[i] + el_edges[i + 1])
        for j in range(n_azimuth):
            az = 360.0 * j / n_azimuth
            dirs.append(_sun(np.cos(np.radians(90.0 - elev)),
                             np.radians(az)))
            weights.append(band / n_azimuth)
    w = np.asarray(weights, float)
    return np.asarray(dirs, float), w / w.sum()


def light_under_sun(canopy, hist, el_edges, *, dhi_share=0.0,
                    row_azimuth_deg=0.0, n_points=512, step_frac=0.5,
                    min_share=1e-4):
    """faPAR under a measured sun, and the coefficient the canopy behaves as.

    `hist` is `sun_position.beam_energy_histogram`: beam energy per (azimuth sector,
    elevation band) over the record. Every bin carrying a meaningful share of
    the year is marched and the results are combined in proportion to the energy
    that actually arrived from it -- which is the difference between this and
    the reference suns, where six directions count equally because they were
    chosen to stress a shader rather than to describe a sky.

    `dhi_share` is the diffuse fraction of the total. Left at zero the answer is
    beam only, which overstates transmission on any real day; given, the sky is
    integrated over `_hemisphere` and the two are combined by energy.

    The emergent k inverts Beer on the result, so it is the coefficient a crop
    model would need in order to reproduce this canopy under this sky -- not a
    coefficient assumed and applied.
    """
    total = float(np.sum(hist))
    if total <= 0:
        raise ValueError("the beam record carries no energy, so there is no "
                         "sun to light the canopy with")

    rng = np.random.default_rng(0)
    pts = np.stack([rng.uniform(0, canopy.spacing, n_points),
                    rng.uniform(0, canopy.spacing, n_points),
                    np.full(n_points, 1e-3)], axis=1)

    n_az = hist.shape[0]
    centres = 0.5 * (el_edges[:-1] + el_edges[1:])

    # Beam, bin by bin, skipping the ones that carry nothing worth a march.
    beam_t, beam_w = 0.0, 0.0
    marched = 0
    for a in range(n_az):
        compass = 360.0 * (a + 0.5) / n_az
        for e, elev in enumerate(centres):
            share = float(hist[a, e]) / total
            if share < min_share or elev <= 0:
                continue
            direction = _sun(np.cos(np.radians(90.0 - elev)),
                             _canopy_azimuth(compass, row_azimuth_deg))
            tau = float(np.mean(canopy.transmittance(
                pts, direction, step_frac=step_frac)))
            beam_t += share * tau
            beam_w += share
            marched += 1
    beam_tau = beam_t / beam_w if beam_w > 0 else 1.0

    # Diffuse, over an isotropic sky.
    diffuse_tau = None
    if dhi_share > 0:
        dirs, w = _hemisphere()
        taus = np.array([
            float(np.mean(canopy.transmittance(pts, d, step_frac=step_frac)))
            for d in dirs])
        diffuse_tau = float(np.sum(w * taus))

    f = float(dhi_share)
    tau = beam_tau if diffuse_tau is None else (1 - f) * beam_tau + f * diffuse_tau
    fapar = 1.0 - tau
    lai = float(canopy.leaf_area) / (float(canopy.spacing) ** 2)

    return {
        "fapar": fapar,
        "transmittance": tau,
        "beam_transmittance": beam_tau,
        "diffuse_transmittance": diffuse_tau,
        "diffuse_share": f,
        "lai": lai,
        # k = -ln(1 - faPAR) / LAI, equation 29 of Braud et al. (2026), on what
        # this canopy actually intercepted rather than on an assumed slab.
        "k_emergent": (-np.log(max(tau, 1e-12)) / lai) if lai > 1e-9 else None,
        "beam_bins_marched": marched,
        # Small here by construction, not by physics: a single plant voxelised
        # into a square module has no row structure to orient, so what moves is
        # the plant's own asymmetry. A rectangular module or `row_field` is
        # where orientation earns its keep.
        "row_azimuth_deg": float(row_azimuth_deg),
        # WHAT A CONSTANT k WOULD HAVE SAID, which is the number a crop model
        # actually uses. Reported as the error it carries rather than as a
        # second faPAR, because the reader's question is how wrong the slab is
        # here, not what the slab thinks.
        **_fixed_k_error(fapar, lai),
    }


def _fixed_k_error(fapar, lai, fixed_k=None):
    """How far Beer with a constant coefficient lands from what was marched."""
    k = CROP_MODEL_K if fixed_k is None else float(fixed_k)
    if lai <= 1e-9:
        return {"fapar_fixed_k": None, "fixed_k": k, "fixed_k_error_pct": None}
    f_fixed = 1.0 - float(np.exp(-k * lai))
    err = (f_fixed - fapar) / fapar * 100.0 if fapar > 1e-9 else None
    return {
        "fapar_fixed_k": f_fixed,
        "fixed_k": k,
        "fixed_k_error_pct": err,
    }
