"""
The socio-environmental overlap action: one area against every public register
the product reads, and a map of where it meets them.

Each register is read on its own. One that cannot be read is reported with its
reason and the rest still are: a check with the embargo layer missing says so,
where a failed run would say nothing about the other five.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from terra import aoi, protocol

# Longest side of the map, in cells. At 10 m a cell, 20 km; a larger area is
# drawn with coarser cells, since the map shows where and the table how much.
MAP_MAX_CELLS = 2048
MAP_CELL_M = 10.0
M_PER_DEG_LAT = 111_320.0

# Okabe and Ito (2008), distinguishable under the three common colour-vision
# deficiencies. The area itself is drawn in a faint grey, so an area that meets
# nothing still shows where it is.
AREA_RGBA = (200, 200, 200, 70)
COLOURS: dict[str, tuple[int, int, int]] = {
    'car': (240, 228, 66),
    'conservation': (0, 158, 115),
    'indigenous': (0, 114, 178),
    'embargo_icmbio': (204, 121, 167),
    'embargo_ibama': (204, 121, 167),
    'deter': (230, 159, 0),
    'prodes': (213, 94, 0),
}
# Drawn in this order, so the later is on top: clearing over everything else.
DRAW_ORDER = ['car', 'conservation', 'indigenous', 'embargo_icmbio', 'embargo_ibama', 'deter', 'prodes']
OVERLAP_ALPHA = 220
# Half the width below which a strip of the area outside every CAR registration
# is not drawn, in metres: a 30 m strip is a road or a stream between two
# registrations, not a part of the field left unregistered.
CAR_GAP_OPEN_M = 15.0

Reader = Callable[[], tuple[list[dict[str, Any]], bool]]


def _hex(rgb: tuple[int, int, int]) -> str:
    return '#{:02x}{:02x}{:02x}'.format(*rgb)


def read_register(
    rid: str,
    title: str,
    publisher: str,
    reads: list[tuple[str, Reader]],
    row: Callable[[dict[str, Any]], Any],
    area_m,
    to_m,
    not_covered: str = '',
) -> tuple[dict[str, Any], list[Any]]:
    """
    One register's entry in the payload, and its features cut to the area.

    `reads` names each layer the register is read from and how; a register
    with none is not published where the area is, and `not_covered` says why.
    """
    from terra.overlap import geometry

    entry: dict[str, Any] = {
        'id': rid,
        'title': title,
        'publisher': publisher,
        'layers': [name for name, _ in reads],
        'colour': _hex(COLOURS[rid]),
        'status': 'read',
        'note': '',
        'overlap_ha': 0.0,
        'n_features': 0,
        'features': [],
    }
    if not reads:
        entry['status'] = 'not_covered'
        entry['note'] = not_covered
        return entry, []

    cuts: list[geometry.Cut] = []
    failed: list[str] = []
    truncated: list[str] = []
    for name, read in reads:
        try:
            features, cap = read()
        except Exception as e:  # sources.SourceError, or a reply of an unexpected shape
            failed.append(f'{name}: {e}')
            continue
        if cap:
            truncated.append(name)
        cuts.extend(geometry.cut(features, area_m, to_m))

    notes = []
    if failed and len(failed) == len(reads):
        entry['status'] = 'failed'
        entry['note'] = 'not read: ' + '; '.join(failed)
        return entry, []
    if failed:
        notes.append('not read: ' + '; '.join(failed))
    if truncated:
        notes.append(
            f'more features than the {len(truncated)} layer(s) {", ".join(truncated)} return in one reading; '
            'the overlap is a lower bound'
        )
    rows = []
    for c in cuts:
        r = asdict(row(c.properties))
        r['overlap_ha'] = round(c.ha, 4)
        rows.append(r)
    rows.sort(key=lambda r: (-r['overlap_ha'], r['ref']))
    entry['note'] = '; '.join(notes)
    entry['overlap_ha'] = round(geometry.union_ha(cuts), 4)
    entry['n_features'] = len(rows)
    entry['features'] = rows
    return entry, cuts


def draw_map(polygon, parts_lonlat: dict[str, list], out_path: Path) -> dict[str, float]:
    """
    The area and what it meets, on a lon/lat grid, so the extent places it.

    `parts_lonlat` holds each register's parts in lon/lat, and 'car' holds the
    part of the area NO registration covers: a field inside CAR is the common
    case, and what is worth seeing is where it is not.
    """
    from rasterio.features import rasterize
    from rasterio.transform import from_bounds

    from terra.imagery import composite

    lon0, lat0, lon1, lat1 = polygon.bounds
    mid = (lat0 + lat1) / 2
    cell_lat = MAP_CELL_M / M_PER_DEG_LAT
    cell_lon = cell_lat / max(np.cos(np.radians(mid)), 1e-6)
    width = max(1, int(np.ceil((lon1 - lon0) / cell_lon)))
    height = max(1, int(np.ceil((lat1 - lat0) / cell_lat)))
    scale = max(width, height) / MAP_MAX_CELLS
    if scale > 1:
        width = max(1, int(np.ceil(width / scale)))
        height = max(1, int(np.ceil(height / scale)))
    transform = from_bounds(lon0, lat0, lon1, lat1, width, height)

    rgba = np.zeros((height, width, 4), dtype=np.uint8)

    def burn(geoms, colour: tuple[int, int, int, int]) -> None:
        shapes = [(g, 1) for g in geoms if g is not None and not g.is_empty]
        if not shapes:
            return
        mask = rasterize(shapes, out_shape=(height, width), transform=transform, fill=0, all_touched=True, dtype='uint8')
        rgba[mask == 1] = colour

    burn([polygon], AREA_RGBA)
    for rid in DRAW_ORDER:
        burn(parts_lonlat.get(rid, []), (*COLOURS[rid], OVERLAP_ALPHA))
    composite.write_rgba_png(rgba, out_path)
    return {'lon_min': lon0, 'lat_min': lat0, 'lon_max': lon1, 'lat_max': lat1}


def overlap(req: protocol.Request, work_dir: Path) -> None:
    from shapely.ops import transform, unary_union

    from terra.overlap import geometry, sources

    if not req.get('polygon_geojson'):
        protocol.fail('no polygon provided (polygon_geojson required)')
    polygon = geometry.polygonal(aoi.polygon_from_geojson(req['polygon_geojson']))
    if polygon.is_empty:
        protocol.fail('the area has no extent')
    bbox: sources.Bbox = polygon.bounds
    centre = polygon.representative_point()
    to_m = geometry.EqualArea(centre.x, centre.y)
    area_m = geometry.polygonal(to_m(polygon))
    area_ha = float(area_m.area) / geometry.M2_PER_HA
    read_at = datetime.now(UTC).replace(microsecond=0).isoformat().replace('+00:00', 'Z')

    def note(msg: str) -> None:
        protocol.emit_progress(-1, msg)

    session = sources.session()
    states = sources.states_for(bbox)
    in_brazil = bool(states)
    outside = 'the area lies outside Brazil, which this register covers'

    protocol.emit_progress(4, 'reading the biomes under the area (TerraBrasilis)')
    biomes: list[str] | None = []
    if in_brazil:
        try:
            biomes = sources.biomes_under(session, bbox)
        except sources.SourceError as e:
            # Every PRODES biome layer is then read; DETER's coverage is unknown.
            note(f'biomes not read ({e}); every PRODES biome layer is read instead')
            biomes = None

    def wfs(url: str, layer: str, sort_by: str | None = None) -> tuple[str, Reader]:
        return layer, lambda: sources.wfs_features(session, url, layer, bbox, sort_by=sort_by)

    def arcgis(service: str) -> tuple[str, Reader]:
        return service, lambda: sources.arcgis_features(session, service, bbox)

    prodes_biomes = list(sources.PRODES_LAYERS) if biomes is None else [b for b in biomes if b in sources.PRODES_LAYERS]
    deter_biomes = list(sources.DETER_LAYERS) if biomes is None else [b for b in biomes if b in sources.DETER_LAYERS]

    plan = [
        (
            'prodes', 'PRODES yearly deforestation', 'INPE, TerraBrasilis',
            [wfs(sources.TERRABRASILIS, sources.PRODES_LAYERS[b]) for b in prodes_biomes],
            sources.prodes_row, outside,
        ),
        (
            'deter', 'DETER alerts', 'INPE, TerraBrasilis',
            [wfs(sources.TERRABRASILIS, sources.DETER_LAYERS[b]) for b in deter_biomes],
            sources.deter_row,
            outside if not in_brazil else
            f'DETER monitors the Amazon and the Cerrado; the area lies in {", ".join(biomes or []) or "no mapped biome"}',
        ),
        (
            'car', 'CAR property registrations', 'SFB, SICAR',
            [wfs(sources.SICAR, f'sicar:sicar_imoveis_{uf}') for uf in states],
            sources.car_row, outside,
        ),
        (
            'embargo_ibama', 'IBAMA embargoes', 'IBAMA',
            [arcgis(sources.IBAMA_EMBARGO)] if in_brazil else [],
            sources.ibama_embargo_row, outside,
        ),
        (
            'embargo_icmbio', 'ICMBio embargoes', 'ICMBio, published by IBAMA',
            [arcgis(sources.ICMBIO_EMBARGO)] if in_brazil else [],
            sources.icmbio_embargo_row, outside,
        ),
        (
            'indigenous', 'Indigenous lands', 'FUNAI',
            [wfs(sources.FUNAI, sources.FUNAI_LAYER, sort_by='gid')] if in_brazil else [],
            sources.indigenous_row, outside,
        ),
        (
            'conservation', 'Conservation units', 'MMA, CNUC',
            [wfs(sources.MMA, sources.CNUC_LAYER)] if in_brazil else [],
            sources.conservation_row, outside,
        ),
    ]

    layers: list[dict[str, Any]] = []
    parts_m: dict[str, list] = {}
    periods: list[dict[str, Any]] = geometry.prodes_periods([])
    for i, (rid, title, publisher, reads, row, why) in enumerate(plan):
        protocol.emit_progress(8 + int(80 * i / len(plan)), f'reading {title} ({publisher})')
        entry, cuts = read_register(rid, title, publisher, reads, row, area_m, to_m, not_covered=why)
        if entry['status'] == 'failed':
            note(f'{title}: {entry["note"]}')
        layers.append(entry)
        parts_m[rid] = [c.part_m for c in cuts]
        if rid == 'prodes':
            periods = geometry.prodes_periods(cuts)

    protocol.emit_progress(90, 'drawing the map')
    to_lonlat = to_m.inverse
    parts_lonlat = {rid: [transform(to_lonlat, g) for g in parts] for rid, parts in parts_m.items() if rid != 'car'}
    car = next(e for e in layers if e['id'] == 'car')
    if car['status'] == 'read':
        covered = unary_union(parts_m['car']) if parts_m['car'] else None
        gap = area_m.difference(covered) if covered is not None else area_m
        # Opened by CAR_GAP_OPEN_M for the drawing alone: the roads and streams
        # between neighbouring registrations are gaps too, and drawn they hid
        # the gaps a field can have. The hectares in the table are not opened.
        gap = gap.buffer(-CAR_GAP_OPEN_M).buffer(CAR_GAP_OPEN_M)
        parts_lonlat['car'] = [transform(to_lonlat, gap)]
    map_png = work_dir / 'overlap_map.png'
    extent = draw_map(polygon, parts_lonlat, map_png)

    result = {
        'area_ha': round(area_ha, 4),
        'read_at': read_at,
        'extent': extent,
        'biomes': biomes or [],
        'states': [s.upper() for s in states],
        'forest_code_cutoff': geometry.FOREST_CODE_CUTOFF,
        'eudr_cutoff': geometry.EUDR_CUTOFF,
        'layers': layers,
        'periods': periods,
        'map_png': str(map_png),
    }
    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'overlap': result}))
    sys.stdout.flush()
