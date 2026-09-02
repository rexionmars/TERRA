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


def flood_routing(req, work_dir):
    """Route rainfall over the AOI and report depth, speed and arrival.

    A different product from flood_envelope and deliberately a separate action.
    The envelope is static and measures disagreement between DEM products; this
    moves water over one of them and is answered by fields in time.

    A second mode routed a breach hydrograph and has been removed. Not for want
    of hydraulics -- the equations are the same either way -- but because
    nothing could reliably decide WHERE a channel enters a drawn polygon:
    ranking the boundary by accumulated flow finds the outlet, which carries
    every cell upstream of it, and ranking it by how far the water then travels
    finds the outlet too on a short AOI. It can return once the inlet arrives as
    a coordinate the caller gives. Rain needs no such point.
    """
    from terra import aoi
    from terra.flood import envelope as flood_mod
    from terra.flood import routing as route_mod
    from terra.imagery import composite as comp
    from terra.terrain import dem as dem_mod
    from terra.terrain import hand

    cog.configure()

    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])
    if polygon.is_empty:
        protocol.fail('the AOI polygon is empty, so there is no window to read a DEM over')

    # A caller sending the keys of the mode that used to exist expects a
    # different product, and quietly routing rain for them would answer a
    # question they did not ask.
    for gone in ('mode', 'volume_m3', 'peak_minutes'):
        if req.get(gone) is not None:
            protocol.fail(f'{gone!r} is not a parameter of this action. Routing a '
                          f'breach needs an inlet location, and no reliable way to '
                          f'find one from a drawn polygon was found, so the mode was '
                          f'removed rather than left guessing. What remains is '
                          f'rainfall over the area: give rain_mm_h.')

    dem_id = req.get('dem_id') or 'cop30'
    try:
        product = dem_mod.resolve(dem_id)
    except ValueError as e:
        protocol.fail(str(e))

    # One product, not the envelope's four. This is not a disagreement measure,
    # and reading four DEMs to route over one of them would quadruple the read
    # for nothing. Which one was used travels in the payload, because the extent
    # a route produces moves with the DEM exactly as the envelope shows.
    buffer_m = protocol.request_number(req, 'buffer_m', None)
    if buffer_m is None:
        buffer_m = dem_mod.recommended_buffer_m(polygon.bounds)
    elif buffer_m < 0:
        protocol.fail(f'buffer_m is a distance beyond the AOI and cannot be negative, '
                      f'got {buffer_m}')

    minutes = protocol.request_positive(req, 'minutes', 60.0)
    manning = protocol.request_positive(req, 'manning', route_mod.MANNING_DEFAULT)
    snapshots = int(protocol.request_number(req, 'snapshots', 0) or 0)
    rain_mm_h = protocol.request_number(req, 'rain_mm_h', None)
    rain_minutes = protocol.request_number(req, 'rain_minutes', None)
    if not rain_mm_h:
        protocol.fail('rain_mm_h is required: the rainfall rate in millimetres per '
                      'hour to put on every cell of the AOI.')

    protocol.emit_progress(10, f'reading {product.id}')
    z, transform, crs = dem_mod.fetch(polygon, product.collection, buffer_m,
                                      progress=lambda m: protocol.emit_progress(15, m))
    z = np.asarray(z, dtype=float)
    z[z < dem_mod.VOID_BELOW_M] = np.nan
    if np.isnan(z).all():
        protocol.fail(f'{product.id} is void over this AOI, so there is no surface to route on')
    n_void = int(np.isnan(z).sum())
    if n_void:
        # Voids are filled to the surrounding median rather than left as NaN: a
        # NaN cell poisons every flux that touches it and the hole spreads
        # across the domain in a few steps. How many were filled is reported.
        z = np.where(np.isnan(z), float(np.nanmedian(z)), z)

    lat = float(polygon.centroid.y)
    dx, dy = hand.pixel_size_m(lat, abs(transform.a), abs(transform.e))

    # Coarsen before routing, if asked. The explicit scheme costs cells times
    # steps, and halving the cell size roughly quadruples both: the same AOI
    # that routes in a minute at 90 m does not finish in ten at 30 m, which is
    # the difference between a control a user turns and a run they abandon.
    #
    # What it costs is measured rather than assumed. On one confined reach
    # (n=1), refining 60 m to 45 m moved the median peak stage by 1%, the 90th
    # percentile by 3% and the flooded area by 2% -- the geometry of the valley,
    # not the cell size, was setting the answer at that scale.
    resolution_m = protocol.request_number(req, 'resolution_m', None)
    native_m = float(max(dx, dy))
    coarsened_from = None
    if resolution_m and resolution_m > native_m * 1.05:
        from scipy.ndimage import zoom

        factor = native_m / float(resolution_m)
        z = zoom(z, factor, order=1)
        if min(z.shape) < 16:
            protocol.fail(f'resolution_m of {resolution_m:.0f} m leaves a '
                          f'{z.shape[1]} by {z.shape[0]} grid over this AOI, which is '
                          f'too coarse to route on. Ask for a finer cell or a larger AOI.')
        transform = transform * transform.scale(1 / factor, 1 / factor)
        coarsened_from = native_m
        dx, dy = dx / factor, dy / factor

    grid = dem_mod.Grid.of(z, transform, crs)
    n_cells = int(z.size)
    # A ceiling, because the cost is the user's wait and nothing in the request
    # bounds it. Refused with the arithmetic rather than silently coarsened: a
    # run that quietly changed its own resolution would report figures the
    # caller did not ask for.
    if n_cells > 400_000:
        protocol.fail(f'this AOI is {grid.width} by {grid.height} = {n_cells:,} cells at '
                      f'{max(dx, dy):.0f} m, and the explicit solver costs cells times '
                      f'timesteps. Set resolution_m coarser (about '
                      f'{max(dx, dy) * (n_cells / 400_000) ** 0.5:.0f} m for this AOI) '
                      f'or draw a smaller area.')

    protocol.emit_progress(30, 'terrain: filling depressions')
    # Filled and nothing more. The D8 graph and the flow accumulation were
    # computed here only to locate a breach inlet; rain falls everywhere and
    # needs neither, so a run is shorter by that whole chain.
    zf = hand.fill_depressions(z)

    # The scheme is well balanced or the run is not reportable. Checked on the
    # actual bed rather than trusted, because an unbalanced scheme manufactures
    # currents on every slope and each depth below would be that error plus the
    # flow, with nothing in the output to say so.
    residual = route_mod.lake_at_rest_residual(zf, dx, dy)
    if residual > 1e-6:
        protocol.fail(f'the scheme failed its lake-at-rest check on this terrain: a '
                      f'motionless lake developed {residual:.3e} m/s. Depths from '
                      f'such a run are the balancing error plus the flow and are '
                      f'not reported.')

    protocol.emit_progress(45, f'routing {minutes:.0f} min over '
                               f'{grid.width} by {grid.height} cells')
    try:
        result = route_mod.route(
            zf, dx, dy, minutes=minutes, rain_mm_h=rain_mm_h,
            rain_minutes=rain_minutes, manning=manning, snapshots=snapshots,
            progress=lambda m: protocol.emit_progress(60, m),
        )
    except ValueError as e:
        protocol.fail(str(e))

    protocol.emit_progress(85, 'measuring')
    aoi_mask = flood_mod.aoi_reporting_mask(polygon, grid)
    depth = result['peak_depth_m']
    speed = result['peak_speed_ms']
    arrival = result['arrival_s']
    cell_km2 = dx * dy / 1e6

    wet = (depth > route_mod.HMIN) & aoi_mask
    inside_n = int(aoi_mask.sum())
    wet_vals = depth[wet]

    # DOES THE CHANNEL RUN THROUGH THIS AREA, OR ONLY CLIP IT?
    #
    # A drawn AOI need not contain the valley it overlaps. Where it catches a
    # corner the routing is still correct, but the reach inside the polygon is a
    # fragment, the flow hugs one edge, and every figure below describes that
    # fragment. The map shows it plainly and a reader who is not looking at the
    # map cannot see it at all, so it is measured: the share of flooded cells
    # lying on the AOI's own boundary ring. A channel crossing an area touches
    # that ring twice, where it enters and where it leaves.
    from scipy.ndimage import binary_erosion

    interior = binary_erosion(aoi_mask, np.ones((3, 3), bool), border_value=0)
    rim = aoi_mask & ~interior
    rim_fraction = round(int((wet & rim).sum()) / int(wet.sum()), 4) if wet.any() else 0.0

    payload = {
        'dem_id': product.id,
        'minutes': float(minutes),
        'manning': float(manning),
        'steps': int(result['steps']),
        'lake_at_rest_residual_ms': float(residual),
        'resolution_m': round(float(max(dx, dy)), 1),
        'coarsened_from_m': round(coarsened_from, 1) if coarsened_from else None,
        'void_cells_filled': n_void,
        'grid': dem_mod.payload_grid(grid),
        'cell_size_m': {'x': float(dx), 'y': float(dy)},
        'aoi': {
            'cells': inside_n,
            'area_km2': round(inside_n * cell_km2, 4),
            'flooded_cells': int(wet.sum()),
            'flooded_km2': round(int(wet.sum()) * cell_km2, 4),
            'flooded_fraction': round(float(wet.sum()) / inside_n, 4) if inside_n else 0.0,
            'on_boundary_fraction': rim_fraction,
        },
        'depth_m': _spread(wet_vals),
        'speed_ms': _spread(speed[wet]),
        'arrival_min': _spread(arrival[wet] / 60.0),
        'rain': {'mm_h': float(rain_mm_h), 'minutes': float(rain_minutes or minutes)},
        'volume': {
            'in_m3': round(result['volume_in_m3'], 1),
            'stored_m3': round(result['volume_stored_m3'], 1),
            'out_m3': round(result['volume_out_m3'], 1),
            'clipped_m3': round(result['volume_clipped_m3'], 1),
            'left_fraction': (round(result['volume_out_m3'] / result['volume_in_m3'], 4)
                              if result['volume_in_m3'] else 0.0),
        },
    }

    payload['assumptions'] = {
        'water': (
            'Clear water over a fixed bed, depth-averaged, with one Manning n '
            f'of {manning} for the whole domain, and no infiltration: every '
            'millimetre that falls stays on the surface. A real catchment '
            'absorbs some of it, so the depths here are an upper bound on what '
            'the same rain would leave.'
        ),
        'terrain': (
            f'{product.id} at {max(dx, dy):.0f} m'
            + (f', coarsened from {coarsened_from:.0f} m' if coarsened_from else '')
            + f', read {buffer_m:.0f} m beyond the AOI, with its closed '
            'depressions filled before routing. The filling is not cosmetic: a '
            'solver takes a sampling artefact in a channel literally, water runs '
            'in and stops, and the run reports a pond level instead of a flow. '
            'Every figure above is taken over the cells inside the AOI polygon; '
            'the buffer exists so the flow arrives correctly and is not '
            'reported on.'
        ),
        'boundary': (
            'Every edge is free outflow, and one-way: water reaching a boundary '
            f'leaves, and {payload["volume"]["left_fraction"] * 100:.0f}% of what '
            'fell had left by the end of the run. A domain that stores '
            'everything it was given never reached an outlet, and its depths are '
            'a filling level rather than a flow.'
        ),
        'aoi_fit': (
            f'{rim_fraction * 100:.0f}% of the flooded cells lie on the AOI '
            'boundary itself. A channel crossing an area touches that ring '
            'twice, where it enters and where it leaves, so a low share means '
            'the reach is inside the polygon. A high one means the polygon clips '
            'the valley rather than holding it: the routing is still correct, '
            'but what is reported is the fragment that fell inside the drawing.'
        ),
    }

    # Rasters, on the same footing the envelope puts them: the GeoTIFF over the
    # whole computed window, the PNG clipped to the AOI so the map overlay
    # covers the ground the figures are measured over and no more.
    depth_tif = Path(work_dir) / 'flood_depth.tif'
    with rasterio.open(
        depth_tif, 'w', driver='GTiff', width=grid.width, height=grid.height,
        count=1, dtype='float32', crs=grid.crs, transform=grid.transform,
        nodata=0.0, compress='deflate',
    ) as dst:
        dst.write(depth.astype('float32'), 1)

    rows = np.flatnonzero(aoi_mask.any(axis=1))
    cols = np.flatnonzero(aoi_mask.any(axis=0))
    ar0, ar1 = int(rows[0]), int(rows[-1]) + 1
    ac0, ac1 = int(cols[0]), int(cols[-1]) + 1
    dmax = float(np.percentile(wet_vals, 98)) if wet_vals.size else 1.0
    depth_png = Path(work_dir) / 'flood_depth.png'
    comp.write_rgba_png(
        route_mod.depth_rgba(depth[ar0:ar1, ac0:ac1], dmax,
                             inside=aoi_mask[ar0:ar1, ac0:ac1]),
        depth_png,
    )
    payload['depth_tif'] = str(depth_tif)
    payload['depth_png'] = str(depth_png)
    payload['depth_png_max_m'] = round(dmax, 3)
    payload['extent'] = comp.extent_from_profile({
        'transform': rasterio.windows.transform(
            rasterio.windows.Window(ac0, ar0, ac1 - ac0, ar1 - ar0), grid.transform
        ),
        'height': ar1 - ar0,
        'width': ac1 - ac0,
        'crs': grid.crs,
    })

    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'flood_routing': payload}))
    sys.stdout.flush()


def _spread(values):
    """Median and the range that matters, or nulls when nothing is wet."""
    v = np.asarray(values, dtype=float)
    v = v[np.isfinite(v)]
    if v.size == 0:
        return {'median': None, 'p90': None, 'max': None}
    return {'median': round(float(np.median(v)), 3),
            'p90': round(float(np.percentile(v, 90)), 3),
            'max': round(float(v.max()), 3)}
