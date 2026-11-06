"""The biomass action: one year of ESA CCI Biomass over an area, as a composition."""

from __future__ import annotations

import json
import sys

import numpy as np

from terra import protocol
from terra.biomass import cci
from terra.imagery import cog

# The PNG is drawn with each 100 m cell as a block of this many pixels a side.
# The map resamples an overlay linearly, and a 100 m cell smeared across its
# neighbours would draw detail the map does not have.
BLOCK_PX = 8


def scale_top(values: np.ndarray) -> float:
    """
    The top of the colour scale, in Mg/ha: the 98th percentile of the area,
    rounded up to a multiple of 50, and never under 50.

    Set from the area rather than fixed at the map's range, because a
    cropland area of 0 to 30 Mg/ha would be one colour on a 0 to 500 scale;
    the legend states the figure, so the scale is never implicit.
    """
    if values.size == 0:
        return 50.0
    p98 = float(np.percentile(values, 98))
    return max(50.0, float(np.ceil(p98 / 50.0) * 50.0))


def biomass_map(req, work_dir):
    from rasterio.features import geometry_mask

    from terra import aoi
    from terra.imagery import composite as comp

    cog.configure()
    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])
    try:
        year = int(req.get('year') or cci.YEARS[-1])
    except (TypeError, ValueError):
        protocol.fail(f'year must be one of {", ".join(map(str, cci.YEARS))}')

    protocol.emit_progress(20, f'reading CCI Biomass {cci.VERSION}, {year}')
    try:
        agb = cci.read(polygon, year)
        sd = cci.read(polygon, year, deviation=True)
    except ValueError as e:
        protocol.fail(str(e))
    except Exception as e:
        protocol.fail(f'CCI Biomass could not be read from CEDA: {e}')

    inside = geometry_mask([polygon], out_shape=agb.values.shape, transform=agb.transform, invert=True)
    if not inside.any():
        protocol.fail('the area covers no 100 m cell of the biomass map; it is smaller than the map resolves')
    values = np.where(inside, agb.values, np.nan).astype(np.float32)
    top = scale_top(agb.values[inside])
    area = np.broadcast_to(cci.cell_area_ha(agb.transform, inside.shape[0])[:, None], inside.shape)
    weights = area[inside]
    mean = float(np.average(agb.values[inside], weights=weights))
    mean_sd = float(np.average(sd.values[inside], weights=weights))

    protocol.emit_progress(70, 'drawing')
    rgba = comp.scaled_to_rgba(np.clip(np.nan_to_num(values) / top, 0.0, 1.0), inside, 'viridis')
    blocks = np.repeat(np.repeat(rgba, BLOCK_PX, axis=0), BLOCK_PX, axis=1)
    overlay_png = work_dir / 'composite.png'
    comp.write_rgba_png(blocks, overlay_png)
    profile = {
        'crs': agb.crs,
        'transform': agb.transform,
        'width': inside.shape[1],
        'height': inside.shape[0],
    }
    raster_tif = work_dir / 'composite.tif'
    try:
        comp.write_float_geotiff(values, profile, raster_tif)
    except Exception as e:
        protocol.fail(f'biomass GeoTIFF failed: {e}')

    meta = {
        'kind': 'biomass',
        'year': year,
        'date': str(year),
        'source_url': cci.tile_url(year, *cci.tiles_over(*polygon.bounds)[0]),
        'legend': {
            'kind': 'stats',
            'subject': f'Above-ground biomass, {year} (Mg/ha)',
            'palette': 'viridis',
            'low': '0',
            'high': f'{top:.0f} Mg/ha',
            'rows': [
                {'label': 'Mean', 'value': f'{mean:.0f} Mg/ha'},
                {'label': 'Mean standard deviation', 'value': f'{mean_sd:.0f} Mg/ha per cell'},
                {'label': 'Cells', 'value': f'{int(inside.sum())} of 100 m'},
                {'label': 'Map', 'value': f'ESA CCI Biomass {cci.VERSION}, CEDA'},
            ],
            'note': (
                'Estimated from L- and C-band radar backscatter at 100 m, for forest. Over crops '
                'and pasture the figure is not a measurement of them, and a field narrower than a '
                'few hundred metres is not resolved.'
            ),
        },
    }
    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({
        'extent': comp.extent_from_profile(profile),
        'overlay_png': str(overlay_png),
        'raster_tif': str(raster_tif),
        'meta': meta,
    }))
    sys.stdout.flush()
