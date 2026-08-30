"""
What the terrain does to the irradiance reaching a tilted surface.

Two effects, in opposite directions. Slope and aspect change how much of the
resource a surface intercepts, which is the plane-of-array lookup; the pixel's
own horizon takes some of it away, which is the beam shading and the sky view
factor. The atmospheric resource has no spatial structure at AOI scale, but the
irradiation reaching an inclined surface does, because the surface is terrain.
That is the mappable quantity, and this is the module that maps it.

It reads N_HORIZON_AZIMUTHS from terra.sun.position rather than restating it.
A solar azimuth indexes straight into the horizon array built here, so the two
sector counts have to be one number and two literals is how they stop being.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from terra.energy.pv import transpose
from terra.sun.position import N_HORIZON_AZIMUTHS

# Lookup grid over (slope, aspect). Coarser than the research grid: against the
# research configuration the mean error is 0.04 percent and the maximum 0.31,
# while the table shrinks from 1116 pairs to 198. Shortening the period is what
# costs accuracy, so the period is kept and the grid is coarsened.
SLOPE_GRID = np.arange(0.0, 31.0, 3.0)


ASPECT_GRID = np.arange(0.0, 360.0, 20.0)


def build_poa_lookup(
    df: pd.DataFrame,
    solpos: pd.DataFrame,
    n_years: float,
    slopes: np.ndarray = SLOPE_GRID,
    aspects: np.ndarray = ASPECT_GRID,
    progress=None,
) -> np.ndarray:
    """
    Plane-of-array irradiation for every (slope, aspect) pair, kWh/m2/year.

    Transposition is the expensive step, so it runs once per pair here and the
    pixel grid is interpolated from the table rather than transposed per pixel.
    """
    table = np.empty((len(slopes), len(aspects)), dtype=float)
    for i, tilt in enumerate(slopes):
        if progress:
            progress(i, len(slopes))
        if tilt == 0.0:
            # A horizontal surface has no aspect; one transposition serves all.
            poa = transpose(df, solpos, 0.0, 0.0)
            table[i, :] = float(poa["poa_global"].sum()) / 1000.0 / n_years
            continue
        for j, az in enumerate(aspects):
            poa = transpose(df, solpos, float(tilt), float(az))
            table[i, j] = float(poa["poa_global"].sum()) / 1000.0 / n_years
    return table


def interpolate_poa(
    slope: np.ndarray,
    aspect: np.ndarray,
    table: np.ndarray,
    slopes: np.ndarray = SLOPE_GRID,
    aspects: np.ndarray = ASPECT_GRID,
) -> np.ndarray:
    """
    Bilinear interpolation of the lookup table onto the pixel grid.

    Aspect wraps at 360 degrees, so the table is extended by one column before
    interpolating rather than clamped, which would flatten north-facing slopes.
    """
    s = np.clip(np.nan_to_num(slope, nan=0.0), slopes[0], slopes[-1])
    a = np.mod(np.nan_to_num(aspect, nan=0.0), 360.0)

    aspects_ext = np.append(aspects, 360.0)
    table_ext = np.concatenate([table, table[:, :1]], axis=1)

    si = np.clip(np.searchsorted(slopes, s) - 1, 0, len(slopes) - 2)
    ai = np.clip(np.searchsorted(aspects_ext, a) - 1, 0, len(aspects_ext) - 2)
    s0, s1 = slopes[si], slopes[si + 1]
    a0, a1 = aspects_ext[ai], aspects_ext[ai + 1]
    ws = np.where(s1 > s0, (s - s0) / (s1 - s0), 0.0)
    wa = np.where(a1 > a0, (a - a0) / (a1 - a0), 0.0)

    v00 = table_ext[si, ai]
    v01 = table_ext[si, ai + 1]
    v10 = table_ext[si + 1, ai]
    v11 = table_ext[si + 1, ai + 1]
    return (
        v00 * (1 - ws) * (1 - wa)
        + v01 * (1 - ws) * wa
        + v10 * ws * (1 - wa)
        + v11 * ws * wa
    )


# ------------------------------------------------------------ horizon shading
#
# Terrain blocks the beam component near sunrise and sunset, and in an incised
# valley it blocks it for much of the day. The research measures a mean loss of
# 1.1 to 1.3 per cent of the annual beam over the study areas and up to 19 per
# cent in valley bottoms, so leaving it out overstates exactly the pixels a
# siting map should be most careful about.
# The research searches 60 pixels on a 27 x 30 m grid, about 1.7 km. Carried in
# metres because the DEM window here is in geographic degrees and its pixel size
# varies with latitude.
HORIZON_MAX_DIST_M = 1700.0


HORIZON_MAX_STEPS = 120


def horizon_angles(
    elevation: np.ndarray,
    dx_m: float,
    dy_m: float,
    n_azimuths: int = N_HORIZON_AZIMUTHS,
    max_dist_m: float = HORIZON_MAX_DIST_M,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Horizon elevation angle per pixel, per azimuth, walking outward on the DEM.

    Azimuths are clockwise from north, matching the aspect convention, so a
    solar azimuth indexes straight into the result.
    """
    h, w = elevation.shape
    az_deg = np.arange(0.0, 360.0, 360.0 / n_azimuths)
    step_m = max(min(dx_m, dy_m), 1e-6)
    n_steps = int(min(HORIZON_MAX_STEPS, max(1, round(max_dist_m / step_m))))

    z = np.nan_to_num(elevation, nan=float(np.nanmedian(elevation)))
    rows, cols = np.mgrid[0:h, 0:w]
    horizon = np.zeros((h, w, n_azimuths), dtype=np.float32)

    for k, az in enumerate(az_deg):
        drow = -np.cos(np.radians(az))   # north is a decreasing row index
        dcol = np.sin(np.radians(az))
        best = np.zeros((h, w), dtype=np.float32)
        for step in range(1, n_steps + 1):
            r = np.rint(rows + drow * step).astype(int)
            c = np.rint(cols + dcol * step).astype(int)
            inside = (r >= 0) & (r < h) & (c >= 0) & (c < w)
            dz = z[np.clip(r, 0, h - 1), np.clip(c, 0, w - 1)] - z
            dist = np.hypot(dcol * step * dx_m, drow * step * dy_m)
            ang = np.degrees(np.arctan2(dz, max(dist, 1e-6)))
            best = np.maximum(best, np.where(inside, ang, 0.0).astype(np.float32))
        horizon[:, :, k] = np.maximum(best, 0.0)
    return horizon, az_deg


def shading_loss_fraction(
    horizon: np.ndarray,
    hist: np.ndarray,
    el_edges: np.ndarray,
) -> np.ndarray:
    """
    Share of the beam energy each pixel loses to its own horizon.

    Per azimuth sector, the cumulative beam energy arriving below the pixel
    horizon is blocked; sectors are summed and normalised by the annual total.
    """
    total = hist.sum()
    if total <= 0:
        return np.zeros(horizon.shape[:2])

    cum = np.cumsum(hist, axis=1)
    centres = 0.5 * (el_edges[:-1] + el_edges[1:])
    blocked = np.zeros(horizon.shape[:2], dtype=float)
    for k in range(horizon.shape[2]):
        idx = np.clip(np.searchsorted(centres, horizon[:, :, k]) - 1,
                      0, len(centres) - 1)
        blocked += np.where(horizon[:, :, k] > centres[0], cum[k][idx], 0.0)
    return np.clip(blocked / total, 0.0, 1.0)


# Below this mean horizon there is no enclosure to measure. Derived from the
# relation between the two: an isotropic sky view of cos^2(h) puts a 2 degree
# mean horizon at a 0.12 percent diffuse loss, which is under the rounding of
# every figure this module publishes. The threshold is read off the horizon the
# chain already traced, so it costs nothing to evaluate.
SVF_MIN_MEAN_HORIZON_DEG = 2.0


def sky_view_factor(horizon: np.ndarray) -> np.ndarray:
    """
    Share of the isotropic sky dome each pixel still sees.

    For a horizon elevation h in an azimuth sector, the fraction of the diffuse
    hemisphere that sector still admits is cos^2(h) (the sector integral of the
    isotropic radiance weighted by the cosine response of a horizontal plane).
    Averaging over sectors gives the pixel's sky view factor.

    Shading removed beam energy only, which is the expensive half to compute and
    the small half to collect: measured on a synthetic incised valley the beam
    term moves the median yield by -0.003 percent while the diffuse term moves
    it by -2.82 percent. On flat ground both vanish (-0.04 percent). The horizon
    that carries the beam answer already carries this one.
    """
    if horizon.size == 0:
        return np.ones(horizon.shape[:2], dtype=float)
    h = np.clip(np.nan_to_num(horizon, nan=0.0), 0.0, 90.0)
    return np.clip(np.cos(np.radians(h)) ** 2, 0.0, 1.0).mean(axis=2)


def diffuse_loss_fraction(horizon: np.ndarray) -> np.ndarray:
    """Share of the diffuse irradiance each pixel loses to its own horizon."""
    return np.clip(1.0 - sky_view_factor(horizon), 0.0, 1.0)


def horizon_enclosure(horizon: np.ndarray) -> dict:
    """
    Whether the terrain encloses the site enough for the diffuse loss to be a
    figure rather than noise, and the evidence for the verdict.

    Returned rather than applied, so the caller reports the threshold it was
    judged against instead of a bare boolean.
    """
    if horizon.size == 0:
        return {
            "mean_horizon_deg": 0.0,
            "max_horizon_deg": 0.0,
            "threshold_deg": SVF_MIN_MEAN_HORIZON_DEG,
            "encloses": False,
        }
    h = np.clip(np.nan_to_num(horizon, nan=0.0), 0.0, 90.0)
    mean_h = float(np.mean(h))
    return {
        "mean_horizon_deg": round(mean_h, 4),
        "max_horizon_deg": round(float(np.max(h)), 4),
        "threshold_deg": SVF_MIN_MEAN_HORIZON_DEG,
        "encloses": bool(mean_h >= SVF_MIN_MEAN_HORIZON_DEG),
    }
