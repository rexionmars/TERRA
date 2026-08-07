#!/usr/bin/env python3
"""
Inference sidecar for geosense-infer.

Reads a JSON request from stdin, runs the trained Random Forest land-cover
classifier over a Sentinel-2 L2A time series clipped to a study-area polygon,
and writes a JSON result to stdout. Progress messages are written to stderr as
one JSON object per line.

The feature engineering, band loading, vegetation indices and georeferencing
logic are reproduced from the project notebooks
(022026/experiments/crop_classification_mapbiomas.ipynb and
ground_truth_temporal_validation.ipynb) to preserve numerical equivalence with
the published results.

Request (stdin, single JSON object):
    {
      "model_dir": "<path to output_mapbiomas/model>",
      "sentinel_dir": "<directory containing *.SAFE products>",
      "tiles": ["T22JBT", "T21JZN"],          # optional tile filter
      "polygon_geojson": {...},                # GeoJSON geometry (Polygon)
      "mapbiomas_path": "<path to mapbiomas_*.tif>",  # optional; enables soja retention
      "mode": "single" | "temporal",          # single: full stack; temporal: cumulative
      "work_dir": "<output directory>"
    }

Result (stdout, single JSON object):
    {
      "extent": {"lon_min":.., "lon_max":.., "lat_min":.., "lat_max":..},
      "overlay_png": "<work_dir>/overlay.png",
      "raster_tif": "<work_dir>/classification_map.tif",
      "n_dates": <int>,
      "date_range": ["YYYY-MM-DD", "YYYY-MM-DD"],
      "class_stats": [{"class_id","name","color","pixels","pct","area_ha"}],
      "temporal": [{"date","n_dates_stack","soja_ndvi_mean","soja_retention_pct","dominant"}]
    }
"""

import sys
import json
from pathlib import Path
from datetime import datetime
import xml.etree.ElementTree as ET

import numpy as np
import rasterio
from rasterio.mask import mask as rio_mask
from rasterio.warp import reproject, Resampling
from rasterio.windows import from_bounds
from shapely.geometry import Polygon, shape
from shapely.ops import transform as shp_transform
from pyproj import Transformer
import joblib

import warnings
warnings.filterwarnings('ignore')

SOJA_CLASS_ID = 39

# Class metadata used for labels and the overlay palette (MapBiomas classes,
# English labels). Shared with the reference path so a prediction and the
# MapBiomas map it is compared against use one palette; see class_palette.py.
from class_palette import (  # noqa: E402
    CLASSIFIER_COLORS as MAPBIOMAS_COLORS,
    CLASSIFIER_LEGEND as MAPBIOMAS_LEGEND,
)


def emit_progress(progress, msg):
    """Write one JSON progress object per line to stderr."""
    sys.stderr.write(json.dumps({'progress': progress, 'msg': msg}) + '\n')
    sys.stderr.flush()


def fail(msg):
    """Write an error to stderr and exit non-zero."""
    sys.stderr.write(json.dumps({'error': msg}) + '\n')
    sys.stderr.flush()
    sys.exit(1)


# --- Request parameters ----------------------------------------------------
#
# ABSENCE SELECTS THE DEFAULT, NOT FALSINESS. `float(req.get(key) or default)`
# reads a deliberate 0 as an omission, because 0 is falsy in Python. It is
# silent and it is wrong wherever zero is a value the caller can mean: a
# degradation rate of 0 %/yr became the 0.5 %/yr default and moved every energy
# figure by 5.78 percent on the lifetime-mean basis; a 0 degree tracker
# rotation limit became 60; a 0 degree slope limit became 15; a 0 m/s calm
# threshold became the wind default. Every numeric parameter is read through
# these two helpers so the pattern cannot come back one call site at a time.

def request_number(req, key, default, cast=float):
    """
    A numeric request parameter, defaulted only when the caller omitted it.

    The default is returned as given rather than cast, so a default of None
    stays None for the parameters whose absence is itself the signal, such as
    an unstated UTC offset.
    """
    value = req.get(key)
    if value is None:
        return default
    return cast(value)


def request_positive(req, key, default, cast=float, allow_zero=False):
    """
    A numeric request parameter that has to be positive, or the run fails.

    For quantities where zero is not a value but a broken request: a window of
    zero years has no data to average and a ground coverage ratio of zero
    divides by zero in the per-hectare ratio. Rejecting is the honest answer;
    substituting the default would report a figure the caller did not ask for
    under a parameter they did set.
    """
    value = request_number(req, key, default, cast)
    if value < 0 or (value == 0 and not allow_zero):
        fail(
            f"{key} must be "
            f"{'zero or greater' if allow_zero else 'greater than zero'}, "
            f"got {value}"
        )
    return value


# --- Polygon / study area --------------------------------------------------

def polygon_from_geojson(geom):
    """Build a shapely Polygon from a GeoJSON geometry dict."""
    return shape(geom)


def parse_kml_coordinates(kml_path, target_name=None):
    """Extract polygon coordinates from a KML file (from the notebooks)."""
    tree = ET.parse(kml_path)
    root = tree.getroot()
    ns = {
        'kml': 'http://www.opengis.net/kml/2.2',
        'gx': 'http://www.google.com/kml/ext/2.2',
    }
    for placemark in root.findall('.//kml:Placemark', ns):
        name = placemark.find('kml:name', ns)
        name_text = name.text if name is not None else 'Unknown'
        if target_name and target_name.lower() not in name_text.lower():
            continue
        coords_elem = placemark.find('.//kml:coordinates', ns)
        if coords_elem is not None:
            coords_text = coords_elem.text.strip()
            coords = []
            for point in coords_text.split():
                parts = point.split(',')
                lon, lat = float(parts[0]), float(parts[1])
                coords.append((lon, lat))
            return {'name': name_text, 'coordinates': coords, 'polygon': Polygon(coords)}
    return None


# --- Sentinel-2 product discovery and band loading -------------------------

def list_sentinel_products(data_path, tile_list=None):
    """List Sentinel-2 SAFE directories, deduplicating by date (from notebooks)."""
    products = {}
    for safe_dir in sorted(data_path.rglob('*.SAFE')):
        if not safe_dir.is_dir():
            continue
        name_parts = safe_dir.name.split('_')
        if len(name_parts) < 6:
            continue
        tile_id = name_parts[5]
        if tile_list and tile_id not in tile_list:
            continue
        date_str = name_parts[2][:8]
        date_obj = datetime.strptime(date_str, '%Y%m%d')
        if date_str in products:
            existing_tile = products[date_str]['tile']
            if tile_list:
                existing_priority = tile_list.index(existing_tile) if existing_tile in tile_list else 999
                new_priority = tile_list.index(tile_id) if tile_id in tile_list else 999
                if new_priority >= existing_priority:
                    continue
            else:
                continue
        products[date_str] = {
            'path': safe_dir,
            'date': date_obj,
            'satellite': name_parts[0],
            'tile': tile_id,
            'doy': date_obj.timetuple().tm_yday,
        }
    return sorted(products.values(), key=lambda x: x['date'])


def list_stac_products(polygon, start, end, tile_list=None, max_cloud=100.0,
                       monthly_best=True,
                       collection='sentinel-2-l2a',
                       stac_url='https://planetarycomputer.microsoft.com/api/stac/v1'):
    """
    Discover Sentinel-2 L2A products from a STAC catalog (Microsoft Planetary
    Computer by default), returning the same product shape as
    list_sentinel_products but with remote COG band hrefs in product['assets'].

    Bands are read on demand via /vsicurl; only the polygon window and the four
    required bands (B02, B03, B04, B08) are fetched, avoiding full SAFE downloads.

    Parameters:
        polygon: shapely Polygon (EPSG:4326)
        start, end: 'YYYY-MM-DD' date strings (inclusive)
        tile_list: optional MGRS tile filter, e.g. ['T22JBT', 'T21JZN']
        max_cloud: maximum eo:cloud_cover percentage to accept
        monthly_best: keep only the lowest-cloud scene per calendar month. This
            approximates the ~1-scene-per-month cadence of the curated training
            set (22 dates), keeping the temporal-statistic features comparable to
            the trained model. When False, all scenes below max_cloud are kept.
    """
    import time
    import pystac_client
    import planetary_computer

    bounds = polygon.bounds

    # The Planetary Computer STAC endpoint occasionally returns transient 5xx
    # (502/503/504) or times out under load. Retry the catalog open + search +
    # item paging with exponential backoff so a momentary outage does not abort
    # the whole run.
    attempts = 4
    items = None
    last_err = None
    for attempt in range(attempts):
        try:
            catalog = pystac_client.Client.open(
                stac_url, modifier=planetary_computer.sign_inplace
            )
            search = catalog.search(
                collections=[collection],
                bbox=[bounds[0], bounds[1], bounds[2], bounds[3]],
                datetime=f'{start}/{end}',
                query={'eo:cloud_cover': {'lt': max_cloud}},
            )
            items = list(search.items())  # triggers HTTP paging
            break
        except Exception as e:
            last_err = e
            if attempt < attempts - 1:
                wait = 2 ** attempt  # 1s, 2s, 4s
                sys.stderr.write(json.dumps({
                    'progress': -1,
                    'msg': f'STAC unavailable, retrying in {wait}s ({attempt + 1}/{attempts})',
                }) + '\n')
                sys.stderr.flush()
                time.sleep(wait)
    if items is None:
        raise RuntimeError(
            'the Sentinel-2 STAC service (Planetary Computer) is temporarily '
            'unavailable; please try again in a moment'
        ) from last_err

    # B02/B03/B04/B08 are required by the spectral model; B8A/B11/B12 are also
    # collected (present in Planetary Computer assets) so the Prithvi path has
    # its six bands. Missing extra bands do not drop the scene.
    required_bands = ['B02', 'B03', 'B04', 'B08']
    extra_bands = ['B8A', 'B11', 'B12']
    products = {}
    for item in items:
        props = item.properties
        dt = props.get('datetime', '')
        date_obj = datetime.strptime(dt[:10], '%Y-%m-%d')
        date_str = date_obj.strftime('%Y%m%d')

        mgrs = props.get('s2:mgrs_tile') or ''
        tile_id = 'T' + mgrs if mgrs and not mgrs.startswith('T') else mgrs
        if tile_list and tile_id not in tile_list:
            continue

        cloud = float(props.get('eo:cloud_cover', 0.0))

        assets = {}
        ok = True
        for band in required_bands:
            if band not in item.assets:
                ok = False
                break
            assets[band] = item.assets[band].href
        if not ok:
            continue
        for band in extra_bands:
            if band in item.assets:
                assets[band] = item.assets[band].href

        # Deduplicate by date, preferring tile_list order, then lower cloud cover.
        if date_str in products:
            prev = products[date_str]
            if tile_list:
                prev_pri = tile_list.index(prev['tile']) if prev['tile'] in tile_list else 999
                new_pri = tile_list.index(tile_id) if tile_id in tile_list else 999
                if new_pri > prev_pri:
                    continue
                if new_pri == prev_pri and cloud >= prev['cloud_cover']:
                    continue
            elif cloud >= prev['cloud_cover']:
                continue

        products[date_str] = {
            'assets': assets,
            'date': date_obj,
            'satellite': props.get('platform', 'S2'),
            'tile': tile_id,
            'doy': date_obj.timetuple().tm_yday,
            'cloud_cover': cloud,
            'id': item.id,
            'preview_uri': (
                item.assets['rendered_preview'].href
                if 'rendered_preview' in item.assets
                else ''
            ),
        }

    result = sorted(products.values(), key=lambda x: x['date'])

    if monthly_best:
        by_month = {}
        for p in result:
            key = (p['date'].year, p['date'].month)
            if key not in by_month or p['cloud_cover'] < by_month[key]['cloud_cover']:
                by_month[key] = p
        result = sorted(by_month.values(), key=lambda x: x['date'])

    return result


def find_band_file(safe_path, band_name, resolution='10m'):
    """Find a band .jp2 within the SAFE directory structure (from notebooks)."""
    granule_path = safe_path / 'GRANULE'
    if not granule_path.exists():
        return None
    for granule in granule_path.iterdir():
        img_path = granule / 'IMG_DATA' / f'R{resolution}'
        if img_path.exists():
            for f in img_path.iterdir():
                if band_name in f.name and f.suffix == '.jp2':
                    return f
    return None


def resolve_band_source(product, band_name, resolution='10m'):
    """
    Resolve a band to a readable raster reference for a product, supporting both
    local SAFE products (product['path']) and STAC products (product['assets']).
    Returns a path/href that rasterio can open (including remote /vsicurl COGs).
    """
    if product.get('assets'):
        href = product['assets'].get(band_name)
        if href is None:
            raise FileNotFoundError(f'Band {band_name} not in STAC assets')
        return href
    band_file = find_band_file(product['path'], band_name, resolution)
    if band_file is None:
        raise FileNotFoundError(f"Band {band_name} not found in {product['path']}")
    return band_file


def clip_band_from_source(source, polygon):
    """Open a raster source (local file or remote COG) and clip to the polygon."""
    with rasterio.open(source) as src:
        transformer = Transformer.from_crs('EPSG:4326', src.crs, always_xy=True)
        projected_polygon = shp_transform(transformer.transform, polygon)
        clipped, clipped_transform = rio_mask(src, [projected_polygon], crop=True, nodata=0)
        profile = {
            'transform': clipped_transform,
            'crs': src.crs,
            'height': clipped.shape[1],
            'width': clipped.shape[2],
        }
    return clipped[0].astype(np.float32), profile


def load_and_clip_band(product, band_name, polygon, resolution='10m'):
    """
    Load a Sentinel-2 band and clip it to the study-area polygon. Accepts either
    a product dict (local SAFE or STAC) or, for backwards compatibility, a SAFE
    Path object.
    """
    if not isinstance(product, dict):
        product = {'path': product}
    source = resolve_band_source(product, band_name, resolution)
    return clip_band_from_source(source, polygon)


def load_band_to_reference_grid(product, band_name, polygon, ref_profile, resolution='10m'):
    """Load a band and reproject to a reference grid if needed (from notebooks)."""
    band, band_profile = load_and_clip_band(product, band_name, polygon, resolution)
    if str(band_profile['crs']) == str(ref_profile['crs']):
        if (band.shape[0] == ref_profile['height'] and band.shape[1] == ref_profile['width']):
            return band
    dst = np.zeros((ref_profile['height'], ref_profile['width']), dtype=np.float32)
    reproject(
        source=band, destination=dst,
        src_transform=band_profile['transform'], src_crs=band_profile['crs'],
        dst_transform=ref_profile['transform'], dst_crs=ref_profile['crs'],
        resampling=Resampling.bilinear,
    )
    return dst


# --- Vegetation indices ----------------------------------------------------

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


# --- Feature engineering (matches feature_names.joblib) ---------------------

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


def build_feature_matrix(products, polygon, ref_prof, n_dates_model):
    """
    Build the (N_pixels, 80) feature matrix from a list of products, matching
    the training pipeline. Returns (feature_matrix, valid_mask_2d) or (None, None).
    """
    ndvi_list, evi_list, savi_list = [], [], []
    band_lists = {'B02': [], 'B03': [], 'B04': [], 'B08': []}
    for product in products:
        try:
            blue = load_band_to_reference_grid(product, 'B02', polygon, ref_prof)
            green = load_band_to_reference_grid(product, 'B03', polygon, ref_prof)
            red = load_band_to_reference_grid(product, 'B04', polygon, ref_prof)
            nir = load_band_to_reference_grid(product, 'B08', polygon, ref_prof)
            blue_r, green_r, red_r, nir_r = (blue / 10000.0, green / 10000.0,
                                             red / 10000.0, nir / 10000.0)
            ndvi_list.append(calculate_ndvi(nir_r, red_r))
            evi_list.append(calculate_evi(nir_r, red_r, blue_r))
            savi_list.append(calculate_savi(nir_r, red_r))
            band_lists['B02'].append(blue_r)
            band_lists['B03'].append(green_r)
            band_lists['B04'].append(red_r)
            band_lists['B08'].append(nir_r)
        except Exception as e:
            sys.stderr.write(json.dumps({'progress': -1, 'msg': f'band error: {e}'}) + '\n')
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


# --- Classification --------------------------------------------------------

def classify_from_features(feature_matrix, valid_mask, model, scaler, label_encoder):
    """Apply the trained model; return (H,W) class map and confidence map."""
    height, width = valid_mask.shape
    classification_map = np.full((height, width), -1, dtype=np.int32)
    confidence_map = np.zeros((height, width), dtype=np.float32)
    X_scaled = scaler.transform(feature_matrix)
    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(X_scaled)
        conf = proba.max(axis=1).astype(np.float32)
        pred_encoded = proba.argmax(axis=1)
    else:
        pred_encoded = model.predict(X_scaled)
        conf = np.ones(len(pred_encoded), dtype=np.float32)
    pred_classes = label_encoder.inverse_transform(pred_encoded)
    rows, cols = np.where(valid_mask)
    classification_map[rows, cols] = pred_classes
    confidence_map[rows, cols] = conf
    return classification_map, confidence_map


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


def compute_aoi_vi_series(products, polygon, ref_prof):
    """Mean ± std NDVI/EVI/SAVI per date; also spatial NDVI temporal mean.

    Also keeps reflectance for the peak-NDVI scene so we can write a true-color
    AOI chip aligned to the same grid as the other overlays.
    """
    import composite as comp

    series = []
    dates = []
    ndvi_means = []
    ndvi_stack = []
    best_ndvi = -1.0
    best_rgb = None  # (red, green, blue, valid_mask)
    for product in products:
        try:
            blue = load_band_to_reference_grid(product, "B02", polygon, ref_prof) / 10000.0
            green = load_band_to_reference_grid(product, "B03", polygon, ref_prof) / 10000.0
            red = load_band_to_reference_grid(product, "B04", polygon, ref_prof) / 10000.0
            nir = load_band_to_reference_grid(product, "B08", polygon, ref_prof) / 10000.0
            ndvi = calculate_ndvi(nir, red)
            evi = calculate_evi(nir, red, blue)
            savi = calculate_savi(nir, red)
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

    return series, dates, ndvi_means, ndvi_mean_map, valid_mask, true_color_rgba


def classify_temporal_transformer(products, polygon, ref_profile, model_dir):
    """Classify with the mestrado Temporal Transformer (T×6 reflectance)."""
    import torch
    import temporal_transformer as tt

    ckpt_path = Path(model_dir) / "tt_mapbiomas.pt"
    if not ckpt_path.exists():
        fail(f"Temporal Transformer checkpoint missing: {ckpt_path.name}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cpu" and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = torch.device("mps")
    model, scaler, classes = tt.load_checkpoint(ckpt_path, device=device)

    band_specs = [
        ("B02", "10m"),
        ("B03", "10m"),
        ("B04", "10m"),
        ("B8A", "20m"),
        ("B11", "20m"),
        ("B12", "20m"),
    ]
    frames = []
    for product in products:
        bands = []
        try:
            for name, res in band_specs:
                arr = load_band_to_reference_grid(
                    product, name, polygon, ref_profile, resolution=res
                )
                bands.append(np.clip(arr / 10000.0, 0, 1).astype(np.float32))
            frames.append(np.stack(bands, axis=0))
        except Exception as e:
            sys.stderr.write(json.dumps({"progress": -1, "msg": f"TT band error: {e}"}) + "\n")
            continue
    if not frames:
        fail("no valid Sentinel-2 frames for Temporal Transformer")

    stack = np.stack(frames, axis=0)  # (T, 6, H, W)
    stack = tt.pad_temporal(stack, tt.NUM_FRAMES)
    t, c, height, width = stack.shape
    valid = stack[:, 2].mean(axis=0) > 0  # mean red > 0
    rows, cols = np.where(valid)
    if rows.size == 0:
        fail("no valid pixels for Temporal Transformer")

    x = np.stack([stack[:, :, r, c] for r, c in zip(rows, cols)], axis=0).astype(np.float32)
    x = np.clip(x, 0.0, 1.0)

    emit_progress(70, f"Temporal Transformer inference ({len(x)} pixels)")
    pred_idx, conf = tt.predict_pixels(model, scaler, x, device)
    cls_map = np.full((height, width), -1, dtype=np.int32)
    conf_map = np.zeros((height, width), dtype=np.float32)
    cls_map[rows, cols] = classes[pred_idx]
    conf_map[rows, cols] = conf.astype(np.float32)
    return cls_map, conf_map


# --- MapBiomas (soja mask for temporal retention) --------------------------

def reproject_mapbiomas_to_grid(mapbiomas_path, ref_profile, ref_band_data):
    """Reproject a cached MapBiomas raster to the Sentinel-2 reference grid."""
    with rasterio.open(mapbiomas_path) as src:
        mb_data = src.read(1)
        mb_transform = src.transform
        mb_crs = src.crs
    dst = np.zeros((ref_profile['height'], ref_profile['width']), dtype=np.uint8)
    reproject(
        source=mb_data.astype(np.uint8), destination=dst,
        src_transform=mb_transform, src_crs=mb_crs,
        dst_transform=ref_profile['transform'], dst_crs=ref_profile['crs'],
        resampling=Resampling.nearest,
    )
    dst[~(ref_band_data > 0)] = 0
    return dst


# --- Georeferencing --------------------------------------------------------

def get_map_extent(profile):
    """Compute the EPSG:4326 lat/lon extent from a raster profile (from notebooks)."""
    t = profile['transform']
    h, w = profile['height'], profile['width']
    left = t.c
    top = t.f
    right = left + w * t.a
    bottom = top + h * t.e
    transformer = Transformer.from_crs(profile['crs'], 'EPSG:4326', always_xy=True)
    lon_min, lat_min = transformer.transform(left, bottom)
    lon_max, lat_max = transformer.transform(right, top)
    return lon_min, lon_max, lat_min, lat_max


def hex_to_rgb(hex_color):
    h = hex_color.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


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


def class_statistics(classification_map):
    """Build per-class statistics (pixels, pct, area_ha) at 10 m resolution."""
    valid = classification_map[classification_map >= 0]
    total = int(valid.size)
    stats = []
    if total == 0:
        return stats
    unique_pred, counts = np.unique(valid, return_counts=True)
    for cls_id, count in zip(unique_pred, counts):
        cls_id = int(cls_id)
        stats.append({
            'class_id': cls_id,
            'name': MAPBIOMAS_LEGEND.get(cls_id, f'Class {cls_id}'),
            'color': MAPBIOMAS_COLORS.get(cls_id, '#cccccc'),
            'pixels': int(count),
            'pct': float(round(100.0 * count / total, 2)),
            'area_ha': float(round(count * 100.0 / 10000.0, 2)),
        })
    stats.sort(key=lambda s: s['pixels'], reverse=True)
    return stats


# --- Prithvi-EO 2.0 classification -----------------------------------------

def classify_prithvi(products, polygon, ref_profile, model_dir, mode):
    """
    Classify a representative acquisition using frozen Prithvi-EO 2.0 embeddings
    and the matching Random Forest head. mode is 'pixel' or 'patch'.
    Returns a (H, W) map of MapBiomas class ids (-1 = invalid).
    """
    import prithvi as pv

    rf_path = model_dir / f'prithvi_rf_{mode}.joblib'
    sc_path = model_dir / f'prithvi_scaler_{mode}.joblib'
    le_path = model_dir / 'prithvi_label_encoder.joblib'
    for p in (rf_path, sc_path, le_path):
        if not p.exists():
            fail(f'Prithvi model artifact missing: {p.name}. Train it with train_prithvi.py')
    rf = joblib.load(rf_path)
    sc = joblib.load(sc_path)
    le = joblib.load(le_path)

    target = products[len(products) // 2]
    emit_progress(30, f'loading Prithvi bands ({target["date"].strftime("%Y-%m-%d")})')
    bands = []
    for name, res in [('B02', '10m'), ('B03', '10m'), ('B04', '10m'),
                      ('B8A', '20m'), ('B11', '20m'), ('B12', '20m')]:
        arr = load_band_to_reference_grid(target, name, polygon, ref_profile, resolution=res)
        bands.append(np.clip(arr / 10000.0, 0, 1))
    band_stack = np.stack(bands, axis=0).astype(np.float32)

    ref0 = bands[2]  # B04
    valid = ref0 > 0
    height, width = valid.shape
    cls_map = np.full((height, width), -1, dtype=np.int32)

    emit_progress(45, f'extracting Prithvi embeddings ({mode})')
    if mode == 'patch':
        emb_map = pv.embed_patches(band_stack, valid)
        X = emb_map[valid]
    else:
        X = pv.embed_pixels(band_stack, valid)

    emit_progress(85, 'classifying embeddings')
    X_scaled = sc.transform(X)
    if hasattr(rf, "predict_proba"):
        proba = rf.predict_proba(X_scaled)
        conf = proba.max(axis=1).astype(np.float32)
        pred = le.inverse_transform(proba.argmax(axis=1))
    else:
        pred = le.inverse_transform(rf.predict(X_scaled))
        conf = np.ones(len(pred), dtype=np.float32)
    rows, cols = np.where(valid)
    cls_map[rows, cols] = pred
    conf_map = np.zeros((height, width), dtype=np.float32)
    conf_map[rows, cols] = conf
    return cls_map, conf_map


# --- Main ------------------------------------------------------------------

def configure_gdal_for_cog():
    """Tune GDAL/rasterio for efficient remote COG range reads."""
    import os
    os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
    os.environ.setdefault('CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif,.TIF,.tiff')
    os.environ.setdefault('GDAL_HTTP_MULTIRANGE', 'YES')
    os.environ.setdefault('GDAL_HTTP_MERGE_CONSECUTIVE_RANGES', 'YES')
    os.environ.setdefault('VSI_CACHE', 'TRUE')


def power_cache_dir(req):
    """
    Directory the NASA POWER series are cached in, or None if it cannot be made.

    Deliberately outside work_dir: the Go runner creates a fresh temporary
    work_dir per run, so a cache written under it would never be read by the
    next one and the fetch would be paid again on every action.
    """
    raw = req.get('power_cache_dir')
    path = Path(raw) if raw else Path.home() / '.cache' / 'geosense' / 'power'
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    return path


# NASA POWER serves the radiation parameters on a 1 degree grid; see
# solar.GRID_NOTE, which states it beside every solar response.
POWER_RADIATION_STEP_DEG = 1.0


def power_cell_key(lon, lat):
    """
    The pair of grid cells a POWER point request resolves to, as a cache key.

    A POWER response is determined by the cell the point falls in on BOTH grids
    it serves: radiation on 1 degree (solar.GRID_NOTE) and meteorology on the
    MERRA-2 0.5 by 0.625 degree grid (wind.grid_key). Keying on either grid
    alone does not hold, because 0.625 does not divide 1.0, so two points inside
    one MERRA-2 longitude cell can straddle a radiation cell boundary. The key
    is the pair, which is the conservative intersection.

    solar.grid_key rounds to 0.01 degrees, which is about 1 km and far finer
    than either grid. Keying the cache on that produced a miss for two AOIs
    that resolve to identical series and each paid the fetch, so the reuse the
    cache states it guarantees did not hold.
    """
    import wind as wind_mod

    met_lon, met_lat = wind_mod.grid_key(lon, lat)
    rad_lon = round(round(float(lon) / POWER_RADIATION_STEP_DEG)
                    * POWER_RADIATION_STEP_DEG, 6)
    rad_lat = round(round(float(lat) / POWER_RADIATION_STEP_DEG)
                    * POWER_RADIATION_STEP_DEG, 6)
    return f'{met_lon:g}_{met_lat:g}_r{rad_lon:g}_{rad_lat:g}'


def cached_power_series(cache_dir, product, lon, lat, start, end, params,
                        fetch_fn, progress=None):
    """
    A POWER series read from disk when one covering `params` is stored, fetched
    and stored otherwise, with the provenance of whichever path was taken.

    The hourly request is the dominant cost of the whole analysis, about 23 s
    for ten years (docs/SOLAR_HANDOFF.md section 6), and three actions ask for
    the same series over the same cell. What determines a POWER response is the
    grid cell, the period and the parameter list, so those are the key; see
    power_cell_key for the cell.

    A stored file is reused when its columns cover the requested parameters, so
    a superset written by one action serves the subset another asks for.

    THE FETCH DATE TRAVELS WITH THE SERIES. POWER reprocesses historical data,
    so a cached series can be a superseded revision of the record. The cache has
    no expiry by design, because a research figure benchmarked against a stored
    run has to stay reproducible; what would make that dangerous is the run not
    saying so. Each series is stored with the timestamp it was fetched at, and
    the record returned here is carried into the response of every action that
    read one, so a cached run and a fetched run are distinguishable.

    Returns (frame, provenance).
    """
    import hashlib
    import pandas as pd
    from datetime import datetime, timezone

    def _record(source, fetched_utc, path=None):
        return {
            'source': source,
            'fetched_utc': fetched_utc,
            'product': product,
            'cell_key': cell,
            'period': f'{start}-{end}',
            'cache_file': None if path is None else path.name,
            'note': (
                'Fetched from NASA POWER during this run.'
                if source == 'fetch' else
                'Read from the on-disk POWER cache, not fetched during this '
                'run. POWER reprocesses historical data, so a series fetched '
                'earlier can be a superseded revision of the record; the fetch '
                'timestamp above is when it was retrieved.'
                if source == 'cache' else
                'No cache directory was available, so the series was fetched '
                'and not stored.'
            ),
        }

    now = lambda: datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    cell = power_cell_key(lon, lat)

    if cache_dir is None:
        return fetch_fn(progress), _record('fetch_uncached', now())

    prefix = f'{product}_{cell}_{start}_{end}_'
    wanted = set(params)
    for path in sorted(cache_dir.glob(prefix + '*.parquet')):
        try:
            stored = pd.read_parquet(path)
        except Exception:
            continue
        if wanted.issubset(stored.columns):
            return stored, _record('cache', _cache_fetch_time(path), path)

    df = fetch_fn(progress)
    fetched = now()
    key = hashlib.sha1(','.join(sorted(params)).encode()).hexdigest()[:12]
    final = cache_dir / (prefix + key + '.parquet')
    partial = cache_dir / (prefix + key + '.parquet.partial')
    try:
        df.to_parquet(partial)
        partial.replace(final)
        # Written after the parquet, so a stamp never exists for a series that
        # is not there. A missing stamp reads as an unknown fetch date rather
        # than as a fresh one.
        final.with_name(final.name + '.json').write_text(
            json.dumps({'fetched_utc': fetched, 'product': product,
                        'cell_key': cell, 'period': f'{start}-{end}',
                        'params': sorted(params)})
        )
    except Exception:
        # A cache that cannot be written must not fail a run that already holds
        # its data. The next run simply pays the fetch again.
        try:
            partial.unlink()
        except OSError:
            pass
    return df, _record('fetch', fetched, final)


def _cache_fetch_time(path):
    """
    When a cached series was fetched, from its stamp, or None if unrecorded.

    Files written before the stamp existed have none. Reporting None is the
    honest answer: the file modification time is when the parquet was written
    to this disk, which a copy or a restore changes, so it is not the fetch
    date and must not be presented as one.
    """
    stamp = path.with_name(path.name + '.json')
    try:
        return json.loads(stamp.read_text()).get('fetched_utc')
    except Exception:
        return None


SITING_STAGES = ('dem', 'slope', 'cover', 'classes')


def compute_siting(polygon, work_dir, slope_acceptable, slope_restrictive,
                   excluded, cropland, mapbiomas_path=None, progress=None):
    """
    Photovoltaic siting classes on the Copernicus DEM grid, with class areas.

    Shared by the solar_siting action and by the plant-energy block of
    energy_model, so a capacity figure and the raster that published the
    area behind it come from one classification rather than from two that can
    disagree.

    Stages are reported through progress(stage, message) with stage one of
    SITING_STAGES; each caller maps the stage onto its own progress scale.
    """
    import solar as solar_mod
    import lulc as lulc_mod
    import rasterio
    from rasterio.features import geometry_mask

    def stage(name, msg):
        if progress:
            progress(name, msg)

    centroid = polygon.centroid
    stage('dem', 'fetching Copernicus DEM GLO-30')
    try:
        dem_path = solar_mod.fetch_dem(polygon, Path(work_dir) / 'dem.tif')
    except Exception as e:
        fail(f'DEM fetch failed: {e}')
    with rasterio.open(dem_path) as src:
        elevation = src.read(1).astype(float)
        dem_transform = src.transform
        dem_crs = src.crs
        dem_profile = src.profile.copy()

    dx_m, dy_m = solar_mod.pixel_size_m(dem_transform, centroid.y)
    stage('slope', 'slope and aspect')
    slope, _aspect = solar_mod.horn_slope_aspect(elevation, dx_m, dy_m)

    stage('cover', 'MapBiomas land cover')
    try:
        mb_path = lulc_mod.resolve_mapbiomas_path(
            mapbiomas_path, polygon, Path(work_dir)
        )
        mb = reproject_mapbiomas_to_grid(
            mb_path,
            {'transform': dem_transform, 'crs': dem_crs,
             'height': slope.shape[0], 'width': slope.shape[1]},
            np.ones_like(slope),
        )
    except Exception as e:
        fail(f'MapBiomas land cover unavailable: {e}')

    inside = ~geometry_mask(
        [polygon.__geo_interface__], out_shape=slope.shape,
        transform=dem_transform, invert=False
    )
    valid = inside & np.isfinite(slope)
    if not valid.any():
        fail('the DEM window does not overlap the AOI')

    stage('classes', 'siting classes')
    suit = solar_mod.suitability_map(
        slope, mb, valid,
        slope_acceptable=slope_acceptable,
        slope_restrictive=slope_restrictive,
        excluded_cover=excluded,
        cropland_cover=cropland,
    )
    px_area_ha = (dx_m * dy_m) / 10_000.0
    return {
        'suitability': suit,
        'slope': slope,
        'valid': valid,
        'classes': solar_mod.suitability_stats(suit, px_area_ha),
        'pixel_area_ha': px_area_ha,
        'dem_transform': dem_transform,
        'dem_crs': dem_crs,
        'dem_profile': dem_profile,
        'thresholds': {
            'slope_acceptable_deg': slope_acceptable,
            'slope_restrictive_deg': slope_restrictive,
            'excluded_cover': list(excluded),
            'cropland_cover': list(cropland),
            'note': (
                'Project conventions, not verified legal restrictions. '
                'Legal reserve, permanent preservation areas and municipal '
                'zoning require the CAR and local legislation, which this '
                'analysis does not consult.'
            ),
        },
    }


def main():
    try:
        req = json.load(sys.stdin)
    except Exception as e:
        fail(f'invalid request JSON: {e}')

    action = req.get('action', 'predict')
    work_dir = Path(req.get('work_dir', '.'))
    work_dir.mkdir(parents=True, exist_ok=True)

    # Lightweight health check used by the desktop boot footer.
    if action == 'ping':
        sys.stdout.write(json.dumps({
            'ok': True,
            'python': sys.version.split()[0],
            'sidecar': 'infer.py',
        }))
        sys.stdout.flush()
        return

    # Standalone MapBiomas land-cover / land-use analysis (no Sentinel / model).
    if action == 'lulc':
        emit_progress(10, 'resolving MapBiomas for AOI')
        try:
            import lulc as lulc_mod
            lulc = lulc_mod.analyze_from_request(req)
        except Exception as e:
            fail(f'LULC analysis failed: {e}')
        emit_progress(100, 'done')
        sys.stdout.write(json.dumps({'lulc': lulc}))
        sys.stdout.flush()
        return

    # Inventory Sentinel-2 scenes for the AOI (no classification / band reads).
    if action == 'list_datacube':
        start = req.get('start')
        end = req.get('end')
        max_cloud = float(req.get('max_cloud', 100.0))
        monthly_best = bool(req.get('monthly_best', True))
        tiles = req.get('tiles') or None
        if not start or not end:
            fail('list_datacube requires start and end dates (YYYY-MM-DD)')
        if req.get('polygon_geojson'):
            polygon = polygon_from_geojson(req['polygon_geojson'])
        elif req.get('kml_path'):
            area = parse_kml_coordinates(Path(req['kml_path']), req.get('kml_target'))
            if area is None:
                fail('polygon not found in KML')
            polygon = area['polygon']
        else:
            fail('no polygon provided (polygon_geojson or kml_path required)')
        emit_progress(20, 'querying STAC catalog (Planetary Computer)')
        try:
            products = list_stac_products(
                polygon, start, end, tile_list=tiles, max_cloud=max_cloud,
                monthly_best=monthly_best,
            )
        except Exception as e:
            fail(f'STAC query failed: {e}')
        scenes = []
        for p in products:
            scenes.append({
                'id': p.get('id') or '',
                'date': p['date'].strftime('%Y-%m-%d'),
                'cloud_cover': round(float(p.get('cloud_cover', 0.0)), 2),
                'tile': p.get('tile') or '',
                'satellite': p.get('satellite') or 'S2',
                'preview_uri': p.get('preview_uri') or '',
            })
        date_range = []
        if scenes:
            date_range = [scenes[0]['date'], scenes[-1]['date']]
        emit_progress(100, f'{len(scenes)} scenes')
        sys.stdout.write(json.dumps({
            'n_scenes': len(scenes),
            'scenes': scenes,
            'date_range': date_range,
            'monthly_best': monthly_best,
            'max_cloud': max_cloud,
        }))
        sys.stdout.flush()
        return

    # Solar resource and photovoltaic yield at the AOI centroid (no imagery).
    if action == 'solar_resource':
        import solar as solar_mod
        from datetime import date as _date

        if not req.get('polygon_geojson'):
            fail('no polygon provided (polygon_geojson required)')
        polygon = polygon_from_geojson(req['polygon_geojson'])
        centroid = polygon.centroid
        lon, lat = solar_mod.grid_key(centroid.x, centroid.y)

        clim_years = request_positive(req, 'climatology_years', 30, int)
        hourly_years = request_positive(req, 'hourly_years', 10, int)
        # Zero is due north here, which is both the default and a value the
        # caller can mean, so absence is what selects the default.
        azimuth = request_number(req, 'surface_azimuth', 0.0)
        pr_override = req.get('performance_ratio')

        # POWER publishes through the previous full year.
        last_year = _date.today().year - 1
        clim_start = f'{last_year - clim_years + 1}0101'
        clim_end = f'{last_year}1231'
        hourly_start = f'{last_year - hourly_years + 1}0101'
        hourly_end = f'{last_year}1231'

        cache = power_cache_dir(req)
        emit_progress(5, f'NASA POWER daily, {clim_years} years')
        try:
            daily, daily_provenance = cached_power_series(
                cache, 'daily', lon, lat, clim_start, clim_end,
                solar_mod.DAILY_PARAMS,
                lambda progress: solar_mod.fetch(
                    'daily', lon, lat, clim_start, clim_end, progress=progress
                ),
                progress=lambda i, n, y: emit_progress(
                    5 + int(35 * (i + 1) / n), f'daily {y}'
                ),
            )
        except Exception as e:
            fail(f'NASA POWER daily request failed: {e}')

        annual = solar_mod.annual_totals(daily)
        if annual.empty:
            fail('NASA POWER returned no complete year for this point')
        slope, pvalue = solar_mod.linear_trend(annual)
        resource = {
            'ghi_annual_kwh_m2': round(float(annual.mean()), 1),
            'ghi_std': round(float(annual.std(ddof=1)), 1) if annual.size > 1 else 0.0,
            'ghi_cv_pct': (
                round(float(100.0 * annual.std(ddof=1) / annual.mean()), 2)
                if annual.size > 1 and annual.mean() else 0.0
            ),
            'ghi_p10': round(float(np.percentile(annual.values, 10)), 1),
            'ghi_p90': round(float(np.percentile(annual.values, 90)), 1),
            'n_years': int(annual.size),
            'trend_per_year': round(slope, 3),
            'trend_p_value': round(pvalue, 4),
            'clear_sky_index': solar_mod.clear_sky_index(daily),
            'monthly': solar_mod.monthly_climatology(daily),
        }

        emit_progress(42, f'NASA POWER hourly, {hourly_years} years')
        try:
            hourly, hourly_provenance = cached_power_series(
                cache, 'hourly', lon, lat, hourly_start, hourly_end,
                solar_mod.HOURLY_PARAMS,
                lambda progress: solar_mod.fetch(
                    'hourly', lon, lat, hourly_start, hourly_end,
                    progress=progress,
                ),
                progress=lambda i, n, y: emit_progress(
                    42 + int(38 * (i + 1) / n), f'hourly {y}'
                ),
            )
        except Exception as e:
            fail(f'NASA POWER hourly request failed: {e}')

        df, solpos = solar_mod.prepare_hourly(hourly, lat, lon, 0.0)
        if df.empty:
            fail('NASA POWER returned no usable hourly record for this point')
        n_years = max(len(set(df.index.year)), 1)

        emit_progress(84, 'optimum tilt')
        sweep = solar_mod.sweep_tilt(df, solpos, azimuth, n_years)
        best = max(sweep, key=lambda r: r['poa_kwh_m2_year'])
        horizontal = next(
            (r['poa_kwh_m2_year'] for r in sweep if abs(r['tilt_deg']) < 1e-9),
            best['poa_kwh_m2_year'],
        )
        tolerance = []
        for dev in (5.0, 10.0, 15.0):
            near = [
                r for r in sweep
                if abs(abs(r['tilt_deg'] - best['tilt_deg']) - dev) < 0.26
            ]
            if near:
                worst = min(near, key=lambda r: r['poa_kwh_m2_year'])
                loss = 100.0 * (1.0 - worst['poa_kwh_m2_year'] / best['poa_kwh_m2_year'])
                tolerance.append({
                    'deviation_deg': dev, 'loss_pct': round(float(loss), 2)
                })

        emit_progress(92, 'photovoltaic yield')
        poa = solar_mod.transpose(df, solpos, best['tilt_deg'], azimuth)
        p_ac = solar_mod.pv_yield(poa, df, solpos, best['tilt_deg'], azimuth)
        pr_modelled = solar_mod.modelled_performance_ratio(p_ac, poa['poa_global'])
        pr_applied = (
            float(pr_override)
            if isinstance(pr_override, (int, float))
            else solar_mod.REFERENCE_PERFORMANCE_RATIO
        )
        pr_source = 'user' if isinstance(pr_override, (int, float)) else 'reference'
        poa_year = float(poa['poa_global'].sum()) / 1000.0 / n_years
        # Specific yield is POA times the performance ratio by construction, so
        # applying a reference ratio is exact rather than a correction factor.
        yield_year = poa_year * pr_applied

        emit_progress(100, 'done')
        sys.stdout.write(json.dumps({
            'solar': {
                'lon': lon, 'lat': lat,
                'resource': resource,
                'geometry': {
                    'optimal_tilt_deg': round(float(best['tilt_deg']), 1),
                    'optimal_poa_kwh_m2_year': round(float(best['poa_kwh_m2_year']), 1),
                    'surface_azimuth_deg': azimuth,
                    'gain_over_horizontal_pct': (
                        round(float(100.0 * (best['poa_kwh_m2_year'] / horizontal - 1.0)), 2)
                        if horizontal else 0.0
                    ),
                    'tilt_tolerance': tolerance,
                },
                'pv': {
                    'specific_yield_kwh_kwp_year': round(float(yield_year), 1),
                    'performance_ratio': round(float(pr_applied), 4),
                    'performance_ratio_source': pr_source,
                    'performance_ratio_modelled': round(float(pr_modelled), 4),
                    'capacity_factor_pct': round(float(100.0 * yield_year / 8760.0), 2),
                    'hourly_years': int(n_years),
                },
                'grid_note': solar_mod.GRID_NOTE,
                # Which POWER series this run read and when it was
                # fetched. Without it a cached run and a fetched run
                # are indistinguishable to the caller, and POWER
                # reprocesses historical data.
                'power_provenance': {
                    'daily': daily_provenance,
                    'hourly': hourly_provenance,
                },
            }
        }))
        sys.stdout.flush()
        return

    # Terrain-resolved plane-of-array irradiation over the AOI.
    if action == 'solar_terrain':
        import solar as solar_mod
        import composite as comp
        import rasterio
        from rasterio.warp import reproject as rio_reproject, Resampling as RioResampling
        from datetime import date as _date

        configure_gdal_for_cog()
        if not req.get('polygon_geojson'):
            fail('no polygon provided (polygon_geojson required)')
        polygon = polygon_from_geojson(req['polygon_geojson'])
        centroid = polygon.centroid
        lon, lat = solar_mod.grid_key(centroid.x, centroid.y)
        hourly_years = request_positive(req, 'hourly_years', 10, int)
        last_year = _date.today().year - 1

        emit_progress(5, 'fetching Copernicus DEM GLO-30')
        try:
            # Buffered, so terrain just outside the AOI can still cast onto
            # pixels inside it. Everything downstream is cropped back to the AOI
            # window before it is published.
            dem_path = solar_mod.fetch_dem(
                polygon, Path(work_dir) / 'dem.tif',
                buffer_m=solar_mod.HORIZON_MAX_DIST_M,
            )
        except Exception as e:
            fail(f'DEM fetch failed: {e}')

        with rasterio.open(dem_path) as src:
            elevation = src.read(1).astype(float)
            buf_transform = src.transform
            dem_crs = src.crs
            buf_profile = src.profile.copy()
            aoi_window = rasterio.windows.from_bounds(
                *polygon.bounds, transform=buf_transform
            ).round_offsets().round_lengths().intersection(
                rasterio.windows.Window(0, 0, src.width, src.height)
            )

        dx_m, dy_m = solar_mod.pixel_size_m(buf_transform, lat)
        emit_progress(20, 'slope, aspect and horizon')
        slope, aspect = solar_mod.horn_slope_aspect(elevation, dx_m, dy_m)
        horizon, _ = solar_mod.horizon_angles(elevation, dx_m, dy_m)

        # Crop back: the buffer exists so the horizon sees beyond the boundary,
        # not so the result reports on land the user did not ask about.
        r0 = int(aoi_window.row_off)
        c0 = int(aoi_window.col_off)
        r1 = r0 + int(aoi_window.height)
        c1 = c0 + int(aoi_window.width)
        if r1 <= r0 or c1 <= c0:
            fail('the DEM window does not overlap the AOI')
        _crop = lambda a: a[r0:r1, c0:c1]
        elevation = _crop(elevation)
        slope, aspect = _crop(slope), _crop(aspect)
        horizon = horizon[r0:r1, c0:c1, :]
        dem_transform = rasterio.windows.transform(aoi_window, buf_transform)
        dem_profile = buf_profile.copy()
        dem_profile.update(height=slope.shape[0], width=slope.shape[1],
                           transform=dem_transform)

        hourly_start = f'{last_year - hourly_years + 1}0101'
        hourly_end = f'{last_year}1231'
        emit_progress(28, f'NASA POWER hourly, {hourly_years} years')
        try:
            hourly, hourly_provenance = cached_power_series(
                power_cache_dir(req), 'hourly', lon, lat,
                hourly_start, hourly_end, solar_mod.HOURLY_PARAMS,
                lambda progress: solar_mod.fetch(
                    'hourly', lon, lat, hourly_start, hourly_end,
                    progress=progress,
                ),
                progress=lambda i, n, y: emit_progress(
                    28 + int(45 * (i + 1) / n), f'hourly {y}'
                ),
            )
        except Exception as e:
            fail(f'NASA POWER hourly request failed: {e}')

        df, solpos = solar_mod.prepare_hourly(hourly, lat, lon, float(np.nanmean(elevation)))
        if df.empty:
            fail('NASA POWER returned no usable hourly record for this point')
        n_years = max(len(set(df.index.year)), 1)

        season = (req.get('season') or 'annual').lower()
        if season not in solar_mod.SEASONS and season not in ('anisotropy', 'shading'):
            fail(f'unknown season: {season}')

        beam_share = solar_mod.beam_fraction(df)

        def _poa_for(name):
            """Plane-of-array total for a season, attenuated by terrain shading.

            Shading removes beam energy only, so the per-pixel loss is scaled by
            the beam share of the irradiation before it is applied. The loss
            itself is returned unscaled, which is what the published layer and
            the research figures report.
            """
            m = solar_mod.season_mask(df.index, name)
            sub, sp = df[m], solpos[m]
            if sub.empty:
                fail(f'no hourly record inside the {name} window')
            yrs = solar_mod.season_years(df.index, name)
            tbl = solar_mod.build_poa_lookup(sub, sp, max(yrs, 1e-6))
            raw = solar_mod.interpolate_poa(slope, aspect, tbl)
            hist, edges = solar_mod.beam_energy_histogram(sub, sp)
            loss = solar_mod.shading_loss_fraction(horizon, hist, edges)
            return raw * (1.0 - loss * beam_share), loss

        emit_progress(76, 'plane-of-array lookup')
        companion = None
        shading_loss = None
        if season == 'anisotropy':
            # Winter over summer in one layer: the seasonal contrast is what
            # the annual map averages away, and a ratio carries it per pixel.
            emit_progress(78, 'lookup [winter]')
            winter, _ = _poa_for('winter')
            emit_progress(85, 'lookup [summer]')
            summer, shading_loss = _poa_for('summer')
            with np.errstate(divide='ignore', invalid='ignore'):
                poa = np.where(summer > 0, winter / summer, np.nan)
            unit = 'winter / summer'
        elif season == 'shading':
            emit_progress(80, 'horizon shading over the year')
            _, shading_loss = _poa_for('annual')
            poa = shading_loss
            unit = 'fraction of beam blocked'
        elif season in solar_mod.SEASON_PAIR:
            # The companion season is computed only so both land on one colour
            # domain. Their spatial spread differs by about a factor of ten, and
            # normalising each to its own range draws them at equal contrast.
            emit_progress(78, f'lookup [{season}]')
            poa, shading_loss = _poa_for(season)
            other = solar_mod.SEASON_PAIR[season]
            emit_progress(85, f'lookup [{other}], shared colour scale')
            companion, _ = _poa_for(other)
            unit = 'kWh/m2 per season'
        else:
            emit_progress(80, f'lookup [{season}]')
            poa, shading_loss = _poa_for(season)
            unit = 'kWh/m2 per season' if season != 'annual' else 'kWh/m2/year'
        emit_progress(92, 'interpolating onto the terrain')

        # Only pixels inside the AOI carry a result.
        from rasterio.features import geometry_mask
        inside = ~geometry_mask(
            [polygon.__geo_interface__], out_shape=poa.shape,
            transform=dem_transform, invert=False
        )
        valid = inside & np.isfinite(poa)
        if not valid.any():
            fail('the DEM window does not overlap the AOI')

        scale = solar_mod.render_scale(season, poa, valid, companion, valid)
        png = Path(work_dir) / 'solar_poa.png'
        comp.write_rgba_png(
            solar_mod.terrain_rgba(
                poa, valid, scale['min'], scale['max'], scale['palette']
            ),
            png,
        )

        tif = Path(work_dir) / 'solar_poa.tif'
        prof = dem_profile.copy()
        prof.update(dtype='float32', count=1, compress='lzw', nodata=float('nan'))
        with rasterio.open(tif, 'w', **prof) as dst:
            dst.write(np.where(valid, poa, np.nan).astype('float32'), 1)

        vals = poa[valid]
        lon_min, lon_max, lat_min, lat_max = get_map_extent(
            {'transform': dem_transform, 'crs': dem_crs,
             'height': poa.shape[0], 'width': poa.shape[1]}
        )
        emit_progress(100, 'done')
        sys.stdout.write(json.dumps({
            'solar_terrain': {
                'poa_min': round(float(np.min(vals)), 1),
                'poa_max': round(float(np.max(vals)), 1),
                'poa_mean': round(float(np.mean(vals)), 1),
                'poa_std_pct': round(float(100.0 * np.std(vals) / np.mean(vals)), 2),
                'slope_mean_deg': round(float(np.nanmean(slope[valid])), 2),
                'slope_max_deg': round(float(np.nanmax(slope[valid])), 2),
                'pixels': int(valid.sum()),
                'hourly_years': int(n_years),
                'season': season,
                'unit': unit,
                # The colour domain the overlay was drawn on. Without it a
                # client can only guess, and two layers drawn on different
                # domains would be compared as if they shared one.
                'scale': {
                    'palette': scale['palette'],
                    'min': round(float(scale['min']), 4),
                    'max': round(float(scale['max']), 4),
                    'reference': scale['reference'],
                    'basis': scale['basis'],
                    'shared_with': scale['shared_with'],
                    'decimals': int(scale['decimals']),
                },
                'shading_mean_pct': (
                    round(float(100.0 * np.nanmean(shading_loss[valid])), 3)
                    if shading_loss is not None else None
                ),
                'shading_max_pct': (
                    round(float(100.0 * np.nanmax(shading_loss[valid])), 3)
                    if shading_loss is not None else None
                ),
                'horizon_max_dist_m': float(solar_mod.HORIZON_MAX_DIST_M),
                'beam_fraction': round(float(beam_share), 4),
                'dem_source': 'Copernicus DEM GLO-30',
                # Whether the POWER series behind this layer was fetched or
                # read from the on-disk cache, and when it was fetched.
                'power_provenance': {'hourly': hourly_provenance},
                'overlay_png': str(png),
                'raster_tif': str(tif),
                'extent': {
                    'lon_min': lon_min, 'lat_min': lat_min,
                    'lon_max': lon_max, 'lat_max': lat_max,
                },
            }
        }))
        sys.stdout.flush()
        return

    # Photovoltaic siting from slope limits and land-cover eligibility.
    if action == 'solar_siting':
        import solar as solar_mod
        import composite as comp
        import rasterio

        configure_gdal_for_cog()
        if not req.get('polygon_geojson'):
            fail('no polygon provided (polygon_geojson required)')
        polygon = polygon_from_geojson(req['polygon_geojson'])

        # Conventions, not verified legal restrictions. Echoed in the response.
        # Zero degrees is a limit the caller can mean: it accepts only ground
        # the DEM reports as flat. Absence selects the convention, not falsiness.
        slope_acceptable = request_number(
            req, 'slope_acceptable_deg', solar_mod.SLOPE_ACCEPTABLE_DEG
        )
        slope_restrictive = request_number(
            req, 'slope_restrictive_deg', solar_mod.SLOPE_RESTRICTIVE_DEG
        )
        excluded = tuple(req.get('excluded_cover') or solar_mod.EXCLUDED_COVER)
        cropland = tuple(req.get('cropland_cover') or solar_mod.CROPLAND_COVER)

        siting_pct = {'dem': 10, 'slope': 35, 'cover': 55, 'classes': 80}
        sited = compute_siting(
            polygon, work_dir, slope_acceptable, slope_restrictive,
            excluded, cropland, mapbiomas_path=req.get('mapbiomas_path'),
            progress=lambda st, msg: emit_progress(siting_pct[st], msg),
        )
        suit = sited['suitability']
        slope = sited['slope']
        stats = sited['classes']
        px_area_ha = sited['pixel_area_ha']
        dem_transform = sited['dem_transform']
        dem_crs = sited['dem_crs']
        dem_profile = sited['dem_profile']

        png = Path(work_dir) / 'solar_siting.png'
        comp.write_rgba_png(solar_mod.suitability_rgba(suit), png)
        tif = Path(work_dir) / 'solar_siting.tif'
        prof = dem_profile.copy()
        prof.update(dtype='int16', count=1, compress='lzw', nodata=-1)
        with rasterio.open(tif, 'w', **prof) as dst:
            dst.write(suit.astype('int16'), 1)

        lon_min, lon_max, lat_min, lat_max = get_map_extent(
            {'transform': dem_transform, 'crs': dem_crs,
             'height': slope.shape[0], 'width': slope.shape[1]}
        )
        by_code = {r['code']: r for r in stats}
        emit_progress(100, 'done')
        sys.stdout.write(json.dumps({
            'solar_siting': {
                'classes': stats,
                # Reported apart, never summed: a pixel that is geometrically
                # fine but currently produces soybean carries a trade-off.
                'suitable_no_conflict_ha': by_code[4]['area_ha'],
                'suitable_cropland_ha': by_code[3]['area_ha'],
                'pixel_area_ha': round(float(px_area_ha), 5),
                'thresholds': sited['thresholds'],
                'dem_source': 'Copernicus DEM GLO-30',
                'overlay_png': str(png),
                'raster_tif': str(tif),
                'extent': {
                    'lon_min': lon_min, 'lat_min': lat_min,
                    'lon_max': lon_max, 'lat_max': lat_max,
                },
            }
        }))
        sys.stdout.flush()
        return

    # Loss waterfall, tracking comparison, generation profile and plant energy.
    # Runs on the same POWER series as solar_resource, read from the cache when
    # that action has already been run for this cell.
    if action == 'energy_model':
        import solar as solar_mod
        import energy as energy_mod
        from datetime import date as _date

        if not req.get('polygon_geojson'):
            fail('no polygon provided (polygon_geojson required)')
        polygon = polygon_from_geojson(req['polygon_geojson'])
        centroid = polygon.centroid
        lon, lat = solar_mod.grid_key(centroid.x, centroid.y)

        clim_years = request_positive(req, 'climatology_years', 30, int)
        hourly_years = request_positive(req, 'hourly_years', 10, int)
        azimuth = request_number(req, 'surface_azimuth', 0.0)
        pr_override = req.get('performance_ratio')
        reporting_basis = (req.get('reporting_basis') or 'year_one').lower()
        if reporting_basis not in energy_mod.REPORTING_BASES:
            fail(f'unknown reporting basis: {reporting_basis}')
        try:
            module_type, gamma_pdc = energy_mod.resolve_module_type(
                req.get(energy_mod.MODULE_TYPE_REQUEST_FIELD)
            )
        except ValueError as e:
            fail(str(e))
        # Zero per year is a value, not an omission: it states that the caller
        # is modelling no degradation. Read through request_number it survives;
        # under the previous `or` default it became 0.5 %/yr and multiplied
        # every lifetime-mean figure by 0.9422 instead of 1.0.
        degradation_rate = request_positive(
            req, 'degradation_rate_per_year',
            energy_mod.DEGRADATION_RATE_PER_YEAR, allow_zero=True,
        )
        analysis_period = request_positive(
            req, 'analysis_period_years',
            energy_mod.ANALYSIS_PERIOD_YEARS, int,
        )
        gcr_fixed = request_positive(req, 'gcr_fixed', energy_mod.GCR_FIXED)
        gcr_tracker = request_positive(
            req, 'gcr_tracker', energy_mod.GCR_TRACKER
        )
        # Zero degrees is a tracker locked flat, which is a configuration a
        # caller can ask for, so it is admitted rather than replaced by 60.
        tracker_max_angle = request_positive(
            req, 'tracker_max_angle_deg', energy_mod.TRACKER_MAX_ANGLE_DEG,
            allow_zero=True,
        )
        density_basis = (
            req.get('capacity_density_basis')
            or energy_mod.DEFAULT_CAPACITY_DENSITY_BASIS
        )
        if density_basis not in energy_mod.CAPACITY_DENSITY_BASES:
            fail(f'unknown capacity density basis: {density_basis}')
        # Zero buildable share is a site with nothing buildable on it, which is
        # a statement, not an omission.
        buildable_fraction = request_positive(
            req, 'buildable_fraction', energy_mod.BUILDABLE_FRACTION,
            allow_zero=True,
        )
        utc_offset = request_number(req, 'utc_offset_hours', None)
        # Zero is total horizon obstruction. It is admitted for the same reason
        # and, like every other value of this field, it is a fraction of BEAM
        # irradiance and is converted by the beam share before it is applied.
        shading_derate = request_positive(
            req, 'shading_derate', 1.0, allow_zero=True
        )
        shading_applied = bool(req.get('shading_applied', False))

        # POWER publishes through the previous full year.
        last_year = _date.today().year - 1
        clim_start = f'{last_year - clim_years + 1}0101'
        clim_end = f'{last_year}1231'
        hourly_start = f'{last_year - hourly_years + 1}0101'
        hourly_end = f'{last_year}1231'
        clim_window = f'{last_year - clim_years + 1}-{last_year} daily'
        hourly_window = f'{last_year - hourly_years + 1}-{last_year} hourly'

        cache = power_cache_dir(req)
        emit_progress(4, f'NASA POWER daily, {clim_years} years')
        try:
            daily, daily_provenance = cached_power_series(
                cache, 'daily', lon, lat, clim_start, clim_end,
                solar_mod.DAILY_PARAMS,
                lambda progress: solar_mod.fetch(
                    'daily', lon, lat, clim_start, clim_end, progress=progress
                ),
                progress=lambda i, n, y: emit_progress(
                    4 + int(26 * (i + 1) / n), f'daily {y}'
                ),
            )
        except Exception as e:
            fail(f'NASA POWER daily request failed: {e}')

        annual = solar_mod.annual_totals(daily)
        if annual.empty:
            fail('NASA POWER returned no complete year for this point')

        emit_progress(32, f'NASA POWER hourly, {hourly_years} years')
        try:
            hourly, hourly_provenance = cached_power_series(
                cache, 'hourly', lon, lat, hourly_start, hourly_end,
                solar_mod.HOURLY_PARAMS,
                lambda progress: solar_mod.fetch(
                    'hourly', lon, lat, hourly_start, hourly_end,
                    progress=progress,
                ),
                progress=lambda i, n, y: emit_progress(
                    32 + int(30 * (i + 1) / n), f'hourly {y}'
                ),
            )
        except Exception as e:
            fail(f'NASA POWER hourly request failed: {e}')

        # Elevation 0.0 as solar_resource does, so the two actions run on one
        # chain and cannot report different plane-of-array totals for one AOI.
        df, solpos = solar_mod.prepare_hourly(hourly, lat, lon, 0.0)
        if df.empty:
            fail('NASA POWER returned no usable hourly record for this point')
        n_years = max(len(set(df.index.year)), 1)

        emit_progress(66, 'optimum tilt')
        sweep = solar_mod.sweep_tilt(df, solpos, azimuth, n_years)
        best = max(sweep, key=lambda r: r['poa_kwh_m2_year'])
        horizontal = next(
            (r['poa_kwh_m2_year'] for r in sweep if abs(r['tilt_deg']) < 1e-9),
            best['poa_kwh_m2_year'],
        )
        poa = solar_mod.transpose(df, solpos, best['tilt_deg'], azimuth)
        # The selected module type re-evaluates the two coefficient-dependent
        # steps of the chain, so every product below runs on the type the
        # response reports rather than on the module default.
        frame = energy_mod.apply_module_type(
            solar_mod.pv_yield_frame(poa, df, solpos, best['tilt_deg'], azimuth),
            gamma_pdc,
        )

        emit_progress(70, 'performance ratio')
        try:
            ratio = energy_mod.resolve_performance_ratio(
                frame, n_years,
                override=(
                    float(pr_override)
                    if isinstance(pr_override, (int, float)) else None
                ),
                declared_loss_pct=req.get('declared_loss_pct') or None,
                optional_loss_pct=req.get('optional_loss_pct') or None,
                reporting_basis=reporting_basis,
                degradation_rate_per_year=degradation_rate,
                analysis_period_years=analysis_period,
            )
        except Exception as e:
            fail(f'performance ratio could not be resolved: {e}')
        poa_year = float(ratio['factors']['energy_poa_kwh_m2_year'])
        ghi_hourly = float(df['ghi'].sum()) / 1000.0 / n_years

        emit_progress(74, 'loss waterfall')
        try:
            waterfall = energy_mod.loss_waterfall(
                frame, ghi_hourly, float(horizontal), n_years, ratio,
                hourly_window=hourly_window,
                ghi_climatology_kwh_m2_year=float(annual.mean()),
                climatology_window=clim_window,
            )
        except Exception as e:
            fail(f'loss waterfall failed: {e}')

        emit_progress(78, 'single-axis tracking comparison')
        try:
            tracking = energy_mod.tracking_comparison(
                df, solpos, n_years, poa, best['tilt_deg'], azimuth, ratio,
                gcr_fixed=gcr_fixed, gcr_tracker=gcr_tracker,
                max_angle_deg=tracker_max_angle,
                gamma_pdc=gamma_pdc,
            )
        except Exception as e:
            fail(f'tracking comparison failed: {e}')

        emit_progress(86, 'generation profile')
        try:
            profile = energy_mod.generation_profile(
                frame, n_years, utc_offset_hours=utc_offset
            )
        except Exception as e:
            fail(f'generation profile failed: {e}')

        density = energy_mod.resolve_capacity_density(
            density_basis, buildable_fraction=buildable_fraction
        )

        # Three ways to reach the suitable area, in order of what the caller
        # already holds. Reading back a siting raster is preferred over the
        # class list alone because the raster also answers whether the area is
        # one block or many, which the capacity figure has to be read against.
        suitability = None
        pixel_area_ha = req.get('pixel_area_ha')
        # A classification the caller supplies carries limits this action never
        # saw, so the response says so rather than reporting no limits at all.
        thresholds = req.get('siting_thresholds') or {
            'note': (
                'The siting classification was supplied by the caller. The '
                'slope limits and land-cover lists behind these areas are not '
                'recorded in this response.'
            ),
        }
        class_areas = None
        siting_tif = req.get('siting_raster_tif')
        siting_classes = req.get('siting_classes')
        if siting_tif and Path(siting_tif).exists():
            import rasterio
            emit_progress(88, 'reading the siting raster')
            with rasterio.open(siting_tif) as src:
                suitability = src.read(1)
                dx_m, dy_m = solar_mod.pixel_size_m(src.transform, centroid.y)
            pixel_area_ha = (dx_m * dy_m) / 10_000.0
            class_areas = solar_mod.suitability_stats(suitability, pixel_area_ha)
        elif siting_classes:
            class_areas = siting_classes
        else:
            configure_gdal_for_cog()
            slope_acceptable = request_number(
                req, 'slope_acceptable_deg', solar_mod.SLOPE_ACCEPTABLE_DEG
            )
            slope_restrictive = request_number(
                req, 'slope_restrictive_deg', solar_mod.SLOPE_RESTRICTIVE_DEG
            )
            excluded = tuple(req.get('excluded_cover') or solar_mod.EXCLUDED_COVER)
            cropland = tuple(req.get('cropland_cover') or solar_mod.CROPLAND_COVER)
            siting_pct = {'dem': 88, 'slope': 91, 'cover': 93, 'classes': 96}
            sited = compute_siting(
                polygon, work_dir, slope_acceptable, slope_restrictive,
                excluded, cropland, mapbiomas_path=req.get('mapbiomas_path'),
                progress=lambda st, msg: emit_progress(siting_pct[st], msg),
            )
            suitability = sited['suitability']
            pixel_area_ha = sited['pixel_area_ha']
            class_areas = sited['classes']
            thresholds = sited['thresholds']

        emit_progress(97, 'plant energy over the suitable area')
        try:
            plant = energy_mod.plant_energy(
                class_areas, annual, poa_year, ratio,
                density=density,
                shading_derate=shading_derate,
                shading_applied=shading_applied,
                # The derate the caller sends is the terrain product's mean
                # horizon loss, which is a fraction of BEAM irradiance. The
                # beam share of this site's own hourly series converts it to a
                # fraction of the plane-of-array total; without it the loss
                # would be applied on the wrong base and every capacity-class
                # energy figure would be low by the diffuse share of it.
                beam_share=float(solar_mod.beam_fraction(df)),
                suitability=suitability,
                pixel_area_ha=(
                    None if pixel_area_ha is None else float(pixel_area_ha)
                ),
                thresholds=thresholds,
            )
        except Exception as e:
            fail(f'plant energy failed: {e}')

        emit_progress(100, 'done')
        sys.stdout.write(json.dumps({
            'energy_model': {
                'lon': lon, 'lat': lat,
                'hourly_years': int(n_years),
                'climatology_years': int(annual.size),
                'hourly_window': hourly_window,
                'climatology_window': clim_window,
                'geometry': {
                    'optimal_tilt_deg': round(float(best['tilt_deg']), 1),
                    'surface_azimuth_deg': azimuth,
                    'poa_kwh_m2_year': round(poa_year, 4),
                    'poa_horizontal_kwh_m2_year': round(float(horizontal), 4),
                    'ghi_hourly_kwh_m2_year': round(ghi_hourly, 4),
                },
                'performance_ratio': ratio,
                'module_type': energy_mod.module_type_assumption(gamma_pdc),
                'loss_waterfall': waterfall,
                'tracking': tracking,
                'generation_profile': profile,
                'capacity_density': density,
                'plant': plant,
                'reporting_basis': reporting_basis,
                'grid_note': solar_mod.GRID_NOTE,
                # Which POWER series this run read and when it was
                # fetched. Without it a cached run and a fetched run
                # are indistinguishable to the caller, and POWER
                # reprocesses historical data.
                'power_provenance': {
                    'daily': daily_provenance,
                    'hourly': hourly_provenance,
                },
                # Repeated at the top level so a reader who sees only one
                # figure still sees the assumption that produced it.
                'assumptions': {
                    'performance_ratio_applied': float(ratio['applied']),
                    'performance_ratio_source': ratio['applied_source'],
                    'performance_ratio_modelled': round(float(ratio['modelled']), 6),
                    'performance_ratio_derived': round(float(ratio['derived']), 6),
                    'reporting_basis': reporting_basis,
                    'degradation_factor': float(ratio['degradation_factor']),
                    'degradation_rate_per_year': float(degradation_rate),
                    'analysis_period_years': int(analysis_period),
                    'module_type': module_type,
                    'gamma_pdc_per_c': float(gamma_pdc),
                    'transposition_model': solar_mod.TRANSPOSITION_MODEL,
                    'albedo': float(solar_mod.ALBEDO),
                    'gcr_fixed': gcr_fixed,
                    'gcr_tracker': gcr_tracker,
                    'capacity_density_basis': density_basis,
                    'capacity_density_mw_dc_per_ha': round(
                        float(density['value_mw_dc_per_ha']), 6),
                    'shading_applied': shading_applied,
                    'shading_derate': shading_derate,
                    'resolution_note': solar_mod.GRID_NOTE,
                    'note': (
                        'Every energy figure in this response was computed at '
                        'the applied performance ratio and the reporting basis '
                        'stated here. A figure copied out of this response '
                        'without them is not interpretable.'
                    ),
                },
            }
        }))
        sys.stdout.flush()
        return

    # Wind resource screening at the AOI centroid, from POWER hourly MERRA-2.
    if action == 'wind_resource':
        import wind as wind_mod
        from datetime import date as _date

        if not req.get('polygon_geojson'):
            fail('no polygon provided (polygon_geojson required)')
        polygon = polygon_from_geojson(req['polygon_geojson'])
        centroid = polygon.centroid
        # The MERRA-2 cell centre, not the centroid: the request resolves to a
        # cell and the response has to say which cell it describes.
        lon, lat = wind_mod.grid_key(centroid.x, centroid.y)

        record_years = request_positive(
            req, 'record_years', wind_mod.RECORD_YEARS, int
        )
        hub_height_m = request_positive(
            req, 'hub_height_m', wind_mod.HUB_HEIGHT_M
        )
        # Zero is a caller stating that no hour counts as calm, and zero is a
        # caller stating that the record maximum needs no floor. Both are
        # values; only absence selects the wind module's convention.
        calm_threshold = request_positive(
            req, 'calm_threshold_ms', wind_mod.CALM_THRESHOLD_MS,
            allow_zero=True,
        )
        record_max_floor = request_positive(
            req, 'record_max_floor_ms', wind_mod.RECORD_MAX_FLOOR_MS,
            allow_zero=True,
        )
        band = req.get('roughness_band_m') or wind_mod.ROUGHNESS_BAND_M
        try:
            roughness_band = (float(band[0]), float(band[1]))
        except (TypeError, IndexError, ValueError):
            fail('roughness_band_m must be two roughness lengths in metres')

        last_year = _date.today().year - 1
        start, end = wind_mod.record_period(last_year, record_years)
        record_window = f'{start[:4]}-{end[:4]} hourly'

        emit_progress(5, f'NASA POWER hourly wind, {record_years} years')
        try:
            df, hourly_provenance = cached_power_series(
                power_cache_dir(req), 'hourly', lon, lat, start, end,
                wind_mod.HOURLY_PARAMS,
                lambda progress: wind_mod.fetch(
                    lon, lat, start, end, progress=progress
                ),
                progress=lambda i, n, y: emit_progress(
                    5 + int(80 * (i + 1) / n), f'hourly {y}'
                ),
            )
        except Exception as e:
            fail(f'NASA POWER hourly request failed: {e}')
        if df.empty:
            fail('NASA POWER returned no hourly record for this point')

        emit_progress(90, 'shear, Weibull fit and turbine power')
        try:
            assessment = wind_mod.assess(
                df, lon, lat,
                hub_height_m=hub_height_m,
                calm_threshold_ms=calm_threshold,
                record_max_floor_ms=record_max_floor,
                roughness_band_m=roughness_band,
            )
        except Exception as e:
            fail(f'wind assessment failed: {e}')

        assessment.update({
            'lon': lon, 'lat': lat,
            'record_window': record_window,
            'hub_height_m': hub_height_m,
            # Whether the POWER record behind this assessment was fetched or
            # read from the on-disk cache, and when it was fetched.
            'power_provenance': {'hourly': hourly_provenance},
            'assumptions': {
                'hub_height_m': hub_height_m,
                'hub_height_source': (
                    'Hub height of the IEA-3.4-130 reference turbine, applied '
                    'as a project convention. No turbine has been selected for '
                    'this site.'
                ),
                'record_years': record_years,
                'record_window': record_window,
                'shear_exponent': assessment['measured']['shear_exponent'],
                'shear_exponent_source': (
                    'Power law between the 10 m and 50 m long-term means of '
                    'this record. Everything above 50 m is extrapolated.'
                ),
                'roughness_band_m': list(roughness_band),
                'calm_threshold_ms': calm_threshold,
                'record_max_floor_ms': record_max_floor,
                'conventions_note': (
                    'Hub height, the assumed roughness band, the calm '
                    'threshold and the record-maximum floor are project '
                    'conventions the user can edit. They are not measurements '
                    'and they have no published basis at this site.'
                ),
                'qualifier': wind_mod.RESULT_QUALIFIER,
                'excluded_losses': list(wind_mod.EXCLUDED_LOSSES),
                'comparison_note': (
                    'The gross capacity factor here and the photovoltaic '
                    'capacity factor from solar_resource are not comparable. '
                    'The photovoltaic figure is computed at a performance '
                    'ratio benchmarked against the Global Solar Atlas; this '
                    'one carries no external validation and no plant losses.'
                ),
                'resolution_note': wind_mod.GRID_NOTE,
            },
        })

        emit_progress(100, 'done')
        sys.stdout.write(json.dumps({'wind': assessment}))
        sys.stdout.flush()
        return

    # Surface water / flood mapping from spectral water indices (no model).
    if action == 'water':
        import water as water_mod
        import composite as comp

        configure_gdal_for_cog()
        start = req.get('start')
        end = req.get('end')
        max_cloud = float(req.get('max_cloud', 100.0))
        monthly_best = bool(req.get('monthly_best', True))
        tiles = req.get('tiles') or None
        index_name = (req.get('index') or water_mod.PRIMARY_INDEX).upper()
        if index_name not in water_mod.INDEX_NAMES:
            fail(f'unknown water index: {index_name}')
        if not start or not end:
            fail('water requires start and end dates (YYYY-MM-DD)')
        if not req.get('polygon_geojson'):
            fail('no polygon provided (polygon_geojson required)')
        polygon = polygon_from_geojson(req['polygon_geojson'])

        emit_progress(10, 'querying STAC catalog (Planetary Computer)')
        try:
            products = list_stac_products(
                polygon, start, end, tile_list=tiles, max_cloud=max_cloud,
                monthly_best=monthly_best,
            )
        except Exception as e:
            fail(f'STAC query failed: {e}')
        if not products:
            fail('no scenes found for this period and cloud filter')

        # The reference grid comes from B04 at 10 m, as in the predict path.
        ref_band, ref_profile = load_and_clip_band(products[0], 'B04', polygon)
        aoi_valid = ref_band > 0
        needed = water_mod.INDEX_BANDS[index_name]

        series = []
        masks = []
        observed = []
        frames = []
        n = len(products)
        for idx, product in enumerate(products):
            pct = 15 + int(70 * (idx + 1) / n)
            date_str = product['date'].strftime('%Y-%m-%d')
            emit_progress(pct, f'water index {idx + 1}/{n} ({date_str})')
            try:
                bands = {}
                for name in ('B03', 'B8A', 'B11', 'B12'):
                    res = comp.BAND_RESOLUTION.get(name, '10m')
                    bands[name] = load_band_to_reference_grid(
                        product, name, polygon, ref_profile, resolution=res
                    ) / 10000.0
            except Exception as e:
                sys.stderr.write(json.dumps({
                    'progress': -1, 'msg': f'skipping {date_str}: {e}'
                }) + '\n')
                sys.stderr.flush()
                continue

            date_valid = water_mod.per_date_valid_mask(aoi_valid, bands, index_name)
            if not date_valid.any():
                continue
            indices = water_mod.compute_water_indices(
                bands['B03'], bands['B8A'], bands['B11'], bands['B12']
            )
            frame = indices[index_name]
            vals = frame[date_valid]
            thr_otsu, clipped, degenerate = water_mod.otsu_threshold_for_date(vals)
            thr_fixed = water_mod.DEFAULT_THRESHOLD

            mask_fixed = water_mod.water_mask_for_date(frame, date_valid, thr_fixed)
            mask_otsu = water_mod.water_mask_for_date(frame, date_valid, thr_otsu)

            masks.append(mask_fixed)
            observed.append(date_valid)
            frames.append(frame)
            series.append({
                'date': date_str,
                'scene_id': product.get('id') or '',
                'cloud_cover': round(float(product.get('cloud_cover', 0.0)), 2),
                'observed_pixels': int(date_valid.sum()),
                'threshold_fixed': thr_fixed,
                'threshold_otsu': thr_otsu,
                'threshold_clipped': bool(clipped),
                'threshold_degenerate': bool(degenerate),
                'water_fraction_pct': round(
                    water_mod.water_fraction_pct(mask_fixed, date_valid), 4
                ),
                'water_fraction_otsu_pct': round(
                    water_mod.water_fraction_pct(mask_otsu, date_valid), 4
                ),
                'water_pixels': int(mask_fixed.sum()),
                'area_ha': round(float(int(mask_fixed.sum()) * 0.01), 4),
            })

        if not series:
            fail('no scene produced a usable observation over the AOI')

        emit_progress(88, 'building occurrence map')
        occ = water_mod.occurrence_map(masks, observed)
        bands_occ = water_mod.classify_occurrence(occ)
        observed_cube = np.stack(observed, axis=0)
        anomaly = water_mod.max_minus_median_index(np.stack(frames, axis=0), observed_cube)

        px_ha = 0.01
        peak = max(series, key=lambda r: r['water_fraction_pct'])

        occ_png = Path(work_dir) / 'water_occurrence.png'
        comp.write_rgba_png(water_mod.occurrence_to_rgba(occ), occ_png)

        lon_min, lon_max, lat_min, lat_max = get_map_extent(ref_profile)
        emit_progress(100, f'{len(series)} dates')
        sys.stdout.write(json.dumps({
            'water': {
                'index': index_name,
                'threshold_method': 'fixed',
                'threshold_fixed': water_mod.DEFAULT_THRESHOLD,
                'otsu_clip': [water_mod.OTSU_CLIP_LOW, water_mod.OTSU_CLIP_HIGH],
                'n_dates': len(series),
                'date_range': [series[0]['date'], series[-1]['date']],
                'aoi_pixels': int(aoi_valid.sum()),
                'aoi_area_ha': round(float(int(aoi_valid.sum()) * px_ha), 4),
                'series': series,
                'peak_date': peak['date'],
                'peak_water_fraction_pct': peak['water_fraction_pct'],
                'ephemeral_pixels': int(bands_occ['ephemeral'].sum()),
                'ephemeral_area_ha': round(
                    float(int(bands_occ['ephemeral'].sum()) * px_ha), 4
                ),
                'persistent_pixels': int(bands_occ['persistent'].sum()),
                'persistent_area_ha': round(
                    float(int(bands_occ['persistent'].sum()) * px_ha), 4
                ),
                'mean_anomaly': float(np.nanmean(anomaly)) if np.isfinite(anomaly).any() else 0.0,
                'occurrence_png': str(occ_png),
                'extent': {
                    'lon_min': lon_min, 'lat_min': lat_min,
                    'lon_max': lon_max, 'lat_max': lat_max,
                },
            }
        }))
        sys.stdout.flush()
        return

    # RGB / false-color composite or spectral index for one STAC scene.
    if action == 'render_composite':
        import composite as comp

        configure_gdal_for_cog()
        start = req.get('start')
        end = req.get('end')
        max_cloud = float(req.get('max_cloud', 100.0))
        monthly_best = bool(req.get('monthly_best', True))
        tiles = req.get('tiles') or None
        scene_id = (req.get('scene_id') or '').strip()
        kind = (req.get('kind') or 'rgb').strip().lower()
        stretch = req.get('stretch_pct') or [2, 98]
        try:
            stretch_lo = float(stretch[0])
            stretch_hi = float(stretch[1])
        except Exception:
            stretch_lo, stretch_hi = 2.0, 98.0

        if not scene_id:
            fail('render_composite requires scene_id')
        if not start or not end:
            fail('render_composite requires start and end dates (YYYY-MM-DD)')
        if req.get('polygon_geojson'):
            polygon = polygon_from_geojson(req['polygon_geojson'])
        elif req.get('kml_path'):
            area = parse_kml_coordinates(Path(req['kml_path']), req.get('kml_target'))
            if area is None:
                fail('polygon not found in KML')
            polygon = area['polygon']
        else:
            fail('no polygon provided (polygon_geojson or kml_path required)')

        emit_progress(10, 'querying STAC for scene')
        try:
            products = list_stac_products(
                polygon, start, end, tile_list=tiles, max_cloud=max_cloud,
                monthly_best=False,  # need full list to match scene_id
            )
        except Exception as e:
            fail(f'STAC query failed: {e}')

        product = None
        for p in products:
            if (p.get('id') or '') == scene_id:
                product = p
                break
        if product is None:
            # Fall back: monthly_best list may have dropped the scene; retry without cloud filter widen
            try:
                products = list_stac_products(
                    polygon, start, end, tile_list=tiles, max_cloud=100.0,
                    monthly_best=False,
                )
            except Exception as e:
                fail(f'STAC query failed: {e}')
            for p in products:
                if (p.get('id') or '') == scene_id:
                    product = p
                    break
        if product is None:
            fail(f'scene not found: {scene_id}')

        emit_progress(30, 'loading reference band B04')
        try:
            ref, ref_prof = load_and_clip_band(product, 'B04', polygon, '10m')
        except Exception as e:
            fail(f'failed to load B04: {e}')

        def load_band(name: str):
            res = comp.BAND_RESOLUTION.get(name, '10m')
            return load_band_to_reference_grid(product, name, polygon, ref_prof, res)

        mask = ref > 0
        overlay_png = work_dir / 'composite.png'
        meta = {
            'kind': kind,
            'scene_id': scene_id,
            'date': product['date'].strftime('%Y-%m-%d') if hasattr(product.get('date'), 'strftime') else str(product.get('date', '')),
            'stretch_pct': [stretch_lo, stretch_hi],
        }

        if kind == 'rgb':
            bands = req.get('bands') or list(comp.RGB_PRESETS['true_color'])
            if len(bands) != 3:
                fail('rgb kind requires bands: [R, G, B]')
            for bname in bands:
                if bname not in comp.ALLOWED_BANDS:
                    fail(f'unsupported band: {bname}')
            emit_progress(50, f'loading {bands[0]}/{bands[1]}/{bands[2]}')
            try:
                r = load_band(bands[0]) / 10000.0
                g = load_band(bands[1]) / 10000.0
                b = load_band(bands[2]) / 10000.0
            except Exception as e:
                fail(f'band load failed: {e}')
            mask = mask & (r > 0) & (g > 0) & (b > 0)
            rgba = comp.rgb_to_rgba(r, g, b, mask, stretch_lo, stretch_hi)
            meta['bands'] = bands
        elif kind == 'index':
            index_name = (req.get('index') or 'ndvi').strip().lower()
            if index_name not in comp.ALLOWED_INDICES:
                fail(f'unsupported index: {index_name}')
            emit_progress(50, f'computing {index_name}')
            try:
                if index_name == 'ndvi':
                    nir = load_band('B08') / 10000.0
                    red = load_band('B04') / 10000.0
                    idx = calculate_ndvi(nir, red)
                    mask = mask & (nir > 0) & (red > 0)
                elif index_name == 'ndwi':
                    green = load_band('B03') / 10000.0
                    nir = load_band('B08') / 10000.0
                    idx = comp.calculate_ndwi(green, nir)
                    mask = mask & (green > 0) & (nir > 0)
                elif index_name == 'ndmi':
                    nir = load_band('B08') / 10000.0
                    swir = load_band('B11') / 10000.0
                    idx = comp.calculate_ndmi(nir, swir)
                    mask = mask & (nir > 0) & (swir > 0)
                else:  # evi
                    nir = load_band('B08') / 10000.0
                    red = load_band('B04') / 10000.0
                    blue = load_band('B02') / 10000.0
                    idx = calculate_evi(nir, red, blue)
                    mask = mask & (nir > 0) & (red > 0) & (blue > 0)
            except Exception as e:
                fail(f'index bands failed: {e}')
            rgba = comp.index_to_rgba(idx, mask, index_name, stretch_lo, stretch_hi)
            meta['index'] = index_name
        else:
            fail(f'unknown kind: {kind}')

        emit_progress(85, 'writing PNG')
        comp.write_rgba_png(rgba, overlay_png)
        raster_tif = work_dir / 'composite.tif'
        emit_progress(92, 'writing GeoTIFF')
        try:
            comp.write_rgba_geotiff(rgba, ref_prof, raster_tif)
        except Exception as e:
            fail(f'composite GeoTIFF failed: {e}')
        extent = comp.extent_from_profile(ref_prof)
        emit_progress(100, 'done')
        sys.stdout.write(json.dumps({
            'extent': extent,
            'overlay_png': str(overlay_png),
            'raster_tif': str(raster_tif),
            'meta': meta,
        }))
        sys.stdout.flush()
        return

    model_dir = Path(req.get('model_dir', ''))
    source = req.get('source', 'stac')  # 'stac' (cloud COG) or 'local' (.SAFE)
    sentinel_dir = Path(req.get('sentinel_dir', '')) if req.get('sentinel_dir') else None
    tiles = req.get('tiles') or None
    mode = req.get('mode', 'single')
    mapbiomas_path = req.get('mapbiomas_path')
    # STAC parameters (used when source == 'stac').
    start = req.get('start')
    end = req.get('end')
    max_cloud = float(req.get('max_cloud', 100.0))
    monthly_best = bool(req.get('monthly_best', True))
    # Model selection: 'spectral', 'prithvi', or 'temporal_transformer'.
    model_kind = req.get('model_kind', 'spectral')
    prithvi_mode = req.get('prithvi_mode', 'pixel')  # 'pixel' or 'patch'

    if source == 'stac':
        configure_gdal_for_cog()

    # Resolve polygon from explicit geometry or KML path.
    if req.get('polygon_geojson'):
        polygon = polygon_from_geojson(req['polygon_geojson'])
    elif req.get('kml_path'):
        area = parse_kml_coordinates(Path(req['kml_path']), req.get('kml_target'))
        if area is None:
            fail('polygon not found in KML')
        polygon = area['polygon']
    else:
        fail('no polygon provided (polygon_geojson or kml_path required)')

    if not model_dir.exists():
        fail(f'model directory not found: {model_dir}')

    rf_model = scaler = label_encoder = feature_names = None
    n_dates_model = 22
    if model_kind == 'spectral':
        emit_progress(5, 'loading model artifacts')
        try:
            rf_model = joblib.load(model_dir / 'rf_classifier.joblib')
            scaler = joblib.load(model_dir / 'scaler.joblib')
            label_encoder = joblib.load(model_dir / 'label_encoder.joblib')
            feature_names = joblib.load(model_dir / 'feature_names.joblib')
        except Exception as e:
            fail(f'failed to load model artifacts: {e}')
        # N_DATES_MODEL: total features minus the 58 non-temporal features
        # (14 stats * 3 indices + 16 band stats). Remainder are raw NDVI dates.
        n_dates_model = len(feature_names) - 58

    if source == 'stac':
        if not start or not end:
            fail('STAC source requires start and end dates (YYYY-MM-DD)')
        emit_progress(10, 'querying STAC catalog (Planetary Computer)')
        try:
            products = list_stac_products(
                polygon, start, end, tile_list=tiles, max_cloud=max_cloud,
                monthly_best=monthly_best,
            )
        except Exception as e:
            fail(f'STAC query failed: {e}')
        if len(products) == 0:
            fail('no Sentinel-2 scenes found for the area, dates and cloud filter')
        sel = 'best/month' if monthly_best else f'all < {max_cloud:.0f}% cloud'
        emit_progress(15, f'{len(products)} scenes selected ({sel})')
    else:
        if sentinel_dir is None or not sentinel_dir.exists():
            fail(f'Sentinel-2 directory not found: {sentinel_dir}')
        emit_progress(10, 'discovering local Sentinel-2 products')
        products = list_sentinel_products(sentinel_dir, tile_list=tiles)
        if len(products) == 0:
            fail('no Sentinel-2 .SAFE products found in the selected directory')
        emit_progress(15, f'{len(products)} products found')

    # Reference grid from the first product's B04 band.
    try:
        ref_band, ref_profile = load_and_clip_band(products[0], 'B04', polygon)
    except Exception as e:
        fail(f'failed to build reference grid: {e}')

    # Optional MapBiomas full map for reference panel + soja mask for retention.
    # Embedded areas ship a local TIFF; custom AOIs in Brazil fetch the COG window.
    soja_mask = None
    mb_map = None
    try:
        import lulc as lulc_mod
        if mapbiomas_path and Path(mapbiomas_path).exists():
            resolved_mb = mapbiomas_path
        elif lulc_mod.polygon_in_brazil(polygon):
            emit_progress(18, 'fetching MapBiomas COG for AOI')
            resolved_mb = str(lulc_mod.fetch_mapbiomas_window(polygon, work_dir))
            mapbiomas_path = resolved_mb
        else:
            resolved_mb = None
        if resolved_mb:
            mb_map = reproject_mapbiomas_to_grid(resolved_mb, ref_profile, ref_band)
            soja_mask = mb_map == SOJA_CLASS_ID
            emit_progress(20, f'soja reference pixels: {int(np.sum(soja_mask))}')
    except Exception as e:
        sys.stderr.write(json.dumps({'progress': -1, 'msg': f'mapbiomas error: {e}'}) + '\n')
        sys.stderr.flush()
        mb_map = None
        soja_mask = None

    temporal = []
    confidence_map = None

    if model_kind == 'prithvi':
        classification_map, confidence_map = classify_prithvi(
            products, polygon, ref_profile, model_dir, prithvi_mode
        )
    elif model_kind == 'temporal_transformer':
        emit_progress(40, f'building Temporal Transformer stack ({len(products)} dates)')
        classification_map, confidence_map = classify_temporal_transformer(
            products, polygon, ref_profile, model_dir
        )
    elif mode == 'temporal':
        n = len(products)
        for idx in range(n):
            cumulative = products[:idx + 1]
            target = products[idx]
            date_str = target['date'].strftime('%Y-%m-%d')
            pct = 20 + int(70 * (idx + 1) / n)
            emit_progress(pct, f'temporal stack {idx + 1}/{n} ({date_str})')

            fm, vmask = build_feature_matrix(cumulative, polygon, ref_profile, n_dates_model)
            if fm is None:
                continue
            cls_map, conf_map = classify_from_features(fm, vmask, rf_model, scaler, label_encoder)

            # NDVI of the target date over the soja reference pixels.
            soja_ndvi_mean = None
            soja_ret = None
            dominant = None
            if soja_mask is not None:
                try:
                    red = load_band_to_reference_grid(target, 'B04', polygon, ref_profile) / 10000.0
                    nir = load_band_to_reference_grid(target, 'B08', polygon, ref_profile) / 10000.0
                    ndvi_map = calculate_ndvi(nir, red)
                    sv = ndvi_map[soja_mask & (ndvi_map != 0)]
                    soja_ndvi_mean = float(np.mean(sv)) if sv.size > 0 else None
                except Exception:
                    pass
                soja_preds = cls_map[soja_mask & (cls_map >= 0)]
                if soja_preds.size > 0:
                    up, pc = np.unique(soja_preds, return_counts=True)
                    dist = {int(c): int(v) for c, v in zip(up, pc)}
                    dom_id = int(up[np.argmax(pc)])
                    dominant = MAPBIOMAS_LEGEND.get(dom_id, str(dom_id))
                    soja_ret = round(100.0 * dist.get(SOJA_CLASS_ID, 0) / soja_preds.size, 1)

            temporal.append({
                'date': date_str,
                'n_dates_stack': len(cumulative),
                'soja_ndvi_mean': (round(soja_ndvi_mean, 4) if soja_ndvi_mean is not None else None),
                'soja_retention_pct': soja_ret,
                'dominant': dominant,
            })

        # Final map = full cumulative stack (last iteration).
        fm, vmask = build_feature_matrix(products, polygon, ref_profile, n_dates_model)
        if fm is None:
            fail('no valid Sentinel-2 data for the selected area')
        classification_map, confidence_map = classify_from_features(
            fm, vmask, rf_model, scaler, label_encoder
        )
    else:
        emit_progress(40, f'building features ({len(products)} dates)')
        fm, vmask = build_feature_matrix(products, polygon, ref_profile, n_dates_model)
        if fm is None:
            fail('no valid Sentinel-2 data for the selected area')
        emit_progress(80, 'classifying')
        classification_map, confidence_map = classify_from_features(
            fm, vmask, rf_model, scaler, label_encoder
        )

    emit_progress(88, 'computing vegetation index series and phenology')
    import phenology as pheno
    import composite as comp
    vi_series, vi_dates, ndvi_means, ndvi_mean_map, ndvi_valid, true_color_rgba = (
        compute_aoi_vi_series(products, polygon, ref_profile)
    )
    phenology = pheno.phenology_metrics(ndvi_means, vi_dates) if vi_dates else {
        'sos_doy': None, 'pos_doy': None, 'eos_doy': None, 'los_days': None,
        'peak': None, 'base': None, 'amplitude': None,
    }
    phenology_states = pheno.state_timeline(ndvi_means, vi_dates) if vi_dates else []

    emit_progress(92, 'writing overlay and GeoTIFF')
    overlay_png = work_dir / 'overlay.png'
    raster_tif = work_dir / 'classification_map.tif'
    confidence_png = work_dir / 'confidence.png'
    ndvi_mean_png = work_dir / 'ndvi_mean.png'
    true_color_png = work_dir / 'true_color.png'
    reference_png = work_dir / 'reference.png'
    write_overlay_png(classification_map, overlay_png)
    write_classification_tif(classification_map, ref_profile, raster_tif)
    if confidence_map is None:
        confidence_map = (classification_map >= 0).astype(np.float32)
    write_confidence_png(confidence_map, classification_map >= 0, confidence_png)
    ndvi_mean_path = ''
    if ndvi_mean_map is not None and ndvi_valid is not None:
        write_ndvi_mean_png(ndvi_mean_map, ndvi_valid, ndvi_mean_png)
        ndvi_mean_path = str(ndvi_mean_png)
    true_color_path = ''
    if true_color_rgba is not None:
        comp.write_rgba_png(true_color_rgba, true_color_png)
        true_color_path = str(true_color_png)
    reference_path = ''
    if mb_map is not None:
        # Mask reference to AOI footprint (same as classification valid pixels).
        ref_cls = mb_map.astype(np.int32).copy()
        ref_cls[ref_band <= 0] = -1
        # Keep only known MapBiomas legend classes.
        known = np.isin(ref_cls, list(MAPBIOMAS_COLORS.keys()))
        ref_cls[~known] = -1
        write_overlay_png(ref_cls, reference_png)
        reference_path = str(reference_png)
    mean_conf = float(confidence_map[classification_map >= 0].mean()) if np.any(classification_map >= 0) else 0.0

    lulc_payload = None
    if mapbiomas_path and Path(mapbiomas_path).exists():
        emit_progress(96, 'analyzing MapBiomas land cover / land use')
        try:
            import lulc as lulc_mod
            # Prefer native MapBiomas clip for composition; attach pred-vs-ref
            # when the reprojected reference grid is available.
            ref_grid = mb_map if mb_map is not None else None
            lulc_payload = lulc_mod.analyze_mapbiomas(
                mapbiomas_path,
                polygon,
                work_dir=work_dir,
                pred_map=classification_map if ref_grid is not None else None,
                ref_on_pred_grid=None,  # composition from native clip
            )
            if ref_grid is not None:
                # Overlay comparison on Sentinel grid (10 m -> 0.01 ha/px).
                # The reference was resampled from 30 m, so the pixel count is
                # not the number of label observations; carry the native cell
                # count alongside it as the sample size.
                cell_ids = lulc_mod.reference_cell_grid(ref_profile, mapbiomas_path)
                compare = lulc_mod.pred_vs_ref_composition(
                    classification_map, ref_grid, cell_ids=cell_ids
                )
                lulc_payload['pred_vs_ref'] = compare
                valid = (classification_map >= 0) & (ref_grid > 0)
                lulc_payload['compare_pixels'] = int(valid.sum())
                n_cells = lulc_mod.distinct_reference_cells(cell_ids, valid)
                if n_cells is not None:
                    lulc_payload['compare_reference_cells'] = n_cells
        except Exception as e:
            sys.stderr.write(json.dumps({
                'progress': -1, 'msg': f'lulc analysis skipped: {e}'
            }) + '\n')
            sys.stderr.flush()

    lon_min, lon_max, lat_min, lat_max = get_map_extent(ref_profile)

    result = {
        'extent': {
            'lon_min': float(lon_min), 'lon_max': float(lon_max),
            'lat_min': float(lat_min), 'lat_max': float(lat_max),
        },
        'overlay_png': str(overlay_png),
        'raster_tif': str(raster_tif),
        'confidence_png': str(confidence_png),
        'ndvi_mean_png': ndvi_mean_path,
        'true_color_png': true_color_path,
        'reference_png': reference_path,
        'mean_confidence': round(mean_conf, 4),
        'n_dates': len(products),
        'date_range': [
            products[0]['date'].strftime('%Y-%m-%d'),
            products[-1]['date'].strftime('%Y-%m-%d'),
        ],
        'class_stats': class_statistics(classification_map),
        'temporal': temporal,
        'vi_series': vi_series,
        'phenology': phenology,
        'phenology_states': phenology_states,
        'lulc': lulc_payload,
    }

    emit_progress(100, 'done')
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()


if __name__ == '__main__':
    main()
