"""
The flood action: the HAND extent over an area, and the envelope around it.

Reads its request, runs the product, and writes one JSON object to stdout.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import rasterio

from terra import protocol
from terra.imagery import cog


# HAND flood extent with the envelope of DEM products around it.
def flood_envelope(req, work_dir):
    # Imported here rather than at module scope, as every heavy action does.
    # dem pulls pystac_client, planetary_computer and shapely.ops, flood pulls
    # the terrain chain; at module scope every action would pay those imports,
    # and one missing dependency would fail the sidecar for every product
    # instead of for this one.
    from terra import aoi
    from terra.flood import envelope as flood_mod
    from terra.imagery import composite as comp
    from terra.terrain import dem as dem_mod

    cog.configure()

    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])
    if polygon.is_empty:
        protocol.fail('the AOI polygon is empty, so there is no window to read a DEM over')

    # An explicit empty list is a broken request and reaches the count check
    # below with its own message; only absence selects the four-product set.
    ids = req.get('dem_ids')
    if ids is None:
        ids = list(dem_mod.DEFAULT_IDS)
    try:
        products = [dem_mod.resolve(pid) for pid in ids]
    except ValueError as e:
        protocol.fail(str(e))
    if len(products) < 2:
        protocol.fail(f'an envelope is a disagreement between DEM products and needs at '
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
        protocol.fail('thresholds_m must be a list of HAND thresholds in metres')
    if not thresholds:
        protocol.fail('thresholds_m is empty; give at least one HAND threshold in metres, '
             f'or omit it for the {list(flood_mod.THRESHOLDS_M)} m sweep')
    if any(t < 0 for t in thresholds):
        protocol.fail(f'HAND thresholds are heights above the drainage and cannot be '
             f'negative, got {thresholds}')

    # Zero is a value for a threshold: HAND <= 0 m is the drainage surface
    # itself, which is a question a caller can ask. Only absence selects the 1 m
    # reference the study reports its widest disagreement at.
    reference_threshold_m = protocol.request_positive(
        req, 'reference_threshold_m', flood_mod.REFERENCE_THRESHOLD_M,
        allow_zero=True,
    )
    # Zero is not a value for the drainage area. hand.compute floors the
    # threshold at one cell, so a request of zero makes every cell drainage,
    # HAND zero everywhere and the extent the whole window at every threshold.
    drainage_km2 = protocol.request_positive(req, 'drainage_km2', flood_mod.DRAINAGE_REF_KM2)

    # Both of these default to None on absence, which is the signal each module
    # reads as "choose for me": dem sizes the buffer from the AOI and flood
    # takes its 1 km inset ring. Zero is a value for both -- a caller reading
    # exactly the AOI, and a caller asking for no inset ring -- so neither
    # can go through request_positive, whose default would have to be a number.
    buffer_m = protocol.request_number(req, 'buffer_m', None)
    if buffer_m is None:
        buffer_m = dem_mod.recommended_buffer_m(polygon.bounds)
    elif buffer_m < 0:
        protocol.fail(f'buffer_m is a distance beyond the AOI and cannot be negative, '
             f'got {buffer_m}')
    # Refused rather than ignored. This key was renamed when the ring stopped
    # being cut from the computed window and started being cut from the AOI
    # boundary: a caller still sending the old name means a caller whose ring
    # width would silently fall back to the default, and the payload would
    # report a margin the request did not ask for.
    if 'edge_margin_cells' in req:
        protocol.fail('edge_margin_cells was renamed to inset_margin_cells. The ring is '
             'now cut from inside the AOI polygon; it was previously cut from '
             'the border of the buffered window the terrain chain ran over. '
             'The two are rings of different shapes, and the payload reports '
             'inset_margin_cells with iou_inset beside it.')
    inset_margin_cells = protocol.request_number(req, 'inset_margin_cells', None, int)
    if inset_margin_cells is not None and inset_margin_cells < 0:
        protocol.fail(f'inset_margin_cells is a ring width and cannot be negative, '
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
    if window_cells > flood_mod.MAX_ENVELOPE_CELLS:
        admissible_km = (
            reference_res_m * flood_mod.MAX_ENVELOPE_CELLS ** 0.5 - 2 * buffer_m
        ) / 1000.0
        protocol.fail(
            f'this AOI is {aoi_w / 1000:.1f} by {aoi_h / 1000:.1f} km, which '
            f'with the {buffer_m:.0f} m buffer the terrain chain needs is '
            f'{window_cells / 1e6:.1f} million cells of {reference_res_m:.0f} m '
            f'for each of the {len(products)} DEM products. The flood envelope '
            f'is limited to {flood_mod.MAX_ENVELOPE_CELLS / 1e6:.0f} million, about '
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
                protocol.emit_progress(
                    read_floor
                    + int((read_ceiling - read_floor) * index / len(products)),
                    message,
                )
                return
        protocol.emit_progress(read_floor, message)

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
        protocol.emit_progress(
            chain_floor
            + int((chain_ceiling - chain_floor)
                  * min(chain_done['n'], chain_steps) / chain_steps),
            message,
        )

    protocol.emit_progress(
        read_floor,
        f'reading {len(products)} DEM products over the AOI plus {buffer_m:.0f} m'
    )
    try:
        aligned = flood_mod.read_aligned(
            polygon, products, buffer_m, reference_res_m,
            progress=read_progress,
            aligning=lambda: protocol.emit_progress(
                read_ceiling, 'aligning the products onto one grid'),
        )
    except flood_mod.NoCommonWindow as e:
        missing = ', '.join(f'{pid} {n} cells' for pid, n in e.missing.items())
        protocol.fail(f'the products do not cover one common window: {missing} have no '
             f'elevation, and trimming up to {e.max_trim} cells from each border '
             f'does not reach a rectangle all of them cover. A void that far '
             f'inside the window is a hole in the product itself, over water '
             f'or in radar shadow; the trim covers only the alignment sliver '
             f'at the border. The terrain chain would still return a HAND '
             f'field over such a hole, and nothing in the output would mark '
             f'the region it is wrong over. Move or shrink the AOI, or name a '
             f'dem_ids set without the product that is missing elevation.')
    except Exception as e:
        protocol.fail(f'DEM read failed: {e}')
    grid = aligned.grid
    dx, dy = aligned.dx, aligned.dy

    # What the figures are about. The arrays above cover the AOI plus buffer_m
    # on every side because the terrain chain needs the drainage entering the
    # AOI to be real terrain; the report covers the AOI itself. Rasterised
    # after the crop, so the mask is on the same grid the products were
    # compared on and not on the window that was requested.
    aoi_mask = flood_mod.aoi_reporting_mask(polygon, grid)

    sources = aligned.sources()

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
        protocol.fail(f'the flood envelope could not be measured: {e}')

    protocol.emit_progress(94, 'writing the agreement raster')
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
        flood_mod.agreement_rgba(result.agreement[ar0:ar1, ac0:ac1], len(sources),
                       inside=aoi_mask[ar0:ar1, ac0:ac1]),
        agreement_png,
    )
    payload['agreement_tif'] = str(agreement_tif)
    payload['agreement_png'] = str(agreement_png)
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

    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'flood': payload}))
    sys.stdout.flush()
