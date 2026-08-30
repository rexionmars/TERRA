"""
The colour policy for the continuous solar-terrain layers, and the raster drawn
under it.

Which palette a quantity gets, which domain it is drawn on, and which two
layers must share one. The last is the reason this is a module rather than a
function beside each product: two layers can only be compared if they were
drawn on the same domain, and a function that sees one array cannot know that.
render_scale owns the decision.

`composite` is imported inside the body that needs it, which keeps this module
free of the palette machinery until something asks it to draw.
"""

from __future__ import annotations

import numpy as np


def terrain_rgba(
    values: np.ndarray,
    valid: np.ndarray,
    vmin: float,
    vmax: float,
    palette: str,
) -> np.ndarray:
    """
    Colour a continuous terrain layer on a domain decided by the caller.

    The domain is an argument rather than derived here because two layers can
    only be compared if they were drawn on the same one, and this function sees
    a single array. `render_scale` owns that decision.
    """
    from terra.imagery import composite as comp

    if not np.isfinite(vmin) or not np.isfinite(vmax) or vmax <= vmin:
        vmin = 0.0 if not np.isfinite(vmin) else float(vmin)
        vmax = vmin + 1.0
    t = np.clip((np.nan_to_num(values, nan=vmin) - vmin) / (vmax - vmin), 0.0, 1.0)
    rgb = comp._lerp_cmap(t.astype(np.float32), comp.CONTINUOUS_STOPS[palette])
    h, w = values.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = (rgb[..., 0] * 255).astype(np.uint8)
    rgba[..., 1] = (rgb[..., 1] * 255).astype(np.uint8)
    rgba[..., 2] = (rgb[..., 2] * 255).astype(np.uint8)
    rgba[..., 3] = np.where(valid, 255, 0).astype(np.uint8)
    return rgba


# ------------------------------------------------------------- render policy
#
# Palette per quantity, matching the research renderers so an overlay and a
# published figure of the same quantity are the same colours: irradiation on
# inferno, shading loss on viridis, the seasonal ratio on a diverging ramp.
PALETTE_IRRADIATION = "inferno"


PALETTE_SHADING = "viridis"


PALETTE_ANISOTROPY = "rdbu_r"


# Fixed domains for the two layers whose value means something absolute.
# Anisotropy is a ratio with a reference at one; the window keeps that reference
# visible without spending half the ramp on values the quantity does not reach
# (0.33 to 0.83 over the study areas).
ANISOTROPY_DOMAIN = (0.3, 1.1)


ANISOTROPY_REFERENCE = 1.0


# Shading loss is a fraction; the research measures at most 0.19.
SHADING_DOMAIN = (0.0, 0.25)


# Seasons drawn on a shared domain, so the pair stays comparable.
SEASON_PAIR = {"winter": "summer", "summer": "winter"}


def render_scale(
    layer: str,
    values: np.ndarray | None = None,
    valid: np.ndarray | None = None,
    companion: np.ndarray | None = None,
    companion_valid: np.ndarray | None = None,
) -> dict:
    """
    Colour domain and palette for a terrain layer.

    Derived here rather than inside the renderer because winter and summer have
    to land on the same domain. Their spatial spread differs by roughly a factor
    of ten, so normalising each to its own range draws both at identical
    contrast and asserts the opposite of the measurement.

    `basis` records how the domain was chosen, so a client can say so instead of
    leaving the reader to assume.
    """
    if layer == "anisotropy":
        lo, hi = ANISOTROPY_DOMAIN
        return {"palette": PALETTE_ANISOTROPY, "min": lo, "max": hi,
                "reference": ANISOTROPY_REFERENCE, "basis": "fixed",
                "shared_with": None, "decimals": 2}

    if layer == "shading":
        lo, hi = SHADING_DOMAIN
        return {"palette": PALETTE_SHADING, "min": lo, "max": hi,
                "reference": None, "basis": "fixed",
                "shared_with": None, "decimals": 3}

    pool = _finite(values, valid)
    if layer in SEASON_PAIR and companion is not None:
        pool = np.concatenate([pool, _finite(companion, companion_valid)])
        basis, shared_with = "shared", SEASON_PAIR[layer]
    else:
        basis, shared_with = "own", None

    if pool.size == 0:
        lo, hi = 0.0, 1.0
    else:
        lo, hi = float(pool.min()), float(pool.max())
    return {"palette": PALETTE_IRRADIATION, "min": lo, "max": hi,
            "reference": None, "basis": basis,
            "shared_with": shared_with, "decimals": 0}


def _finite(values, valid) -> np.ndarray:
    """Valid, finite samples of a layer, flattened."""
    if values is None:
        return np.empty(0, dtype=float)
    m = np.isfinite(values)
    if valid is not None:
        m &= valid
    return values[m].ravel()
