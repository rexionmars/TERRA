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
second needs pyhelios3d, which is not in requirements.txt and is absent by
default. The ellipsoid is not a placeholder for the leaves -- it is a coarser
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
                    z_top=None, images=1):
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
    n_xy = max(int(np.ceil(spacing / cell)), 1)
    n_z = max(int(np.ceil(z_top / cell)), 1)
    _check_extent(n_xy, n_z, spacing, cell)

    # Cell centres, which is what the march samples -- a cell either counts
    # whole or not at all, so testing the centre is the consistent choice.
    axis_xy = (np.arange(n_xy) + 0.5) * cell
    axis_z = (np.arange(n_z) + 0.5) * cell
    gx, gy, gz = np.meshgrid(axis_xy, axis_xy, axis_z, indexing="ij")

    leaf_area = float(lai) * spacing ** 2
    volume = 4.0 / 3.0 * np.pi * crown_a ** 2 * crown_b
    density = leaf_area / volume if volume > 0 else 0.0

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
    if voxel_area > 0:
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
    _check_extent(max(int(np.ceil(spacing / cell)), 1),
                  max(int(np.ceil(top / cell)), 1), spacing, cell)

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
    canopy = cv.Canopy(np.zeros((0, 3)), np.zeros(0), spacing=meta["spacing"],
                       cell=meta["cell"], z_max=meta["z_top"])
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
        "tolerance": SHADER_TOLERANCE,
        "suns": cases,
    }


def analytic_check(canopy, step_frac=0.5):
    """
    What the same field would transmit if its leaf area were spread uniformly.

    Not a test of the march -- the march is checked against this in
    test_canopy_voxel.py, where the deviation is bounded and the bound is
    measured. It is here because it is the number that says how much the
    orchard's structure matters: uniform is the null model, and the gap between
    it and the field is the whole reason for voxelising anything.
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
        out.append({
            "cos_zenith": float(cos_zenith),
            "field": field,
            "uniform": uniform,
            "ratio": field / uniform if uniform > 0 else float("nan"),
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

    if source == "ellipsoid":
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
