"""
The vegetation-index series over an area, per date.

Mean and standard deviation of NDVI, EVI and SAVI across the AOI, optionally
under a crop mask, plus the temporal mean NDVI that the overlay is drawn from.
It is what the run band and the canopy both read the season out of.
"""

from __future__ import annotations

import json
import sys

import numpy as np

from terra.imagery import indices, sentinel2


def compute_aoi_vi_series(products, polygon, ref_prof, crop_mask=None):
    """Mean ± std NDVI/EVI/SAVI per date; also spatial NDVI temporal mean.

    Also keeps reflectance for the peak-NDVI scene so we can write a true-color
    AOI chip aligned to the same grid as the other overlays.

    `crop_mask` ADDS A SECOND SERIES, it does not narrow the first.

    An area mean over mixed cover is not the crop's index, and the gap is not
    small: on a measured soybean AOI the peak read 0.314 with a standard
    deviation of 0.190, which for a roughly even two-population mix puts the
    crop pixels near 0.50 and everything else near 0.12. Anything downstream
    that inverts that mean to a leaf area index -- which is what the canopy
    reading does -- is answering for an average of soybean and bare ground.

    Both are returned because they answer different questions and because the
    AOI-wide one is what every existing export and figure already carries;
    narrowing it in place would move numbers nobody asked to move.
    """
    from terra.imagery import composite as comp

    series = []
    crop_series = []
    dates = []
    ndvi_means = []
    ndvi_stack = []
    best_ndvi = -1.0
    best_rgb = None  # (red, green, blue, valid_mask)
    for product in products:
        try:
            blue = sentinel2.load_reflectance_to_reference_grid(product, "B02", polygon, ref_prof)
            green = sentinel2.load_reflectance_to_reference_grid(product, "B03", polygon, ref_prof)
            red = sentinel2.load_reflectance_to_reference_grid(product, "B04", polygon, ref_prof)
            nir = sentinel2.load_reflectance_to_reference_grid(product, "B08", polygon, ref_prof)
            ndvi = indices.calculate_ndvi(nir, red)
            evi = indices.calculate_evi(nir, red, blue)
            savi = indices.calculate_savi(nir, red)
            valid = ndvi != 0
            if not np.any(valid):
                continue
            date_str = product["date"].strftime("%Y-%m-%d")
            dates.append(product["date"])
            mean_ndvi = float(np.mean(ndvi[valid]))
            ndvi_means.append(mean_ndvi)
            ndvi_stack.append(ndvi.astype(np.float32))
            if mean_ndvi > best_ndvi:
                best_ndvi = mean_ndvi
                best_rgb = (
                    red.astype(np.float32),
                    green.astype(np.float32),
                    blue.astype(np.float32),
                    valid,
                )
            series.append(
                {
                    "date": date_str,
                    "ndvi_mean": round(mean_ndvi, 4),
                    "ndvi_std": round(float(np.std(ndvi[valid])), 4),
                    "evi_mean": round(float(np.mean(evi[valid])), 4),
                    "evi_std": round(float(np.std(evi[valid])), 4),
                    "savi_mean": round(float(np.mean(savi[valid])), 4),
                    "savi_std": round(float(np.std(savi[valid])), 4),
                }
            )
            if crop_mask is not None:
                # Valid AND crop. A date whose crop pixels were all cloud drops
                # out of this series while staying in the AOI-wide one, so the
                # two can have different lengths and each carries its own dates.
                on_crop = valid & crop_mask
                n = int(np.count_nonzero(on_crop))
                if n:
                    crop_series.append(
                        {
                            "date": date_str,
                            "ndvi_mean": round(float(np.mean(ndvi[on_crop])), 4),
                            "ndvi_std": round(float(np.std(ndvi[on_crop])), 4),
                            "evi_mean": round(float(np.mean(evi[on_crop])), 4),
                            "evi_std": round(float(np.std(evi[on_crop])), 4),
                            "savi_mean": round(float(np.mean(savi[on_crop])), 4),
                            "savi_std": round(float(np.std(savi[on_crop])), 4),
                            "n_pixels": n,
                        }
                    )
        except Exception as e:
            sys.stderr.write(json.dumps({"progress": -1, "msg": f"VI series: {e}"}) + "\n")
            continue

    ndvi_mean_map = None
    valid_mask = None
    if ndvi_stack:
        stack = np.stack(ndvi_stack, axis=0)
        # Mean over dates where NDVI != 0
        nonzero = stack != 0
        with np.errstate(invalid="ignore"):
            ndvi_mean_map = np.where(
                nonzero.any(axis=0),
                stack.sum(axis=0) / np.maximum(nonzero.sum(axis=0), 1),
                0.0,
            ).astype(np.float32)
        valid_mask = nonzero.any(axis=0)

    true_color_rgba = None
    if best_rgb is not None:
        r, g, b, mask = best_rgb
        true_color_rgba = comp.rgb_to_rgba(r, g, b, mask)

    return (series, crop_series, dates, ndvi_means, ndvi_mean_map,
            valid_mask, true_color_rgba)
