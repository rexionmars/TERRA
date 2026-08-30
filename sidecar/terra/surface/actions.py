"""
The surface action: the Copernicus elevation over one area, as the globe draws it.

It does not persist a run. The other products record one because they are
measurements a reader returns to and compares; this is the ground they were
measured on, static and reproducible from the polygon alone, so a row would
record nothing the request does not already say.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import geometry_mask

from terra import aoi, protocol
from terra.imagery import cog, composite as comp
from terra.terrain import dem as terrain_dem

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
# The decoded range the scalar protocol carries. The decoding is
# r + g/256 + b/65536, whose supremum is 256; 255 leaves the top of the ramp on
# a whole number and inside the range rather than at its edge.
VALUE_FULL_SCALE = 255.0
# ZERO MEANS ABSENT, AND THE SURFACE STARTS AT ONE.
#
# The protocol writes 0 for every cell outside the raster it was given -- a tile
# on the other side of the world is still a tile it has to answer. On a count
# that is free, because 0 is already "no product called this flooded". On a
# continuous surface it is not: 0 is a legitimate elevation, the window's own
# floor, so an unmasked ramp painted the whole planet the colour of the valley
# bottom.
#
# One value is therefore reserved. The surface occupies [1, 255] and the ramp
# is transparent below 1, which costs one part in 254 of the range -- under
# 1 cm on a 2 km window, and nothing at all next to the 65536 steps the
# fraction channels carry.
VALUE_ABSENT = 0.0
VALUE_FLOOR = 1.0


def surface_model(req, work_dir):
    cog.configure()
    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])

    protocol.emit_progress(10, 'fetching Copernicus DEM GLO-30')
    try:
        dem_path = terrain_dem.fetch_file(polygon, Path(work_dir) / 'surface.tif')
    except Exception as e:
        protocol.fail(f'DEM fetch failed: {e}')

    protocol.emit_progress(60, 'reading the surface')
    with rasterio.open(dem_path) as src:
        elevation = src.read(1).astype('float32')
        profile = src.profile
        nodata = src.nodata
        transform = src.transform

    # dem.py's threshold, for its reason: SRTM writes -32768 into voids and ALOS
    # writes -9999, and neither is always declared as the COG's nodata. The
    # lowest bare land on Earth is near -430 m.
    void = ~np.isfinite(elevation) | (elevation < -1000.0)
    if nodata is not None:
        void |= elevation == nodata

    # THE POLYGON, NOT ITS BOUNDING BOX. fetch_dem returns a rectangular window
    # because that is what a raster window is; the figures below and the raster
    # written for the map are both over the shape that was drawn. Without this
    # a diagonal AOI reports the surface of a rectangle several times its area,
    # which is the mistake the flood payload's reporting mask exists to avoid.
    inside = ~geometry_mask(
        [polygon.__geo_interface__], out_shape=elevation.shape,
        transform=transform, invert=False,
    )
    absent = void | ~inside
    measured = elevation[~absent]
    if measured.size == 0:
        protocol.fail('the DEM window is entirely void over this area')

    lo = float(np.min(measured))
    hi = float(np.max(measured))

    protocol.emit_progress(85, 'writing the surface raster')
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
    fraction = np.clip((elevation - lo) / span, 0.0, 1.0)
    normalised = VALUE_FLOOR + fraction * (VALUE_FULL_SCALE - VALUE_FLOOR)
    # Absent cells carry the reserved value rather than a clamped elevation.
    normalised = np.where(absent, VALUE_ABSENT, normalised)
    packed = np.rint(normalised * 65536.0).astype('uint32')
    packed = np.clip(packed, 0, 0xFFFFFF)
    rgba = np.zeros((*elevation.shape, 4), dtype=np.uint8)
    rgba[..., 0] = (packed >> 16) & 0xFF
    rgba[..., 1] = (packed >> 8) & 0xFF
    rgba[..., 2] = packed & 0xFF
    # Alpha is for a reader opening the file, not for the decoder: MapLibre's
    # DEM unpacking reads RGB only, which is why absence had to be a value.
    rgba[..., 3] = np.where(absent, 0, 255).astype(np.uint8)
    values_png = Path(work_dir) / 'surface_values.png'
    comp.write_rgba_png(rgba, values_png)

    protocol.emit_progress(100, f'{hi - lo:.0f} m of relief')
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
        'void_cells': int(absent.sum()),
        # A decoded value v carries metres as
        #   floor_m + (v - value_floor) * relief_m / (value_full_scale - value_floor)
        # and v below value_floor is absent. The map needs all of them; none
        # can be guessed from the image, and a legend that guessed would be a
        # legend in the wrong units over the wrong ground.
        'value_full_scale': VALUE_FULL_SCALE,
        'value_floor': VALUE_FLOOR,
        'notes': [
            'Copernicus GLO-30 is a surface model: it measures the first '
            'reflective surface, so closed forest reports canopy top and built '
            'ground reports roofs. It is not bare earth.',
            'The window is the AOI itself, with no buffer, so every figure '
            'here is over exactly the polygon drawn.',
        ],
    }}))
