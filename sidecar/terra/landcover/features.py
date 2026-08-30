"""
The 80 features per pixel the spectro-temporal Random Forest was fitted on.

Band statistics, temporal descriptors of NDVI, EVI and SAVI, and 22 raw NDVI
dates. The order is the model's: feature_names.joblib records it, and a matrix
built in another order is a matrix the head reads as different measurements.
"""

from __future__ import annotations

import numpy as np

from terra.imagery import indices, sentinel2

SOJA_CLASS_ID = 39


def compute_index_features(time_series):
    """Compute the 14 temporal features per index used by the trained model."""
    features = []
    for ts in time_series:
        feat = []
        feat.append(np.mean(ts))
        feat.append(np.std(ts))
        feat.append(np.max(ts))
        feat.append(np.min(ts))
        feat.append(np.max(ts) - np.min(ts))
        feat.append(np.median(ts))
        feat.append(np.argmax(ts))
        feat.append(np.argmin(ts))
        mid = len(ts) // 2
        wet = np.mean(ts[:mid]) if mid > 0 else np.mean(ts)
        dry = np.mean(ts[mid:]) if mid > 0 else np.mean(ts)
        feat.append(wet)
        feat.append(dry)
        feat.append(wet - dry)
        diff = np.diff(ts)
        feat.append(np.mean(diff) if len(diff) > 0 else 0.0)
        feat.append(np.max(diff) if len(diff) > 0 else 0.0)
        feat.append(np.min(diff) if len(diff) > 0 else 0.0)
        features.append(feat)
    return np.array(features)


def build_feature_matrix(products, polygon, ref_prof, n_dates_model, note=None):
    """
    Build the (N_pixels, 80) feature matrix from a list of products, matching
    the training pipeline. Returns (feature_matrix, valid_mask_2d) or (None, None).
    """
    ndvi_list, evi_list, savi_list = [], [], []
    band_lists = {'B02': [], 'B03': [], 'B04': [], 'B08': []}
    for product in products:
        try:
            blue = sentinel2.load_band_to_reference_grid(product, 'B02', polygon, ref_prof)
            green = sentinel2.load_band_to_reference_grid(product, 'B03', polygon, ref_prof)
            red = sentinel2.load_band_to_reference_grid(product, 'B04', polygon, ref_prof)
            nir = sentinel2.load_band_to_reference_grid(product, 'B08', polygon, ref_prof)
            blue_r, green_r, red_r, nir_r = (
                sentinel2.as_trained(blue), sentinel2.as_trained(green),
                sentinel2.as_trained(red), sentinel2.as_trained(nir))
            ndvi_list.append(indices.calculate_ndvi(nir_r, red_r))
            evi_list.append(indices.calculate_evi(nir_r, red_r, blue_r))
            savi_list.append(indices.calculate_savi(nir_r, red_r))
            band_lists['B02'].append(blue_r)
            band_lists['B03'].append(green_r)
            band_lists['B04'].append(red_r)
            band_lists['B08'].append(nir_r)
        except Exception as e:
            if note:
                note(f'band error: {e}')
            continue
    if len(ndvi_list) == 0:
        return None, None

    ndvi_stack = np.array(ndvi_list)
    evi_stack = np.array(evi_list)
    savi_stack = np.array(savi_list)
    band_stacks = {k: np.array(v) for k, v in band_lists.items()}

    n_times, height, width = ndvi_stack.shape
    ndvi_pixels = ndvi_stack.reshape(n_times, -1).T
    evi_pixels = evi_stack.reshape(n_times, -1).T
    savi_pixels = savi_stack.reshape(n_times, -1).T

    valid_obs = np.sum(ndvi_pixels != 0, axis=1)
    valid_mask_flat = valid_obs >= max(1, n_times * 0.5)

    for arr in [ndvi_pixels, evi_pixels, savi_pixels]:
        valid_arr = arr[valid_mask_flat]
        for i in range(valid_arr.shape[0]):
            ts = valid_arr[i]
            zero_mask = ts == 0
            if np.any(zero_mask) and np.any(~zero_mask):
                ts[zero_mask] = np.interp(
                    np.where(zero_mask)[0], np.where(~zero_mask)[0], ts[~zero_mask]
                )
                valid_arr[i] = ts
        arr[valid_mask_flat] = valid_arr

    all_features = []
    for pixels in [ndvi_pixels, evi_pixels, savi_pixels]:
        all_features.append(compute_index_features(pixels[valid_mask_flat]))
    for band_name in ['B02', 'B03', 'B04', 'B08']:
        stack = band_stacks[band_name]
        band_pixels = stack.reshape(n_times, -1).T[valid_mask_flat]
        band_mean = np.mean(band_pixels, axis=1)
        band_std = np.std(band_pixels, axis=1)
        band_max = np.max(band_pixels, axis=1)
        band_min = np.min(band_pixels, axis=1)
        all_features.append(np.column_stack([band_mean, band_std, band_max, band_min]))

    ndvi_raw = ndvi_pixels[valid_mask_flat]
    if n_times < n_dates_model:
        pad = np.zeros((ndvi_raw.shape[0], n_dates_model - n_times))
        ndvi_raw = np.hstack([ndvi_raw, pad])
    elif n_times > n_dates_model:
        ndvi_raw = ndvi_raw[:, -n_dates_model:]
    all_features.append(ndvi_raw)

    feature_matrix = np.hstack(all_features)
    valid_mask_2d = valid_mask_flat.reshape(height, width)
    return feature_matrix, valid_mask_2d
