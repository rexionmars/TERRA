"""
Slope and aspect over a grid of elevations, and the cell size they need.

Read by the solar terrain and siting chains, which ask how much irradiation
each cell of an area receives and where a plant could stand. Nothing here
reads a catalogue: it takes an array that terra.terrain.dem already returned.

TWO PIXEL SIZES IN ONE PACKAGE, DELIBERATELY, FOR NOW. `pixel_size_m` here and
`hand.pixel_size_m` compute the same quantity and disagree: this one uses
111_320 m per degree on both axes, hand uses 110_540 on the meridional one,
which is 0.7 percent in dy. They also take different arguments -- an affine
transform and a latitude here, a latitude and two degree spacings there.

They are not unified in the move that brought this function here, because
unifying them changes the slope every solar terrain run reports, and a move is
not the place to change a published number. The call sites are qualified by
module, so neither can be reached by accident; what is left is to decide which
constant is right and change the numbers on purpose.
"""

from __future__ import annotations

import numpy as np

def pixel_size_m(transform, lat: float) -> tuple[float, float]:
    """Approximate pixel dimensions in metres for a geographic grid."""
    dx_deg, dy_deg = abs(transform.a), abs(transform.e)
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = m_per_deg_lat * np.cos(np.radians(lat))
    return dx_deg * m_per_deg_lon, dy_deg * m_per_deg_lat


def horn_slope_aspect(z: np.ndarray, dx_m: float, dy_m: float):
    """
    Slope and aspect by the Horn (1981) third-order finite difference.

    Aspect is the compass bearing of the downhill direction, clockwise from
    north. A flat cell has no aspect and is returned as NaN rather than as a
    bearing of zero, which would read as north-facing.
    """
    p = np.pad(z, 1, mode="edge")
    nw, n_, ne = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    w_, e_ = p[1:-1, :-2], p[1:-1, 2:]
    sw, s_, se = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]

    # Rows increase southward, so the north gradient is top minus bottom.
    gx = ((ne + 2 * e_ + se) - (nw + 2 * w_ + sw)) / (8.0 * dx_m)
    gy = ((nw + 2 * n_ + ne) - (sw + 2 * s_ + se)) / (8.0 * dy_m)

    grad = np.hypot(gx, gy)
    slope = np.degrees(np.arctan(grad))
    aspect = np.degrees(np.arctan2(-gx, -gy)) % 360.0
    aspect = np.where(grad < 1e-9, np.nan, aspect)
    return slope, aspect
