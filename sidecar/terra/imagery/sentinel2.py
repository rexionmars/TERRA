"""
Sentinel-2 L2A: which scenes exist over an area, and what a band of one holds.

Two sources of the same product shape. `list_stac_products` reads the Planetary
Computer catalogue and returns hrefs to Cloud-Optimized GeoTIFFs, so only the
polygon window and the bands asked for cross the network. `list_sentinel_products`
walks SAFE directories already on disk, which is the path the notebooks this
was ported from used and the one the training script still uses.

Digital numbers are not reflectance. `to_reflectance` divides by the
quantification value and applies the BOA offset that processing baseline 04.00
introduced in January 2022; `as_trained` deliberately does not apply that
offset, because the model was fitted on scenes read without it and a feature
computed the other way is a feature the model never saw. The two are separate
functions so that neither can be reached by accident.

The reference grid is the other invariant. Every band of every date in one run
is read onto the grid of one band of one date, because a per-date grid would
make a temporal statistic a comparison between slightly different pixels.
"""

from __future__ import annotations

from datetime import datetime

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.mask import mask as rio_mask
from rasterio.warp import Resampling, reproject
from shapely.ops import transform as shp_transform

from terra import stac


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
    bounds = polygon.bounds

    items = stac.search(
        collection,
        bbox=[bounds[0], bounds[1], bounds[2], bounds[3]],
        datetime=f'{start}/{end}',
        query={'eo:cloud_cover': {'lt': max_cloud}},
        url=stac_url,
    )

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
