"""
Leaf area index from NDVI, by inverting Beer-Lambert on the vegetation index.

WHY THIS IS HERE. The canopy field takes an LAI. Asking a user to type one is
asking them for a quantity nobody measures in the field, while the application
already holds what does determine it: it classifies the crop and it collects a
Sentinel-2 NDVI series over the same ground. This is the link between them, and
it did not exist anywhere in the sidecar.

THE INVERSION (Baret & Guyot, 1991):

    LAI = -(1/k) * ln( (NDVI_inf - NDVI) / (NDVI_inf - NDVI_soil) )

NDVI approaches a ceiling as leaf area accumulates, so the relation is the same
exponential saturation Beer-Lambert describes, read backwards.

NONE OF THE THREE PARAMETERS IS UNIVERSAL. NDVI_soil is the bare soil of that
field, NDVI_inf the value its closed canopy reaches, and k an extinction
coefficient for that crop and that sensor geometry. They are calibration, not
constants, and the defaults below are a starting point for a soy or maize field
rather than an answer. A surface offering this should say whose numbers they
are.

IT SATURATES, AND THE SATURATION IS THE POINT TO REPORT. Above roughly LAI 4 the
index barely moves, so a small error in NDVI becomes a large one in LAI: at
NDVI 0.85 with these defaults one hundredth of NDVI is worth about 0.3 of LAI,
and by 0.88 it is worth 0.9. Past that the inverted figure is extrapolation
rather than measurement, which is why `lai_from_ndvi` reports how much of the
answer sits in that regime instead of only returning it.

A NOTE ON THE k HERE AND THE G ELSEWHERE. This k is the extinction coefficient
of the INVERSION -- how NDVI saturates with leaf area. It is not the projection
coefficient the canopy engines use to attenuate light, which is G_LEAF = 0.5 for
a spherical leaf angle distribution. They are different quantities that happen
to sit in the same place in two exponentials, and substituting one for the other
is not a small error: on a real series it moved an interception comparison by 22
percentage points and reversed its sign.
"""

from __future__ import annotations

import numpy as np

# A soy or maize field, as a starting point. Every one of them is calibration.
NDVI_SOIL = 0.15
NDVI_INF = 0.90
K_EXTINCTION = 0.65

# Where the inversion stops measuring and starts extrapolating.
SATURATION_LAI = 4.0
# And where it is refused outright, since beyond this the index has nothing
# left to say and any figure is the ceiling plus noise.
MAX_LAI = 8.0


def lai_from_ndvi(ndvi, ndvi_soil=NDVI_SOIL, ndvi_inf=NDVI_INF, k=K_EXTINCTION,
                  lai_max=MAX_LAI):
    """
    Invert one NDVI, or an array of them, to leaf area index.

    Values at or below the soil return zero rather than a negative leaf area.
    Values at or above the ceiling are clamped to `lai_max`, because the
    logarithm diverges there and the divergence is an artefact of the model, not
    a canopy.
    """
    if not ndvi_inf > ndvi_soil:
        raise ValueError(
            f"the closed-canopy NDVI ({ndvi_inf:g}) has to exceed the bare-soil "
            f"one ({ndvi_soil:g}); as given the inversion has no range to work in")
    if k <= 0:
        raise ValueError("the extinction coefficient must be positive")

    x = np.asarray(ndvi, dtype=float)
    ratio = (ndvi_inf - x) / (ndvi_inf - ndvi_soil)
    # Clipped low rather than allowed to reach zero: the log diverges at the
    # ceiling, and a pixel one thousandth above it is not an infinite canopy.
    ratio = np.clip(ratio, np.exp(-k * lai_max), 1.0)
    # `+ 0.0` normalises negative zero, and it is not cosmetic once this leaves
    # Python. Bare soil clips the ratio to exactly 1.0, and `-log(1.0)` is -0.0
    # in IEEE 754; it compares equal to zero but serialises to JSON as `-0.0` and
    # renders as "-0.00". On a real soybean AOI the first three dates of the
    # series read "-0.00" leaf area, which is a negative canopy as far as anyone
    # reading the panel can tell. The docstring above already promises zero.
    lai = -np.log(ratio) / k + 0.0
    return float(lai) if np.isscalar(ndvi) or np.ndim(ndvi) == 0 else lai


def invert_series(ndvi, days=None, window_days=12, **kwargs):
    """
    A whole series, smoothed first, with the saturated fraction reported.

    SMOOTHING IS BY DATE, NOT BY POSITION. A cloud-screened series is irregular
    -- five days between two observations, or three months -- so a window
    counted in samples averages across whatever survived, which on a gappy
    series means mixing dates that are a season apart. The window here is in
    days, and `days` is required for that reason; without it the series is
    returned unsmoothed rather than smoothed wrongly.
    """
    x = np.asarray(ndvi, dtype=float)
    if days is None:
        smoothed = x
    else:
        d = np.asarray(days, dtype=float)
        if len(d) != len(x):
            raise ValueError(f"{len(x)} values against {len(d)} dates")
        smoothed = np.empty_like(x)
        for i in range(len(x)):
            near = np.abs(d - d[i]) <= window_days / 2
            smoothed[i] = np.nanmean(x[near]) if near.any() else x[i]

    lai = lai_from_ndvi(smoothed, **kwargs)
    lai = np.atleast_1d(lai)
    finite = np.isfinite(lai)
    saturated = int(np.sum(lai[finite] >= SATURATION_LAI))

    return {
        "ndvi": [float(v) for v in smoothed],
        "lai": [float(v) for v in lai],
        "peak_lai": float(np.nanmax(lai)) if finite.any() else 0.0,
        "n": int(finite.sum()),
        # Reported rather than only returned. Above this the index barely moves
        # and the answer is extrapolation; a reader has to be told which part of
        # the series is in that regime.
        "n_saturated": saturated,
        "saturation_lai": SATURATION_LAI,
        "parameters": {
            "ndvi_soil": float(kwargs.get("ndvi_soil", NDVI_SOIL)),
            "ndvi_inf": float(kwargs.get("ndvi_inf", NDVI_INF)),
            "k": float(kwargs.get("k", K_EXTINCTION)),
        },
    }
