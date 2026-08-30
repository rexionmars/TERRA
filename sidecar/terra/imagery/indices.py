"""
Vegetation indices over reflectance, each clipped to the range it can occupy.

A division by a sum of reflectances is undefined where both are zero, which is
every masked cell of a clipped scene. Each function replaces the non-finite
result with zero rather than propagating NaN, because the arrays here feed a
feature matrix and a model cannot be handed a NaN.
"""

from __future__ import annotations

import numpy as np


def calculate_ndvi(nir, red):
    with np.errstate(divide='ignore', invalid='ignore'):
        ndvi = (nir - red) / (nir + red)
        ndvi = np.where(np.isfinite(ndvi), ndvi, 0)
    return np.clip(ndvi, -1, 1)


def calculate_evi(nir, red, blue, G=2.5, C1=6.0, C2=7.5, L=1.0):
    with np.errstate(divide='ignore', invalid='ignore'):
        evi = G * (nir - red) / (nir + C1 * red - C2 * blue + L)
        evi = np.where(np.isfinite(evi), evi, 0)
    return np.clip(evi, -1, 1)


def calculate_savi(nir, red, L=0.5):
    with np.errstate(divide='ignore', invalid='ignore'):
        savi = ((nir - red) / (nir + red + L)) * (1 + L)
        savi = np.where(np.isfinite(savi), savi, 0)
    return np.clip(savi, -1, 1)
