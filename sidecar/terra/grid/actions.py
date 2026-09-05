"""
The questions the shell can ask about the electrical system.

Siblings of terra/energy/actions.py, not extensions of it. Each answers about
the system a site would join; none answers about the site's resource, and none
appends itself to an action that does. A caller weighing a project asks both
slices and weighs the two answers, which is a judgement this code does not make
for them.

EVERY ACTION HERE NEEDS THE STORE, AND THAT IS BY DESIGN. There is no
file-reading fallback: answering a plant-and-window question has exactly one
implementation, so it cannot drift into two. An installation without the store
gets a failure that says what is missing, not a slower answer that might
disagree with the fast one.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from terra import protocol
from terra.protocol import Request


def _window(req: Request, conn, dataset: str = 'pv_curtailment_detail'):
    """
    The window an action reads over: what the caller asked for, bounded by what
    the store holds.

    THE RECORD'S WINDOW, NOT THE RESOURCE'S. terra/energy runs on a decade of
    NASA POWER; this record begins in 2024-04. An action that silently accepted
    a 2016 request would return a fraction of a window it reported as whole.
    """
    from terra.grid import store

    held = [c for c in store.coverage(conn) if c['dataset'] == dataset]
    if not held:
        protocol.fail(
            f'the store holds no {dataset!r}. Load it with '
            f'terra.grid.store.load_period before asking this question.')
    lo, hi = f"{held[0]['from']}-01", f"{held[0]['to']}-28"
    start = max(str(req.get('start') or lo), lo)
    end = min(str(req.get('end') or hi), hi)
    if start > end:
        protocol.fail(
            f'the requested window {start}..{end} lies outside the record, '
            f'which runs {lo}..{hi}')
    return start, end, {'requested': [req.get('start'), req.get('end')],
                        'record': [lo, hi], 'used': [start, end]}


def _aoi(req: Request):
    if not req.get('polygon_geojson'):
        protocol.fail('this action needs polygon_geojson')
    return req['polygon_geojson']


def grid_curtailment(req: Request, work_dir: Path) -> None:
    """
    What the operator withheld at the plants inside an AOI, and why.

    Returns nothing rather than zero for an AOI with no metered plant: zero
    would read as 'nothing was curtailed here' where the truth is 'nothing here
    is measured'.
    """
    from terra.grid import curtailment, store

    aoi = _aoi(req)
    protocol.emit_progress(10, 'opening the grid store')
    with store.connect(req) as conn:
        start, end, window = _window(req, conn)
        protocol.emit_progress(30, 'totals')
        summary = curtailment.curtailment_context(conn, aoi, start, end)
        if summary is None:
            protocol.emit_progress(100, 'no metered plant in this AOI')
            sys.stdout.write(json.dumps({'grid_curtailment': {
                'window': window, 'summary': None,
                'note': (
                    'No plant of the operational record lies inside this AOI. '
                    'That is not a curtailment of zero; it is an absence of '
                    'measurement, and a neighbour\'s figure is not borrowed '
                    'here because the record cannot say it applies.'),
            }}, default=str))
            return
        protocol.emit_progress(50, 'by reason')
        reasons = curtailment.by_reason(conn, aoi, start, end)
        protocol.emit_progress(65, 'by hour')
        hours = curtailment.by_hour(
            conn, aoi, start, end,
            utc_offset_hours=protocol.request_number(req, 'utc_offset', -3.0))
        protocol.emit_progress(80, 'by month')
        months = curtailment.by_month(conn, aoi, start, end)
        protocol.emit_progress(90, 'by plant')
        plants = curtailment.by_plant(
            conn, aoi, start, end,
            limit=int(protocol.request_positive(req, 'plant_limit', 50)))

    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({
        'grid_curtailment': {
            'window': window,
            'summary': summary,
            # Reported apart and never summed into a score. The reason split
            # says whether the constraint would follow this project to another
            # site; the hourly profile says when the loss falls; the per-plant
            # table says how much of the aggregate is one large neighbour.
            'by_reason': reasons,
            'by_hour': hours,
            'by_month': months,
            'by_plant': plants,
        }
    }, default=str))


def grid_congestion(req: Request, work_dir: Path) -> None:
    """
    The transmission network within reach of an AOI, and what the plants
    already on it experience.

    The two are reported side by side and never combined. Distance says whether
    a connection is plausible; the curtailment at the plants already connected
    says what a connection would be worth, and only the second is evidence
    about capacity.
    """
    from terra.grid import congestion, curtailment, store

    radius = float(req.get('search_radius_km') or 100.0)
    protocol.emit_progress(10, 'opening the grid store')
    with store.connect(req) as conn:
        protocol.emit_progress(35, 'transmission register')
        reach = congestion.connection_context(conn, _aoi(req), max_km=radius)
        start, end, window = _window(req, conn)
        protocol.emit_progress(70, 'curtailment at connected plants')
        experienced = curtailment.curtailment_context(
            conn, _aoi(req), start, end)

    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({
        'grid_congestion': {
            'connection': reach,
            'curtailment_at_connected_plants': experienced,
            'window': window,
            'note': (
                'Proximity and curtailment are reported apart and must not be '
                'summed into a score. A site 1.3 km from a 440 kV line rated '
                '2,664 MVA can still lose 14 percent of its output, because '
                'the binding constraint is upstream of the connection.'
            ),
        }
    }, default=str))


def grid_figure(req: Request, work_dir: Path) -> None:
    """
    One analysis of the published series, computed over the store.

    ONE ACTION AND NOT TWELVE. They share the store, the window, the table
    shape and the transport, and differ only in which module they call -- the
    same argument that made terra/registry.py a table of dotted paths rather
    than 55 imports written by hand.

    THE TABLES ARE THE RESULT. The interface draws them at its own type scale;
    it is not sent a picture. The paper figure is 183 mm at 7 pt, and
    frontend/src/lib/figure.ts records why that does not survive a screen --
    about 7.3 px in a 540 px panel, under the 9 px floor the interface holds in
    twenty-one places. Returning the numbers also makes the port checkable
    against the research's own CSVs, which a bitmap never could.

    THE CAVEATS TRAVEL WITH IT. Four of the twelve retire an earlier reading,
    and a caller shown Fig. 10 without Fig. 12 is reading a result the series
    itself demoted to one robustness test in three.
    """
    import importlib

    from terra.grid import store
    from terra.grid.figures.spec import FIGURES

    number = int(protocol.request_positive(req, 'figure', 0, cast=int))
    spec = FIGURES.get(number)
    if spec is None:
        protocol.fail(
            f'figure {number} is not one this application computes; '
            f'it has {", ".join(str(n) for n in sorted(FIGURES))}')

    aoi = req.get('polygon_geojson')
    if spec.scope == 'site' and not aoi:
        protocol.fail(
            f'figure {number} is read over an area and none was given')
    if spec.scope == 'system' and aoi:
        # Refused rather than ignored. A system figure answered over a polygon
        # would be a different quantity under the same name, and silently
        # dropping the polygon would let a caller believe it had been honoured.
        protocol.fail(
            f'figure {number} is about the system and cannot be read over an '
            f'area; it would be a different quantity under the same name')

    module = importlib.import_module(f'terra.grid.figures.{spec.module}')

    protocol.emit_progress(10, 'opening the grid store')
    with store.connect(req) as conn:
        for dataset in spec.needs:
            held = [c for c in store.coverage(conn) if c['dataset'] == dataset]
            if not held:
                protocol.fail(
                    f'figure {number} reads {dataset!r} and the store holds '
                    f'none of it')
        protocol.emit_progress(30, 'reading the record')
        kw: dict[str, Any] = {}
        if req.get('start'):
            kw['start'] = str(req['start'])
        if req.get('end'):
            kw['end'] = str(req['end'])
        if spec.scope == 'site':
            kw['aoi'] = aoi
        frames = module.read(conn, **kw)

    protocol.emit_progress(70, 'analysing')
    out = module.analyse(frames)

    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({
        'grid_figure': {
            'number': spec.number,
            'title': spec.title,
            'scope': spec.scope,
            'supersedes': list(spec.supersedes),
            'caveats': list(spec.caveats),
            'headline': out.get('headline'),
            'integrity': out.get('integrity'),
            # One entry per panel, in the shape terra's own tables use:
            # columns and rows, so the interface draws and the research pack
            # exports from the same object.
            'tables': {
                name: _table(frame) for name, frame in out['tables'].items()
            },
        }
    # allow_nan=False, and it is not a preference.
    #
    # Python writes a float NaN as the bare token NaN, which is NOT JSON: the Go
    # decoder answers "invalid character 'N' looking for beginning of value" and
    # the whole run fails at the transport with a message about nothing that
    # went wrong. A plant with no coordinate produced one -- 432 of them carry
    # none, because ANEEL writes an absent coordinate as 0.0 and the loader
    # stores that as no geometry.
    #
    # Refusing here rather than emitting it means a missed conversion fails in
    # Python, next to the frame that holds it, instead of a decade downstream in
    # a different language.
    }, default=str, allow_nan=False))


def _table(frame) -> dict:
    """
    One panel as columns and rows, with every absent value as null.

    astype(object) FIRST, and that is the whole of it. `frame.where(cond, None)`
    on a float column keeps the column float, so the None becomes NaN and
    nothing has changed -- the same trap the loader in store.py records for
    Series.map, arriving through a different door for the fourth time in this
    slice. Object dtype is what lets None stay None.
    """
    import pandas as pd

    safe = frame.astype(object).where(pd.notna(frame), None)
    return {
        'columns': [str(c) for c in frame.columns],
        'rows': safe.values.tolist(),
    }



def grid_plants(req: Request, work_dir: Path) -> None:
    """
    The plant register as a layer, for a map that has nothing on it.

    THE ONLY ACTION HERE THAT DOES NOT TAKE A WINDOW OR AN AOI. Every other one
    answers about a polygon over a period; this one exists so the polygon can
    be drawn at all. A register is not a reading, so it carries no window: it
    says where the plants are, not what happened to them.

    An AOI IS ACCEPTED AND ONLY NARROWS. Passing one clips the register to its
    neighbourhood, which is what a caller already looking at a place wants; it
    does not turn this into a question about that place. The distinction
    matters because grid_curtailment over the same polygon answers about the
    plants INSIDE it, and this answers about the plants NEAR what is on screen.
    """
    from terra.grid import store

    bbox = req.get('bbox')
    if bbox is None and req.get('polygon_geojson'):
        # The AOI's own envelope, padded, so the layer covers the neighbours a
        # reader is deciding between and not only the polygon already drawn.
        pad = float(req.get('pad_degrees') or 0.25)
        xs, ys = [], []
        for ring in req['polygon_geojson'].get('coordinates') or []:
            for pt in ring:
                xs.append(float(pt[0]))
                ys.append(float(pt[1]))
        if xs:
            bbox = [min(xs) - pad, min(ys) - pad,
                    max(xs) + pad, max(ys) + pad]

    kinds = req.get('kinds')
    if isinstance(kinds, str):
        kinds = [kinds]

    protocol.emit_progress(20, 'opening the grid store')
    with store.connect(req) as conn:
        protocol.emit_progress(50, 'reading the register')
        layer = store.register_geojson(
            conn, bbox=bbox, kinds=kinds,
            limit=int(protocol.request_positive(req, 'limit', 40000,
                                                cast=int)))

    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({
        'grid_plants': {
            'geojson': layer,
            'counts': layer['counts'],
            'bbox': bbox,
            # Said with the layer because it decides how it must be read: the
            # register holds 18,639 located photovoltaic enterprises and the
            # operational record covers 558 of them. An area drawn over any of
            # the rest returns nothing, and the map is the only place that can
            # warn of it before the run.
            'note': (
                'A point is one enterprise as ANEEL registers it, not a '
                'footprint: a 40 MW array over a square kilometre is one dot. '
                'Only the metered plants can be answered about by the other '
                'actions in this slice.'
            ),
        }
    }, default=str, allow_nan=False))



def grid_network(req: Request, work_dir: Path) -> None:
    """
    The transmission network as a layer, sibling of grid_plants.

    SEPARATE FROM THE REGISTER AND NOT FOLDED INTO IT, because the two cost
    very differently and are wanted at different moments. The register is 7 MB
    and answers "what can be asked about"; the network is 1 MB and answers "what
    could this ground reach". A caller looking at one does not always want the
    other, and one action returning both would make the cheap layer wait for the
    expensive one.

    LIKE grid_plants, IT TAKES NO WINDOW. A register is not a reading. What it
    says is where the network is, not what happened on it, and an AOI only
    narrows the extent rather than turning it into a question about that place.
    """
    from terra.grid import store

    bbox = req.get('bbox')
    if bbox is None and req.get('polygon_geojson'):
        pad = float(req.get('pad_degrees') or 1.0)
        xs, ys = [], []
        for ring in req['polygon_geojson'].get('coordinates') or []:
            for pt in ring:
                xs.append(float(pt[0]))
                ys.append(float(pt[1]))
        if xs:
            bbox = [min(xs) - pad, min(ys) - pad,
                    max(xs) + pad, max(ys) + pad]

    protocol.emit_progress(20, 'opening the grid store')
    with store.connect(req) as conn:
        protocol.emit_progress(50, 'reading the network register')
        layer = store.network_geojson(
            conn, bbox=bbox,
            min_kv=float(req.get('min_kv') or 0.0))

    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'grid_network': layer},
                                default=str, allow_nan=False))


def grid_coverage(req: Request, work_dir: Path) -> None:
    """
    What the store holds, and which revision of it.

    Not a convenience. The record is revised in batches -- ONS rewrote every
    month of 2025-01..2026-03 across four days -- so every figure this slice
    returns is a figure about one revision, and a caller comparing two runs has
    no way to know they read the same data unless something reports it.
    """
    from terra.grid import store

    with store.connect(req) as conn:
        held = store.coverage(conn)
        with conn.cursor() as cur:
            cur.execute('SELECT count(*), count(geom) FROM br.plant')
            plants, located = cur.fetchone()
            cur.execute('SELECT count(*) FROM br.substation')
            substations = cur.fetchone()[0]
            cur.execute('SELECT count(*) FROM br.transmission_line '
                        'WHERE in_service')
            lines = cur.fetchone()[0]
            cur.execute('SELECT count(*), count(*) FILTER (WHERE identical) '
                        'FROM br.load_conflict')
            conflicts, identical = cur.fetchone()

    sys.stdout.write(json.dumps({
        'grid_coverage': {
            'datasets': held,
            'plants': {'registered': plants, 'with_geometry': located},
            'network': {'substations': substations, 'lines_in_service': lines},
            'load_conflicts': {'total': conflicts, 'identical': identical,
                               'note': (
                                   'Instants where one plant had two rows. The '
                                   'first was kept; br.load_conflict records '
                                   'every choice.')},
        }
    }, default=str))
