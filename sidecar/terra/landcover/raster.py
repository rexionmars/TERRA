"""
The classification written out: the overlay, the GeoTIFF, and the two
diagnostic ramps.

The overlay and the reference are drawn from one legend, which is why the
palette lives beside them rather than in each: the two used to carry their own
colour literal and disagreed on every class they shared.
"""

from __future__ import annotations

import numpy as np
import rasterio

from terra.landcover.palette import CLASSIFIER_COLORS as MAPBIOMAS_COLORS, hex_to_rgb


def write_confidence_png(confidence_map, valid_mask, out_path):
    """Write a single-band confidence overlay as RGBA (blue→cyan→yellow)."""
    h, w = confidence_map.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    conf = np.clip(confidence_map, 0, 1)
    mask = valid_mask & (conf > 0)
    # Cool→hot ramp used by the map legend (keep in sync with ConfidenceLegend CSS).
    r = np.clip((conf - 0.5) * 2.0, 0, 1)
    g = np.clip(conf * 1.2, 0, 1)
    b = np.clip(1.0 - conf * 0.5, 0, 1)
    rgba[..., 0] = (r * 255).astype(np.uint8)
    rgba[..., 1] = (g * 255).astype(np.uint8)
    rgba[..., 2] = (b * 255).astype(np.uint8)
    rgba[..., 3] = (conf * 200).astype(np.uint8)
    rgba[~mask, 3] = 0
    with rasterio.open(
        out_path, "w", driver="PNG", height=h, width=w, count=4, dtype="uint8"
    ) as dst:
        for i in range(4):
            dst.write(rgba[:, :, i], i + 1)


def write_ndvi_mean_png(ndvi_mean, valid_mask, out_path):
    """Write temporal-mean NDVI as RGBA using a yellow→green ramp."""
    h, w = ndvi_mean.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    v = np.clip(ndvi_mean, 0.0, 1.0)
    # YlGn-ish: low = #ffffcc, mid = #78c679, high = #006837
    r = np.clip(1.0 - v * 0.85, 0, 1)
    g = np.clip(0.80 + v * 0.15, 0, 1)
    b = np.clip(0.45 * (1.0 - v), 0, 1)
    rgba[..., 0] = (r * 255).astype(np.uint8)
    rgba[..., 1] = (g * 255).astype(np.uint8)
    rgba[..., 2] = (b * 255).astype(np.uint8)
    rgba[..., 3] = 255
    rgba[~valid_mask, 3] = 0
    with rasterio.open(
        out_path, "w", driver="PNG", height=h, width=w, count=4, dtype="uint8"
    ) as dst:
        for i in range(4):
            dst.write(rgba[:, :, i], i + 1)


def write_overlay_png(classification_map, out_path):
    """Write an RGBA PNG of the classification map using the MapBiomas palette."""
    h, w = classification_map.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for cls_id, hex_color in MAPBIOMAS_COLORS.items():
        mask = classification_map == cls_id
        if np.any(mask):
            r, g, b = hex_to_rgb(hex_color)
            rgba[mask] = [r, g, b, 255]
    # invalid pixels stay fully transparent (alpha = 0)
    with rasterio.open(
        out_path, 'w', driver='PNG', height=h, width=w, count=4, dtype='uint8'
    ) as dst:
        for i in range(4):
            dst.write(rgba[:, :, i], i + 1)


def write_classification_tif(classification_map, ref_profile, out_path):
    """Write the classification map as a georeferenced GeoTIFF (from notebooks)."""
    tif_profile = {
        'driver': 'GTiff',
        'dtype': 'int16',
        'width': ref_profile['width'],
        'height': ref_profile['height'],
        'count': 1,
        'crs': ref_profile['crs'],
        'transform': ref_profile['transform'],
        'compress': 'lzw',
        'nodata': -1,
    }
    with rasterio.open(out_path, 'w', **tif_profile) as dst:
        dst.write(classification_map.astype(np.int16), 1)
