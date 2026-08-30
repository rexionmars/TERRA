"""
The energy actions: the resource at a point, how it falls across the terrain,
where a plant can stand, what it would yield, and the wind screening.

Each reads its request, runs the product, and writes one JSON object to stdout.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from terra import protocol
from terra.imagery import cog


# Solar resource and photovoltaic yield at the AOI centroid (no imagery).
def solar_resource(req, work_dir):
    from datetime import date as _date

    from terra import aoi
    from terra.energy import pv as pv_mod
    from terra.sun import (
        cache as power_cache,
        nasa_power as sun_power,
        position as sun_position,
        record as sun_record,
    )

    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])
    centroid = polygon.centroid
    lon, lat = sun_power.request_point(centroid.x, centroid.y)

    clim_years = protocol.request_positive(req, 'climatology_years', 30, int)
    hourly_years = protocol.request_positive(req, 'hourly_years', 10, int)
    # Zero is due north here, which is both the default and a value the
    # caller can mean, so absence is what selects the default.
    azimuth = protocol.request_number(req, 'surface_azimuth', 0.0)
    pr_override = req.get('performance_ratio')

    # POWER publishes through the previous full year.
    last_year = _date.today().year - 1
    clim_start = f'{last_year - clim_years + 1}0101'
    clim_end = f'{last_year}1231'
    hourly_start = f'{last_year - hourly_years + 1}0101'
    hourly_end = f'{last_year}1231'

    cache = power_cache.power_cache_dir(req)
    protocol.emit_progress(5, f'NASA POWER daily, {clim_years} years')
    try:
        daily, daily_provenance = power_cache.cached_power_series(
            cache, 'daily', lon, lat, clim_start, clim_end,
            sun_power.DAILY_PARAMS,
            lambda progress: sun_power.fetch(
                'daily', lon, lat, clim_start, clim_end, progress=progress
            ),
            progress=lambda i, n, y: protocol.emit_progress(
                5 + int(35 * (i + 1) / n), f'daily {y}'
            ),
        )
    except Exception as e:
        protocol.fail(f'NASA POWER daily request failed: {e}')

    annual = sun_record.annual_totals(daily)
    if annual.empty:
        protocol.fail('NASA POWER returned no complete year for this point')
    slope, pvalue = sun_record.linear_trend(annual)
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
        'clear_sky_index': sun_record.clear_sky_index(daily),
        'monthly': sun_record.monthly_climatology(daily),
    }

    protocol.emit_progress(42, f'NASA POWER hourly, {hourly_years} years')
    try:
        hourly, hourly_provenance = power_cache.cached_power_series(
            cache, 'hourly', lon, lat, hourly_start, hourly_end,
            sun_power.HOURLY_PARAMS,
            lambda progress: sun_power.fetch(
                'hourly', lon, lat, hourly_start, hourly_end,
                progress=progress,
            ),
            progress=lambda i, n, y: protocol.emit_progress(
                42 + int(38 * (i + 1) / n), f'hourly {y}'
            ),
        )
    except Exception as e:
        protocol.fail(f'NASA POWER hourly request failed: {e}')

    df, solpos = sun_position.prepare_hourly(hourly, lat, lon, 0.0)
    if df.empty:
        protocol.fail('NASA POWER returned no usable hourly record for this point')
    n_years = max(len(set(df.index.year)), 1)

    protocol.emit_progress(84, 'optimum tilt')
    sweep = pv_mod.sweep_tilt(df, solpos, azimuth, n_years)
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

    protocol.emit_progress(92, 'photovoltaic yield')
    poa = pv_mod.transpose(df, solpos, best['tilt_deg'], azimuth)
    p_ac = pv_mod.pv_yield(poa, df, solpos, best['tilt_deg'], azimuth)
    pr_modelled = pv_mod.modelled_performance_ratio(p_ac, poa['poa_global'])
    pr_applied = (
        float(pr_override)
        if isinstance(pr_override, (int, float))
        else pv_mod.REFERENCE_PERFORMANCE_RATIO
    )
    pr_source = 'user' if isinstance(pr_override, (int, float)) else 'reference'
    poa_year = float(poa['poa_global'].sum()) / 1000.0 / n_years
    # Specific yield is POA times the performance ratio by construction, so
    # applying a reference ratio is exact rather than a correction factor.
    yield_year = poa_year * pr_applied

    protocol.emit_progress(100, 'done')
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
            'grid_note': sun_power.GRID_NOTE,
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
def solar_terrain(req, work_dir):
    from datetime import date as _date

    import rasterio

    from terra import aoi
    from terra.energy import (
        overlays as overlays_mod,
        seasons as seasons_mod,
        terrain_irradiance as poa_mod,
    )
    from terra.imagery import composite as comp, grid as ref_grid
    from terra.sun import (
        cache as power_cache,
        nasa_power as sun_power,
        position as sun_position,
        record as sun_record,
    )
    from terra.terrain import dem as terrain_dem, slope as terrain_slope

    cog.configure()
    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])
    centroid = polygon.centroid
    lon, lat = sun_power.request_point(centroid.x, centroid.y)
    hourly_years = protocol.request_positive(req, 'hourly_years', 10, int)
    last_year = _date.today().year - 1

    protocol.emit_progress(5, 'fetching Copernicus DEM GLO-30')
    try:
        # Buffered, so terrain just outside the AOI can still cast onto
        # pixels inside it. Everything downstream is cropped back to the AOI
        # window before it is published.
        dem_path = terrain_dem.fetch_file(
            polygon, Path(work_dir) / 'dem.tif',
            buffer_m=poa_mod.HORIZON_MAX_DIST_M,
            progress=lambda msg: protocol.emit_progress(-1, msg),
        )
    except Exception as e:
        protocol.fail(f'DEM fetch failed: {e}')

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

    dx_m, dy_m = terrain_slope.pixel_size_m(buf_transform, lat)
    protocol.emit_progress(20, 'slope, aspect and horizon')
    slope, aspect = terrain_slope.horn_slope_aspect(elevation, dx_m, dy_m)
    horizon, _ = poa_mod.horizon_angles(elevation, dx_m, dy_m)

    # Crop back: the buffer exists so the horizon sees beyond the boundary,
    # not so the result reports on land the user did not ask about.
    r0 = int(aoi_window.row_off)
    c0 = int(aoi_window.col_off)
    r1 = r0 + int(aoi_window.height)
    c1 = c0 + int(aoi_window.width)
    if r1 <= r0 or c1 <= c0:
        protocol.fail('the DEM window does not overlap the AOI')
    def _crop(a):
        return a[r0:r1, c0:c1]
    elevation = _crop(elevation)
    slope, aspect = _crop(slope), _crop(aspect)
    horizon = horizon[r0:r1, c0:c1, :]
    dem_transform = rasterio.windows.transform(aoi_window, buf_transform)
    dem_profile = buf_profile.copy()
    dem_profile.update(height=slope.shape[0], width=slope.shape[1],
                       transform=dem_transform)

    hourly_start = f'{last_year - hourly_years + 1}0101'
    hourly_end = f'{last_year}1231'
    protocol.emit_progress(28, f'NASA POWER hourly, {hourly_years} years')
    try:
        hourly, hourly_provenance = power_cache.cached_power_series(
            power_cache.power_cache_dir(req), 'hourly', lon, lat,
            hourly_start, hourly_end, sun_power.HOURLY_PARAMS,
            lambda progress: sun_power.fetch(
                'hourly', lon, lat, hourly_start, hourly_end,
                progress=progress,
            ),
            progress=lambda i, n, y: protocol.emit_progress(
                28 + int(45 * (i + 1) / n), f'hourly {y}'
            ),
        )
    except Exception as e:
        protocol.fail(f'NASA POWER hourly request failed: {e}')

    df, solpos = sun_position.prepare_hourly(hourly, lat, lon, float(np.nanmean(elevation)))
    if df.empty:
        protocol.fail('NASA POWER returned no usable hourly record for this point')
    n_years = max(len(set(df.index.year)), 1)

    season = (req.get('season') or 'annual').lower()
    if season not in seasons_mod.SEASONS and season not in ('anisotropy', 'shading'):
        protocol.fail(f'unknown season: {season}')

    beam_share = sun_record.beam_fraction(df)

    # Whether the terrain encloses the site enough for the diffuse loss to
    # be a figure rather than noise. Read off the horizon already traced, so
    # the test costs nothing; below the threshold the sky view factor is a
    # rounding term and applying it would spend the arithmetic on noise.
    enclosure = poa_mod.horizon_enclosure(horizon)
    svf_loss = (
        poa_mod.diffuse_loss_fraction(horizon)
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
        m = seasons_mod.season_mask(df.index, name)
        sub, sp = df[m], solpos[m]
        if sub.empty:
            protocol.fail(f'no hourly record inside the {name} window')
        yrs = seasons_mod.season_years(df.index, name)
        tbl = poa_mod.build_poa_lookup(sub, sp, max(yrs, 1e-6))
        raw = poa_mod.interpolate_poa(slope, aspect, tbl)
        hist, edges = sun_position.beam_energy_histogram(sub, sp)
        loss = poa_mod.shading_loss_fraction(horizon, hist, edges)
        attenuated = raw * (1.0 - loss * beam_share)
        if svf_loss is not None:
            attenuated = attenuated * (1.0 - svf_loss * (1.0 - beam_share))
        return attenuated, loss

    protocol.emit_progress(76, 'plane-of-array lookup')
    companion = None
    shading_loss = None
    if season == 'anisotropy':
        # Winter over summer in one layer: the seasonal contrast is what
        # the annual map averages away, and a ratio carries it per pixel.
        protocol.emit_progress(78, 'lookup [winter]')
        winter, _ = _poa_for('winter')
        protocol.emit_progress(85, 'lookup [summer]')
        summer, shading_loss = _poa_for('summer')
        with np.errstate(divide='ignore', invalid='ignore'):
            poa = np.where(summer > 0, winter / summer, np.nan)
        unit = 'winter / summer'
    elif season == 'shading':
        protocol.emit_progress(80, 'horizon shading over the year')
        _, shading_loss = _poa_for('annual')
        poa = shading_loss
        unit = 'fraction of beam blocked'
    elif season in overlays_mod.SEASON_PAIR:
        # The companion season is computed only so both land on one colour
        # domain. Their spatial spread differs by about a factor of ten, and
        # normalising each to its own range draws them at equal contrast.
        protocol.emit_progress(78, f'lookup [{season}]')
        poa, shading_loss = _poa_for(season)
        other = overlays_mod.SEASON_PAIR[season]
        protocol.emit_progress(85, f'lookup [{other}], shared colour scale')
        companion, _ = _poa_for(other)
        unit = 'kWh/m2 per season'
    else:
        protocol.emit_progress(80, f'lookup [{season}]')
        poa, shading_loss = _poa_for(season)
        unit = 'kWh/m2 per season' if season != 'annual' else 'kWh/m2/year'
    protocol.emit_progress(92, 'interpolating onto the terrain')

    # Only pixels inside the AOI carry a result.
    from rasterio.features import geometry_mask
    inside = ~geometry_mask(
        [polygon.__geo_interface__], out_shape=poa.shape,
        transform=dem_transform, invert=False
    )
    valid = inside & np.isfinite(poa)
    if not valid.any():
        protocol.fail('the DEM window does not overlap the AOI')

    scale = overlays_mod.render_scale(season, poa, valid, companion, valid)
    png = Path(work_dir) / 'solar_poa.png'
    comp.write_rgba_png(
        overlays_mod.terrain_rgba(
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
    lon_min, lon_max, lat_min, lat_max = ref_grid.get_map_extent(
        {'transform': dem_transform, 'crs': dem_crs,
         'height': poa.shape[0], 'width': poa.shape[1]}
    )
    protocol.emit_progress(100, 'done')
    summary = poa_mod.summarise(
        vals, slope, valid,
        shading_loss=shading_loss, svf_loss=svf_loss, enclosure=enclosure,
        scale=scale, season=season, unit=unit, n_years=n_years,
        beam_share=beam_share,
    )
    sys.stdout.write(json.dumps({
        'solar_terrain': {
            **summary,
            # Whether the POWER series behind this layer was fetched or read
            # from the on-disk cache, and when it was fetched.
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
def solar_siting(req, work_dir):
    import rasterio

    from terra import aoi, mapbiomas as mb_source
    from terra.energy import siting as siting_mod
    from terra.imagery import composite as comp, grid as ref_grid

    cog.configure()
    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])

    # Conventions, not verified legal restrictions. Echoed in the response.
    # Zero degrees is a limit the caller can mean: it accepts only ground
    # the DEM reports as flat. Absence selects the convention, not falsiness.
    slope_acceptable = protocol.request_number(
        req, 'slope_acceptable_deg', siting_mod.SLOPE_ACCEPTABLE_DEG
    )
    slope_restrictive = protocol.request_number(
        req, 'slope_restrictive_deg', siting_mod.SLOPE_RESTRICTIVE_DEG
    )
    excluded = tuple(req.get('excluded_cover') or siting_mod.EXCLUDED_COVER)
    cropland = tuple(req.get('cropland_cover') or siting_mod.CROPLAND_COVER)

    siting_pct = {'dem': 10, 'slope': 35, 'cover': 55, 'classes': 80}
    try:
        sited = siting_mod.compute_siting(
            polygon, work_dir, slope_acceptable, slope_restrictive,
            excluded, cropland,
            mapbiomas_path=mb_source.resolve_mapbiomas_path(
                req.get('mapbiomas_path'), polygon, Path(work_dir)
            ),
            progress=lambda st, msg: protocol.emit_progress(siting_pct[st], msg),
            note=lambda msg: protocol.emit_progress(-1, msg),
        )
    except siting_mod.SitingFailed as e:
        protocol.fail(str(e))
    suit = sited['suitability']
    slope = sited['slope']
    stats = sited['classes']
    px_area_ha = sited['pixel_area_ha']
    dem_transform = sited['dem_transform']
    dem_crs = sited['dem_crs']
    dem_profile = sited['dem_profile']

    png = Path(work_dir) / 'solar_siting.png'
    comp.write_rgba_png(siting_mod.suitability_rgba(suit), png)
    tif = Path(work_dir) / 'solar_siting.tif'
    prof = dem_profile.copy()
    prof.update(dtype='int16', count=1, compress='lzw', nodata=-1)
    with rasterio.open(tif, 'w', **prof) as dst:
        dst.write(suit.astype('int16'), 1)

    lon_min, lon_max, lat_min, lat_max = ref_grid.get_map_extent(
        {'transform': dem_transform, 'crs': dem_crs,
         'height': slope.shape[0], 'width': slope.shape[1]}
    )
    by_code = {r['code']: r for r in stats}
    protocol.emit_progress(100, 'done')
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
def energy_model(req, work_dir):
    from datetime import date as _date

    from terra import aoi, mapbiomas as mb_source
    from terra.energy import pv as pv_mod, pv_plant as energy_mod, siting as siting_mod
    from terra.sun import (
        cache as power_cache,
        nasa_power as sun_power,
        position as sun_position,
        record as sun_record,
    )
    from terra.terrain import slope as terrain_slope

    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])
    centroid = polygon.centroid
    lon, lat = sun_power.request_point(centroid.x, centroid.y)

    clim_years = protocol.request_positive(req, 'climatology_years', 30, int)
    hourly_years = protocol.request_positive(req, 'hourly_years', 10, int)
    azimuth = protocol.request_number(req, 'surface_azimuth', 0.0)
    pr_override = req.get('performance_ratio')
    reporting_basis = (req.get('reporting_basis') or 'year_one').lower()
    if reporting_basis not in energy_mod.REPORTING_BASES:
        protocol.fail(f'unknown reporting basis: {reporting_basis}')
    try:
        module_type, gamma_pdc = energy_mod.resolve_module_type(
            req.get(energy_mod.MODULE_TYPE_REQUEST_FIELD)
        )
    except ValueError as e:
        protocol.fail(str(e))
    # Zero per year is a value, not an omission: it states that the caller
    # is modelling no degradation. Read through request_number it survives;
    # under the previous `or` default it became 0.5 %/yr and multiplied
    # every lifetime-mean figure by 0.9422 instead of 1.0.
    degradation_rate = protocol.request_positive(
        req, 'degradation_rate_per_year',
        energy_mod.DEGRADATION_RATE_PER_YEAR, allow_zero=True,
    )
    analysis_period = protocol.request_positive(
        req, 'analysis_period_years',
        energy_mod.ANALYSIS_PERIOD_YEARS, int,
    )
    gcr_fixed = protocol.request_positive(req, 'gcr_fixed', energy_mod.GCR_FIXED)
    gcr_tracker = protocol.request_positive(
        req, 'gcr_tracker', energy_mod.GCR_TRACKER
    )
    # Zero degrees is a tracker locked flat, which is a configuration a
    # caller can ask for, so it is admitted rather than replaced by 60.
    tracker_max_angle = protocol.request_positive(
        req, 'tracker_max_angle_deg', energy_mod.TRACKER_MAX_ANGLE_DEG,
        allow_zero=True,
    )
    density_basis = (
        req.get('capacity_density_basis')
        or energy_mod.DEFAULT_CAPACITY_DENSITY_BASIS
    )
    if density_basis not in energy_mod.CAPACITY_DENSITY_BASES:
        protocol.fail(f'unknown capacity density basis: {density_basis}')
    # Zero buildable share is a site with nothing buildable on it, which is
    # a statement, not an omission.
    buildable_fraction = protocol.request_positive(
        req, 'buildable_fraction', energy_mod.BUILDABLE_FRACTION,
        allow_zero=True,
    )
    utc_offset = protocol.request_number(req, 'utc_offset_hours', None)
    # Zero is total horizon obstruction. It is admitted for the same reason
    # and, like every other value of this field, it is a fraction of BEAM
    # irradiance and is converted by the beam share before it is applied.
    shading_derate = protocol.request_positive(
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

    cache = power_cache.power_cache_dir(req)
    protocol.emit_progress(4, f'NASA POWER daily, {clim_years} years')
    try:
        daily, daily_provenance = power_cache.cached_power_series(
            cache, 'daily', lon, lat, clim_start, clim_end,
            sun_power.DAILY_PARAMS,
            lambda progress: sun_power.fetch(
                'daily', lon, lat, clim_start, clim_end, progress=progress
            ),
            progress=lambda i, n, y: protocol.emit_progress(
                4 + int(26 * (i + 1) / n), f'daily {y}'
            ),
        )
    except Exception as e:
        protocol.fail(f'NASA POWER daily request failed: {e}')

    annual = sun_record.annual_totals(daily)
    if annual.empty:
        protocol.fail('NASA POWER returned no complete year for this point')

    protocol.emit_progress(32, f'NASA POWER hourly, {hourly_years} years')
    try:
        hourly, hourly_provenance = power_cache.cached_power_series(
            cache, 'hourly', lon, lat, hourly_start, hourly_end,
            sun_power.HOURLY_PARAMS,
            lambda progress: sun_power.fetch(
                'hourly', lon, lat, hourly_start, hourly_end,
                progress=progress,
            ),
            progress=lambda i, n, y: protocol.emit_progress(
                32 + int(30 * (i + 1) / n), f'hourly {y}'
            ),
        )
    except Exception as e:
        protocol.fail(f'NASA POWER hourly request failed: {e}')

    # Elevation 0.0 as solar_resource does, so the two actions run on one
    # chain and cannot report different plane-of-array totals for one AOI.
    df, solpos = sun_position.prepare_hourly(hourly, lat, lon, 0.0)
    if df.empty:
        protocol.fail('NASA POWER returned no usable hourly record for this point')
    n_years = max(len(set(df.index.year)), 1)

    protocol.emit_progress(66, 'optimum tilt')
    sweep = pv_mod.sweep_tilt(df, solpos, azimuth, n_years)
    best = max(sweep, key=lambda r: r['poa_kwh_m2_year'])
    horizontal = next(
        (r['poa_kwh_m2_year'] for r in sweep if abs(r['tilt_deg']) < 1e-9),
        best['poa_kwh_m2_year'],
    )
    poa = pv_mod.transpose(df, solpos, best['tilt_deg'], azimuth)
    # The selected module type re-evaluates the two coefficient-dependent
    # steps of the chain, so every product below runs on the type the
    # response reports rather than on the module default.
    frame = energy_mod.apply_module_type(
        pv_mod.pv_yield_frame(poa, df, solpos, best['tilt_deg'], azimuth),
        gamma_pdc,
    )

    protocol.emit_progress(70, 'performance ratio')
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
        protocol.fail(f'performance ratio could not be resolved: {e}')
    poa_year = float(ratio['factors']['energy_poa_kwh_m2_year'])
    ghi_hourly = float(df['ghi'].sum()) / 1000.0 / n_years

    protocol.emit_progress(74, 'loss waterfall')
    try:
        waterfall = energy_mod.loss_waterfall(
            frame, ghi_hourly, float(horizontal), n_years, ratio,
            hourly_window=hourly_window,
            ghi_climatology_kwh_m2_year=float(annual.mean()),
            climatology_window=clim_window,
            gamma_pdc=gamma_pdc,
        )
    except Exception as e:
        protocol.fail(f'loss waterfall failed: {e}')

    protocol.emit_progress(78, 'single-axis tracking comparison')
    try:
        tracking = energy_mod.tracking_comparison(
            df, solpos, n_years, poa, best['tilt_deg'], azimuth, ratio,
            gcr_fixed=gcr_fixed, gcr_tracker=gcr_tracker,
            max_angle_deg=tracker_max_angle,
            gamma_pdc=gamma_pdc,
        )
    except Exception as e:
        protocol.fail(f'tracking comparison failed: {e}')

    protocol.emit_progress(86, 'generation profile')
    try:
        profile = energy_mod.generation_profile(
            frame, n_years, utc_offset_hours=utc_offset
        )
    except Exception as e:
        protocol.fail(f'generation profile failed: {e}')

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
        protocol.emit_progress(88, 'reading the siting raster')
        with rasterio.open(siting_tif) as src:
            suitability = src.read(1)
            dx_m, dy_m = terrain_slope.pixel_size_m(src.transform, centroid.y)
        pixel_area_ha = (dx_m * dy_m) / 10_000.0
        class_areas = siting_mod.suitability_stats(suitability, pixel_area_ha)
    elif siting_classes:
        class_areas = siting_classes
    else:
        cog.configure()
        slope_acceptable = protocol.request_number(
            req, 'slope_acceptable_deg', siting_mod.SLOPE_ACCEPTABLE_DEG
        )
        slope_restrictive = protocol.request_number(
            req, 'slope_restrictive_deg', siting_mod.SLOPE_RESTRICTIVE_DEG
        )
        excluded = tuple(req.get('excluded_cover') or siting_mod.EXCLUDED_COVER)
        cropland = tuple(req.get('cropland_cover') or siting_mod.CROPLAND_COVER)
        siting_pct = {'dem': 88, 'slope': 91, 'cover': 93, 'classes': 96}
        try:
            sited = siting_mod.compute_siting(
                polygon, work_dir, slope_acceptable, slope_restrictive,
                excluded, cropland,
                mapbiomas_path=mb_source.resolve_mapbiomas_path(
                    req.get('mapbiomas_path'), polygon, Path(work_dir)
                ),
                progress=lambda st, msg: protocol.emit_progress(siting_pct[st], msg),
            note=lambda msg: protocol.emit_progress(-1, msg),
            )
        except siting_mod.SitingFailed as e:
            protocol.fail(str(e))
        suitability = sited['suitability']
        pixel_area_ha = sited['pixel_area_ha']
        class_areas = sited['classes']
        thresholds = sited['thresholds']

    protocol.emit_progress(97, 'plant energy over the suitable area')
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
            beam_share=float(sun_record.beam_fraction(df)),
            suitability=suitability,
            pixel_area_ha=(
                None if pixel_area_ha is None else float(pixel_area_ha)
            ),
            thresholds=thresholds,
        )
    except Exception as e:
        protocol.fail(f'plant energy failed: {e}')

    protocol.emit_progress(100, 'done')
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
            'grid_note': sun_power.GRID_NOTE,
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
                'transposition_model': pv_mod.TRANSPOSITION_MODEL,
                'albedo': float(pv_mod.ALBEDO),
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
def wind_resource(req, work_dir):
    from datetime import date as _date

    from terra import aoi
    from terra.energy import wind as wind_mod
    from terra.sun import cache as power_cache, nasa_power as sun_power

    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])
    centroid = polygon.centroid
    # The MERRA-2 cell centre, not the centroid: the request resolves to a
    # cell and the response has to say which cell it describes.
    lon, lat = sun_power.meteorology_cell(centroid.x, centroid.y)

    record_years = protocol.request_positive(
        req, 'record_years', wind_mod.RECORD_YEARS, int
    )
    hub_height_m = protocol.request_positive(
        req, 'hub_height_m', wind_mod.HUB_HEIGHT_M
    )
    # Zero is a caller stating that no hour counts as calm, and zero is a
    # caller stating that the record maximum needs no floor. Both are
    # values; only absence selects the wind module's convention.
    calm_threshold = protocol.request_positive(
        req, 'calm_threshold_ms', wind_mod.CALM_THRESHOLD_MS,
        allow_zero=True,
    )
    record_max_floor = protocol.request_positive(
        req, 'record_max_floor_ms', wind_mod.RECORD_MAX_FLOOR_MS,
        allow_zero=True,
    )
    band = req.get('roughness_band_m') or wind_mod.ROUGHNESS_BAND_M
    try:
        roughness_band = (float(band[0]), float(band[1]))
    except (TypeError, IndexError, ValueError):
        protocol.fail('roughness_band_m must be two roughness lengths in metres')

    last_year = _date.today().year - 1
    start, end = wind_mod.record_period(last_year, record_years)
    record_window = f'{start[:4]}-{end[:4]} hourly'

    protocol.emit_progress(5, f'NASA POWER hourly wind, {record_years} years')
    try:
        df, hourly_provenance = power_cache.cached_power_series(
            power_cache.power_cache_dir(req), 'hourly', lon, lat, start, end,
            wind_mod.HOURLY_PARAMS,
            lambda progress: wind_mod.fetch(
                lon, lat, start, end, progress=progress
            ),
            progress=lambda i, n, y: protocol.emit_progress(
                5 + int(80 * (i + 1) / n), f'hourly {y}'
            ),
        )
    except Exception as e:
        protocol.fail(f'NASA POWER hourly request failed: {e}')
    if df.empty:
        protocol.fail('NASA POWER returned no hourly record for this point')

    protocol.emit_progress(90, 'shear, Weibull fit and turbine power')
    try:
        assessment = wind_mod.assess(
            df, lon, lat,
            hub_height_m=hub_height_m,
            calm_threshold_ms=calm_threshold,
            record_max_floor_ms=record_max_floor,
            roughness_band_m=roughness_band,
        )
    except Exception as e:
        protocol.fail(f'wind assessment failed: {e}')

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

    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'wind': assessment}))
    sys.stdout.flush()
