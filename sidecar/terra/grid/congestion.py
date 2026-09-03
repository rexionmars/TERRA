"""
The transmission network a site would have to reach, and how far away it is.

WHAT SITING DOES NOT ASK. terra/energy/siting.py classifies ground by slope and
land cover: whether a plant could physically stand there. A site that passes
every one of those tests and sits 80 km from the nearest bus is not a site, and
no suitability class says so, because distance to a bus is a property of the
whole site and of a network outside it rather than of any pixel in it.

PROXIMITY IS NOT ACCESS, AND THIS SLICE KEEPS THE TWO APART. A site 1.3 km from
a 440 kV line rated 2,664 MVA can still be curtailed 14 percent of its output,
because the constraint is upstream of the connection. curtailment.py answers
that separately and this module does not fold it in.
"""

from __future__ import annotations


def attachment(conn, aoi_geojson):
    """
    Where the plants of this AOI actually attach to the network, as the
    operator states it.

    NOT THE NEAREST SUBSTATION, AND THAT IS THE WHOLE POINT. Sol do Cerrado's
    array sits 9.01 km from a bus named JAIBA, and the nearest-substation query
    answers `JAIBA 500 kV` -- because ONS publishes the 500, 230 and 138 kV
    buses of that substation at ONE coordinate, so a distance ordering breaks
    the tie by whichever row the planner reached first. The plant connects at
    MGJAB-230-A, which is the 230 kV bus. Same name, same point, wrong voltage,
    and every headroom figure computed from it is about the wrong circuit.

    THE ATTACHMENT IS PUBLISHED AND DOES NOT HAVE TO BE INFERRED. ONS's
    capacity-factor register names the connection point of every unit it
    meters, and br.ons_unit holds it. So this reads the attachment rather than
    guessing it from proximity, and the two are returned side by side and never
    merged: distance says whether reaching the network is plausible for ground
    that has no plant, and this says where the ground that HAS one is already
    joined.

    THE PATH IS THE OPERATOR'S OWN, NOT A NAME MATCH. AOI to plant is ANEEL's
    coordinate; plant to cluster is derived from the record; cluster to id_ons
    is the pairing ONS itself writes on every curtailment row. Matching
    br.ons_unit by cluster NAME instead would join 82 of 95 clusters and would
    be a string comparison standing in for an identifier that exists.

    Returns an empty list where br.ons_unit was never loaded, because an
    installation without that register is missing a fact, not holding a
    different one.
    """
    import json

    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('br.ons_unit')")
        if cur.fetchone()[0] is None:
            return []
        cur.execute(
            """
            WITH aoi AS (SELECT ST_GeomFromGeoJSON(%s) AS g),
            -- The clusters whose plants stand on this ground.
            mine AS (
                SELECT DISTINCT pc.cluster_key
                FROM br.plant p
                JOIN br.plant_cluster pc USING (ceg_core), aoi
                WHERE p.geom IS NOT NULL AND ST_Intersects(p.geom, aoi.g)),
            -- The operator's own name for them.
            ids AS (
                SELECT DISTINCT c.id_ons
                FROM br.pv_curtail c JOIN mine USING (cluster_key))
            SELECT u.id_ons, u.name, u.connection_code, u.connection_name,
                   u.capacity_mw, u.kind,
                   ST_Distance(u.geom_connection::geography,
                               (SELECT g FROM aoi)::geography) / 1000.0 AS km,
                   -- The EPE bus, resolved by POINT AND VOLTAGE. Geometry
                   -- alone cannot separate three buses published at one
                   -- coordinate; the voltage is in the connection code, and
                   -- letting the candidates at that point disambiguate is
                   -- safer than parsing it -- RSOSO269 is Osorio 2 at 69 kV,
                   -- not a bus at 269 kV, and two code shapes are in use
                   -- (MGJAB-230-A and MGFCSQ138-A).
                   b.bus, b.name AS substation, b.voltage_kv
            FROM br.ons_unit u
            JOIN ids USING (id_ons)
            LEFT JOIN LATERAL (
                SELECT s.bus, s.name, s.voltage_kv
                FROM br.substation s
                WHERE s.geom IS NOT NULL
                  AND ST_DWithin(u.geom_connection::geography,
                                 s.geom::geography, 1000)
                ORDER BY (u.connection_code LIKE '%%' || s.voltage_kv::text || '%%'
                          OR u.connection_name LIKE '%%' || s.voltage_kv::text || '%%')
                         DESC,
                         ST_Distance(u.geom_connection::geography,
                                     s.geom::geography)
                LIMIT 1) b ON true
            ORDER BY u.capacity_mw DESC NULLS LAST
            """, (json.dumps(aoi_geojson),))
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]

    out = []
    for r in rows:
        out.append({
            'id_ons': r['id_ons'],
            'entity': r['name'],
            'point_code': r['connection_code'],
            'point_name': (r['connection_name'] or '').strip(),
            'capacity_mw': r['capacity_mw'],
            'kind': r['kind'],
            'distance_km': (None if r['km'] is None else round(r['km'], 2)),
            'bus': r['bus'],
            'substation': (r['substation'] or '').strip() or None,
            'voltage_kv': r['voltage_kv'],
            # True where the code or name carries the bus's own voltage. 221 of
            # the 223 units that resolve to a substation are confirmed this
            # way; the two that are not resolved by distance alone and may name
            # the wrong voltage level of the right substation.
            'voltage_confirmed': bool(
                r['voltage_kv'] is not None
                and (str(int(r['voltage_kv'])) in (r['connection_code'] or '')
                     or str(int(r['voltage_kv'])) in (r['connection_name'] or ''))),
        })
    return out



def neighbours(conn, aoi_geojson, max_km: float = 30.0, limit: int = 6):
    """
    The connection points the plants AROUND this ground attach to.

    THE QUESTION GROUND WITH NO PLANT ACTUALLY HAS. attachment() answers where
    the plants inside an AOI are joined, which for an AOI drawn over an
    existing array is a lookup: the reader can see the plant. The AOI that
    needs answering is the empty one -- someone choosing where to build -- and
    for that one attachment() is empty and proximity is all that remains.

    Proximity is the weaker half and it was the only half offered. Over one
    bare polygon east of Jaiba the reading said "nearest bus 14.9 km" while
    three connection points sat within 8 km, unmentioned: MGJAB-230-A at 4.9,
    MGJAB-138-A at 7.5, MGJBQ-138-A at 7.8. The strong answer was already in
    the store.

    IT IS THE NEIGHBOUR'S ATTACHMENT AND NOT A PREDICTION OF THIS GROUND'S, and
    every caller has to carry that. Where a plant would actually connect is an
    access opinion the operator issues and does not publish; what this says is
    that the plants near here enter the network at these points, and that a
    project here would be asking to join the same part of the system. The
    distance is measured from the AOI to the PLANT, not to the point: it is a
    statement about which neighbours are near, and their point may be further
    away than they are.

    Ordered by distance and capped, because a radius over a dense corridor
    returns a list nobody reads and the nearest few are the ones a siting
    decision is actually between.
    """
    import json

    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('br.ons_unit')")
        if cur.fetchone()[0] is None:
            return []
        cur.execute(
            """
            WITH aoi AS (SELECT ST_GeomFromGeoJSON(%s) AS g),
            near AS (
                SELECT u.id_ons, u.name, u.connection_code, u.connection_name,
                       u.capacity_mw, u.kind,
                       min(ST_Distance(p.geom::geography,
                                       (SELECT g FROM aoi)::geography)) / 1000.0
                           AS km
                FROM br.plant p
                JOIN br.plant_cluster pc USING (ceg_core)
                -- By name, which is the only key these two share:
                -- br.plant_cluster is derived from the detail record and keys
                -- on the cluster's own name, while br.ons_unit keys on id_ons.
                -- 82 of the 95 clusters match; the rest are absent rather than
                -- wrong, and an absent neighbour understates the list.
                JOIN br.ons_unit u
                     ON upper(btrim(u.name)) = upper(btrim(pc.cluster_name)),
                     aoi
                WHERE p.geom IS NOT NULL
                  AND ST_DWithin(p.geom::geography, aoi.g::geography, %s)
                GROUP BY 1, 2, 3, 4, 5, 6
            )
            SELECT n.*, b.bus, b.name AS substation, b.voltage_kv
            FROM near n
            LEFT JOIN LATERAL (
                SELECT s.bus, s.name, s.voltage_kv
                FROM br.substation s, br.ons_unit u2
                WHERE u2.id_ons = n.id_ons
                  AND s.geom IS NOT NULL
                  AND ST_DWithin(u2.geom_connection::geography,
                                 s.geom::geography, 1000)
                ORDER BY (n.connection_code LIKE '%%' || s.voltage_kv::text || '%%'
                          OR n.connection_name LIKE '%%' || s.voltage_kv::text || '%%')
                         DESC,
                         ST_Distance(u2.geom_connection::geography,
                                     s.geom::geography)
                LIMIT 1) b ON true
            ORDER BY n.km
            LIMIT %s
            """, (json.dumps(aoi_geojson), float(max_km) * 1000.0, int(limit)))
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]

    out = []
    for r in rows:
        out.append({
            'id_ons': r['id_ons'],
            'entity': r['name'],
            'point_code': r['connection_code'],
            'point_name': (r['connection_name'] or '').strip(),
            'capacity_mw': (None if r['capacity_mw'] is None
                            else float(r['capacity_mw'])),
            'kind': r['kind'],
            # From the AOI to the nearest PLANT of this entity, not to its
            # connection point. Which neighbours are near is the question;
            # where their point is, is the next line.
            'distance_km': round(float(r['km']), 2),
            'bus': r['bus'],
            'substation': (r['substation'] or '').strip() or None,
            'voltage_kv': (None if r['voltage_kv'] is None
                           else float(r['voltage_kv'])),
        })
    return out


def _first_seen(values):
    """
    The values in the order they arrive, without repeats.

    dict.fromkeys would do it in one line and hides what is load-bearing: the
    ORDER is the caller's and the deduplication is incidental. Two neighbours
    can share a bus -- Sol do Cerrado and Jaiba V both sit on 3389 -- and the
    headroom of that bus is asked once, at the distance of whichever of them is
    nearer.
    """
    seen = set()
    out = []
    for v in values:
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out

def bus_headroom(conn, bus: int):
    """
    What leaves a bus, against what is already attached to it.

    REPORTED, NEVER SCORED, and the measurement says why: across the 29
    connection points where both quantities are known, the correlation between
    local occupancy and the curtailment actually suffered is -0.025. Barreiras
    II carries 350 MW on 3,475 MVA of line -- 10 percent -- and the plants
    there lose 37 percent of their output. Local headroom does not explain the
    loss, because the binding constraint is upstream of the bus.

    So a caller that adds these two into a suitability number is asserting a
    relationship the record does not contain. They belong side by side.

    capacity_mva is null on 41 percent of lines in service; a null total here
    is an unpublished rating, never a rating of zero.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) AS lines_in_service,
                   sum(capacity_mva) AS capacity_mva,
                   count(capacity_mva) AS lines_rated
            FROM br.transmission_line
            WHERE in_service AND (bus_from = %s OR bus_to = %s)
            """, (bus, bus))
        n, mva, rated = cur.fetchone()
        cur.execute(
            """
            SELECT count(*), sum(capacity_mw)
            FROM br.ons_unit u
            JOIN br.substation s
              ON ST_DWithin(u.geom_connection::geography, s.geom::geography, 1000)
            WHERE s.bus = %s
              AND (u.connection_code LIKE '%%' || s.voltage_kv::text || '%%'
                   OR u.connection_name LIKE '%%' || s.voltage_kv::text || '%%')
            """, (bus,))
        units, attached = cur.fetchone()
    return {
        'bus': bus,
        'lines_in_service': n,
        'lines_with_published_rating': rated,
        'line_capacity_mva': None if mva is None else round(float(mva), 1),
        'units_attached': units,
        'attached_mw': None if attached is None else round(float(attached), 1),
        'note': (
            'Occupancy and curtailment are reported apart and must not be '
            'combined. Their correlation over the points where both are known '
            'is -0.025: a bus at 10 percent occupancy can still curtail 37 '
            'percent of what it carries, because the constraint is upstream.'
        ),
    }


def connection_context(conn, aoi_geojson, max_km: float = 100.0):
    """
    How far an AOI is from somewhere its power could enter the network.

    WHAT SITING DOES NOT ASK. terra/energy/siting.py answers whether a plant
    could physically stand on this ground -- slope, land cover. A site that
    passes every one of those tests and sits 80 km from the nearest 230 kV bus
    is not a site, and nothing in the suitability classes says so.

    MEASURED FROM THE AOI, NOT FROM ITS CENTROID, so the answer is the distance
    from the nearest ground the plant could occupy rather than from a point
    that may be nowhere near the buildable part.

    DISTANCE TO A LINE IS A LOWER BOUND, AND KNOWABLY SO. ONS publishes a
    line's terminals and its length, never its route, so the stored geometry is
    the segment between the terminals. Measured against the published lengths,
    the real route is 7.7 percent longer than its segment at the median and
    40.8 percent at the ninetieth percentile -- so a segment distance is short,
    by a factor this response carries rather than leaves to be discovered.

    A CONNECTION IS NOT A GRANT OF CAPACITY. Proximity is necessary and nowhere
    near sufficient: the plants already connected to these buses are curtailed
    a third of the time, which is what curtailment_context reports and what
    this deliberately does not fold in.
    """
    import json

    # Read FIRST and reported apart. Where the AOI already holds a metered
    # plant this is the answer to "which bus", and the proximity figures below
    # are context; where it holds none, this is empty and proximity is all
    # there is. Merging them would let a 500 kV bus 9 km away stand in for the
    # 230 kV bus the plant is actually wired to.
    joined = attachment(conn, aoi_geojson)
    # Only where this ground has none of its own. An AOI over an existing array
    # already knows where it is joined, and listing the neighbours beside that
    # would offer a weaker claim next to a stronger one under one heading.
    nearby = [] if joined else neighbours(conn, aoi_geojson)

    geom = json.dumps(aoi_geojson)
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH aoi AS (SELECT ST_GeomFromGeoJSON(%s) AS g)
            SELECT s.name, s.voltage_kv, s.uf, s.subsystem,
                   ST_Distance(s.geom::geography,
                               (SELECT g FROM aoi)::geography) / 1000.0 AS km
            FROM br.substation s, aoi
            WHERE ST_DWithin(s.geom::geography, aoi.g::geography, %s)
            ORDER BY km LIMIT 5
            """, (geom, max_km * 1000.0))
        cols = [d.name for d in cur.description]
        subs = [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]

        cur.execute(
            """
            WITH aoi AS (SELECT ST_GeomFromGeoJSON(%s) AS g)
            SELECT l.name, l.voltage_kv, l.capacity_mva, l.in_service,
                   ST_Distance(l.geom::geography,
                               (SELECT g FROM aoi)::geography) / 1000.0 AS km
            FROM br.transmission_line l, aoi
            WHERE l.in_service
              AND ST_DWithin(l.geom::geography, aoi.g::geography, %s)
            ORDER BY km LIMIT 5
            """, (geom, max_km * 1000.0))
        cols = [d.name for d in cur.description]
        lines = [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]

    if not subs and not lines:
        return {
            'reachable': False,
            'searched_km': max_km,
            'attachment': joined,
            'neighbours': nearby,
            'neighbour_bus_headroom': [],
            'note': (
                f'No substation or line of the transmission register lies '
                f'within {max_km:g} km of this AOI. The register covers the '
                f'transmission system; a distribution connection is not in it '
                f'and is not ruled out by this.'
            ),
        }

    def summarise(row, extra=()):
        out = {'name': (row['name'] or '').strip(),
               'distance_km': round(row['km'], 2),
               'voltage_kv': row['voltage_kv']}
        for key in extra:
            out[key] = row[key]
        return out

    nearest_sub = subs[0] if subs else None
    nearest_line = lines[0] if lines else None
    buses = sorted({a['bus'] for a in joined if a.get('bus') is not None})
    return {
        'reachable': True,
        'searched_km': max_km,
        # What the operator says this ground is wired to, and what leaves that
        # bus. Never summed with the curtailment: the correlation between
        # occupancy and loss is -0.025.
        'attachment': joined,
        'attached_bus_headroom': [bus_headroom(conn, b) for b in buses],
        # The neighbours' attachments, for ground that has none of its own.
        # NOT A PREDICTION OF WHERE THIS GROUND WOULD JOIN: where a project
        # actually connects is an access opinion the operator issues and does
        # not publish. What this says is that the plants near here enter the
        # network at these points, so a project here would be asking to join
        # the same part of the system -- and inherit what it does to them.
        'neighbours': nearby,
        # IN THE NEIGHBOURS' OWN ORDER, WHICH IS BY DISTANCE. Built from a set
        # this was ordered by BUS NUMBER, so the first entry was whichever id
        # sorted lowest -- and a caller labelling it "nearest" named the
        # furthest: over one area east of Jaiba the neighbours run 0.5, 3.2 and
        # 15.4 km while bus 3389 (the 15.4) sorted before 4391 (the 3.2).
        #
        # A neighbour whose point resolved to no bus is skipped rather than
        # holding a place: 'Conj. Jaiba 4 (Distribuicao)' has a connection code
        # that matches no substation in the transmission register, which is the
        # register saying it is not on the transmission system.
        'neighbour_bus_headroom': [
            bus_headroom(conn, b)
            for b in _first_seen(n['bus'] for n in nearby
                                 if n.get('bus') is not None)
        ],
        'nearest_substation': (None if nearest_sub is None
                               else summarise(nearest_sub)),
        'nearest_line': (None if nearest_line is None
                         else summarise(nearest_line, ('capacity_mva',))),
        'substations': [summarise(r) for r in subs],
        'lines': [summarise(r, ('capacity_mva',)) for r in lines],
        # Highest voltage reachable inside the search radius. A 500 kV bus 60 km
        # away and a 230 kV bus 5 km away are different propositions, and the
        # nearest one alone does not say which is on offer.
        'highest_voltage_kv': max(
            [r['voltage_kv'] for r in subs + lines if r['voltage_kv']],
            default=None),
        # ONS publishes an operating capacity for 1,269 of the 2,208 lines,
        # 57.5 percent, and none of the published values is zero -- so a null
        # here is a line whose rating is not in the register, never a line of
        # no capacity. Stated because the difference decides whether a nearby
        # line is usable or merely present.
        'capacity_published_fraction': 0.575,
        'route_factor': {
            'median': 1.077, 'p90': 1.408,
            'note': (
                'Line distances are to the straight segment between a line\'s '
                'terminals, which is all ONS publishes. Multiply by this to '
                'approximate the conductor route.'
            ),
        },
        'source': 'ONS transmission equipment register',
    }
