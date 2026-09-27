"""
The management zones action: several seasons of NDVI over a field, clustered
into three, four and five zones, each partition returned with its polygons.
"""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np

from terra import aoi, protocol

# Acquisitions read at once; see the vegetation health product for the count.
READERS = 8
ZONE_COUNTS = (3, 4, 5)
# Patches smaller than this are merged into the zone around them: a zone an
# applicator cannot follow at working speed is not a zone.
MIN_ZONE_HA = 0.3
# One 10 m cell (terra.imagery.mosaic.PIXEL_M), in hectares.
CELL_HA = 0.01
# ColorBrewer YlGn, light to dark: zone 1, the lowest NDVI, lightest.
YLGN = {
    3: ['#f7fcb9', '#addd8e', '#31a354'],
    4: ['#ffffcc', '#c2e699', '#78c679', '#238443'],
    5: ['#ffffcc', '#c2e699', '#78c679', '#31a354', '#006837'],
}
# A season needs this share of the field's cells with a value to be used.
MIN_SEASON_COVER = 0.5


def _hex_rgb(h: str) -> tuple[int, int, int]:
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def zone_raster(labels: np.ndarray, valid: np.ndarray, grid_shape: tuple[int, int], order: np.ndarray) -> np.ndarray:
    """
    The cells' zones on the grid, 1-based and ordered by NDVI, 0 outside,
    with patches under MIN_ZONE_HA merged into their surroundings.
    """
    from rasterio.features import sieve

    raster = np.zeros(grid_shape, dtype=np.int32)
    rank = np.empty_like(order)
    rank[order] = np.arange(len(order))
    raster[valid] = rank[labels] + 1
    size = max(1, int(round(MIN_ZONE_HA / CELL_HA)))
    # sieve replaces a small patch by its largest neighbour; zero is left as
    # zero by masking it out, so the field's edge is not eaten into.
    return sieve(raster, size=size, mask=raster > 0).astype(np.int32)


def polygons(raster: np.ndarray, grid) -> list[tuple[int, dict[str, Any]]]:
    """One GeoJSON feature per zone, in WGS84, a MultiPolygon of its patches."""
    from rasterio.features import shapes
    from rasterio.warp import transform_geom
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union

    parts: dict[int, list] = {}
    for geom, value in shapes(raster, mask=raster > 0, transform=grid.transform):
        parts.setdefault(int(value), []).append(shape(geom))
    out: list[tuple[int, dict[str, Any]]] = []
    for zone in sorted(parts):
        merged = unary_union(parts[zone])
        out.append((zone, transform_geom(grid.crs, 'EPSG:4326', mapping(merged))))
    return out


def zones(req: protocol.Request, work_dir: Path) -> None:
    from rasterio.warp import transform_bounds

    from terra.imagery import cog, composite, mosaic
    from terra.zones import cluster, seasons

    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    start = str(req.get('start') or '')
    end = str(req.get('end') or '')
    if not start or not end:
        protocol.fail('start and end are required')
    polygon = aoi.polygon_from_geojson(req['polygon_geojson'])
    max_cloud = protocol.request_number(req, 'max_cloud', 60.0)
    earlier = int(protocol.request_number(req, 'earlier_seasons', seasons.EARLIER_SEASONS, int))

    cog.configure()

    def note(msg: str) -> None:
        protocol.emit_progress(-1, msg)

    protocol.emit_progress(2, 'building the grid')
    grid = mosaic.reference_grid(polygon, 0.0)
    inside = mosaic.area_mask(polygon, grid)
    n_inside = int(inside.sum())
    if not n_inside:
        protocol.fail('the area covers no 10 m cell')

    layers: list[np.ndarray] = []
    season_rows: list[dict[str, Any]] = []
    wins = seasons.windows(start, end, earlier)
    for k, (a, b) in enumerate(wins):
        lo = 4 + int(76 * k / len(wins))
        hi = 4 + int(76 * (k + 1) / len(wins))
        protocol.emit_progress(lo, f'searching the season {a} to {b}')
        try:
            found = sorted(mosaic.search_scenes(grid, a, b, max_cloud, seasons.BANDS), key=lambda s: s.date)
        except Exception as e:  # a season the catalogue could not list is one season lost
            note(f'the season {a} to {b} could not be searched ({e})')
            continue
        maps: list[np.ndarray] = []
        done = 0
        with ThreadPoolExecutor(max_workers=READERS) as pool:
            futures = [pool.submit(seasons.ndvi_map, s, grid, inside) for s in found]
            for s, f in zip(found, futures, strict=True):
                try:
                    m = f.result()
                except Exception as e:  # a tile that fails to read is one date lost
                    note(f'{s.date}: not read ({e})')
                    m = None
                if m is not None:
                    maps.append(m)
                done += 1
                protocol.emit_progress(
                    lo + int((hi - lo) * done / max(1, len(found))), f'season {a[:4]}: {done} of {len(found)} acquisitions read'
                )
        row: dict[str, Any] = {'start': a, 'end': b, 'n_scenes': len(found), 'n_clear': len(maps), 'cover': 0.0, 'used': False}
        if maps:
            layer, _count = seasons.season_layer(maps)
            cover = float(np.isfinite(layer[inside]).sum()) / n_inside
            row['cover'] = round(cover, 4)
            if cover >= MIN_SEASON_COVER:
                row['used'] = True
                layers.append(layer)
            else:
                note(
                    f'the season {a} to {b}: {100 * cover:.0f}% of the field has '
                    f'{seasons.MIN_OBS} clear dates; the season is not used'
                )
        season_rows.append(row)

    if len(layers) < 2:
        protocol.fail(
            f'{len(layers)} season(s) had {seasons.MIN_OBS} clear acquisitions over half the field; '
            'zones need at least two. Widen the period or raise the cloud limit.'
        )

    protocol.emit_progress(82, 'clustering')
    stack = np.stack(layers, axis=-1)  # rows, cols, seasons
    valid = inside & np.isfinite(stack).all(axis=-1)
    x = stack[valid]
    z = cluster.standardise(x)
    parts = {c: cluster.fuzzy_c_means(z, c) for c in ZONE_COUNTS}
    suggested = cluster.suggest(parts)

    protocol.emit_progress(92, 'drawing the zones')
    raw_ndvi_mean = x.mean(axis=1)
    lon_min, lat_min, lon_max, lat_max = transform_bounds(grid.crs, 'EPSG:4326', *grid.bounds, densify_pts=21)
    partitions = []
    for c, p in sorted(parts.items()):
        labels = p.u.argmax(axis=1)
        means = np.array([raw_ndvi_mean[labels == i].mean() if (labels == i).any() else np.nan for i in range(c)])
        order = np.argsort(np.nan_to_num(means, nan=np.inf))
        raster = zone_raster(labels, valid, inside.shape, order)
        features = []
        zones_rows = []
        feats = dict(polygons(raster, grid))
        for zone in range(1, c + 1):
            cells = raster == zone
            n = int(cells.sum())
            per_season = [float(np.nanmean(layer[cells])) if n else None for layer in layers]
            row = {
                'zone': zone,
                'area_ha': round(n * CELL_HA, 4),
                'share': round(n / max(1, int((raster > 0).sum())), 4),
                'ndvi_mean': round(float(np.nanmean(stack[cells])), 4) if n else None,
                'season_ndvi': [round(v, 4) if v is not None else None for v in per_season],
                'colour': YLGN[c][zone - 1],
            }
            zones_rows.append(row)
            if zone in feats:
                features.append(
                    {
                        'type': 'Feature',
                        'properties': {'zone': zone, 'zones': c, 'area_ha': row['area_ha'], 'ndvi_mean': row['ndvi_mean']},
                        'geometry': feats[zone],
                    }
                )
        rgba = np.zeros((*raster.shape, 4), dtype=np.uint8)
        for zone in range(1, c + 1):
            rgba[raster == zone] = (*_hex_rgb(YLGN[c][zone - 1]), 235)
        png = work_dir / f'zones_{c}.png'
        composite.write_rgba_png(rgba, png)
        partitions.append(
            {
                'k': c,
                'fpi': round(p.fpi, 4),
                'nce': round(p.nce, 4),
                'iterations': p.iterations,
                'zones': zones_rows,
                'zones_geojson': json.dumps({'type': 'FeatureCollection', 'features': features}),
                'png': str(png),
            }
        )

    result = {
        'extent': {'lon_min': lon_min, 'lat_min': lat_min, 'lon_max': lon_max, 'lat_max': lat_max},
        'seasons': season_rows,
        'n_cells': int(valid.sum()),
        'field_cells': n_inside,
        'fuzziness': cluster.FUZZINESS,
        'percentile': seasons.PERCENTILE,
        'min_zone_ha': MIN_ZONE_HA,
        'suggested_k': suggested,
        'partitions': partitions,
    }
    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'zones': result}))
    sys.stdout.flush()
