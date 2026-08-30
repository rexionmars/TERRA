"""
The land-cover actions: classify an area, read the reference over it, and
measure how far a run sits from the ground the models were fitted on.

Each reads its request, runs the product, and writes one JSON object to stdout.
The request and response shapes are the contract with
internal/analysis/runner.go, which builds each request and parses each response.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import numpy as np

from terra import protocol
from terra.imagery import cog, sentinel2


# Standalone MapBiomas land-cover / land-use analysis (no Sentinel / model).
def lulc(req, work_dir):
    protocol.emit_progress(10, 'resolving MapBiomas for AOI')
    try:
        from terra.landcover import mapbiomas as lulc_mod
        lulc = lulc_mod.analyze_from_request(req)
    except Exception as e:
        protocol.fail(f'LULC analysis failed: {e}')
    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'lulc': lulc}))
    sys.stdout.flush()


# Domain-shift diagnosis from two cached fingerprints (no STAC re-fetch).
def domain_shift(req, work_dir):
    protocol.emit_progress(20, 'comparing domain fingerprints')
    try:
        from terra.landcover import domain_shift as ds_mod
        fp_a = req.get('fingerprint_a')
        fp_b = req.get('fingerprint_b')
        if not isinstance(fp_a, dict) or not isinstance(fp_b, dict):
            protocol.fail('domain_shift requires fingerprint_a and fingerprint_b')
        report = ds_mod.compare_fingerprints(
            fp_a,
            fp_b,
            agreement_a=req.get('agreement_a'),
            agreement_b=req.get('agreement_b'),
            include_tsne=bool(req.get('include_tsne', False)),
        )
    except Exception as e:
        protocol.fail(f'domain_shift failed: {e}')
    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'domain_shift': report}))
    sys.stdout.flush()


# One source against N targets, in one process. See compare_cohort for why
# this is not N invocations of the action above.
def domain_shift_cohort(req, work_dir):
    protocol.emit_progress(10, 'comparing domain fingerprints')
    try:
        from terra.landcover import domain_shift as ds_mod
        source = req.get('source')
        targets = req.get('targets')
        if not isinstance(source, dict):
            protocol.fail('domain_shift_cohort requires a source')
        if not isinstance(targets, list) or not targets:
            protocol.fail('domain_shift_cohort requires at least one target')
        report = ds_mod.compare_cohort(source, targets)
    except Exception as e:
        protocol.fail(f'domain_shift_cohort failed: {e}')
    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'domain_shift_cohort': report}))
    sys.stdout.flush()


# Land-cover classification over a Sentinel-2 time series: the action the
# sidecar was written for, and the one an omitted `action` field asks for.
def predict(req, work_dir):
    from terra import aoi, mapbiomas as mb_source
    from terra.imagery import grid as ref_grid
    from terra.landcover import (
        classify,
        features,
        raster as lc_raster,
        series as lc_series,
        spectra as lc_spectra,
    )
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
        cog.configure()

    # Resolve polygon from explicit geometry or KML path.
    if req.get('polygon_geojson'):
        polygon = aoi.polygon_from_geojson(req['polygon_geojson'])
    elif req.get('kml_path'):
        area = aoi.parse_kml_coordinates(Path(req['kml_path']), req.get('kml_target'))
        if area is None:
            protocol.fail('polygon not found in KML')
        polygon = area['polygon']
    else:
        protocol.fail('no polygon provided (polygon_geojson or kml_path required)')

    if not model_dir.exists():
        protocol.fail(f'model directory not found: {model_dir}')

    rf_model = scaler = label_encoder = feature_names = None
    n_dates_model = 22
    if model_kind == 'spectral':
        protocol.emit_progress(5, 'loading model artifacts')
        try:
            rf_model = joblib.load(model_dir / 'rf_classifier.joblib')
            scaler = joblib.load(model_dir / 'scaler.joblib')
            label_encoder = joblib.load(model_dir / 'label_encoder.joblib')
            feature_names = joblib.load(model_dir / 'feature_names.joblib')
        except Exception as e:
            protocol.fail(f'failed to load model artifacts: {e}')
        # N_DATES_MODEL: total features minus the 58 non-temporal features
        # (14 stats * 3 indices + 16 band stats). Remainder are raw NDVI dates.
        n_dates_model = len(feature_names) - 58

    if source == 'stac':
        if not start or not end:
            protocol.fail('STAC source requires start and end dates (YYYY-MM-DD)')
        protocol.emit_progress(10, 'querying STAC catalog (Planetary Computer)')
        try:
            products = sentinel2.list_stac_products(
                polygon, start, end, tile_list=tiles, max_cloud=max_cloud,
                monthly_best=monthly_best,
            )
        except Exception as e:
            protocol.fail(f'STAC query failed: {e}')
        if len(products) == 0:
            protocol.fail('no Sentinel-2 scenes found for the area, dates and cloud filter')
        sel = 'best/month' if monthly_best else f'all < {max_cloud:.0f}% cloud'
        protocol.emit_progress(15, f'{len(products)} scenes selected ({sel})')
    else:
        if sentinel_dir is None or not sentinel_dir.exists():
            protocol.fail(f'Sentinel-2 directory not found: {sentinel_dir}')
        protocol.emit_progress(10, 'discovering local Sentinel-2 products')
        products = sentinel2.list_sentinel_products(sentinel_dir, tile_list=tiles)
        if len(products) == 0:
            protocol.fail('no Sentinel-2 .SAFE products found in the selected directory')
        protocol.emit_progress(15, f'{len(products)} products found')

    # Reference grid from the first product's B04 band.
    try:
        ref_band, ref_profile = sentinel2.load_and_clip_band(products[0], 'B04', polygon)
    except Exception as e:
        protocol.fail(f'failed to build reference grid: {e}')

    # Optional MapBiomas full map for reference panel + soja mask for retention.
    # Embedded areas ship a local TIFF; custom AOIs in Brazil fetch the COG window.
    soja_mask = None
    mb_map = None
    try:
        from terra.landcover import mapbiomas as lulc_mod
        if mapbiomas_path and Path(mapbiomas_path).exists():
            resolved_mb = mapbiomas_path
        elif mb_source.polygon_in_brazil(polygon):
            protocol.emit_progress(18, 'fetching MapBiomas COG for AOI')
            resolved_mb = str(mb_source.fetch_mapbiomas_window(polygon, work_dir))
            mapbiomas_path = resolved_mb
        else:
            resolved_mb = None
        if resolved_mb:
            mb_map = ref_grid.reproject_to_reference(resolved_mb, ref_profile, ref_band)
            soja_mask = mb_map == features.SOJA_CLASS_ID
            protocol.emit_progress(20, f'soja reference pixels: {int(np.sum(soja_mask))}')
    except Exception as e:
        protocol.emit_progress(-1, f'mapbiomas error: {e}')
        mb_map = None
        soja_mask = None

    try:
        prediction = classify.run(
            products, polygon, ref_profile,
            kind=model_kind, mode=mode, model_dir=model_dir,
            prithvi_mode=prithvi_mode,
            artifacts=(rf_model, scaler, label_encoder) if model_kind == 'spectral' else None,
            n_dates_model=n_dates_model, soja_mask=soja_mask,
            progress=protocol.emit_progress,
            note=lambda msg: protocol.emit_progress(-1, msg),
        )
    except (classify.NoValidData, classify.ArtifactMissing) as e:
        protocol.fail(str(e))
    classification_map = prediction.classification
    confidence_map = prediction.confidence
    temporal = prediction.temporal
    # Spectral RF feature rows become the domain fingerprint; Prithvi and the
    # Temporal Transformer have none and fall back to an NDVI-only fingerprint
    # after the VI series is computed.
    feature_matrix_for_fingerprint = prediction.feature_matrix

    protocol.emit_progress(88, 'computing vegetation index series and phenology')
    from terra import phenology as pheno
    from terra.imagery import composite as comp
    # The classification is already built above, so the crop pixels are known
    # before the index is averaged and the masked series costs one extra mean
    # per date rather than a second pass over the scenes.
    try:
        crop_pixels = mb_source.crop_mask(classification_map)
        if not crop_pixels.any():
            crop_pixels = None
    except Exception:
        crop_pixels = None

    (vi_series, vi_series_crop, vi_dates, ndvi_means, ndvi_mean_map,
     ndvi_valid, true_color_rgba) = lc_series.compute_aoi_vi_series(
        products, polygon, ref_profile, crop_mask=crop_pixels,
        note=lambda msg: protocol.emit_progress(-1, msg),
    )
    phenology = pheno.phenology_metrics(ndvi_means, vi_dates) if vi_dates else {
        'sos_doy': None, 'pos_doy': None, 'eos_doy': None, 'los_days': None,
        'peak': None, 'base': None, 'amplitude': None,
    }
    phenology_states = pheno.state_timeline(ndvi_means, vi_dates) if vi_dates else []

    domain_fingerprint = None
    try:
        from terra.landcover import domain_shift as ds_mod
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
        protocol.emit_progress(-1, f'domain fingerprint skipped: {e}')

    protocol.emit_progress(91, 'measuring spectral response per class')
    spectra = None
    try:
        spectra = lc_spectra.class_spectra(
            products, polygon, ref_profile, classification_map,
            note=lambda msg: protocol.emit_progress(-1, msg))
    except Exception as e:
        protocol.emit_progress(-1, f'class spectra skipped: {e}')

    limit = None
    if spectra is not None:
        try:
            limit = lc_spectra.library_limit(spectra, note=lambda msg: protocol.emit_progress(-1, msg))
        except Exception as e:
            protocol.emit_progress(-1, f'library comparison skipped: {e}')

    protocol.emit_progress(92, 'writing overlay and GeoTIFF')
    overlay_png = work_dir / 'overlay.png'
    raster_tif = work_dir / 'classification_map.tif'
    confidence_png = work_dir / 'confidence.png'
    ndvi_mean_png = work_dir / 'ndvi_mean.png'
    true_color_png = work_dir / 'true_color.png'
    reference_png = work_dir / 'reference.png'
    lc_raster.write_overlay_png(classification_map, overlay_png)
    lc_raster.write_classification_tif(classification_map, ref_profile, raster_tif)
    if confidence_map is None:
        confidence_map = (classification_map >= 0).astype(np.float32)
    lc_raster.write_confidence_png(confidence_map, classification_map >= 0, confidence_png)
    ndvi_mean_path = ''
    if ndvi_mean_map is not None and ndvi_valid is not None:
        lc_raster.write_ndvi_mean_png(ndvi_mean_map, ndvi_valid, ndvi_mean_png)
        ndvi_mean_path = str(ndvi_mean_png)
    true_color_path = ''
    if true_color_rgba is not None:
        comp.write_rgba_png(true_color_rgba, true_color_png)
        true_color_path = str(true_color_png)
    reference_path = ''
    if mb_map is not None:
        lc_raster.write_overlay_png(
            lc_raster.reference_classes(mb_map, ref_band), reference_png)
        reference_path = str(reference_png)
    mean_conf = float(confidence_map[classification_map >= 0].mean()) if np.any(classification_map >= 0) else 0.0
    conf_floor = classify.confidence_floor(label_encoder)

    lulc_payload = None
    if mapbiomas_path and Path(mapbiomas_path).exists():
        protocol.emit_progress(96, 'analyzing MapBiomas land cover / land use')
        try:
            from terra.landcover import mapbiomas as lulc_mod
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
            protocol.emit_progress(-1, f'lulc analysis skipped: {e}')

    lon_min, lon_max, lat_min, lat_max = ref_grid.get_map_extent(ref_profile)

    pixel_size_m = ref_grid.reference_pixel_size_m(ref_profile)

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
        'class_stats': classify.class_statistics(classification_map),
        # Seven bands on one acquisition, per predicted class. None when the
        # scene could not be read; see lc_spectra.class_spectra for why it is one date.
        'lc_spectra.class_spectra': spectra,
        # Each class against a leaf-level library, and the limit that runs into.
        'lc_spectra.library_limit': limit,
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

    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
