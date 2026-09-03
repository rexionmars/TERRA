"""
What the operator withheld, from whom, when and why.

THE QUESTION NO RESOURCE MODEL CAN ANSWER. Every step of terra/energy's loss
waterfall is physics -- geometry, temperature, inverter -- and each one is a
property of the site. Curtailment is a decision taken elsewhere in the system,
about the grid rather than the site, and a plant told not to generate produced
nothing its resource explains. It does not belong in that chain and is not
derivable from it.

THE REASON IS THE DECISION-RELEVANT PART AND A MODE THROWS IT AWAY. ONS
publishes five reason-and-origin combinations and they mean opposite things for
a project. Over the whole photovoltaic record: ENE/SIS is 69.0 percent --
surplus energy, systemic, a national oversupply no site can site its way out
of. CNF is 23.9 percent, and 8.4 points of that is CNF/LOC: a LOCAL reliability
constraint, which is precisely what a different connection point could avoid.
REL is 7.1 percent. A site whose curtailment is nine tenths ENE/SIS and a site
whose curtailment is half CNF/LOC face different problems, and reporting the
most frequent reason calls both of them ENE.

IT IS CONCENTRATED IN THE HOURS THE PLANT EARNS IN. Across the record, 71.3
percent of half hours are under restriction at 10:00 and 2.3 percent at 17:00.
An annual fraction hides that: the withheld energy is not spread over the day,
it is taken from the peak.

THE ENERGY AND THE REASON LIVE IN DIFFERENT RECORDS. ONS publishes a
curtailment record whose val_geracaolimitada is the CAP imposed, not the energy
withheld -- summing it counts megawatt ceilings as megawatt-hours -- and whose
val_geracaoreferenciafinal, which would give the energy, is absent on 42,238 of
42,384 rows of one cluster. What that record carries reliably is WHEN a
restriction was in force and WHY. The energy is in the detail record instead,
per plant, as the operator's estimate against its own meter.
"""

from __future__ import annotations

import json

import pandas as pd


# The two the record calls LOCAL. They are the ones a siting decision can act
# on: a constraint at this connection rather than a surplus across the
# subsystem. Named here rather than inlined, because the distinction is the
# reason the reason breakdown exists.
LOCAL_ORIGIN = 'LOC'


REASON_MEANING = {
    'ENE': 'surplus energy — more generation offered than the system can absorb',
    'CNF': 'reliability — the system could not securely accept the output',
    'REL': 'reliability of the plant or its connection',
    'PAR': 'scheduled outage or partial availability',
}


def _plants_in(aoi_geojson):
    """The SQL fragment that reduces the record to an AOI's plants."""
    return ("""
        WITH dentro AS (
            -- The coordinate travels with the selection, because a
            -- per-plant figure without one cannot be DRAWN. by_plant answers
            -- "which of these neighbours is the aggregate", and the honest
            -- form of that answer is a point on the ground rather than a row
            -- in a table: the plants of one AOI share a subsystem and often a
            -- cluster, and what separates them is where they stand. Selected
            -- here rather than joined again in by_plant, so every query keeps
            -- one definition of which plants are inside.
            SELECT p.ceg_core, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon
            FROM br.plant p
            WHERE p.geom IS NOT NULL
              AND ST_Intersects(p.geom, ST_GeomFromGeoJSON(%s))
        )""", json.dumps(aoi_geojson))


# Every query below joins the detail record to the curtailment record through
# the cluster a plant belonged to AT THE TIME. Membership is time-varying --
# 23 percent of plants change cluster over the published span -- so the instant
# is part of the join and not a filter applied after it.
_JOIN = """
    FROM br.pv_detail d
    JOIN dentro USING (ceg_core)
    LEFT JOIN br.plant_cluster pc
           ON pc.ceg_core = d.ceg_core
          AND d.instante BETWEEN pc.valid_from AND pc.valid_to
    LEFT JOIN br.pv_curtail c
           ON c.cluster_key = pc.cluster_key
          AND c.instante = d.instante
    WHERE d.instante >= %s AND d.instante < %s
"""


def _rows(conn, sql, params):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]


def by_reason(conn, aoi_geojson, start, end):
    """
    Withheld energy split by the reason and origin ONS recorded for it.

    THE SPLIT IS THE POINT. A local constraint is a different problem from a
    systemic surplus: the first is a property of this connection and the second
    of the subsystem, and only the first is something a project can answer by
    choosing differently. share_local below is that number.
    """
    cte, geom = _plants_in(aoi_geojson)
    rows = _rows(conn, cte + """
        SELECT c.reason_code AS reason, c.origin_code AS origin,
               count(*) AS periods,
               sum(d.gen_estimated - d.gen_verified) / 2.0 AS withheld_mwh
        """ + _JOIN + """
          AND c.reason_code IS NOT NULL
        GROUP BY 1, 2 ORDER BY 4 DESC NULLS LAST
    """, (geom, pd.Timestamp(start), pd.Timestamp(end) + pd.Timedelta(days=1)))

    total = sum(r['withheld_mwh'] or 0.0 for r in rows)
    local = sum(r['withheld_mwh'] or 0.0 for r in rows
                if r['origin'] == LOCAL_ORIGIN)
    for r in rows:
        r['withheld_mwh'] = round(float(r['withheld_mwh'] or 0.0), 1)
        r['share'] = round(r['withheld_mwh'] / total, 4) if total else None
        r['meaning'] = REASON_MEANING.get(r['reason'])
        r['scope'] = 'local' if r['origin'] == LOCAL_ORIGIN else 'systemic'
    return {
        'by_reason': rows,
        'share_local': round(local / total, 4) if total else None,
        'note': (
            'A systemic reason describes the subsystem and would follow this '
            'project to any site in it. A local one describes this connection. '
            'Only the local share is a number a siting decision can act on.'
        ),
    }


def by_hour(conn, aoi_geojson, start, end, utc_offset_hours: float = -3.0):
    """
    Withheld energy by hour of the local day.

    AN ANNUAL FRACTION HIDES THIS. Curtailment is not spread over the day; it
    is taken from the hours the resource is worth most, because that is when the
    surplus exists. Across the record 71.3 percent of half hours are restricted
    at 10:00 and 2.3 percent at 17:00.

    ONS stamps this record in Brasilia local time already, so the offset is
    applied only when a caller states a different one.
    """
    cte, geom = _plants_in(aoi_geojson)
    shift = f"d.instante + interval '{utc_offset_hours + 3.0} hours'"
    rows = _rows(conn, cte + f"""
        SELECT extract(hour FROM {shift})::int AS hour,
               count(*) AS periods,
               count(*) FILTER (WHERE c.reason_code IS NOT NULL) AS restricted,
               sum(d.gen_estimated) / 2.0 AS expected_mwh,
               sum(d.gen_estimated - d.gen_verified) / 2.0 AS withheld_mwh
        """ + _JOIN + """
        GROUP BY 1 ORDER BY 1
    """, (geom, pd.Timestamp(start), pd.Timestamp(end) + pd.Timedelta(days=1)))
    for r in rows:
        expected = float(r['expected_mwh'] or 0.0)
        r['expected_mwh'] = round(expected, 1)
        r['withheld_mwh'] = round(float(r['withheld_mwh'] or 0.0), 1)
        r['withheld_fraction'] = (round(r['withheld_mwh'] / expected, 4)
                                  if expected > 0 else None)
        r['restricted_fraction'] = (round(r['restricted'] / r['periods'], 4)
                                    if r['periods'] else None)
    return rows


def by_month(conn, aoi_geojson, start, end):
    """
    Withheld energy by calendar month, as published.

    Seasonal and not incidental: the surplus that drives ENE follows the
    hydrology and the load, neither of which is flat over the year.
    """
    cte, geom = _plants_in(aoi_geojson)
    rows = _rows(conn, cte + """
        SELECT to_char(date_trunc('month', d.instante), 'YYYY-MM') AS month,
               sum(d.gen_estimated) / 2.0 AS expected_mwh,
               sum(d.gen_estimated - d.gen_verified) / 2.0 AS withheld_mwh,
               count(*) FILTER (WHERE c.reason_code IS NOT NULL) AS restricted,
               count(*) AS periods
        """ + _JOIN + """
        GROUP BY 1 ORDER BY 1
    """, (geom, pd.Timestamp(start), pd.Timestamp(end) + pd.Timedelta(days=1)))
    for r in rows:
        expected = float(r['expected_mwh'] or 0.0)
        r['expected_mwh'] = round(expected, 1)
        r['withheld_mwh'] = round(float(r['withheld_mwh'] or 0.0), 1)
        r['withheld_fraction'] = (round(r['withheld_mwh'] / expected, 4)
                                  if expected > 0 else None)
    return rows


def by_plant(conn, aoi_geojson, start, end, limit: int = 50):
    """
    The same figures per plant, which is the resolution the record has.

    THE AGGREGATE HIDES THE SPREAD. Plants inside one AOI share a subsystem and
    often a cluster, and they still differ: the aggregate is dominated by the
    largest, and a project comparing itself to 'the area' is comparing itself to
    whichever neighbour is biggest.
    """
    cte, geom = _plants_in(aoi_geojson)
    rows = _rows(conn, cte + """
        SELECT d.id_ons, max(d.plant_name) AS plant,
               max(pc.cluster_name) AS cluster,
               sum(d.gen_estimated) / 2.0 AS expected_mwh,
               sum(d.gen_estimated - d.gen_verified) / 2.0 AS withheld_mwh,
               count(*) FILTER (WHERE c.reason_code IS NOT NULL) AS restricted,
               count(*) AS periods,
               -- One coordinate per plant, and max() over a constant is how a
               -- grouped query carries one: dentro holds exactly one row per
               -- ceg_core, so this is that row's value and not a choice among
               -- several.
               max(dentro.lat) AS lat, max(dentro.lon) AS lon
        """ + _JOIN + """
        GROUP BY 1 ORDER BY 4 DESC NULLS LAST LIMIT %s
    """, (geom, pd.Timestamp(start), pd.Timestamp(end) + pd.Timedelta(days=1),
          limit))
    for r in rows:
        expected = float(r['expected_mwh'] or 0.0)
        r['expected_mwh'] = round(expected, 1)
        r['withheld_mwh'] = round(float(r['withheld_mwh'] or 0.0), 1)
        r['withheld_fraction'] = (round(r['withheld_mwh'] / expected, 4)
                                  if expected > 0 else None)
        r['restricted_fraction'] = (round(r['restricted'] / r['periods'], 4)
                                    if r['periods'] else None)
        # Rounded to about a metre. The register's own precision is nowhere
        # near that, and a full double would put fifteen digits of false
        # precision into every payload and every export.
        r['lat'] = None if r['lat'] is None else round(float(r['lat']), 5)
        r['lon'] = None if r['lon'] is None else round(float(r['lon']), 5)
    return rows


def curtailment_context(conn, aoi_geojson, start: str, end: str):
    """
    What the operator curtailed at the plants inside an AOI, over a window.

    THE ANSWER energy_model CANNOT MODEL. Every step of the loss waterfall is
    physics: geometry, temperature, inverter. Curtailment is a decision taken
    elsewhere in the system, about the grid rather than the site, and a plant
    that was told not to generate produced nothing its resource explains.

    THE ENERGY AND THE REASON COME FROM DIFFERENT RECORDS, AND ONLY ONE OF THEM
    HAS THE ENERGY. The curtailment record's val_geracaolimitada is the CAP the
    operator imposed, not the energy withheld -- summing it counts megawatt
    ceilings as megawatt-hours -- and val_geracaoreferenciafinal, which would
    give the energy, is absent on 42,238 of 42,384 rows of one cluster. What
    the record does carry reliably is WHEN a restriction was in force and WHY.
    The energy is in the detail record instead, per plant: at 935 W/m2 on the
    array, Castilho 1 was estimated at 41.792 MW and verified at 6.112 MW under
    reason ENE. So this reads the amount from the detail record and the reason
    from the curtailment record, joined on the cluster and the instant.

    ESTIMATED MINUS VERIFIED IS ONS'S OWN ACCOUNTING, NOT A MEASUREMENT. The
    estimate is the operator's model of what the plant would have produced, so
    the difference carries that model's error and can be negative. Reported as
    published rather than clipped, because clipping would turn a two-sided
    error into a one-sided bias in every total above it.

    THE ATTRIBUTION OF THE REASON IS THE CLUSTER'S. ONS curtails a cluster, so
    the reason and origin describe every plant in it. The energy does not have
    that problem: it is per plant, and only the plants inside the AOI are
    summed.

    Returns None when the AOI contains no plant the record covers.
    """
    import json

    import pandas as pd

    lo = pd.Timestamp(start)
    hi = pd.Timestamp(end) + pd.Timedelta(days=1)

    with conn.cursor() as cur:
        cur.execute(
            """
            WITH dentro AS (
                SELECT p.ceg_core FROM br.plant p
                WHERE p.geom IS NOT NULL
                  AND ST_Intersects(p.geom, ST_GeomFromGeoJSON(%s))
            )
            SELECT count(DISTINCT d.id_ons)                          AS plants,
                   count(*)                                          AS periods,
                   sum(d.gen_estimated - d.gen_verified) / 2.0       AS withheld,
                   sum(d.gen_estimated) / 2.0                        AS expected,
                   sum(d.gen_verified) / 2.0                         AS delivered,
                   count(*) FILTER (WHERE c.reason_code IS NOT NULL) AS restricted,
                   -- The same difference over the half hours with NO
                   -- restriction in force: the operator's estimate against its
                   -- own meter, at the same plants over the same window. It is
                   -- the floor of what this difference means, and without it a
                   -- withheld fraction cannot be told from model error.
                   sum(d.gen_estimated - d.gen_verified)
                       FILTER (WHERE c.reason_code IS NULL) / 2.0 AS free_gap,
                   sum(d.gen_estimated)
                       FILTER (WHERE c.reason_code IS NULL) / 2.0 AS free_expected,
                   sum(d.gen_estimated - d.gen_verified)
                       FILTER (WHERE c.reason_code IS NOT NULL) / 2.0
                       AS restricted_gap,
                   mode() WITHIN GROUP (ORDER BY c.reason_code)      AS top_reason,
                   mode() WITHIN GROUP (ORDER BY c.origin_code)      AS top_origin
            FROM br.pv_detail d
            JOIN dentro USING (ceg_core)
            LEFT JOIN br.plant_cluster pc
                   ON pc.ceg_core = d.ceg_core
                  AND d.instante BETWEEN pc.valid_from AND pc.valid_to
            LEFT JOIN br.pv_curtail c
                   ON c.cluster_key = pc.cluster_key
                  AND c.instante = d.instante
            WHERE d.instante >= %s AND d.instante < %s
            """,
            (json.dumps(aoi_geojson), lo, hi))
        cols = [d.name for d in cur.description]
        row = dict(zip(cols, cur.fetchone(), strict=True))

    if not row['plants']:
        return None

    expected = float(row['expected'] or 0.0)
    withheld = float(row['withheld'] or 0.0)
    free_expected = float(row['free_expected'] or 0.0)
    free_gap = float(row['free_gap'] or 0.0)
    baseline = (free_gap / free_expected) if free_expected > 0 else None
    restricted_gap = float(row['restricted_gap'] or 0.0)
    return {
        'plants_in_aoi': int(row['plants']),
        'window': f'{start}..{end}',
        'expected_mwh': round(expected, 1),
        'delivered_mwh': round(float(row['delivered'] or 0.0), 1),
        'withheld_mwh': round(withheld, 1),
        'withheld_fraction': (round(withheld / expected, 4)
                              if expected > 0 else None),
        # THE TOTAL IS A SUM OF TWO DIFFERENT THINGS AND SAYING SO IS THE ONLY
        # WAY IT ADDS UP. withheld_mwh spans every half hour in the window, so
        # it carries both the energy taken while a restriction was in force and
        # the operator's estimate error while none was -- and the second is
        # frequently NEGATIVE, because plants often out-produce the estimate
        # when free. At one AOI the restricted periods account for 192,976 MWh
        # and the free ones for -39,442, which is why the by_reason table sums
        # to more than the headline. Split here so a reader is not left to
        # discover that the two do not agree.
        'withheld_under_restriction_mwh': round(restricted_gap, 1),
        'estimate_gap_when_free_mwh': round(free_gap, 1),
        'periods': int(row['periods']),
        'periods_under_restriction': int(row['restricted'] or 0),
        'restricted_fraction': (round(row['restricted'] / row['periods'], 4)
                                if row['periods'] else None),
        'top_reason': row['top_reason'],
        'top_origin': row['top_origin'],
        # The same quantity where no restriction was in force, and the reason
        # withheld_fraction must not be read alone.
        #
        # SUBTRACT, DO NOT DIVIDE. The floor crosses zero -- it runs -10 to +8
        # percent across clusters -- so a signal-to-floor ratio is undefined
        # near the crossing and returns 9,341x for a cluster whose floor is
        # 0.0 percent. The difference is the quantity with meaning: curtailment
        # net of the operator's model bias, in the same units as the figure
        # above it.
        #
        # MEASURED, over the whole record: the difference holds at a median of
        # 36.1 points across ten quarters, sd 7.6, range 27.0 to 48.4; and at a
        # median of 37.0 points across 84 clusters, sd 15.3. The two groupings
        # of the same data agree on the centre and disagree on the spread,
        # which is what a floor that is a property of the PLANT rather than of
        # the period looks like. So a withheld fraction is comparable over time
        # for one AOI, and is not comparable between AOIs without its floor.
        # (84 of 93 clusters; nine carry too few restricted half hours to
        # measure, and dropping them biases this toward the stable ones.)
        'unrestricted_baseline_fraction': (None if baseline is None
                                           else round(baseline, 4)),
        'kind': 'empirical',
        'basis': (
            'Withheld energy is the operator\'s estimated generation minus its '
            'verified generation, summed over the plants inside the AOI. The '
            'estimate is a model of ONS\'s, so the difference carries its error '
            'and is reported unclipped. The reason and origin are attributed to '
            'the CLUSTER a plant belonged to at the time, so they describe '
            'plants outside the AOI as well. '
            'unrestricted_baseline_fraction is the same difference over the '
            'half hours with no restriction in force, at the same plants over '
            'the same window: the floor below which this figure is the '
            'operator\'s model error rather than curtailment.'
        ),
        'source': 'ONS constrained-off, photovoltaic detail and curtailment',
    }


