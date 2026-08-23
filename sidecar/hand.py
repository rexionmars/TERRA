"""
HAND (Height Above Nearest Drainage) from a DEM, with no external dependency.

The chain is the classical one -- Nobre et al. (2011): fill the depressions,
direct the flow (D8), accumulate it, extract the drainage by an area threshold,
and measure the height of each cell above the drainage cell it flows to.

WHY THIS IS REIMPLEMENTED RATHER THAN TAKEN FROM pysheds OR richdem. Both bring
compiled dependencies that the sidecar does not carry, and the packaged
application ships an interpreter it builds itself -- a wheel that fails to
build there fails at install time, on a machine with no compiler and no one to
read the error. The second reason is the drainage threshold: it is a free
parameter that almost no flood study reports, this product measures its effect,
and a measurement of a parameter buried inside a dependency is a measurement of
something the reader cannot see.

Ported from the study E-hand-flood-baseline in the TERRA-Simulation
repository, where it carries five analytic self-checks. Those checks live in
sidecar/tests/test_hand.py here, because a module that verifies itself on
import costs every caller the time and a module that verifies itself under
__main__ is never run by CI.

Nothing is vectorised beyond the D8 step. Measured on this implementation: a
900 by 900 grid, which is 27 km square at 30 m, takes 3.5 s for the whole
chain, and the cost is close to linear in cells at 4.3 microseconds each. The
Priority-Flood dominates it and heapq is implemented in C, so the plain loop
is cheaper than it reads.
"""

import heapq
import math

import numpy as np

# D8 offsets as (row, column). The order is fixed so that the argmax tie-break
# is deterministic between runs and between DEM products -- this product
# compares one DEM against another, and a tie broken differently on each would
# show up as terrain disagreement that is really an implementation detail.
D8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def pixel_size_m(lat_deg, res_lon_deg, res_lat_deg):
    """
    Pixel size in metres for a DEM in degrees (EPSG:4326).

    Holds for small areas: dx is evaluated at one latitude, and varies by about
    0.1 percent over 0.1 degree of it, well below the vertical error of any DEM
    this compares.
    """
    dx = 111_320.0 * math.cos(math.radians(lat_deg)) * res_lon_deg
    dy = 110_540.0 * res_lat_deg
    return dx, dy


def fill_depressions(z, eps=1e-3):
    """
    Priority-Flood with epsilon (Barnes et al., 2014).

    Returns a DEM with no interior minima and no plateaus: every cell sits at
    least eps above the cell the water left it through. The epsilon is what
    lets D8 find a descent across a flat surface -- without it a filled lake
    becomes a plateau with no defined flow direction.
    """
    H, W = z.shape
    filled = np.full((H, W), np.inf)
    seen = np.zeros((H, W), bool)
    heap = []

    for i in range(H):
        for j in (0, W - 1):
            heapq.heappush(heap, (float(z[i, j]), i, j))
            seen[i, j] = True
            filled[i, j] = z[i, j]
    for j in range(1, W - 1):
        for i in (0, H - 1):
            heapq.heappush(heap, (float(z[i, j]), i, j))
            seen[i, j] = True
            filled[i, j] = z[i, j]

    while heap:
        zc, i, j = heapq.heappop(heap)
        for di, dj in D8:
            ii, jj = i + di, j + dj
            if 0 <= ii < H and 0 <= jj < W and not seen[ii, jj]:
                seen[ii, jj] = True
                zn = max(float(z[ii, jj]), zc + eps)
                filled[ii, jj] = zn
                heapq.heappush(heap, (zn, ii, jj))

    return filled


def d8_receivers(zf, dx, dy):
    """
    The steepest-descent neighbour of each cell, as a flat index.

    A cell with no lower neighbour receives -1: it is an outlet, and the water
    leaves the domain there. After fill_depressions that happens only on the
    border, which is the property that makes the graph acyclic.

    The +inf frame is what avoids treating the border as a special case: the
    neighbour that is not there never wins the argmax. Framing with -inf would
    be wrong in a way worth naming -- it would make the whole border drain
    outward even where the terrain descends INTO the domain, and would truncate
    the drainage of the entire outer ring.
    """
    H, W = zf.shape
    padded = np.full((H + 2, W + 2), np.inf)
    padded[1:-1, 1:-1] = zf

    slopes = np.empty((8, H, W))
    for k, (di, dj) in enumerate(D8):
        dist = math.hypot(di * dy, dj * dx)
        neighbour = padded[1 + di:1 + di + H, 1 + dj:1 + dj + W]
        slopes[k] = (zf - neighbour) / dist

    best = np.argmax(slopes, axis=0)
    ii = np.arange(H)[:, None] + np.array([d[0] for d in D8])[best]
    jj = np.arange(W)[None, :] + np.array([d[1] for d in D8])[best]

    outlet = np.take_along_axis(slopes, best[None], axis=0)[0] <= 0
    receivers = np.where(outlet, -1, np.clip(ii, 0, H - 1) * W + np.clip(jj, 0, W - 1))
    return receivers.ravel().astype(np.int64)


def topological_order(receivers):
    """
    Cells ordered upstream to downstream (Kahn).

    After fill_depressions the flow graph is acyclic by construction -- the
    epsilon guarantees a strict descent -- so the order always exists. If it
    does not, an earlier step is wrong, and that is what the assertion catches
    rather than letting a partial order produce a plausible wrong answer.
    """
    n = receivers.size
    indegree = np.bincount(receivers[receivers >= 0], minlength=n)
    stack = list(np.flatnonzero(indegree == 0))
    order = []
    while stack:
        c = stack.pop()
        order.append(c)
        r = receivers[c]
        if r >= 0:
            indegree[r] -= 1
            if indegree[r] == 0:
                stack.append(r)
    if len(order) != n:
        raise ValueError(
            f"the flow graph has a cycle: {n - len(order)} cells are trapped. "
            "fill_depressions did not leave a strict descent, which means the "
            "DEM reached it with a value the epsilon could not separate."
        )
    return np.array(order, dtype=np.int64)


def flow_accumulation(receivers, order, shape):
    """How many cells drain through each cell, itself included."""
    acc = np.ones(receivers.size, dtype=np.int64)
    for c in order:
        r = receivers[c]
        if r >= 0:
            acc[r] += acc[c]
    return acc.reshape(shape)


def hand(z, receivers, order, drainage):
    """
    The height of each cell above the drainage cell it flows to.

    Walks the topological order backwards -- downstream first -- so the
    drainage elevation of the receiver is already resolved when a cell is
    visited. That is what replaces a per-cell search, which would cost
    O(n * path length).

    The height uses the ORIGINAL DEM, not the filled one. Inside a filled
    depression that produces a negative HAND, which is information -- the cell
    is below its drainage -- and not an error. The caller decides whether to
    clip at zero.
    """
    z_flat = z.ravel()
    drain_flat = drainage.ravel()
    ref = np.empty(z_flat.size)

    for c in order[::-1]:
        if drain_flat[c]:
            ref[c] = z_flat[c]
        else:
            r = receivers[c]
            ref[c] = ref[r] if r >= 0 else z_flat[c]

    return (z_flat - ref).reshape(z.shape)


def compute(z, dx, dy, drainage_km2=0.5, eps=1e-3):
    """The whole chain. Returns HAND, accumulation, drainage and the flow order."""
    cell_km2 = dx * dy / 1e6
    min_cells = max(1, int(round(drainage_km2 / cell_km2)))

    zf = fill_depressions(z, eps=eps)
    receivers = d8_receivers(zf, dx, dy)
    order = topological_order(receivers)
    acc = flow_accumulation(receivers, order, z.shape)
    drainage = acc >= min_cells
    h = hand(z, receivers, order, drainage)

    return {
        "hand": h,
        "acc": acc,
        "drainage": drainage,
        "filled": zf,
        "receivers": receivers,
        "order": order,
        "min_cells": min_cells,
        "cell_km2": cell_km2,
    }
