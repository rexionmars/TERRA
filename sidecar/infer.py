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


def require_torch(product):
    """
    Fail with an explanation when PyTorch is absent.

    torch is deliberately outside requirements.txt -- it outweighs everything
    else the application ships -- so the models that need it are opt-in. A bare
    `import torch` raises ModuleNotFoundError, which leaves the process as a
    traceback and an exit status: the caller reported "sidecar failed: exit
    status 1" and the user had no way to learn that one optional package was
    the whole of the problem.

    Named here rather than inlined because two products need it, and a check
    that exists in one place is a check the other forgets.
    """
    try:
        import torch  # noqa: F401
    except ImportError:
        fail(f'{product} needs PyTorch, which is not installed in this '
             f'environment. Install it there, or choose the Random Forest '
             f'model, which needs nothing further. '
             f'Settings > System reports what each interpreter has.')


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
            # Which radiometric convention the DNs are in. See boa_add_offset:
            # 04.00 and later carry BOA_ADD_OFFSET and earlier scenes do not,
            # so the two cannot be converted by the same constant.
            'processing_baseline': props.get('s2:processing_baseline'),
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


QUANTIFICATION_VALUE = 10000.0
BOA_ADD_OFFSET = -1000.0
# Processing baseline 04.00, and the date it began producing. Either identifies
# a product that carries the offset; the baseline is authoritative and the date
# is the fallback for a catalogue that does not report one.
BOA_OFFSET_FIRST_BASELINE = 4.0
BOA_OFFSET_FIRST_DATE = datetime(2022, 1, 25)


def boa_add_offset(product):
    """
    The radiometric offset this product's DNs carry, or zero.

    Baseline 04.00 shifted the dynamic range by a constant so that reflectance
    near zero would stop being clamped over dark surfaces, and recorded the
    shift as BOA_ADD_OFFSET in the product metadata. Reflectance has been
    (DN + offset) / QUANTIFICATION_VALUE ever since, and reading it as DN alone
    overstates every band by 0.1.

    Some catalogues harmonise this away and some do not. The Planetary
    Computer, which this sidecar reads by default, does not: its items expose
    no raster:bands scale or offset, so the correction belongs here.

    Derived per product rather than hardcoded as a constant, because a scene
    from before the switch carries no offset and subtracting one from it would
    introduce the error this function exists to remove.
    """
    if not isinstance(product, dict):
        return 0.0
    baseline = product.get('processing_baseline')
    if baseline:
        try:
            return (BOA_ADD_OFFSET
                    if float(baseline) >= BOA_OFFSET_FIRST_BASELINE else 0.0)
        except (TypeError, ValueError):
            pass
    acquired = product.get('date')
    if isinstance(acquired, datetime):
        return BOA_ADD_OFFSET if acquired >= BOA_OFFSET_FIRST_DATE else 0.0
    # Neither field available: a local product with no metadata. Assume the
    # pre-04.00 convention, which is what an archive predating the switch is.
    return 0.0


def to_reflectance(dn, product):
    """
    Surface reflectance from digital numbers, offset included.

    Use this for every quantity that is REPORTED as reflectance or derived from
    it: the vegetation indices, phenology, the water masks, the composites and
    the canopy series. It is the physically correct conversion.

    Do not use it to feed a trained model. See as_trained.
    """
    return (dn + boa_add_offset(product)) / QUANTIFICATION_VALUE


def as_trained(dn):
    """
    The convention the shipped models were fitted under, which omits the offset.

    A MODEL IS NOT A MEASUREMENT. The artifacts in model/ were fitted on inputs
    built as DN / 10000 from 22 Sentinel-2 products acquired between 2024-05-04
    and 2026-01-04 over tiles T21JZN and T22JBT. Every one of those postdates
    baseline 04.00, so the training imagery carried the offset and the training
    pipeline did not subtract it: the heads learned a feature space in which
    every band sits 0.1 high, and they are self-consistent within it.

    Nothing was mismatched before, therefore, and correcting inference alone is
    what would create the mismatch. Measured over a Cascavel AOI, converting
    these inputs with the offset moves 56.8 per cent of pixels and turns 70.8
    per cent soybean into 62.0 per cent forest formation on cropland, which is
    not an improvement in accuracy but a model answering a question it was
    never asked.

    So the seam is deliberate: everything the application reports as a physical
    quantity uses to_reflectance, and the three model input paths use this. The
    seam closes when the heads are refitted on offset-corrected inputs, at which
    point this function is deleted rather than changed.
    """
    return dn / QUANTIFICATION_VALUE


def load_reflectance_to_reference_grid(product, band_name, polygon, ref_profile,
                                       resolution='10m'):
    """`load_band_to_reference_grid` with the DN-to-reflectance step applied."""
    return to_reflectance(
        load_band_to_reference_grid(product, band_name, polygon, ref_profile,
                                    resolution=resolution),
        product,
    )


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
            blue_r, green_r, red_r, nir_r = (
                as_trained(blue), as_trained(green),
                as_trained(red), as_trained(nir))
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
    import composite as comp

    series = []
    crop_series = []
    dates = []
    ndvi_means = []
    ndvi_stack = []
    best_ndvi = -1.0
    best_rgb = None  # (red, green, blue, valid_mask)
    for product in products:
        try:
            blue = load_reflectance_to_reference_grid(product, "B02", polygon, ref_prof)
            green = load_reflectance_to_reference_grid(product, "B03", polygon, ref_prof)
            red = load_reflectance_to_reference_grid(product, "B04", polygon, ref_prof)
            nir = load_reflectance_to_reference_grid(product, "B08", polygon, ref_prof)
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


def classify_temporal_transformer(products, polygon, ref_profile, model_dir):
    """Classify with the mestrado Temporal Transformer (T×6 reflectance)."""
    require_torch("The Temporal Transformer")
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
                bands.append(np.clip(as_trained(arr), 0, 1).astype(np.float32))
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

def reference_pixel_size_m(profile):
    """
    The side of one pixel of the reference grid, in metres.

    Read off the grid rather than assumed. Every consumer that turns a pixel
    count into an area needs this number, and the two that already do --
    class_statistics for hectares and the brush probe in the studio -- each
    carried their own copy of the literal 10.

    NOT solar.pixel_size_m, which converts DEGREES to metres for a geographic
    DEM and would multiply this grid by 111320. The reference grid comes from a
    Sentinel-2 COG in UTM, so its transform is already in metres; the
    geographic branch below exists for a local product that is not, and is an
    approximation at the grid's own latitude in the way that one is.
    """
    transform = profile['transform']
    side = abs(float(transform.a))
    crs = profile.get('crs')
    if crs is not None and getattr(crs, 'is_geographic', False):
        lat = float(transform.f) + 0.5 * float(transform.e) * profile['height']
        return side * 111_320.0 * float(np.cos(np.radians(lat)))
    return side


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


# The seven bands the application reads, and their central wavelengths.
# Values from the Sentinel-2A spectral response functions (ESA, S2-SRF v3.1);
# the two SWIR bands and B8A are 20 m products resampled onto the 10 m grid.
TERRA_BANDS = (('B02', '10m'), ('B03', '10m'), ('B04', '10m'), ('B08', '10m'),
               ('B8A', '20m'), ('B11', '20m'), ('B12', '20m'))
BAND_WAVELENGTH_NM = {
    'B02': 492.4, 'B03': 559.8, 'B04': 664.6, 'B08': 832.8,
    'B8A': 864.7, 'B11': 1613.7, 'B12': 2202.4,
}
# Below this a class mean is a handful of pixels rather than a spectrum. The
# class is dropped from the figure instead of drawn at an unstated precision.
SPECTRUM_MIN_PIXELS = 30


def class_spectra(products, polygon, ref_profile, classification_map,
                  min_pixels=SPECTRUM_MIN_PIXELS):
    """
    Mean surface reflectance per band, per predicted class, on one acquisition.

    What the domain-shift diagnostics beside it cannot say. MMD, KL and the
    change-vector magnitude report THAT a distribution moved; a per-class
    spectrum reports which band moved and in which direction.

    ONE acquisition, not the series. The classification is temporal -- 80
    features over up to 22 dates -- but reflectance is not, and averaging seven
    bands across a season would mix phenological stages into a single curve
    that describes no date. The scene at the middle of the period is used, the
    same one the reference implementation in experiments/ measures, and it is
    named in the payload so the figure is not read as a seasonal mean.

    to_reflectance, not as_trained: this is REPORTED as a physical quantity, so
    it carries the baseline 04.00 offset. The classifier that produced
    classification_map consumed the uncorrected convention it was fitted under,
    which is the seam documented on as_trained -- the labels come from one
    space, the reflectance reported for them from the other.

    Returns None when nothing can be measured, rather than an empty shell.
    """
    if not products or classification_map is None:
        return None
    valid = classification_map >= 0
    if not valid.any():
        return None

    scene = products[len(products) // 2]
    bands = {}
    for name, resolution in TERRA_BANDS:
        try:
            bands[name] = load_reflectance_to_reference_grid(
                scene, name, polygon, ref_profile, resolution=resolution)
        except Exception as e:
            sys.stderr.write(json.dumps({
                'progress': -1, 'msg': f'spectrum band {name} skipped: {e}'
            }) + '\n')
            sys.stderr.flush()
    if not bands:
        return None

    points = []
    for cls_id in sorted({int(c) for c in np.unique(classification_map[valid])}):
        selected = valid & (classification_map == cls_id)
        for name, _ in TERRA_BANDS:
            band = bands.get(name)
            if band is None:
                continue
            pixels = band[selected & np.isfinite(band)]
            if pixels.size < min_pixels:
                continue
            points.append({
                'class_id': cls_id,
                'name': MAPBIOMAS_LEGEND.get(cls_id, f'Class {cls_id}'),
                'color': MAPBIOMAS_COLORS.get(cls_id, '#cccccc'),
                'band': name,
                'wavelength_nm': BAND_WAVELENGTH_NM[name],
                'n_pixels': int(pixels.size),
                'mean': float(round(float(np.mean(pixels)), 6)),
                'sd': float(round(float(np.std(pixels)), 6)),
                'p05': float(round(float(np.percentile(pixels, 5)), 6)),
                'p95': float(round(float(np.percentile(pixels, 95)), 6)),
            })
    if not points:
        return None
    return {
        'scene_date': scene['date'].strftime('%Y-%m-%d'),
        'scene_id': str(scene.get('id', '')),
        'n_scenes': len(products),
        # Named rather than assumed. The indices reported elsewhere in this run
        # come from the model's own convention; these do not.
        'convention': 'BOA reflectance, baseline 04.00 offset applied',
        'bands': [name for name, _ in TERRA_BANDS if name in bands],
        'points': points,
    }


REFERENCE_DIR = Path(__file__).resolve().parent / 'reference'
SOYBEAN_REFERENCE = REFERENCE_DIR / 'soybean_leaf_reference.json'


def spectral_angle(a, b):
    """
    The angle between two spectra, in radians. Spectral Angle Mapper.

    Scale-invariant, which is the whole reason it is the standard comparison: a
    material in shade differs from the same material in sun by a multiplier,
    and the angle ignores exactly that. What it cannot ignore is a change of
    SHAPE, which is what the leaf-to-canopy difference turns out to be.
    """
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na <= 0 or nb <= 0:
        return float('nan')

    # The half-angle form, not arccos of the cosine.
    #
    # arccos has an infinite derivative at 1, which is exactly where the
    # scale-invariance this function promises puts every shaded-material
    # comparison. A rounding error of eps in the cosine emerges as sqrt(2*eps)
    # in the angle, so the 2.2e-16 that dot() leaves on one platform and not on
    # another became 2.1e-8 radians -- a spectrum reported as not quite
    # identical to itself, on Linux but not on macOS.
    #
    # 2*atan2(|u - v|, |u + v|) over the unit vectors is conditioned evenly
    # across the whole range: it returns 0 for parallel and pi for antiparallel
    # without the clip that was hiding the loss. Checked against the previous
    # form on non-degenerate pairs, the two agree to 3.3e-16.
    u = a / na
    v = b / nb
    return float(2.0 * np.arctan2(
        float(np.linalg.norm(u - v)), float(np.linalg.norm(u + v))))


def library_limit(spectra):
    """
    Each predicted class against a leaf-level library spectrum, and the limit
    that comparison runs into.

    WHAT THIS IS FOR. A reader looking at a class called Soybean wants to know
    whether the pixels under it reflect like soybean. This computes the angle
    to a reference built from 1131 soybean leaf spectra, and reports the answer
    the measurement actually gives -- which is that Soybean is NOT the closest
    class to the soybean reference.

    That is not a classification error. A library spectrum is leaf level and a
    Sentinel-2 pixel is canopy: soil through the gaps and shadow between rows.
    The ratio between the two is reported per band because it is the mechanism:
    it is not constant, so the difference is not brightness. If it were, the
    angle would be zero, since the angle is scale-invariant. Soil raises the
    red while gaps and shadow lower the NIR, in opposite directions, and the
    shape itself is distorted.

    So a small angle here means CONSISTENCY, not identification, and nothing
    downstream may label it otherwise.

    The reference is vendored rather than fetched: it is 7 numbers derived from
    a 28 MB package by experiments/spectral_response_and_offset.py, convolved
    onto the ESA response functions. Fetching 28 MB at classify time to arrive
    at 7 numbers would be a network dependency for a constant.
    """
    if not spectra or not spectra.get('points'):
        return None
    try:
        reference = json.loads(SOYBEAN_REFERENCE.read_text())['reference']
    except Exception as e:
        sys.stderr.write(json.dumps({
            'progress': -1, 'msg': f'library reference unavailable: {e}'
        }) + '\n')
        sys.stderr.flush()
        return None

    leaf = {b['band']: float(b['reflectance']) for b in reference['bands']}
    bands = [b for b, _ in TERRA_BANDS if b in leaf]

    by_class = {}
    for p in spectra['points']:
        by_class.setdefault(p['class_id'], {})[p['band']] = p

    out = []
    for class_id in sorted(by_class):
        points = by_class[class_id]
        # A class the scene could not measure in every band has no vector to
        # compare; a partial one would be an angle in a different space.
        if any(b not in points for b in bands):
            continue
        canopy = np.array([points[b]['mean'] for b in bands], dtype=float)
        reference_vector = np.array([leaf[b] for b in bands], dtype=float)
        canopy_norm = float(np.linalg.norm(canopy))
        reference_norm = float(np.linalg.norm(reference_vector))
        first = points[bands[0]]
        out.append({
            'class_id': class_id,
            'name': first['name'],
            'color': first['color'],
            'angle_rad': round(spectral_angle(canopy, reference_vector), 6),
            'bands': [
                {
                    'band': b,
                    'wavelength_nm': points[b]['wavelength_nm'],
                    'canopy': round(float(canopy[i]), 6),
                    'leaf': round(float(reference_vector[i]), 6),
                    # Canopy over leaf. Constant would mean brightness alone.
                    'ratio': (
                        round(float(canopy[i] / reference_vector[i]), 4)
                        if reference_vector[i] > 0 else None
                    ),
                    # The unit vectors are what the angle actually compares,
                    # so a reader can see the difference the angle sees.
                    'unit_canopy': (
                        round(float(canopy[i] / canopy_norm), 6)
                        if canopy_norm > 0 else None
                    ),
                    'unit_leaf': (
                        round(float(reference_vector[i] / reference_norm), 6)
                        if reference_norm > 0 else None
                    ),
                }
                for i, b in enumerate(bands)
            ],
        })
    if not out:
        return None
    out.sort(key=lambda c: c['angle_rad'])
    return {
        'reference': {
            'material': reference['material'],
            'source': reference['source'],
            'package_id': reference['package_id'],
            'n_spectra': reference['n_spectra'],
            'level': reference['level'],
            'note': reference['note'],
            'bands': reference['bands'],
        },
        'scene_date': spectra.get('scene_date', ''),
        'classes': out,
    }


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
    # prithvi imports torch on the way in, so the same absence surfaces here as
    # an unexplained traceback rather than as a missing package.
    require_torch("Prithvi-EO 2.0")
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
        bands.append(np.clip(as_trained(arr), 0, 1))
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

    The hourly request is the dominant cost of the whole analysis, measured at
    about 23 s for ten years, and three actions ask for the same series over
    the same cell. What determines a POWER response is the
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


# --- Action handlers -------------------------------------------------------
#
# One function per action the request can name, each taking the parsed request
# and the resolved work directory and writing its own response to stdout. The
# pair is passed to every handler whether or not it reads both, so the table at
# the foot of this section can call any of them the same way.
#
# The imports inside these functions are deliberate and stay where they are.
# Helios arrives through pyhelios3d and PyTorch through torch, neither of which
# requirements.txt installs; the rest cost import time no other action pays.
# Hoisting one to module scope would make the sidecar refuse to start at all --
# `ping` included, which is the call that reports what an interpreter has.

# Lightweight health check used by the desktop boot footer.
def action_ping(req, work_dir):
    sys.stdout.write(json.dumps({
        'ok': True,
        'python': sys.version.split()[0],
        'sidecar': 'infer.py',
    }))
    sys.stdout.flush()


# Standalone MapBiomas land-cover / land-use analysis (no Sentinel / model).
def action_lulc(req, work_dir):
    emit_progress(10, 'resolving MapBiomas for AOI')
    try:
        import lulc as lulc_mod
        lulc = lulc_mod.analyze_from_request(req)
    except Exception as e:
        fail(f'LULC analysis failed: {e}')
    emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'lulc': lulc}))
    sys.stdout.flush()


# Domain-shift diagnosis from two cached fingerprints (no STAC re-fetch).
def action_domain_shift(req, work_dir):
    emit_progress(20, 'comparing domain fingerprints')
    try:
        import domain_shift as ds_mod
        fp_a = req.get('fingerprint_a')
        fp_b = req.get('fingerprint_b')
        if not isinstance(fp_a, dict) or not isinstance(fp_b, dict):
            fail('domain_shift requires fingerprint_a and fingerprint_b')
        report = ds_mod.compare_fingerprints(
            fp_a,
            fp_b,
            agreement_a=req.get('agreement_a'),
            agreement_b=req.get('agreement_b'),
            include_tsne=bool(req.get('include_tsne', False)),
        )
    except Exception as e:
        fail(f'domain_shift failed: {e}')
    emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'domain_shift': report}))
    sys.stdout.flush()


# One source against N targets, in one process. See compare_cohort for why
# this is not N invocations of the action above.
def action_domain_shift_cohort(req, work_dir):
    emit_progress(10, 'comparing domain fingerprints')
    try:
        import domain_shift as ds_mod
        source = req.get('source')
        targets = req.get('targets')
        if not isinstance(source, dict):
            fail('domain_shift_cohort requires a source')
        if not isinstance(targets, list) or not targets:
            fail('domain_shift_cohort requires at least one target')
        report = ds_mod.compare_cohort(source, targets)
    except Exception as e:
        fail(f'domain_shift_cohort failed: {e}')
    emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'domain_shift_cohort': report}))
    sys.stdout.flush()


# The leaf-area-density field of one periodic orchard module, plus the
# transmittances a second implementation of the march has to reproduce.
#
# The grid leaves as a binary file rather than inside the JSON: a 27x27x16
# field is 47 kB of float32 and several times that as decimal text, and the
# consumer uploads it to a texture, where it wants to be bytes anyway.
def action_canopy_field(req, work_dir):
    emit_progress(5, 'building the canopy field')
    source = req.get('source', 'ellipsoid')
    grow_meta = None

    # Helios is only ever asked for architecture. Its ImportError is caught
    # apart from every other failure, because "you do not have this package"
    # and "this package misbehaved" call for different things from the
    # reader, and an uncaught one would reach the user as `exit status 1`.
    if source == 'helios':
        try:
            # helios_grow itself imports without the toolkit, so a species
            # list can be offered on a machine that cannot grow anything;
            # the ImportError arrives from grow(). Catching it here rather
            # than around the import is what keeps the message specific.
            import helios_grow
            grown = helios_grow.grow(
                species=req.get('species', 'almond'),
                days=int(req.get('days', 120)),
                seed=req.get('seed'))
        except ImportError as e:
            fail('Growing a 3D crop needs the pyhelios3d package, which '
                 'installs as the module `pyhelios`. This interpreter does '
                 'not have it: run `pip install pyhelios3d` there, or '
                 'choose another Python in Settings > System. Canopies '
                 f'from ellipsoid crowns need nothing extra. ({e})')
        except Exception as e:
            fail(f'growing the plant failed: {e}')
        try:
            emit_progress(35, f'extracting {grown.species} at day {grown.days}')
            pos, area, grow_meta = helios_grow.leaf_cloud(grown)
        except Exception as e:
            fail(f'extracting the grown scene failed: {e}')
        req = dict(req, source='leaves',
                   leaf_positions=pos.tolist(), leaf_areas=area.tolist())

    try:
        import canopy_field as cfield
        grid, payload = cfield.build(
            req, progress=lambda p, m: emit_progress(p, m))
    except Exception as e:
        fail(f'canopy_field failed: {e}')

    try:
        import numpy as _np
        field_path = work_dir / 'canopy_field.f32'
        _np.ascontiguousarray(grid, dtype=_np.float32).tofile(str(field_path))
    except Exception as e:
        fail(f'writing the canopy field failed: {e}')

    payload['field']['path'] = str(field_path)
    payload['field']['bytes'] = int(grid.size * 4)
    if grow_meta is not None:
        payload['grown'] = grow_meta
    emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'canopy_field': payload}))
    sys.stdout.flush()


# A stand of plants as geometry, for a reader who wants to see the canopy.
#
# This is not the canopy field with a nicer surface on it. The field is a
# leaf-area density on a voxel grid: there is no leaf in it, and no
# rendering of it can show one, because the architecture was integrated away
# when it was built. This action keeps the architecture -- Helios grows the
# stand, the bridge pulls the triangles out by organ, and the mesh goes to
# the webview as glTF for three.js to draw.
#
# THE MESH IS LARGE AND THAT IS THE POINT. Twelve sorghum at day 60 is about
# 264,000 triangles. Fruit alone is a third of that -- a sorghum panicle,
# which nobody asked to see in a canopy -- so `organs` selects, defaulting
# to the vegetative structure. Growing is ~2 s for twenty plants, and the
# mesh is written once per request rather than per frame.
def action_canopy_mesh(req, work_dir):
    emit_progress(5, 'growing the stand')
    try:
        import helios_grow
        grown = helios_grow.grow_canopy(
            species=req.get('species', 'sorghum'),
            days=int(req.get('days', 60)),
            rows=int(req.get('rows', 4)),
            per_row=int(req.get('per_row', 5)),
            inter_row=float(req.get('inter_row', 0.8)),
            inter_plant=float(req.get('inter_plant', 0.2)),
            seed=req.get('seed'))
    except ImportError as e:
        fail('Growing a 3D canopy needs the pyhelios3d package, which '
             'installs as the module `pyhelios`. This interpreter does not '
             'have it: run `pip install -r requirements-helios.txt` there, '
             f'or choose another Python in Settings > System. ({e})')
    except Exception as e:
        fail(f'growing the stand failed: {e}')

    emit_progress(45, 'extracting the scene')
    try:
        import helios_bridge
        organs = req.get('organs') or ['leaf', 'petiole', 'other']
        scene = helios_bridge.extract(
            grown.ctx, organ_uuids=helios_grow.organ_uuids(grown))
        present = [o for o in organs if o in scene and len(scene[o]['tris'])]
        if not present:
            fail(f'the grown scene has none of the organs {organs}; it has '
                 f'{sorted(scene)}')
    except SystemExit:
        raise
    except Exception as e:
        fail(f'extracting the grown scene failed: {e}')

    emit_progress(75, 'writing the mesh')
    try:
        # GLB rather than glTF: a .gltf carries its buffer as a base64 data
        # URI, and the Go side base64s the file again to cross the webview
        # bridge, so 21 MB of geometry arrives as a 37 MB string and the
        # parser inside the webview exhausts its stack -- reported as
        # "Maximum call stack size exceeded", which names nothing. GLB keeps
        # the buffer binary, so there is one encoding on the path instead of
        # two, and write_glb indexes the vertices on the way out.
        mesh_path = work_dir / 'canopy_mesh.glb'
        helios_bridge.write_glb(scene, str(mesh_path), organs=present)
    except Exception as e:
        fail(f'writing the mesh failed: {e}')

    # The leaf area Helios reports for the stand, so a reader can tell this
    # is the same canopy the field would have been built from.
    pids = grown.plant_id if isinstance(grown.plant_id, list) else [grown.plant_id]
    payload = {
        'path': str(mesh_path),
        'bytes': int(mesh_path.stat().st_size),
        'species': grown.species,
        'days': grown.days,
        'plants': len(pids),
        'rows': int(req.get('rows', 4)),
        'per_row': int(req.get('per_row', 5)),
        'inter_row': float(req.get('inter_row', 0.8)),
        'inter_plant': float(req.get('inter_plant', 0.2)),
        'leaf_area': float(sum(grown.pa.getPlantLeafArea(p) for p in pids)),
        'organs': {o: int(len(scene[o]['tris'])) for o in present},
    }
    emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'canopy_mesh': payload}))
    sys.stdout.flush()


# The AOI's own NDVI series, read as a canopy.
# #
#
# WHAT IT CONNECTS. Everything above this line either observes the ground or
# simulates a plant, and nothing crossed between them: the canopy actions take
# a species and an age from the reader, while lai_ndvi.py -- written to be
# exactly this bridge -- was imported by nothing but its own tests. This walks
# the AOI's vegetation-index series into leaf area index, asks the ladder which
# Helios age produces it, and reports what the answer is worth.
#
# TWO ANCHORS FOR THE AGE, AND BOTH ARE REPORTED. Leaf area gives one: the age
# whose plant carries the observed LAI. Phenology gives another, independent
# of it: days since green-up in the series itself. Where the isolated-plant
# model describes the field the two agree. Where they do not, the disagreement
# is the finding -- Helios grows a plant with no neighbours (measured: soybean
# at 60 days is 1.402 m2 alone and 1.371 m2 inside a 24-plant stand, a ratio of
# 0.98), so in a dense sowing it reaches a given leaf area far too early. This
# action does not choose between them, because choosing would hide the one
# thing a reader needs in order to trust or distrust the geometry.
#
# THE SUN IS THE AOI'S OWN, when a location is given. canopy_field's six
# REFERENCE_SUNS exist to cross-validate a shader and are not solar geometry;
# solar.prepare_hourly turns the POWER record for this cell into real (azimuth,
# elevation) with the beam energy that arrived at each, and the march is
# weighted by that instead of by six arbitrary directions. Without a location
# the reference suns still answer, and the payload says which was used.
#
# NO GEOMETRY CROSSES HERE. This returns series and scalars; the mesh is
# canopy_mesh's job, and a reader who wants to see the stand asks for it with
# the age this action resolved.
#
def action_canopy_from_aoi(req, work_dir):
    emit_progress(5, 'reading the vegetation index series')

    series = req.get('vi_series') or []
    # The classification already knows what grows here, so the species is a
    # consequence of the data rather than a field the reader fills from a
    # default that has nothing to do with the AOI. It suggests and refuses:
    # cane, coffee and eucalyptus have no plant in the library, and the
    # catch-all crop classes do not identify one.
    suggestion = None
    if req.get('class_stats'):
        try:
            import crop_species
            suggestion = crop_species.suggest(req['class_stats'])
        except Exception as e:
            suggestion = {'species': None, 'why': f'suggestion failed: {e}'}
    if len(series) < 3:
        fail('a canopy needs a vegetation-index series; this run carries '
             f'{len(series)} observation(s), and three is the minimum the '
             'phenology smoother can label')

    dates = [str(p.get('date', '')) for p in series]
    ndvi = [float(p.get('ndvi_mean', 'nan')) for p in series]
    # An explicit species wins: the suggestion is the classification's
    # reading, and a reader who overrides it means to.
    species_name = req.get('species') or (
        (suggestion or {}).get('species') or 'sorghum')

    # Density from the sowing the reader set, which is how every other
    # canopy action states it. The ladder is per plant, so this is what
    # turns it into an LAI.
    inter_row = float(req.get('inter_row', 0.8))
    inter_plant = float(req.get('inter_plant', 0.25))
    if inter_row <= 0 or inter_plant <= 0:
        fail('row and plant spacing must both be positive')
    density = 1.0 / (inter_row * inter_plant)

    try:
        import lai_ndvi
        import lai_to_age
        import phenology as phen
    except ImportError as e:
        fail(f'the canopy bridge is unavailable: {e}')

    # Ordinal days for the smoother, which is by DATE and not by position:
    # a cloud-screened series is irregular, and a window counted in samples
    # averages across whatever survived.
    import datetime as _dt
    try:
        ordinals = [
            _dt.date.fromisoformat(d[:10]).toordinal() if d else None
            for d in dates
        ]
    except ValueError as e:
        fail(f'a date in the series is not ISO-8601: {e}')
    if any(o is None for o in ordinals):
        fail('every observation needs a date for the smoother to use')

    emit_progress(20, 'inverting NDVI to leaf area index')
    try:
        inverted = lai_ndvi.invert_series(ndvi, days=ordinals)
    except Exception as e:
        fail(f'the NDVI inversion failed: {e}')

    emit_progress(35, 'labelling phenological states')
    state_ids = phen.assign_states_from_ndvi(np.asarray(ndvi, dtype=float))
    state_slugs = {
        phen.STATE_SOIL: 'soil', phen.STATE_GREENUP: 'greenup',
        phen.STATE_MATURE: 'mature', phen.STATE_SENESCENCE: 'senescence',
        phen.STATE_FALLOW: 'fallow',
    }
    states = [state_slugs.get(int(s), 'soil') for s in state_ids]

    # THE INDEPENDENT AGE, COUNTED FROM ITS OWN CYCLE'S GREEN-UP.
    #
    # A year of Brazilian cropland holds more than one cycle -- a summer
    # crop and a safrinha, or a crop followed by a cover -- and taking the
    # first green-up of the whole series dates every later cycle from the
    # start of the file. Measured on a real AOI: the July and August 2026
    # observations were handed 344 days of age because the series begins
    # green in August 2025, when their own cycle had started weeks earlier.
    cycle_ids = phen.cycle_of(state_ids)
    cycle_list = phen.cycles(state_ids)
    greenup_by_cycle = {
        k: ordinals[c['greenup']] for k, c in enumerate(cycle_list)
    }

    emit_progress(50, 'matching leaf area to an age')
    try:
        resolved = lai_to_age.resolve_series(
            inverted['lai'], density, species_name,
            states=states, dates=dates)
    except lai_to_age.LadderError as e:
        fail(str(e))

    # THE LADDER IS A GROWTH CURVE AND A SEASON IS NOT.
    #
    # Helios plants only grow: leaf area rises with age and never falls, so
    # the ladder has no age for a canopy that is shedding. Past the peak the
    # inversion still answers -- a declining LAI matches a young plant -- but
    # the answer means "a plant carrying this much leaf", not "a canopy of
    # this age", and the two stop being the same thing.
    #
    # Left uncompared, that shows up as a disagreement growing to a hundred
    # days by the end of the season, which reads as the competition defect
    # and is not it. So the peak splits the series: before it the two ages
    # are measuring the same thing and their difference is informative;
    # after it the row says it is declining and offers no age comparison.
    lai_values = list(inverted['lai'])
    peak_index = int(np.nanargmax(lai_values)) if lai_values else 0
    # A duração da estação, para normalizar o progresso do campo contra o
    # do Helios. Do próprio NDVI, que é onde ela é observável.
    season_days = float(phen.phenology_metrics(ndvi, dates).get('los_days') or 0.0)
    for i, (row, o) in enumerate(zip(resolved, ordinals)):
        k = int(cycle_ids[i])
        start = greenup_by_cycle.get(k)
        since = None if start is None else float(o - start)
        row['cycle'] = k if k >= 0 else None
        row['days_since_greenup'] = since
        row['declining'] = i > peak_index
        if row['declining']:
            row['age_check'] = {
                'comparable': False,
                'why': ('a série já passou do pico e está perdendo folha; a '
                        'escada só cresce, então a idade que ela devolve é a '
                        'de uma planta com esta área foliar, não a deste '
                        'dossel'),
            }
        else:
            row['age_check'] = lai_to_age.disagreement(
                row.get('day'), row.get('plateau_day'), since, season_days)

    usable = [r for r in resolved if r.get('day') is not None]
    payload = {
        'species': species_name,
        'density': density,
        'inter_row': inter_row,
        'inter_plant': inter_plant,
        'reachable_lai': lai_to_age.reachable_lai(species_name, density),
        'species_suggestion': suggestion,
        # HOW MUCH OF THIS AOI IS THE CROP, because the series is an area
        # mean and a mean over mixed cover is not the crop's index.
        #
        # Measured on the soybean AOI this was built against: the peak
        # reads 0.314 with a standard deviation of 0.190, which for a
        # roughly even two-population mix puts the crop pixels near 0.50
        # and everything else near 0.12. So the LAI below is an area mean
        # and understates the crop by about that much. Reading the series
        # over crop pixels only is the fix, and it belongs upstream in the
        # index extraction rather than here.
        'crop_fraction': (
            None if not suggestion else suggestion.get('confidence')),
        'lai': inverted,
        'states': states,
        'phenology': phen.phenology_metrics(ndvi, dates),
        'resolved': resolved,
        'n_usable': len(usable),
        # The cycles the season was split into. More than one means the
        # window covers more than one crop, and every age below is measured
        # from its own cycle rather than from the start of the record.
        'cycles': [
            {
                'start': dates[c['start']],
                'end': dates[c['end']],
                'greenup': dates[c['greenup']],
                'n': c['end'] - c['start'] + 1,
            }
            for c in cycle_list
        ],
        'sun': {'source': 'reference'},
    }

    # WHICH DATE THE CANOPY IS BUILT FOR, decided here rather than inside
    # the sun block because the sun now depends on it.
    #
    # The densest canopy the ladder can actually build, which is where the
    # architecture matters: at low LAI every geometry transmits alike and
    # the answer says nothing.
    #
    # Not the peak of the series, which is the obvious choice and is wrong
    # often enough to matter -- a season that reaches the species' ceiling
    # has its peak AT the plateau, where the ladder returns no age at all,
    # and the naive `max` then silently fell through to the first usable
    # row: LAI 0.10 lit instead of 3.75.
    lit_row = max(usable, key=lambda r: r['lai'], default=None)

    # The AOI's own sun, when there is a point to ask POWER about.
    lat, lon = req.get('lat'), req.get('lon')
    if lat is not None and lon is not None:
        emit_progress(70, 'reading the solar record for this cell')
        try:
            import solar as solar_mod
            cell_lon, cell_lat = solar_mod.grid_key(float(lon), float(lat))
            last_year = _dt.date.today().year - 1
            years = int(req.get('hourly_years', 3))
            start = f'{last_year - years + 1}0101'
            end = f'{last_year}1231'
            hourly, provenance = cached_power_series(
                power_cache_dir(req),
                'hourly', cell_lon, cell_lat, start, end,
                solar_mod.HOURLY_PARAMS,
                lambda progress: solar_mod.fetch(
                    'hourly', cell_lon, cell_lat, start, end,
                    progress=progress),
            )
            df, solpos = solar_mod.prepare_hourly(
                hourly, cell_lat, cell_lon, float(req.get('elevation', 0.0)))

            # THE SEASON, WHICH IS THE LARGEST THING THIS BLOCK DECIDES.
            #
            # The record fetched above is three whole years, and averaging
            # all of it gives the sun of no particular time. This canopy is
            # dated -- it is one Sentinel-2 observation -- and season is the
            # bigger term by far: measured on this app's own cached POWER
            # records, faPAR varies 0.068 across months at one site against
            # 0.016 across the entire latitude range of Brazil.
            #
            # Until this window existed the panel printed "faPAR under the
            # real sun, on <date>" beside a sky averaged over every other
            # month of three years, which is a caption contradicting its own
            # number. Narrowing costs nothing: the parquet is already local
            # and the other years still contribute through the day-of-year
            # window, so a February canopy is lit by three Februaries.
            window_days = int(req.get('sun_window_days', 21))
            season = solar_mod.doy_window_mask(
                df.index, (lit_row or {}).get('date'), window_days)
            if season is not None and bool(season.any()):
                df, solpos = df[season], solpos[season]
            else:
                window_days = None
            energy, el_edges = solar_mod.beam_energy_histogram(df, solpos)
            # The diffuse share of what arrives, from the record rather than
            # assumed: a canopy lit by the beam alone is lit by a fraction
            # of a clear day and by almost nothing under cloud.
            ghi_sum = float(np.nansum(df['ghi'].to_numpy()))
            dhi_sum = float(np.nansum(df['dhi'].to_numpy()))
            dhi_share = (dhi_sum / ghi_sum) if ghi_sum > 0 else 0.0
            # One real day of the window rather than an hour-of-day mean.
            # Near the equator -- where these AOIs are -- the noon sun
            # passes within ten degrees of the zenith, azimuth swings tens
            # of degrees in half an hour there, and averaging it produces a
            # direction no sun ever occupied.
            track_day = solar_mod.representative_day(df)
            track = solar_mod.sun_track(df, solpos, track_day)
            payload['sun'] = {
                'source': 'power',
                'cell': [cell_lat, cell_lon],
                'years': years,
                'provenance': provenance,
                'beam_energy_total': float(np.sum(energy)),
                'n_azimuth_bins': int(energy.shape[0]),
                'n_elevation_bins': int(energy.shape[1]),
                'diffuse_share': dhi_share,
                # Which sky this is, so the reader is not left inferring it
                # from a caption. `window_days` None means the whole record
                # answered, which happens when no date resolved to an age.
                'window_days': window_days,
                'window_centre': (lit_row or {}).get('date') if window_days else None,
                'n_hours': int(len(df)),
                # THE SUN AS SOMETHING THAT CAN BE DRAWN, not only summed.
                #
                # Everything above describes the sky as totals and bin
                # counts, which a march consumes and a viewer cannot. A
                # scene handed those has no choice but to invent a light,
                # and the picture then shows a sun that had nothing to do
                # with the number beside it.
                #
                # `direction` is the beam-energy-weighted mean, so a scene
                # lit from it is lit by the same sun the faPAR came from.
                # `track` is one real day, hour by hour, for a viewer that
                # wants to move the sun rather than fix it.
                'direction': solar_mod.mean_beam_direction(df, solpos),
                'clearness': solar_mod.clearness(df),
                'track_date': (
                    str(track_day) if track_day is not None else None),
                'track': track,
            }

            # Light the canopy the series resolved, under that sun.
            #
            # MORE THAN ONE PLANT, BECAUSE ONE PLANT IS NOT AN ANSWER.
            # helios_grow draws a plant stochastically, and the draw is not
            # a rounding detail: measured here on soybean at 55 days with
            # everything else held -- same species, same age, same sowing,
            # leaf area rescaled to an identical LAI so only the shape can
            # differ -- five seeds spanned faPAR 0.703 to 0.799. That 0.096
            # is larger than the whole seasonal term the window above was
            # added to capture, and three times a 20% error in the LAI this
            # action works so hard to invert.
            #
            # Until this loop existed the action grew seed 7 and printed
            # `fapar.toFixed(3)`, so it reported three decimals of a number
            # whose own spread lands in the second. The band is the honest
            # form of the same computation, and no new data buys it: it is
            # the model's own variance, and it can only be sampled.
            #
            # Cost is why the default is three and not thirty. The march is
            # ~11 s and dominates; growing a plant is 0.24 s.
            if lit_row is not None:
                try:
                    import canopy_field as cfield
                    import helios_grow as hgrow
                    row_az = float(req.get('row_azimuth_deg', 0.0))
                    base_seed = int(req.get('seed', 7))
                    n_seeds = max(1, min(int(req.get('n_seeds', 3)), 12))
                    # One periodic module carrying one plant, so the LAI the
                    # march integrates is the sowing's and not the plant's.
                    module = float(np.sqrt(inter_row * inter_plant))
                    cell = module / max(int(round(module / 0.05)), 4)

                    runs = []
                    for i in range(n_seeds):
                        emit_progress(
                            80 + int(15 * i / n_seeds),
                            f'lighting canopy {i + 1} of {n_seeds}')
                        grown = hgrow.grow(species=species_name,
                                           days=int(round(lit_row['day'])),
                                           seed=base_seed + i)
                        pos, leaf_area, _m = hgrow.leaf_cloud(grown)
                        pos = np.asarray(pos, float).copy()
                        pos[:, 0] = np.mod(pos[:, 0] + module / 2, module)
                        pos[:, 1] = np.mod(pos[:, 1] + module / 2, module)
                        grid, fmeta = cfield.leaf_cloud_field(
                            pos, leaf_area, spacing=module, cell=cell)
                        one = cfield.light_under_sun(
                            cfield.canopy_of(grid, fmeta), energy, el_edges,
                            dhi_share=dhi_share, row_azimuth_deg=row_az)
                        # THE FRACTION OF GROUND UNDER LEAF, which is the
                        # one geometric number that tracks the answer.
                        # Measured here at fixed LAI: sweeping the canopy's
                        # horizontal extent moves faPAR 0.19 to 0.88 and
                        # faPAR follows cover almost proportionally, while
                        # sweeping its HEIGHT over a factor of 2.4 moves it
                        # 0.020. Reported so a reader with an observed cover
                        # -- which a nadir view gives cheaply, and which no
                        # 3D reconstruction is needed for -- can check the
                        # simulated canopy against the field's.
                        one['cover'] = float(
                            (grid.sum(axis=2) > 0).mean())
                        one['seed'] = base_seed + i
                        runs.append(one)

                    # The median run carries the headline, so the reported
                    # figures stay a self-consistent single canopy rather
                    # than a mean of quantities that do not average.
                    runs.sort(key=lambda r: r.get('fapar', 0.0))
                    lit = dict(runs[len(runs) // 2])
                    fapars = [float(r['fapar']) for r in runs]
                    covers = [float(r['cover']) for r in runs]
                    lit['ensemble'] = {
                        'n': len(runs),
                        'fapar_min': min(fapars),
                        'fapar_max': max(fapars),
                        'fapar_spread': max(fapars) - min(fapars),
                        'cover_min': min(covers),
                        'cover_max': max(covers),
                        'seeds': [int(r['seed']) for r in runs],
                    }
                    lit['date'] = lit_row.get('date')
                    lit['day'] = lit_row.get('day')
                    payload['light'] = lit
                except Exception as e:
                    payload['light'] = {'error': str(e)}
        except Exception as e:
            # A canopy answer is still worth having without the sun record,
            # so this degrades rather than fails, and says which it did.
            payload['sun'] = {'source': 'reference', 'why': str(e)}

    emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'canopy_from_aoi': payload}))
    sys.stdout.flush()


# Inventory Sentinel-2 scenes for the AOI (no classification / band reads).
def action_list_datacube(req, work_dir):
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


# Solar resource and photovoltaic yield at the AOI centroid (no imagery).
def action_solar_resource(req, work_dir):
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


# Terrain-resolved plane-of-array irradiation over the AOI.
def action_solar_terrain(req, work_dir):
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

    # Whether the terrain encloses the site enough for the diffuse loss to
    # be a figure rather than noise. Read off the horizon already traced, so
    # the test costs nothing; below the threshold the sky view factor is a
    # rounding term and applying it would spend the arithmetic on noise.
    enclosure = solar_mod.horizon_enclosure(horizon)
    svf_loss = (
        solar_mod.diffuse_loss_fraction(horizon)
        if enclosure['encloses'] else None
    )

    def _poa_for(name):
        """Plane-of-array total for a season, attenuated by terrain shading.

        Two losses, on two bases. The horizon blocks beam energy below it,
        which is scaled by the beam share before it is applied; and it hides
        part of the sky dome, which removes diffuse energy in proportion to
        the sky view factor. The beam term is the expensive one to compute
        and the small one to collect -- on flat ground both vanish, but in
        enclosed terrain the diffuse term is the larger by two orders of
        magnitude, and the horizon that answers the first already answers
        the second.

        The published shading layer stays the unscaled beam fraction, which
        is what the research figures report.
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
        attenuated = raw * (1.0 - loss * beam_share)
        if svf_loss is not None:
            attenuated = attenuated * (1.0 - svf_loss * (1.0 - beam_share))
        return attenuated, loss

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
            # The sky view factor and the threshold it was judged against.
            # Reported whether or not it was applied: "not applied" and
            # "applied at zero" are different statements about the terrain.
            'sky_view': {
                'applied': bool(svf_loss is not None),
                'mean_horizon_deg': enclosure['mean_horizon_deg'],
                'max_horizon_deg': enclosure['max_horizon_deg'],
                'threshold_deg': enclosure['threshold_deg'],
                'diffuse_loss_mean_pct': (
                    round(float(100.0 * np.nanmean(svf_loss[valid])), 3)
                    if svf_loss is not None else None
                ),
                'diffuse_loss_max_pct': (
                    round(float(100.0 * np.nanmax(svf_loss[valid])), 3)
                    if svf_loss is not None else None
                ),
            },
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


# Photovoltaic siting from slope limits and land-cover eligibility.
def action_solar_siting(req, work_dir):
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


# Loss waterfall, tracking comparison, generation profile and plant energy.
# Runs on the same POWER series as solar_resource, read from the cache when
# that action has already been run for this cell.
def action_energy_model(req, work_dir):
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
            gamma_pdc=gamma_pdc,
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


# Wind resource screening at the AOI centroid, from POWER hourly MERRA-2.
def action_wind_resource(req, work_dir):
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
            'qualifier': wind_mod.RESULT_QUALIFIER,
            'excluded_losses': list(wind_mod.EXCLUDED_LOSSES),
            'comparison_note': (
                'The gross capacity factor here and the photovoltaic '
                'capacity factor from solar_resource are not comparable. '
                'The photovoltaic figure is computed at a performance '
                'ratio benchmarked against the Global Solar Atlas; this '
                'one carries no external validation and no plant losses.'
            ),
        },
    })

    emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'wind': assessment}))
    sys.stdout.flush()


# The ceiling on one flood envelope run, in cells of the shared grid.
#
# Measured on this chain (hand.compute, one product, square grids from 300 by
# 300 to 1200 by 1200 cells): 1.9 to 3.0 microseconds per cell, the rate rising
# with grid size, and about 200 bytes of peak resident memory per cell, flat
# across that range. Every product runs the chain on the shared grid, so four
# products over N cells cost about 4 * 3e-6 * N seconds, and the peak holds one
# chain's working set plus the elevation arrays, HAND fields and masks kept
# across it, roughly 250 * N bytes.
#
# At 4e6 cells that is roughly 50 s of terrain chain and 1.0 GB resident, inside
# a desktop application that is also holding a browser. Memory binds before time
# and it binds steeply: 8e6 cells would ask for 1.9 GB, where the packaged
# application on a 16 GB machine stops being slow and starts swapping.
#
# 4e6 cells of 30 m is a 60 km square, which after the 5 km buffer cap in
# dem.recommended_buffer_m is an AOI of about 50 km on a side. Beyond that the
# run is refused rather than quietly downsampled: this analysis measures
# disagreement between DEM products, and reading them at a resolution none of
# them has changes the quantity being measured. Measured over one 6 by 6 km
# window at Propriedade B, moving COP90 onto the 30 m grid before the terrain
# chain rather than after it moved its own 1 m extent by IoU 0.47, which is as
# large as the product disagreement this payload exists to report.
MAX_ENVELOPE_CELLS = 4_000_000


def common_covered_window(arrays, max_trim):
    """
    The largest rectangle of the shared grid that every DEM product covers.

    Returns (row_start, row_stop, col_start, col_stop), or None when trimming up
    to `max_trim` cells from each border does not reach a rectangle they all
    cover.

    Each product is merged over a window snapped outward to its own cell
    boundaries, so the windows differ by less than one of their own cells and a
    product moved onto the reference grid can fall short of it at the border: on
    a real 6 by 6 km read here, ALOS left one column of 203 cells uncovered.
    Those cells arrive as NaN, and the terrain chain has no answer for a NaN --
    the depression fill orders on elevation, so a void leaves the flow direction
    of everything downstream of it undefined and the chain still returns a HAND
    field, wrong over a region rather than absent over it.

    `max_trim` is what separates that sliver from a hole in a product. The
    sliver cannot exceed one cell of the coarsest product plus a rounding cell;
    a void over water or in radar shadow can sit anywhere and be any size, and
    peeling the window until it disappears would report a smaller area with
    nothing on screen saying why. Past the bound this returns None and the
    caller names the products that are missing elevation.
    """
    covered = None
    for z in arrays:
        finite = np.isfinite(z)
        covered = finite if covered is None else (covered & finite)
    height, width = covered.shape
    r0, r1, c0, c1 = 0, height, 0, width
    while r1 > r0 and c1 > c0:
        block = covered[r0:r1, c0:c1]
        if block.all():
            return r0, r1, c0, c1
        # The border line missing the most cells goes first. Peeling in a fixed
        # order instead spends the whole allowance in the wrong direction: one
        # uncovered column leaves every row incomplete, so a row-first rule
        # trims max_trim rows off both ends before it reaches the column.
        missing = [
            int((~block[0]).sum()), int((~block[-1]).sum()),
            int((~block[:, 0]).sum()), int((~block[:, -1]).sum()),
        ]
        worst = int(np.argmax(missing))
        if missing[worst] == 0:
            return None  # every border line is covered; the hole is inside
        if worst == 0 and r0 < max_trim:
            r0 += 1
        elif worst == 1 and height - r1 < max_trim:
            r1 -= 1
        elif worst == 2 and c0 < max_trim:
            c0 += 1
        elif worst == 3 and width - c1 < max_trim:
            c1 -= 1
        else:
            return None
    return None


def aoi_reporting_mask(polygon, grid):
    """
    The AOI polygon rasterised onto the shared grid: which cells are reported.

    The polygon and not its bounding box. A user who draws an L-shaped AOI is
    asking about the L, and a bounding box would put the notch back into every
    area, count and IoU with nothing on screen saying it had.

    A cell is inside when its CENTRE is inside the polygon -- rasterio's
    default, all_touched left off. The alternative includes every cell the
    boundary clips, which biases the reported area outward by half a cell all
    the way round; with a centre rule the two errors cancel to first order.
    """
    from rasterio import features

    return features.geometry_mask(
        [polygon], out_shape=(grid.height, grid.width),
        transform=grid.transform, invert=True,
    )


def agreement_rgba(counts, n_products, inside=None):
    """
    Colour the agreement raster: how many products call each cell flooded.

    The blue ramp water.occurrence_to_rgba uses, on an absolute scale rather
    than a percentile stretch, so the same colour means the same count in every
    run and one legend describes them all. Cells no product calls flooded are
    transparent rather than the palest tone of the ramp, which is what stops the
    dry majority of a window from reading as a faint flood.

    `inside` is the reporting mask. Cells outside it are transparent too, for
    the same reason the payload does not count them: the terrain chain ran over
    the AOI plus its buffer, and an overlay that covers more ground than the
    figures beside it invites the reader to attribute those figures to it.
    """
    import composite as comp

    t = np.clip(counts.astype(np.float32) / max(int(n_products), 1), 0.0, 1.0)
    rgb = comp._lerp_cmap(t, comp._BLUES)
    height, width = counts.shape
    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    for band in range(3):
        rgba[..., band] = (rgb[..., band] * 255).astype(np.uint8)
    drawn = counts > 0 if inside is None else (counts > 0) & inside
    rgba[..., 3] = np.where(drawn, 255, 0).astype(np.uint8)
    return rgba


# HAND flood extent with the envelope of DEM products around it.
def action_flood_envelope(req, work_dir):
    # Imported here rather than at module scope, as every heavy action does.
    # dem pulls pystac_client, planetary_computer and shapely.ops, flood pulls
    # the terrain chain; at module scope every action would pay those imports,
    # and one missing dependency would fail the sidecar for every product
    # instead of for this one.
    import composite as comp
    import dem as dem_mod
    import flood as flood_mod

    configure_gdal_for_cog()

    if not req.get('polygon_geojson'):
        fail('no polygon provided (polygon_geojson required)')
    polygon = polygon_from_geojson(req['polygon_geojson'])
    if polygon.is_empty:
        fail('the AOI polygon is empty, so there is no window to read a DEM over')

    # An explicit empty list is a broken request and reaches the count check
    # below with its own message; only absence selects the four-product set.
    ids = req.get('dem_ids')
    if ids is None:
        ids = list(dem_mod.DEFAULT_IDS)
    try:
        products = [dem_mod.resolve(pid) for pid in ids]
    except ValueError as e:
        fail(str(e))
    if len(products) < 2:
        fail(f'an envelope is a disagreement between DEM products and needs at '
             f'least two; this request names {len(products)}. One product '
             f'yields an extent with no measure of how much of it follows from '
             f'the choice of product. Known products: '
             f'{", ".join(sorted(dem_mod.COLLECTIONS))}.')

    thresholds = req.get('thresholds_m')
    if thresholds is None:
        thresholds = list(flood_mod.THRESHOLDS_M)
    try:
        thresholds = [float(t) for t in thresholds]
    except (TypeError, ValueError):
        fail('thresholds_m must be a list of HAND thresholds in metres')
    if not thresholds:
        fail('thresholds_m is empty; give at least one HAND threshold in metres, '
             f'or omit it for the {list(flood_mod.THRESHOLDS_M)} m sweep')
    if any(t < 0 for t in thresholds):
        fail(f'HAND thresholds are heights above the drainage and cannot be '
             f'negative, got {thresholds}')

    # Zero is a value for a threshold: HAND <= 0 m is the drainage surface
    # itself, which is a question a caller can ask. Only absence selects the 1 m
    # reference the study reports its widest disagreement at.
    reference_threshold_m = request_positive(
        req, 'reference_threshold_m', flood_mod.REFERENCE_THRESHOLD_M,
        allow_zero=True,
    )
    # Zero is not a value for the drainage area. hand.compute floors the
    # threshold at one cell, so a request of zero makes every cell drainage,
    # HAND zero everywhere and the extent the whole window at every threshold.
    drainage_km2 = request_positive(req, 'drainage_km2', flood_mod.DRAINAGE_REF_KM2)

    # Both of these default to None on absence, which is the signal each module
    # reads as "choose for me": dem sizes the buffer from the AOI and flood
    # takes its 1 km inset ring. Zero is a value for both -- a caller reading
    # exactly the AOI, and a caller asking for no inset ring -- so neither
    # can go through request_positive, whose default would have to be a number.
    buffer_m = request_number(req, 'buffer_m', None)
    if buffer_m is None:
        buffer_m = dem_mod.recommended_buffer_m(polygon.bounds)
    elif buffer_m < 0:
        fail(f'buffer_m is a distance beyond the AOI and cannot be negative, '
             f'got {buffer_m}')
    # Refused rather than ignored. This key was renamed when the ring stopped
    # being cut from the computed window and started being cut from the AOI
    # boundary: a caller still sending the old name means a caller whose ring
    # width would silently fall back to the default, and the payload would
    # report a margin the request did not ask for.
    if 'edge_margin_cells' in req:
        fail('edge_margin_cells was renamed to inset_margin_cells. The ring is '
             'now cut from inside the AOI polygon; it was previously cut from '
             'the border of the buffered window the terrain chain ran over. '
             'The two are rings of different shapes, and the payload reports '
             'inset_margin_cells with iou_inset beside it.')
    inset_margin_cells = request_number(req, 'inset_margin_cells', None, int)
    if inset_margin_cells is not None and inset_margin_cells < 0:
        fail(f'inset_margin_cells is a ring width and cannot be negative, '
             f'got {inset_margin_cells}')

    # Refused before the first byte is fetched: the read is the slow part of an
    # oversized request and the user would wait through all four of them to be
    # told the size was never admissible.
    aoi_w, aoi_h = dem_mod.aoi_extent_m(polygon.bounds)
    window_w, window_h = dem_mod.aoi_extent_m(
        dem_mod.buffer_bounds(polygon.bounds, buffer_m)
    )
    reference_res_m = products[0].native_resolution_m
    window_cells = (window_w / reference_res_m) * (window_h / reference_res_m)
    if window_cells > MAX_ENVELOPE_CELLS:
        admissible_km = (
            reference_res_m * MAX_ENVELOPE_CELLS ** 0.5 - 2 * buffer_m
        ) / 1000.0
        fail(
            f'this AOI is {aoi_w / 1000:.1f} by {aoi_h / 1000:.1f} km, which '
            f'with the {buffer_m:.0f} m buffer the terrain chain needs is '
            f'{window_cells / 1e6:.1f} million cells of {reference_res_m:.0f} m '
            f'for each of the {len(products)} DEM products. The flood envelope '
            f'is limited to {MAX_ENVELOPE_CELLS / 1e6:.0f} million, about '
            f'{admissible_km:.0f} km on a side, because the chain holds roughly '
            f'250 bytes per cell at its peak. Draw a smaller AOI. The products '
            f'are read at their native resolution; reading them at a coarser '
            f'resolution to fit the limit would change the quantity being '
            f'measured.'
        )

    # The read and the terrain chain are the two slow stages, and each reports
    # per unit of real work: one step per product read, then one per terrain
    # chain and one per threshold compared.
    read_floor, read_ceiling = 5, 45
    chain_floor, chain_ceiling = 45, 92

    def read_progress(message):
        """
        Advance once per product read.

        dem.fetch_set prefixes every message with the product id, which is how a
        message is placed. One that matches no id still reports its text and
        leaves the bar where it stands, so the prefix is not load-bearing: a
        change to it makes the bar coarser and nothing else.
        """
        for index, product in enumerate(products):
            if message.startswith(product.id + ':'):
                emit_progress(
                    read_floor
                    + int((read_ceiling - read_floor) * index / len(products)),
                    message,
                )
                return
        emit_progress(read_floor, message)

    # flood.measure emits one message per product for the terrain chain and one
    # per threshold for the comparison, and it adds the reference threshold to
    # the sweep if the caller left it out -- so the step count is known before
    # the run rather than estimated. min() keeps a message the module might add
    # later from running the bar past its band.
    chain_steps = len(products) + len(
        {float(t) for t in thresholds} | {float(reference_threshold_m)}
    )
    chain_done = {'n': 0}

    def chain_progress(message):
        chain_done['n'] += 1
        emit_progress(
            chain_floor
            + int((chain_ceiling - chain_floor)
                  * min(chain_done['n'], chain_steps) / chain_steps),
            message,
        )

    emit_progress(
        read_floor,
        f'reading {len(products)} DEM products over the AOI plus {buffer_m:.0f} m'
    )
    try:
        reads = dem_mod.fetch_set(
            polygon, ids=[p.id for p in products], buffer_m=buffer_m,
            progress=read_progress,
        )
    except Exception as e:
        fail(f'DEM read failed: {e}')

    emit_progress(read_ceiling, 'aligning the products onto one grid')
    reference = reads[0].reference
    arrays = {}
    for read in reads:
        # flood.measure counts products cell by cell and so requires one grid,
        # which means a product whose native grid differs is moved onto the
        # reference grid BEFORE its terrain chain runs. dem.fetch_set argues for
        # the other order: chain on the native grid, align the mask after. On
        # the 6 by 6 km window measured here the two orders put COP90's 1 m
        # extent at IoU 0.47 of each other. The order used is recorded in
        # assumptions.chain_grid below and, per pair, in the resampled column;
        # the two components cannot be separated from the numbers alone.
        arrays[read.product.id] = (
            dem_mod.resample_onto(read.array, read.grid, reference)
            if read.resampled else read.array
        )

    # One cell of the coarsest product, plus one for the rounding: past that a
    # missing cell is not the alignment sliver.
    max_trim = int(
        round(max(p.native_resolution_m for p in products) / reference_res_m)
    ) + 1
    covered = common_covered_window(arrays.values(), max_trim)
    if covered is None:
        missing = ', '.join(
            f'{pid} {int((~np.isfinite(z)).sum())} cells'
            for pid, z in arrays.items() if not np.isfinite(z).all()
        )
        fail(f'the products do not cover one common window: {missing} have no '
             f'elevation, and trimming up to {max_trim} cells from each border '
             f'does not reach a rectangle all of them cover. A void that far '
             f'inside the window is a hole in the product itself, over water '
             f'or in radar shadow; the trim covers only the alignment sliver '
             f'at the border. The terrain chain would still return a HAND '
             f'field over such a hole, and nothing in the output would mark '
             f'the region it is wrong over. Move or shrink the AOI, or name a '
             f'dem_ids set without the product that is missing elevation.')
    r0, r1, c0, c1 = covered
    arrays = {pid: z[r0:r1, c0:c1] for pid, z in arrays.items()}

    # The window the products were actually compared on, which the crop above
    # can leave up to one cell inside the read window on any side. The payload
    # bounds have to be this one and not the requested one, or the map would be
    # drawn a cell off the ground it describes.
    grid = dem_mod.Grid(
        transform=rasterio.windows.transform(
            rasterio.windows.Window(c0, r0, c1 - c0, r1 - r0), reference.transform
        ),
        width=c1 - c0,
        height=r1 - r0,
        crs=reference.crs,
    )
    dx, dy = dem_mod.cell_size_m(grid)

    # What the figures are about. The arrays above cover the AOI plus buffer_m
    # on every side because the terrain chain needs the drainage entering the
    # AOI to be real terrain; the report covers the AOI itself. Rasterised
    # after the crop, so the mask is on the same grid the products were
    # compared on and not on the window that was requested.
    aoi_mask = aoi_reporting_mask(polygon, grid)

    sources = {}
    for read in reads:
        row = read.describe()
        sources[row['id']] = flood_mod.Source(
            id=row['id'],
            z=arrays[row['id']],
            collection=row['collection'],
            native_resolution_m=row['native_resolution_m'],
            resampled=row['resampled'],
        )

    try:
        result = flood_mod.measure(
            sources, dx, dy,
            thresholds_m=thresholds,
            drainage_km2=drainage_km2,
            reference_threshold_m=reference_threshold_m,
            inset_margin_cells=inset_margin_cells,
            grid=dem_mod.payload_grid(grid),
            buffer_m=buffer_m,
            aoi_mask=aoi_mask,
            progress=chain_progress,
        )
    except Exception as e:
        fail(f'the flood envelope could not be measured: {e}')

    emit_progress(94, 'writing the agreement raster')
    payload = result.payload
    # The agreement raster is the product, and it cannot travel in the payload:
    # a 4e6-cell array as JSON numbers is tens of megabytes through the pipe.
    # It leaves as two files instead, and they cover different ground on
    # purpose. The GeoTIFF is the chain's own output over the whole computed
    # window, which is what the `grid` block describes and what a reader
    # re-running the analysis needs; it carries its own transform, so nothing
    # about its extent is implicit.
    agreement_tif = Path(work_dir) / 'flood_agreement.tif'
    with rasterio.open(
        agreement_tif, 'w', driver='GTiff', height=grid.height, width=grid.width,
        count=1, dtype='uint8', crs=grid.crs, transform=grid.transform,
        compress='deflate',
    ) as dst:
        dst.write(result.agreement, 1)

    # The PNG is drawn on the map beside the figures, so it covers what the
    # figures cover: clipped to the AOI bounding box, and transparent at every
    # cell outside the polygon itself. An overlay reaching into the buffer
    # would cover several times the ground the areas are measured over.
    rows = np.flatnonzero(aoi_mask.any(axis=1))
    cols = np.flatnonzero(aoi_mask.any(axis=0))
    ar0, ar1 = int(rows[0]), int(rows[-1]) + 1
    ac0, ac1 = int(cols[0]), int(cols[-1]) + 1
    agreement_png = Path(work_dir) / 'flood_agreement.png'
    comp.write_rgba_png(
        agreement_rgba(result.agreement[ar0:ar1, ac0:ac1], len(sources),
                       inside=aoi_mask[ar0:ar1, ac0:ac1]),
        agreement_png,
    )
    # The same crop again, carrying the COUNTS rather than their colours.
    #
    # The coloured PNG is finished: its palette, and which counts are drawn at
    # all, were decided here. A reader who wants a different ramp, or wants to
    # see only the cells three products agree on, has to re-run the analysis to
    # get it. This file is the measurement instead, and the map colours it on
    # the GPU from an expression -- see frontend/src/components/map/scalarTiles.ts.
    #
    # The count goes in red, one per byte, which is what SCALAR_ENCODING
    # decodes. Alpha marks the reporting mask, so a cell outside the AOI reads
    # as absent rather than as a measured zero. Both are drawn as nothing, and
    # the distinction is kept because they are not the same statement.
    agreement_values_png = Path(work_dir) / 'flood_agreement_values.png'
    counts_crop = result.agreement[ar0:ar1, ac0:ac1]
    inside_crop = aoi_mask[ar0:ar1, ac0:ac1]
    values_rgba = np.zeros((*counts_crop.shape, 4), dtype=np.uint8)
    values_rgba[..., 0] = np.clip(counts_crop, 0, 255).astype(np.uint8)
    values_rgba[..., 3] = np.where(inside_crop, 255, 0).astype(np.uint8)
    comp.write_rgba_png(values_rgba, agreement_values_png)

    payload['agreement_tif'] = str(agreement_tif)
    payload['agreement_png'] = str(agreement_png)
    payload['agreement_values_png'] = str(agreement_values_png)
    # Where to put the PNG, in the field shape the water payload already uses,
    # so mapLayers.ts places both overlays through one code path. This is the
    # extent of the PNG and not of the GeoTIFF or of `grid`: those two describe
    # the buffered window, and placing a clipped image on them would stretch it
    # over ground it does not cover.
    payload['extent'] = comp.extent_from_profile({
        'transform': rasterio.windows.transform(
            rasterio.windows.Window(ac0, ar0, ac1 - ac0, ar1 - ar0), grid.transform
        ),
        'height': ar1 - ar0,
        'width': ac1 - ac0,
        'crs': grid.crs,
    })
    payload['assumptions']['rasters'] = (
        f'The GeoTIFF holds the agreement counts over the whole computed '
        f'{grid.width} by {grid.height} window, buffer included, on the grid '
        f'the grid block describes. The PNG holds the same counts clipped to '
        f'the AOI: a {ac1 - ac0} by {ar1 - ar0} cell bounding box with every '
        f'cell outside the polygon transparent, placed by extent. That is the '
        f'ground the figures are measured over.'
    )
    payload['assumptions']['chain_grid'] = (
        f'The terrain chain ran on the shared {grid.width} by {grid.height} '
        f'grid for every product. A product whose native grid differs from that '
        f'one was moved onto it before the chain -- which includes a product at '
        f'the same nominal cell size on a different origin, not only a coarser '
        f'one. The other order, the chain on '
        f'the native grid and the resulting mask aligned after, gives a '
        f'different extent for such a product: measured over one 6 by 6 km '
        f'window (n=1), the two orders agreed at IoU 0.47 for COP90 at the 1 m '
        f'threshold and at 0.95 for a product already at 30 m. Pairs flagged '
        f'resampled carry a method component of that order in addition to the '
        f'terrain difference. Pairs flagged false carry the terrain difference '
        f'alone.'
    )

    emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'flood': payload}))
    sys.stdout.flush()


# Surface water / flood mapping from spectral water indices (no model).
def action_water(req, work_dir):
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
                )
                bands[name] = to_reflectance(bands[name], product)
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


# RGB / false-color composite or spectral index for one STAC scene.
def action_render_composite(req, work_dir):
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
        """Reflectance, not DN. The offset belongs to the product, which
        this closure holds, so the callers below cannot forget it."""
        res = comp.BAND_RESOLUTION.get(name, '10m')
        return load_reflectance_to_reference_grid(product, name, polygon,
                                                  ref_prof, res)

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
            r = load_band(bands[0])
            g = load_band(bands[1])
            b = load_band(bands[2])
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
                nir = load_band('B08')
                red = load_band('B04')
                idx = calculate_ndvi(nir, red)
                mask = mask & (nir > 0) & (red > 0)
            elif index_name == 'ndwi':
                green = load_band('B03')
                nir = load_band('B08')
                idx = comp.calculate_ndwi(green, nir)
                mask = mask & (green > 0) & (nir > 0)
            elif index_name == 'ndmi':
                nir = load_band('B08')
                swir = load_band('B11')
                idx = comp.calculate_ndmi(nir, swir)
                mask = mask & (nir > 0) & (swir > 0)
            else:  # evi
                nir = load_band('B08')
                red = load_band('B04')
                blue = load_band('B02')
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


# Land-cover classification over a Sentinel-2 time series: the action the
# sidecar was written for, and the one an omitted `action` field asks for.
def action_predict(req, work_dir):
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
    # Spectral RF feature rows become the domain fingerprint; Prithvi / TT fall
    # back to an NDVI-only fingerprint after the VI series is computed.
    feature_matrix_for_fingerprint = None

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
                    red = load_reflectance_to_reference_grid(target, 'B04', polygon, ref_profile)
                    nir = load_reflectance_to_reference_grid(target, 'B08', polygon, ref_profile)
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
        feature_matrix_for_fingerprint = fm
        classification_map, confidence_map = classify_from_features(
            fm, vmask, rf_model, scaler, label_encoder
        )
    else:
        emit_progress(40, f'building features ({len(products)} dates)')
        fm, vmask = build_feature_matrix(products, polygon, ref_profile, n_dates_model)
        if fm is None:
            fail('no valid Sentinel-2 data for the selected area')
        feature_matrix_for_fingerprint = fm
        emit_progress(80, 'classifying')
        classification_map, confidence_map = classify_from_features(
            fm, vmask, rf_model, scaler, label_encoder
        )

    emit_progress(88, 'computing vegetation index series and phenology')
    import phenology as pheno
    import composite as comp
    # The classification is already built above, so the crop pixels are known
    # before the index is averaged and the masked series costs one extra mean
    # per date rather than a second pass over the scenes.
    try:
        import crop_species
        crop_pixels = crop_species.crop_mask(classification_map)
        if not crop_pixels.any():
            crop_pixels = None
    except Exception:
        crop_pixels = None

    (vi_series, vi_series_crop, vi_dates, ndvi_means, ndvi_mean_map,
     ndvi_valid, true_color_rgba) = compute_aoi_vi_series(
        products, polygon, ref_profile, crop_mask=crop_pixels
    )
    phenology = pheno.phenology_metrics(ndvi_means, vi_dates) if vi_dates else {
        'sos_doy': None, 'pos_doy': None, 'eos_doy': None, 'los_days': None,
        'peak': None, 'base': None, 'amplitude': None,
    }
    phenology_states = pheno.state_timeline(ndvi_means, vi_dates) if vi_dates else []

    domain_fingerprint = None
    try:
        import domain_shift as ds_mod
        ndvi_vals = None
        if ndvi_mean_map is not None and ndvi_valid is not None:
            ndvi_vals = ndvi_mean_map[ndvi_valid]
        domain_fingerprint = ds_mod.build_fingerprint(
            feature_matrix_for_fingerprint,
            ndvi_values=ndvi_vals,
            # The training statistics the forest was fitted on. Without them the
            # fingerprint is in raw units, where a Euclidean distance is 99.7%
            # acquisition-index features and 0% reflectance.
            scaler_mean=getattr(scaler, 'mean_', None) if scaler is not None else None,
            scaler_scale=getattr(scaler, 'scale_', None) if scaler is not None else None,
            feature_names=list(feature_names) if feature_names is not None else None,
            feature_importances=(
                getattr(rf_model, 'feature_importances_', None)
                if rf_model is not None
                else None
            ),
        )
    except Exception as e:
        sys.stderr.write(json.dumps({
            'progress': -1, 'msg': f'domain fingerprint skipped: {e}'
        }) + '\n')
        sys.stderr.flush()

    emit_progress(91, 'measuring spectral response per class')
    spectra = None
    try:
        spectra = class_spectra(products, polygon, ref_profile,
                                classification_map)
    except Exception as e:
        sys.stderr.write(json.dumps({
            'progress': -1, 'msg': f'class spectra skipped: {e}'
        }) + '\n')
        sys.stderr.flush()

    limit = None
    if spectra is not None:
        try:
            limit = library_limit(spectra)
        except Exception as e:
            sys.stderr.write(json.dumps({
                'progress': -1, 'msg': f'library comparison skipped: {e}'
            }) + '\n')
            sys.stderr.flush()

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
    # The floor this figure cannot go below.
    #
    # confidence is max(predict_proba), so with K classes it lives on [1/K, 1]
    # and never approaches zero. Reported as a bare percentage it reads on a
    # 0-100 scale it does not occupy: 38% over five classes is a fifth of the
    # way from maximum uncertainty to certainty, not a third. The consumer
    # needs K to say that, and only this side knows it.
    conf_floor = (
        1.0 / len(label_encoder.classes_)
        if label_encoder is not None and len(getattr(label_encoder, 'classes_', [])) > 0
        else 0.0
    )

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
                # Agreement, which the composition comparison beside it cannot
                # show: equal marginals are not equal maps.
                agreement = lulc_mod.agreement_against_reference(
                    classification_map, ref_grid, cell_ids=cell_ids
                )
                if agreement is not None:
                    lulc_payload['agreement'] = agreement
        except Exception as e:
            sys.stderr.write(json.dumps({
                'progress': -1, 'msg': f'lulc analysis skipped: {e}'
            }) + '\n')
            sys.stderr.flush()

    lon_min, lon_max, lat_min, lat_max = get_map_extent(ref_profile)

    pixel_size_m = reference_pixel_size_m(ref_profile)

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
        'confidence_floor': round(conf_floor, 4),
        'n_dates': len(products),
        'date_range': [
            products[0]['date'].strftime('%Y-%m-%d'),
            products[-1]['date'].strftime('%Y-%m-%d'),
        ],
        'pixel_size_m': round(pixel_size_m, 3),
        'class_stats': class_statistics(classification_map),
        # Seven bands on one acquisition, per predicted class. None when the
        # scene could not be read; see class_spectra for why it is one date.
        'class_spectra': spectra,
        # Each class against a leaf-level library, and the limit that runs into.
        'library_limit': limit,
        'temporal': temporal,
        'vi_series': vi_series,
        # The same dates averaged over crop pixels only. Empty when the AOI
        # carries no cropland, which is a statement and not a failure.
        'vi_series_crop': vi_series_crop,
        'crop_pixel_pct': (
            round(100.0 * float(crop_pixels.mean()), 2)
            if crop_pixels is not None else 0.0
        ),
        'phenology': phenology,
        'phenology_states': phenology_states,
        'lulc': lulc_payload,
        'domain_fingerprint': domain_fingerprint,
    }

    emit_progress(100, 'done')
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()


# The action a request can name, and the function that answers it.
#
# A table rather than the run of `if action == ...: ... return` branches this
# replaces. That run held every handler in one namespace at one indentation
# level, where a name bound by one branch stayed visible to the next and only
# the `return` at the foot of each kept it from running on into the prediction
# path. It also puts the set of actions on one screen, which is the set
# backend/sidecar.go is written against.
# ------------------------------------------------------------------ elevation
#
# THE SURFACE ITSELF, AS ITS OWN SUBJECT.
#
# Copernicus GLO-30 is already fetched by two products here -- solar.py reads it
# for horizons and dem.py reads it for the flood envelope -- and in both it is
# an input nobody looks at. A reader cannot see the ground a run was computed
# on, which is the one thing every terrain figure in this application depends
# on.
#
# IT IS A SURFACE MODEL, NOT A TERRAIN MODEL, and the payload says so rather
# than leaving it to be inferred. GLO-30 is TanDEM-X: it measures the first
# reflective surface, so a closed forest reports canopy top and a city reports
# roofs. Every product downstream inherits that -- HAND over a DSM in forest
# carries canopy height into the height above drainage -- and naming it here is
# where a reader can first see it.
#
# NO BUFFER. solar_terrain widens its window so a ridge outside the AOI can
# shade pixels inside it; nothing here is cast from anywhere. The window is the
# AOI, and the figures are over exactly what is drawn.
# The top of the decoded range the scalar protocol carries. The decoding is
# r + g/256 + b/65536, whose supremum is 256; 255 leaves the top of the ramp on
# a whole number and inside the range rather than at its edge.
VALUE_FULL_SCALE = 255.0


def action_surface_model(req, work_dir):
    import composite as comp
    import numpy as np
    import rasterio
    import solar as solar_mod

    configure_gdal_for_cog()
    if not req.get('polygon_geojson'):
        fail('no polygon provided (polygon_geojson required)')
    polygon = polygon_from_geojson(req['polygon_geojson'])

    emit_progress(10, 'fetching Copernicus DEM GLO-30')
    try:
        dem_path = solar_mod.fetch_dem(polygon, Path(work_dir) / 'surface.tif')
    except Exception as e:
        fail(f'DEM fetch failed: {e}')

    emit_progress(60, 'reading the surface')
    with rasterio.open(dem_path) as src:
        elevation = src.read(1).astype('float32')
        profile = src.profile
        nodata = src.nodata

    # dem.py's threshold, for its reason: SRTM writes -32768 into voids and ALOS
    # writes -9999, and neither is always declared as the COG's nodata. The
    # lowest bare land on Earth is near -430 m.
    void = ~np.isfinite(elevation) | (elevation < -1000.0)
    if nodata is not None:
        void |= elevation == nodata
    measured = elevation[~void]
    if measured.size == 0:
        fail('the DEM window is entirely void over this area')

    lo = float(np.min(measured))
    hi = float(np.max(measured))

    emit_progress(85, 'writing the surface raster')
    # The values, for the map to colour with an expression rather than for the
    # sidecar to colour once. Positional base-256, which is what
    # frontend/src/components/map/scalarTiles.ts decodes as
    #
    #     value = r + g/256 + b/65536
    #
    # THE DECODED RANGE IS [0, 256), and that is what sets the encoding rather
    # than any choice about elevation. Metres do not fit: a window with 900 m of
    # relief would wrap. Centimetres do not either. So the surface is carried
    # NORMALISED to the window's own relief, 0 at its floor and 255 at its
    # ceiling, and `floor_m` and `relief_m` below are what turn a decoded value
    # back into metres.
    #
    # The fraction channels are not spare precision: at 255 steps a 3000 m
    # window would quantise to 12 m, which a hypsometric ramp would show as
    # terracing. Carrying the fraction puts the step at relief/65536 -- under
    # 5 cm on that same window.
    span = max(hi - lo, 1e-6)
    normalised = np.clip((elevation - lo) / span, 0.0, 1.0) * VALUE_FULL_SCALE
    packed = np.rint(normalised * 65536.0).astype('uint32')
    packed = np.clip(packed, 0, 0xFFFFFF)
    rgba = np.zeros((*elevation.shape, 4), dtype=np.uint8)
    rgba[..., 0] = (packed >> 16) & 0xFF
    rgba[..., 1] = (packed >> 8) & 0xFF
    rgba[..., 2] = packed & 0xFF
    rgba[..., 3] = np.where(void, 0, 255).astype(np.uint8)
    values_png = Path(work_dir) / 'surface_values.png'
    comp.write_rgba_png(rgba, values_png)

    emit_progress(100, f'{hi - lo:.0f} m of relief')
    sys.stdout.write(json.dumps({'surface_model': {
        # Named, not implied. See the note above this function.
        'model_kind': 'DSM',
        'source': 'Copernicus DEM GLO-30 (cop-dem-glo-30)',
        'native_resolution_m': 30.0,
        'values_png': str(values_png),
        'extent': comp.extent_from_profile(profile),
        'floor_m': lo,
        'ceiling_m': hi,
        # The relief of the window, which is what a hypsometric ramp is scaled
        # to and the one figure that says whether this ground is flat.
        'relief_m': hi - lo,
        'mean_m': float(np.mean(measured)),
        'measured_cells': int(measured.size),
        'void_cells': int(void.sum()),
        # A decoded value v is floor_m + v * relief_m / VALUE_FULL_SCALE. The
        # map needs the three of them together; none can be guessed from the
        # image, and a legend that guessed would be a legend in the wrong units.
        'value_full_scale': VALUE_FULL_SCALE,
        'notes': [
            'Copernicus GLO-30 is a surface model: it measures the first '
            'reflective surface, so closed forest reports canopy top and built '
            'ground reports roofs. It is not bare earth.',
            'The window is the AOI itself, with no buffer, so every figure '
            'here is over exactly the polygon drawn.',
        ],
    }}))


ACTIONS = {
    'ping': action_ping,
    'lulc': action_lulc,
    'domain_shift': action_domain_shift,
    'domain_shift_cohort': action_domain_shift_cohort,
    'canopy_field': action_canopy_field,
    'canopy_mesh': action_canopy_mesh,
    'canopy_from_aoi': action_canopy_from_aoi,
    'list_datacube': action_list_datacube,
    'solar_resource': action_solar_resource,
    'solar_terrain': action_solar_terrain,
    'solar_siting': action_solar_siting,
    'energy_model': action_energy_model,
    'wind_resource': action_wind_resource,
    'flood_envelope': action_flood_envelope,
    'water': action_water,
    'surface_model': action_surface_model,
    'render_composite': action_render_composite,
    'predict': action_predict,
}


def main():
    try:
        req = json.load(sys.stdin)
    except Exception as e:
        fail(f'invalid request JSON: {e}')

    action = req.get('action', 'predict')
    work_dir = Path(req.get('work_dir', '.'))
    work_dir.mkdir(parents=True, exist_ok=True)
    # An unknown action runs the prediction path. That is what the branch chain
    # did by falling through to it, and what a request that names no action at
    # all asks for.
    ACTIONS.get(action, action_predict)(req, work_dir)


if __name__ == '__main__':
    main()
