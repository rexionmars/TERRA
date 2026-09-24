"""
The mineral map's derived rasters as RGBA, and the legend each is read with.

Every layer is one of three kinds, and the payload says which, because the
frontend reads them differently:

    classes   one hard colour per class, no blending, so the colour inverts
              back to the class (frontend lib/classMask.ts); the legend lists
              every colour painted, with `excluded` on those that are not a
              class (cells observed only under the mask).
    ramp      a continuous quantity between `min` and `max`, clamped, drawn
              through `colors` evenly spaced; the value itself is in the
              GeoTIFF, since a colour read back names an interval, not a number.
    rgb       three quantities in the three channels, named in `channels`.

Transparent pixels are cells with no value: outside the area, not observed, or
not among the cells the layer is about.
"""

from __future__ import annotations

import numpy as np

OPAQUE = 235   # the class maps' alpha, mapping.class_rgba's


def hex_rgb(color: str) -> tuple[int, int, int]:
    c = color.lstrip('#')
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def classes_rgba(codes: np.ndarray, legend: list[dict]) -> np.ndarray:
    """
    Paint `codes` (legend ordinal per cell, -1 transparent) with the legend's
    colours. Legend items carry `color` and an optional `alpha` (0-255).
    """
    h, w = codes.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for i, item in enumerate(legend):
        sel = codes == i
        if sel.any():
            r, g, b = hex_rgb(item['color'])
            rgba[sel] = (r, g, b, int(item.get('alpha', OPAQUE)))
    return rgba


def ramp_rgba(values: np.ndarray, lo: float, hi: float, colors: list[str]) -> np.ndarray:
    """Linear colour ramp over [lo, hi], clamped at both ends; NaN transparent."""
    h, w = values.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    ok = np.isfinite(values)
    if not ok.any() or hi <= lo:
        return rgba
    stops = np.array([hex_rgb(c) for c in colors], dtype=np.float64)
    t = np.clip((values[ok] - lo) / (hi - lo), 0.0, 1.0) * (len(colors) - 1)
    i0 = np.minimum(np.floor(t).astype(int), len(colors) - 2)
    f = (t - i0)[:, None]
    rgb = stops[i0] * (1.0 - f) + stops[i0 + 1] * f
    rgba[ok, :3] = np.round(rgb).astype(np.uint8)
    rgba[ok, 3] = OPAQUE
    return rgba


def rgb_rgba(r: np.ndarray, g: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Three 0-1 quantities as the three channels; a cell missing any is transparent."""
    h, w = r.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    ok = np.isfinite(r) & np.isfinite(g) & np.isfinite(b)
    for k, v in enumerate((r, g, b)):
        rgba[ok, k] = np.round(np.clip(v[ok], 0.0, 1.0) * 255.0).astype(np.uint8)
    rgba[ok, 3] = OPAQUE
    return rgba


def spread(values: np.ndarray) -> dict | None:
    """Count, mean, standard deviation and the 10/50/90th percentiles, or None."""
    v = values[np.isfinite(values)]
    if len(v) == 0:
        return None
    p10, p50, p90 = np.percentile(v, [10, 50, 90])
    return {'cells': int(len(v)), 'mean': round(float(v.mean()), 4),
            'sd': round(float(v.std()), 4), 'p10': round(float(p10), 4),
            'p50': round(float(p50), 4), 'p90': round(float(p90), 4)}
