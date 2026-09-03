"""
The local store the Brazilian record is queried from.

ons.py fetches what ONS publishes, which is whole period files: 93 MB per month
for the photovoltaic detail record alone, about 4 GB across the three
curtailment records, and no query interface of any kind. Answering "this plant,
this window" from those files means reading a month to keep a day of it. That
is what this module exists to stop. ons.py is the ingest; this is the query.

WHY POSTGIS AND NOT A PARQUET DIRECTORY. Two joins decide it, and neither is
temporal. TERRA's unit of analysis is an AOI polygon, and the ONS record is
per plant with a CEG and no geometry at all -- the operator publishes what a
plant did, never where it is. The geometry comes from a different agency
(ANEEL SIGA, CodCEG with a coordinate pair), so connecting a TERRA AOI to the
curtailment record is a spatial join across two sources that share only an
identifier. That is a database's job, and the spatial half of it is PostGIS's.

WHY LOCAL. It sits beside the application on one machine, like the POWER cache
and unlike a service. Nothing here authenticates to anything remote, no run
depends on a network to answer from what is already stored, and the store is
the user's file on the user's disk. It is also what makes fusion cheap later:
a raster product of TERRA's own and an ONS series become two tables in one
database rather than two formats in two directories.

THE REVISION DISCIPLINE HAS TO SURVIVE THE LOAD. ons.py refuses to serve a
superseded file because ONS rewrites whole years in a batch; that guarantee is
worth nothing if the rows it loaded stay in a table with no record of which
revision they came from. Every fact table carries source_id into
br.source_file, which holds the file, its catalogue revision and when it was
loaded, and reloading a revised period deletes that source's rows before
inserting. A table that merely accumulated would hold both revisions of
fourteen months of 2025 and silently double every sum over them.

RESOLUTION IS THE RECORD'S, NOT THIS MODULE'S. Half-hourly per plant, kept as
published. Aggregating on load would be smaller and would destroy the only
thing that makes the record worth storing: the coincidence between what a plant
was told not to generate and what the resource was doing at that half hour.
"""

from __future__ import annotations

from terra import protocol

from pathlib import Path

# Kept as text rather than assembled, because a schema is read far more often
# than it is run and the indexes are the part that has to be seen next to the
# columns they cover.
SCHEMA = """
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS br;

-- Which published file each row came from, and which revision of it.
-- The table ons.py's revision check would be pointless without.
CREATE TABLE IF NOT EXISTS br.source_file (
    source_id           bigserial PRIMARY KEY,
    dataset             text        NOT NULL,
    period              text        NOT NULL,
    filename            text        NOT NULL,
    catalogue_revision  text,
    loaded_utc          timestamptz NOT NULL DEFAULT now(),
    row_count           bigint,
    UNIQUE (dataset, period)
);

-- THE KEY IS id_ons, NOT ceg, AND THAT IS NOT A PREFERENCE.
-- The wind curtailment record is 93 percent cluster rows: 211,296 of 227,664
-- lines of 2026-08, across 142 clusters, every one of them carrying ceg as a
-- literal '-'. Keyed on ceg those collide 142 ways at every half hour. id_ons
-- is populated on every row of both records and is unique with the instant;
-- across twelve months of the wind record, 157 units, an id_ons beginning
-- 'CJU_' and an absent ceg agreed exactly, with no exception in either
-- direction. So a cluster is identifiable and a plant is joinable, and neither
-- has to be inferred from the other.
--
-- WHAT THIS MEANS FOR WIND, AND IT IS NOT A SCHEMA DETAIL. Curtailment is
-- attributed to a cluster that ANEEL has no enterprise record of, so the
-- AOI-to-plant-to-curtailment join below DOES NOT REACH IT. The photovoltaic
-- detail record has no clusters at all -- 560 units, all plants, all of them
-- joining to SIGA -- which is why the spatial path works there and has to be
-- resolved by cluster membership before it works for wind.

-- Where the record contradicts itself, and what was kept.
--
-- The photovoltaic detail record carries 56 instants at which one plant has
-- two rows: 48 in 2024-04 and 8 in 2024-05, the first two months it was
-- published, out of 18,938,083 rows in thirty months. The 8 are exact repeats.
-- The 48 DISAGREE -- one row reads gen_estimated as absent and the other as
-- zero, and their gen_verified differs in the third decimal.
--
-- A primary key on (id_ons, instante) is the right assertion about 99.9994
-- percent of this record and it is what surfaced these at all; dropping it to
-- accommodate 56 rows would give up the guarantee everywhere. So the key
-- stays, the loader keeps the first row of a colliding set, and every choice
-- it made is written here. Discarding silently would be indistinguishable from
-- a load that lost rows, and picking a value without recording the other is a
-- number this store cannot defend.
CREATE TABLE IF NOT EXISTS br.load_conflict (
    source_id   bigint      NOT NULL REFERENCES br.source_file
                            ON DELETE CASCADE,
    table_name  text        NOT NULL,
    id_ons      text        NOT NULL,
    instante    timestamp   NOT NULL,
    n_rows      int         NOT NULL,
    identical   boolean     NOT NULL
);

CREATE INDEX IF NOT EXISTS load_conflict_source_idx
    ON br.load_conflict (source_id);

-- The plants, from ANEEL SIGA. The only source of geometry: ONS publishes
-- what a plant did and never where it is.
--
-- KEYED ON THE CORE CEG, NOT ON THE ONS ONE. ONS identifies a generating unit
-- (UFV.RS.SP.034111-8.01) and ANEEL identifies the enterprise
-- (UFV.RS.SP.034111-8). Joined without stripping the suffix, nothing matches
-- and the failure looks like missing data rather than like a key mismatch.
CREATE TABLE IF NOT EXISTS br.plant (
    ceg_core        text PRIMARY KEY,
    name            text,
    kind            text,           -- UFV, EOL, UTE, PCH, ...
    uf              text,
    municipality    text,
    capacity_kw     double precision,
    operation_start date,
    geom            geometry(Point, 4326)
);

CREATE INDEX IF NOT EXISTS plant_geom_idx ON br.plant USING gist (geom);
CREATE INDEX IF NOT EXISTS plant_kind_idx ON br.plant (kind);

-- Which cluster each plant belongs to, derived from the detail record.
--
-- THE ONLY BRIDGE BETWEEN A PLANT AND ITS CURTAILMENT. ONS attributes
-- curtailment to a CLUSTER, not to a plant: of the 83 units in six months of
-- the photovoltaic curtailment record, 79 are clusters carrying no CEG at all
-- and only 4 are plants. The detail record is the reverse -- every row is a
-- named plant -- and it is the only place that names both, through
-- nom_conjuntousina. Without this table an AOI can find its plants and cannot
-- find what any of them was told not to generate.
--
-- MEMBERSHIP IS TIME-VARYING AND KEYING ON THE PLANT ALONE IS WRONG. 131 of
-- the 560 plants -- 23 percent -- appear under more than one cluster over the
-- published span; the Juazeiro plants run 27,312 half hours under
-- 'Conj. Juazeiro Solar' and then 15,120 under 'Conj. Juazeiro II 230 kV'.
-- A single row per plant picks one of them arbitrarily and attributes a
-- quarter of the fleet's curtailment to the cluster it was not in at the time.
-- So the row is the membership, bounded by the window it is observed over, and
-- the join to curtailment has to match the instant as well as the plant.
--
-- Derived rather than published, so it is rebuilt from the detail record after
-- a load rather than maintained by hand.
CREATE TABLE IF NOT EXISTS br.plant_cluster (
    ceg_core     text      NOT NULL,
    cluster_key  text      NOT NULL,
    cluster_name text      NOT NULL,
    valid_from   timestamp NOT NULL,
    valid_to     timestamp NOT NULL,
    n_rows       bigint    NOT NULL,
    PRIMARY KEY (ceg_core, cluster_key)
);

CREATE INDEX IF NOT EXISTS plant_cluster_key_idx
    ON br.plant_cluster (cluster_key);

-- WHAT AN AOI QUESTION ACTUALLY READS, computed once per load instead of once
-- per question.
--
-- THE COST IS THE JOIN, NOT THE VOLUME. curtailment_context asks one thing --
-- what these plants did over this window -- and to answer it joins 19,088,880
-- half-hourly detail rows to 2,854,800 curtailment rows on cluster and
-- instant. Over an AOI holding 17 plants that took 78.5 seconds; over this
-- view it takes 71 milliseconds, and the counts are identical. The saving is
-- not from aggregating time: an hourly rollup of the same record is 9,544,440
-- rows and 475 MB, which is half the table and does not fit the cache either.
-- It is from having already done the join.
--
-- THE GRAIN IS PLANT x DAY x REASON, and each of the three is load-bearing.
-- Plant, because the AOI selects plants and nothing coarser can answer for a
-- polygon. Day, because every question above this is monthly or annual.
-- Reason, because the difference between withheld energy and CURTAILED energy
-- is whether a restriction was in force, and collapsing that would leave the
-- floor -- 6.6 percent at one site, 17.7 at another -- uncomputable.
--
-- float8 IN THE SUMS AND NOT float4. The columns are real, and summing 720,528
-- of them in a different association order than the direct query moves the
-- total by about 0.004 percent. Invisible at the precision anything displays,
-- and still wrong: two paths to one number that disagree are a defect waiting
-- to be found by someone comparing them.
--
-- A LEFT JOIN, so a plant with no curtailment row keeps its generation. An
-- inner join would silently drop every half hour the operator did not write
-- about, which is most of them, and the expected total would shrink to the
-- restricted subset while still being called expected.
--
-- WITH NO DATA: created empty and populated by refresh_rollup, because
-- ensure_schema runs on every connect and building this is seventy seconds.
CREATE MATERIALIZED VIEW IF NOT EXISTS br.pv_daily AS
SELECT d.ceg_core,
       d.id_ons,
       d.instante::date  AS day,
       c.reason_code,
       c.origin_code,
       count(*)                                          AS periods,
       sum(d.gen_estimated::float8) / 2.0                AS expected_mwh,
       sum(d.gen_verified::float8)  / 2.0                AS delivered_mwh,
       sum((d.gen_estimated - d.gen_verified)::float8) / 2.0 AS withheld_mwh,
       sum(d.irradiance_poa::float8) / 2000.0            AS poa_kwh,
       bool_or(d.irradiance_bad)                         AS irradiance_bad
FROM br.pv_detail d
-- BOUNDED BY THE WINDOW THE MEMBERSHIP WAS OBSERVED OVER, which is not
-- optional: 106 of the 556 plants -- 19 percent -- appear under more than one
-- cluster across the published span, and 18 of them under three. Joined on the
-- plant alone, every detail row of those plants matches each of its
-- memberships, so their periods and their energy are counted two and three
-- times and their curtailment is attributed to a cluster they had left. The
-- direct query in curtailment.py carries this bound; a view meant to answer
-- the same question has to carry it too, or the two disagree by a fifth of the
-- fleet.
LEFT JOIN br.plant_cluster pc ON pc.ceg_core = d.ceg_core
                             AND d.instante BETWEEN pc.valid_from AND pc.valid_to
LEFT JOIN br.pv_curtail   c  ON c.cluster_key = pc.cluster_key
                            AND c.instante    = d.instante
GROUP BY 1, 2, 3, 4, 5
WITH NO DATA;

-- The AOI question's own shape: these plants, this window.
CREATE INDEX IF NOT EXISTS pv_daily_plant_day_idx
    ON br.pv_daily (ceg_core, day);
CREATE INDEX IF NOT EXISTS pv_daily_unit_idx
    ON br.pv_daily (id_ons, day);

-- The transmission network, from the operator's own equipment register.
--
-- WHAT SITING IS MISSING WITHOUT IT. terra/energy/siting.py classifies ground
-- by slope and land cover: whether a plant could physically stand there. It
-- says nothing about whether the power could leave, and in the subsystems
-- where curtailment runs at a third of output that is the binding constraint,
-- not the terrain.
CREATE TABLE IF NOT EXISTS br.substation (
    bus          integer PRIMARY KEY,
    name         text    NOT NULL,
    voltage_kv   double precision,
    subsystem    text,
    uf           text,
    operator     text,
    geom         geometry(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS substation_geom_idx ON br.substation USING gist (geom);
CREATE INDEX IF NOT EXISTS substation_kv_idx ON br.substation (voltage_kv);

-- THE GEOMETRY IS A STRAIGHT SEGMENT AND THE ROUTE IS NOT STRAIGHT. ONS
-- publishes a line's two terminals and its length, never its path. The
-- segment below joins the terminals, so a distance measured to it is a LOWER
-- BOUND on the distance to the conductor, and it is wrong in the direction
-- that flatters a site. published_length_km against the segment's own length
-- is how far off it is, per line, and load_network reports the distribution.
-- SURROGATE KEY, BECAUSE THE REGISTER HAS NO UNIQUE ONE. cod_equipamento
-- repeats on 4 of 2,332 rows, and the repeats are real distinctions the code
-- does not carry: 'PRSTF56STIN1SP' is both a 600 kV line and the converter on
-- it, entered and retired on the same day. Declaring it a primary key rejects
-- the load; declaring it unique-enough and deduplicating would drop a row the
-- register means to have.
CREATE TABLE IF NOT EXISTS br.transmission_line (
    line_id            bigserial PRIMARY KEY,
    equipment          text,
    name               text,
    bus_from           integer,
    bus_to             integer,
    voltage_kv         double precision,
    capacity_mva       double precision,
    reactance_pu       double precision,
    published_length_km double precision,
    straight_length_km  double precision,
    in_service         boolean NOT NULL,
    geom               geometry(LineString, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS line_geom_idx ON br.transmission_line USING gist (geom);
CREATE INDEX IF NOT EXISTS line_service_idx ON br.transmission_line (in_service);
CREATE INDEX IF NOT EXISTS line_equipment_idx ON br.transmission_line (equipment);

-- The operator's own register of what it dispatches, keyed on ITS identifier.
--
-- THE ONLY SOURCE OF GEOMETRY FOR A CLUSTER, which is what makes it necessary
-- rather than redundant with br.plant. That table is keyed on the ANEEL
-- enterprise CEG and therefore reaches plants; the curtailment record is 95
-- percent CLUSTER rows carrying no CEG at all, so 83 of 87 units in it join to
-- nothing there. This register is keyed on id_ons, covers clusters, and carries
-- both a connection-point and a collector-substation coordinate.
--
-- TWO COORDINATES AND THEY ARE NOT INTERCHANGEABLE. The research measured the
-- difference: in 31 of 37 clusters the collector substation is more than 750 m
-- from the array centroid, median 1.9 km, and an event study run on the
-- substation coordinate returned a null result that the plant coordinate
-- turned into a signal. Both are stored; a caller picks and the choice is
-- visible.
CREATE TABLE IF NOT EXISTS br.ons_unit (
    id_ons          text PRIMARY KEY,
    name            text,
    kind            text,      -- nom_tipousina
    subsystem       text,
    uf              text,
    connection_code text,      -- cod_pontoconexao
    connection_name text,
    capacity_mw     double precision,
    geom_connection geometry(Point, 4326),
    geom_collector  geometry(Point, 4326)
);

CREATE INDEX IF NOT EXISTS ons_unit_conn_idx
    ON br.ons_unit USING gist (geom_connection);
CREATE INDEX IF NOT EXISTS ons_unit_kind_idx ON br.ons_unit (kind);

-- The half-hourly photovoltaic detail record.
--
-- irradiance_poa IS NOT GHI. ONS names the column val_irradianciaverificado
-- and says nothing further; it is measured in the plane of the array. The name
-- here says so because a column called irradiance joined against a modelled
-- GHI reports a 14.8 percent bias that is the tilt and not an error.
--
-- irradiance_bad IS THE OPERATOR'S FLAG AND IT IS INCOMPLETE. Filtering on it
-- alone leaves physically impossible readings in: of the rows it does NOT
-- flag, 8,656 exceed 1500 W/m2 and 1,094 are negative, and the single largest
-- unflagged value is 123,312 W/m2 -- ninety times the solar constant. It
-- reaches 40 plant-days of 111,966 that pass a flag-only filter, 0.036 percent,
-- which medians absorb and means do not. A caller computing anything from this
-- column should bound it physically as well as trust the flag.
CREATE TABLE IF NOT EXISTS br.pv_detail (
    id_ons          text        NOT NULL,
    ceg             text,
    ceg_core        text,
    instante        timestamp   NOT NULL,
    subsystem       text,
    uf              text,
    plant_name      text,
    cluster_name    text,
    -- `real` and not double precision, with a measured cost.
    --
    -- Four bytes against eight over 22 million rows is about 350 MB. What it
    -- buys the other way is three parts per million on an aggregate: summing
    -- 700,000 curtailment values in float32 lands 13,599.334 GWh where float64
    -- reaches 13,599.376. Below any threshold these figures are quoted at, and
    -- the port's own test against the published tables holds at 1e-5 rather
    -- than 1e-6 because of exactly this.
    irradiance_poa  real,
    irradiance_bad  boolean,
    gen_estimated   real,
    gen_verified    real,
    source_id       bigint      NOT NULL REFERENCES br.source_file
                                ON DELETE CASCADE,
    PRIMARY KEY (id_ons, instante)
);

-- (id_ons, instante) is the primary key and already serves a plant-and-window
-- query. BRIN is for the other shape: a window across all plants, which is what
-- a system-wide figure asks for, over a table that is written in time order and
-- for which a btree on time alone would cost more than the scan it saves.
CREATE INDEX IF NOT EXISTS pv_detail_time_brin
    ON br.pv_detail USING brin (instante);
CREATE INDEX IF NOT EXISTS pv_detail_core_idx ON br.pv_detail (ceg_core);
CREATE INDEX IF NOT EXISTS pv_detail_source_idx ON br.pv_detail (source_id);

-- The curtailment record proper, carrying the reason and origin codes the
-- detail series does not.
CREATE TABLE IF NOT EXISTS br.pv_curtail (
    id_ons          text        NOT NULL,
    ceg             text,
    ceg_core        text,
    instante        timestamp   NOT NULL,
    subsystem       text,
    uf              text,
    plant_name      text,
    generation      real,
    generation_cap  real,       -- val_geracaolimitada
    availability    real,
    -- BOTH REFERENCES, AND THE SECOND IS THE ONE THAT MATTERS.
    --
    -- The curtailment identity the research uses is
    --   corte = max(coalesce(reference_final, reference) - generation, 0)
    -- over rows carrying a reason. Storing only the final one looked like
    -- keeping the refinement and was keeping the rare one: across six months of
    -- restricted rows, val_geracaoreferenciafinal is present on 5.3 percent and
    -- val_geracaoreferencia on 100 percent. The fallback carries 94.7 percent
    -- of the record rather than an edge case, so one column alone would have
    -- made every energy figure null for nineteen rows in twenty.
    reference_final real,       -- val_geracaoreferenciafinal, 5.3% filled
    reference       real,       -- val_geracaoreferencia, always filled
    reason_code     text,       -- ENE / CNF / REL / PAR
    origin_code     text,       -- SIS / LOC
    -- Set on cluster rows, which are 95 percent of this table. Normalised at
    -- load so the join to br.plant_cluster is an indexed equality rather than
    -- a string function over 3.5 million rows.
    cluster_key     text,
    source_id       bigint      NOT NULL REFERENCES br.source_file
                                ON DELETE CASCADE,
    PRIMARY KEY (id_ons, instante)
);

CREATE INDEX IF NOT EXISTS pv_curtail_time_brin
    ON br.pv_curtail USING brin (instante);
-- CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so a
-- store created by an earlier version keeps its old column list and the index
-- below fails on a column that was never added. Stated as an ALTER so
-- ensure_schema is an upgrade as well as a creation.
ALTER TABLE br.pv_curtail ADD COLUMN IF NOT EXISTS cluster_key text;
ALTER TABLE br.pv_curtail ADD COLUMN IF NOT EXISTS reference_final real;

CREATE INDEX IF NOT EXISTS pv_curtail_cluster_idx
    ON br.pv_curtail (cluster_key, instante);
CREATE INDEX IF NOT EXISTS pv_curtail_reason_idx
    ON br.pv_curtail (reason_code, origin_code);
"""


# How each ONS dataset's published columns map onto a table here. Held as data
# because the wind record is the same shape with one column renamed, and a
# mapping written twice is a mapping that drifts.
TABLES = {
    'pv_curtailment_detail': {
        'table': 'br.pv_detail',
        'columns': {
            'id_ons': 'id_ons',
            'ceg': 'ceg',
            'din_instante': 'instante',
            'id_subsistema': 'subsystem',
            'id_estado': 'uf',
            'nom_usina': 'plant_name',
            'nom_conjuntousina': 'cluster_name',
            'val_irradianciaverificado': 'irradiance_poa',
            'flg_dadoirradianciainvalido': 'irradiance_bad',
            'val_geracaoestimada': 'gen_estimated',
            'val_geracaoverificada': 'gen_verified',
        },
    },
    'pv_curtailment': {
        'table': 'br.pv_curtail',
        'columns': {
            'id_ons': 'id_ons',
            'ceg': 'ceg',
            'din_instante': 'instante',
            'id_subsistema': 'subsystem',
            'id_estado': 'uf',
            'nom_usina': 'plant_name',
            'val_geracao': 'generation',
            'val_geracaolimitada': 'generation_cap',
            'val_disponibilidade': 'availability',
            'val_geracaoreferenciafinal': 'reference_final',
            'val_geracaoreferencia': 'reference',
            'cod_razaorestricao': 'reason_code',
            'cod_origemrestricao': 'origin_code',
        },
        # Computed at load, not published. See cluster_key.
        'derive': ('cluster_key',),
    },
}


def refresh_clusters(conn) -> dict:
    """
    Rebuild br.plant_cluster from whatever the detail record currently holds.

    Derived rather than maintained, so a load that adds plants or renames a
    cluster is reflected by running this and not by remembering to edit a
    table. Rebuilt wholesale for the same reason br.plant is: it describes the
    present state of the record, not its history.
    """
    with conn.cursor() as cur:
        cur.execute(
            'SELECT ceg_core, cluster_name, min(instante), max(instante), '
            'count(*) FROM br.pv_detail '
            'WHERE ceg_core IS NOT NULL AND cluster_name IS NOT NULL '
            'GROUP BY 1, 2')
        rows = [(core, cluster_key(name), name, lo, hi, n)
                for core, name, lo, hi, n in cur.fetchall()]
        cur.execute('TRUNCATE br.plant_cluster')
        cur.executemany(
            'INSERT INTO br.plant_cluster (ceg_core, cluster_key, '
            'cluster_name, valid_from, valid_to, n_rows) '
            'VALUES (%s, %s, %s, %s, %s, %s) '
            'ON CONFLICT (ceg_core, cluster_key) DO NOTHING', rows)
        # Overlapping windows for one plant mean the record had it in two
        # clusters at the same instant, which the interval model cannot
        # represent. Reported rather than resolved: a silent pick would be the
        # arbitrary choice this table exists to stop.
        cur.execute(
            'SELECT count(*) FROM br.plant_cluster a JOIN br.plant_cluster b '
            'ON a.ceg_core = b.ceg_core AND a.cluster_key < b.cluster_key '
            'AND a.valid_from <= b.valid_to AND b.valid_from <= a.valid_to')
        overlapping = cur.fetchone()[0]
    conn.commit()
    return {'memberships': len(rows),
            'plants': len({r[0] for r in rows}),
            'clusters': len({r[1] for r in rows}),
            'overlapping_pairs': overlapping}



def refresh_rollup(conn, concurrently: bool = False) -> dict:
    """
    Rebuild br.pv_daily from whatever the record currently holds.

    RUN ONCE AFTER A LOAD, NOT ONCE PER PERIOD. load_period writes one month;
    refreshing here costs about seventy seconds regardless of how much moved,
    so a caller loading thirty months calls this at the end and pays it once
    rather than thirty times. Same reason refresh_clusters is separate from the
    loader that makes it stale.

    DERIVED, NEVER EDITED, and rebuilt whole. It describes the present state of
    the record, so a period reloaded under a new revision is reflected by
    running this and not by remembering which rows to touch. ONS rewrote every
    month of 2025-01..2026-03 in one batch; anything incremental here would
    have had to know that.

    `concurrently` keeps the old contents readable while the new ones are
    built, at the cost of needing a unique index and roughly twice the work. It
    is off by default because the store is local and single-user: a refresh
    that blocks for seventy seconds after a load nobody is querying is cheaper
    than the index that would avoid it.
    """
    import time

    t0 = time.time()
    with conn.cursor() as cur:
        cur.execute('REFRESH MATERIALIZED VIEW '
                    + ('CONCURRENTLY ' if concurrently else '')
                    + 'br.pv_daily')
    conn.commit()
    with conn.cursor() as cur:
        cur.execute('SELECT count(*), count(DISTINCT ceg_core), '
                    'min(day), max(day) FROM br.pv_daily')
        rows, plants, lo, hi = cur.fetchone()
    return {'rows': rows, 'plants': plants, 'from': lo, 'to': hi,
            'seconds': round(time.time() - t0, 1)}


def cluster_key(name) -> str:
    """
    A cluster name reduced to a form the two records agree on.

    They do not agree as published. The detail record writes
    'Conj. Marangatu' and the curtailment record writes 'CONJ. MARANGATU';
    accents, case and the prefix all vary. Normalised this way, 79 of 79
    clusters match across the two.
    """
    import re
    import unicodedata

    text = unicodedata.normalize('NFKD', str(name))
    text = text.encode('ascii', 'ignore').decode().upper()
    text = re.sub(r'\s+', ' ', text).strip()
    return re.sub(r'^CONJ\.?\s*', '', text).strip()


def ceg_core(ceg) -> str | None:
    """
    The enterprise CEG behind a generating unit's, or None where there is none.

    ONS writes UFV.RS.SP.034111-8.01 and ANEEL writes UFV.RS.SP.034111-8, so
    the join to geometry needs the suffix gone. Done by stripping the last
    dotted field rather than by a regular expression, because the field count
    before it differs between the source types and a pattern written for UFV
    silently fails to match EOL.

    A LITERAL '-' IS HOW ONS WRITES ABSENT, and it is the value on every one of
    the 211,296 cluster rows in a single month of the wind record. Carried
    through as a string it becomes a plant identifier that 142 clusters share,
    and it joins to nothing while looking like it should. It becomes None here,
    which is what the column means and what the store records.

    Already-core input passes through unchanged, so the function is safe to
    apply to ANEEL's own CodCEG as well as to the ONS one.
    """
    if ceg is None:
        return None
    text = str(ceg).strip()
    if text in ('', '-', 'nan'):
        return None
    parts = text.split('.')
    return '.'.join(parts[:-1]) if len(parts) > 4 else text


class StoreUnreachable(protocol.Unavailable):
    """
    The database could not be opened, in the user's terms rather than psycopg's.

    Raised instead of letting psycopg.OperationalError escape, because it does
    not escape into a log -- it escapes onto the settings screen, where the
    reader is deciding what to install or start. A traceback there says the
    process failed; it does not say which of the three things a person has to
    do next. Every message this carries names one of them.
    """


def connect(req=None):
    """
    A connection to the local store.

    psycopg is imported here rather than at module scope for the reason
    terra/registry.py defers every product import: an action that never touches
    the Brazilian record must not pay for a database driver being installed, and
    in an installation that has no store at all the rest of the sidecar still
    has to answer.
    """
    import os

    try:
        import psycopg
    except ImportError as e:
        from terra.protocol import MissingDependency
        raise MissingDependency(
            'the grid record needs psycopg and a local PostgreSQL with '
            'PostGIS, and neither is optional for this slice: there is no '
            'file-reading fallback, by design, so that answering a plant-and-'
            'window question has exactly one implementation. psycopg is not '
            'installed in this interpreter. terra/grid/store.py SCHEMA is what '
            'the database is expected to hold.'
        ) from e

    dsn = (req or {}).get('br_store_dsn') or os.environ.get('TERRA_BR_DSN')
    if not dsn:
        # Local by default and by design: the store is a file on this disk, not
        # a service to authenticate to.
        dsn = 'postgresql:///terra_br'
    try:
        return psycopg.connect(dsn)
    except psycopg.OperationalError as e:
        raise StoreUnreachable(_why_unreachable(e, dsn)) from e


def _why_unreachable(exc, dsn: str) -> str:
    """
    Which of the three failures this was, said as the action it needs.

    They are told apart by what libpq puts in the message, because psycopg
    raises one exception type for all of them. Matching text is fragile and is
    the price of a sentence someone can act on; an unmatched failure falls
    through to the driver's own words rather than to a guess.
    """
    text = str(exc).strip()
    lowered = text.lower()
    where = _dsn_summary(dsn)
    if 'does not exist' in lowered and 'database' in lowered:
        return (
            f'There is a PostgreSQL server at {where} but no database for the '
            f'grid record. Create it and let the schema be applied: '
            f'createdb terra_br')
    if 'connection refused' in lowered or 'could not connect' in lowered:
        return (
            f'No PostgreSQL server answered at {where}. Start it, or point the '
            f'grid store at one that is running.')
    if 'authentication' in lowered or 'password' in lowered:
        return (
            f'The PostgreSQL server at {where} refused these credentials.')
    return f'The grid store at {where} could not be opened: {text}'


def _dsn_summary(dsn: str) -> str:
    """The connection named without its password, for a message shown on screen."""
    import re

    return re.sub(r'://([^:/@]+):[^@]*@', r'://\1@', dsn)


def ensure_schema(conn) -> None:
    """The schema, created if absent. Safe to run on every open."""
    with conn.cursor() as cur:
        cur.execute(SCHEMA)
    conn.commit()


def loaded_revision(conn, dataset: str, period: str):
    """
    The catalogue revision of the period already loaded, or None.

    What lets a load skip a file whose revision has not moved, and what lets it
    know a reload is a REPLACEMENT rather than an addition.
    """
    with conn.cursor() as cur:
        cur.execute(
            'SELECT catalogue_revision FROM br.source_file '
            'WHERE dataset = %s AND period = %s', (dataset, period))
        row = cur.fetchone()
    return row[0] if row else None


def load_period(conn, dataset: str, path: Path, provenance: dict,
                chunk: int = 200_000, progress=None) -> dict:
    """
    One ONS period file into its table, replacing any revision already there.

    DELETE BEFORE INSERT, IN ONE TRANSACTION. ONS rewrote every month of
    2025-01..2026-03 in a batch; a load that merely inserted would leave both
    revisions in the table, and every sum over those fourteen months would
    silently double. The delete is by source_id and cascades, so it removes
    exactly the rows the superseded file put there and nothing a neighbouring
    period contributed.

    Streamed through COPY in chunks rather than INSERTed: the photovoltaic
    detail record is about 19 million rows over its published span, and row-wise
    insertion of that is measured in hours where COPY is measured in minutes.

    Returns a summary of what was loaded.
    """
    import pandas as pd

    from terra.grid import ons

    spec = TABLES[dataset]
    period = provenance['period']
    revision = provenance.get('catalogue_revision')
    already = loaded_revision(conn, dataset, period)
    if already is not None and already == revision:
        return {'dataset': dataset, 'period': period, 'rows': 0,
                'action': 'skipped', 'conflicts': 0,
                'note': 'This revision is already loaded.'}

    source_cols = list(spec['columns'])
    target_cols = ([spec['columns'][c] for c in source_cols] + ['ceg_core']
                   + list(spec.get('derive', ())) + ['source_id'])
    # Read whole rather than in chunks. A month is about 640,000 rows, which is
    # a frame this holds comfortably, and the duplicate detection below has to
    # see the whole file: a colliding pair split across a chunk boundary would
    # pass both halves to COPY and raise on the primary key, which is the
    # failure this exists to replace with a recorded decision.
    frame = pd.read_csv(path, usecols=source_cols, **ons.CSV_KWARGS)
    frame = frame[source_cols]

    collided = frame.duplicated(['id_ons', 'din_instante'], keep=False)
    conflicts = []
    if collided.any():
        clash = frame[collided]
        exact = set(map(tuple, clash[clash.duplicated(keep=False)]
                        [['id_ons', 'din_instante']].values))
        for (unit, when), group in clash.groupby(['id_ons', 'din_instante']):
            conflicts.append((unit, when, len(group),
                              (unit, when) in exact))
        frame = frame.drop_duplicates(['id_ons', 'din_instante'], keep='first')

    # '-' is how ONS writes an absent CEG; see ceg_core. Both the raw column
    # and the core become NULL, so a cluster row is stored as having no
    # enterprise rather than as having one named '-'.
    #
    # BUILT AS PYTHON LISTS, NOT THROUGH Series.map, AND THAT IS THE WHOLE
    # POINT. pandas turns a None returned by a mapped function into NaN on an
    # object column, and NaN IS NOT None: the guard `core is not None` is then
    # true for every row, and psycopg writes the float as the four characters
    # 'nan'. It loaded 2,685,264 rows of the curtailment record that way --
    # absence disguised as a value, which is the exact defect ceg_core exists
    # to remove, arriving through a different door. Lists keep None as None.
    # EVERY ABSENT VALUE BECOMES None, ONCE, FOR THE WHOLE FRAME.
    #
    # Not a tidy-up: pandas reads a blank cell as NaN, and PostgreSQL ACCEPTS
    # NaN in a real column, so it is stored rather than rejected -- and one NaN
    # makes every sum over that column NaN. The curtailment record arrived with
    # 2,804,924 NaN in reference and 2,154,470 in generation_cap, because ONS
    # leaves those blank on the cluster rows that are 95 percent of the file,
    # and the first working query returned 'nan MWh'. The text columns take the
    # same route to a different symptom, the four characters 'nan'.
    #
    # Done here for the frame rather than per column, because a list of which
    # columns can be blank is a list that goes stale the first time ONS adds
    # one. This was the third appearance of the same defect -- '-' for an
    # absent CEG, 0.0 for an absent coordinate, NaN for an absent number -- and
    # the first two were each fixed where they were found.
    frame = frame.astype(object).where(frame.notna(), None)

    raw = frame['ceg'].tolist()
    cores = [ceg_core(v) for v in raw]
    cegs = [None if (v is None or str(v).strip() in ('', '-', 'nan')) else v
            for v in raw]
    frame = frame.assign(ceg=cegs)

    # A cluster row is one with no CEG, and its name IS the cluster's; a plant
    # row keys on nothing here and reaches its curtailment through its own CEG.
    extra = []
    if 'cluster_key' in spec.get('derive', ()):
        extra.append([None if core else cluster_key(nome)
                      for core, nome in zip(cores, frame['nom_usina'].tolist(),
                                            strict=True)])

    with conn.cursor() as cur:
        # CASCADE from source_file removes the superseded rows; see the
        # docstring. Done inside the same transaction as the insert, so a load
        # that fails halfway leaves the previous revision intact rather than
        # leaving the table empty.
        cur.execute('DELETE FROM br.source_file WHERE dataset = %s '
                    'AND period = %s', (dataset, period))
        cur.execute(
            'INSERT INTO br.source_file '
            '(dataset, period, filename, catalogue_revision) '
            'VALUES (%s, %s, %s, %s) RETURNING source_id',
            (dataset, period, provenance['file'], revision))
        source_id = cur.fetchone()[0]

        copy_sql = (f'COPY {spec["table"]} ({", ".join(target_cols)}) '
                    f'FROM STDIN')
        with cur.copy(copy_sql) as copy:
            for i, (row, core) in enumerate(
                    zip(frame.itertuples(index=False, name=None),
                        cores, strict=True)):
                copy.write_row((*row, core, *(e[i] for e in extra), source_id))
        total = len(frame)

        for unit, when, n, identical in conflicts:
            cur.execute(
                'INSERT INTO br.load_conflict (source_id, table_name, id_ons, '
                'instante, n_rows, identical) VALUES (%s, %s, %s, %s, %s, %s)',
                (source_id, spec['table'], unit, when, n, identical))

        cur.execute('UPDATE br.source_file SET row_count = %s '
                    'WHERE source_id = %s', (total, source_id))
    conn.commit()
    return {'dataset': dataset, 'period': period, 'rows': total,
            'action': 'replaced' if already else 'inserted',
            'conflicts': len(conflicts),
            'superseded_revision': already, 'catalogue_revision': revision}


def plants_in_aoi(conn, geojson_geometry, kind=None):
    """
    The plants whose point falls inside an AOI, as (ceg_core, name, ...).

    THE JOIN THIS WHOLE MODULE EXISTS FOR. TERRA asks about a polygon; ONS
    answers about a CEG; only ANEEL knows the two are the same place.

    A POINT IS NOT A PLANT. ANEEL publishes one coordinate pair per enterprise,
    so a 50 MW plant covering several square kilometres is a single point that
    may sit outside an AOI drawn over part of its own array. Callers wanting
    plants NEAR an AOI rather than inside it should buffer the geometry; doing
    that here would report a containment that was not asked for.
    """
    import json

    sql = ['SELECT ceg_core, name, kind, uf, municipality, capacity_kw, '
           'ST_X(geom) AS lon, ST_Y(geom) AS lat FROM br.plant '
           'WHERE ST_Intersects(geom, ST_GeomFromGeoJSON(%s))']
    params = [json.dumps(geojson_geometry)]
    if kind is not None:
        sql.append('AND kind = %s')
        params.append(kind)
    with conn.cursor() as cur:
        cur.execute(' '.join(sql), params)
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]


# ANEEL SIGA, the only public source of a coordinate per enterprise. Its column
# names are its own and are stated here rather than at the call site, for the
# reason TABLES exists: a name spelled in a caller is a name no test can check.
SIGA_COLUMNS = {
    'CodCEG': 'ceg',
    'NomEmpreendimento': 'name',
    'SigTipoGeracao': 'kind',
    'SigUFPrincipal': 'uf',
    'DscMuninicpios': 'municipality',
    'MdaPotenciaFiscalizadaKw': 'capacity_kw',
    'DatEntradaOperacao': 'operation_start',
    'NumCoordNEmpreendimento': 'lat',
    'NumCoordEEmpreendimento': 'lon',
}


def load_plants(conn, siga_csv: Path, progress=None) -> dict:
    """
    The plant table, from an ANEEL SIGA export.

    THE FILE IS UTF-8 AND ITS CONTENT LOOKS LIKE LATIN-1 UNTIL IT IS READ AS
    UTF-8. Read wrong it does not fail: 'Operacao' comes back as mojibake and
    is stored, so a municipality name in the table is subtly wrong in a way no
    query reports and only a human reading a result notices.

    SIGA IDENTIFIES A UNIT TOO, with a '.1' suffix where ONS writes '.01'.
    Both reduce to the same enterprise through ceg_core, which is what makes
    the join work at all, and it means several SIGA rows can share one core --
    25,130 cores across 25,133 rows. The table is keyed on the core, so the
    duplicates are collapsed here rather than raising on insert.

    Replaces the table wholesale. SIGA is a snapshot of a register, not an
    append-only record, and a plant that left it should leave here too.
    """
    import pandas as pd

    frame = pd.read_csv(siga_csv, sep=';', decimal=',', encoding='utf-8',
                        usecols=list(SIGA_COLUMNS), low_memory=False)
    frame = frame.rename(columns=SIGA_COLUMNS)
    # As a list, for the reason load_period states: Series.map turns a None
    # into NaN and the two are not interchangeable. The notna() below happens
    # to catch NaN as well, so this path was correct by accident -- and a
    # second spelling of the same operation is how the defect comes back.
    frame['ceg_core'] = [ceg_core(v) for v in frame['ceg'].tolist()]
    frame = frame[frame['ceg_core'].notna()]
    frame = frame.drop_duplicates('ceg_core', keep='first')
    frame['operation_start'] = pd.to_datetime(
        frame['operation_start'], errors='coerce').dt.date

    rows = 0
    with conn.cursor() as cur:
        cur.execute('TRUNCATE br.plant')
        copy_sql = ('COPY br.plant (ceg_core, name, kind, uf, municipality, '
                    'capacity_kw, operation_start, geom) FROM STDIN')
        with cur.copy(copy_sql) as copy:
            copy.set_types(['text', 'text', 'text', 'text', 'text',
                            'float8', 'date', 'text'])
            for r in frame.itertuples(index=False):
                # A row with no coordinate is still a plant and is still
                # joinable by CEG; only the spatial query cannot reach it.
                # Dropping it would silently shrink the register.
                #
                # ANEEL WRITES AN ABSENT COORDINATE AS 0.0, NOT AS EMPTY, and
                # 432 of the 25,130 enterprises are recorded that way -- the
                # same defect as the ONS '-' for an absent CEG, wearing a
                # different disguise. Stored as given they become a point in
                # the Gulf of Guinea, and an AOI drawn anywhere near the origin
                # returns 432 Brazilian plants that are not there. Exactly
                # (0, 0) is absence; no Brazilian plant sits within 2000 km of
                # it, so nothing real is lost by reading it that way.
                missing = (pd.isna(r.lat) or pd.isna(r.lon)
                           or (float(r.lat) == 0.0 and float(r.lon) == 0.0))
                geom = (None if missing
                        else f'SRID=4326;POINT({r.lon} {r.lat})')
                copy.write_row((
                    r.ceg_core, r.name, r.kind, r.uf, r.municipality,
                    None if pd.isna(r.capacity_kw) else float(r.capacity_kw),
                    None if pd.isna(r.operation_start) else r.operation_start,
                    geom))
                rows += 1
        if progress:
            progress(rows)
    conn.commit()
    with conn.cursor() as cur:
        cur.execute('SELECT count(*), count(geom) FROM br.plant')
        total, located = cur.fetchone()
    return {'rows': rows, 'stored': total, 'with_geometry': located}



def register_geojson(conn, bbox=None, kinds=None, limit: int = 40000) -> dict:
    """
    The plant register as a layer, so an area is drawn over something visible.

    THE MAP IS BARE AND THAT IS THE DEFECT THIS ANSWERS. Every question this
    slice takes is "what about the plants inside this polygon", and until the
    polygon is drawn nothing on screen says where a plant is. An area drawn
    over a solar farm the imagery plainly shows can return no plant at all, and
    an empty answer is then indistinguishable from a broken one. Drawing the
    register first makes the polygon a choice instead of a guess.

    `metered` IS THE POINT OF THE LAYER, NOT A DETAIL OF IT. ANEEL registers
    18,639 located photovoltaic enterprises; ONS meters 558 of them, three
    percent. Every action in this slice can only answer about those 558, so a
    layer that drew all 18,639 alike would invite an area over the other 97
    percent and give nothing back. The two populations are different questions
    and the map has to tell them apart.

    ONE POINT PER ENTERPRISE, which is what the register publishes and not what
    a plant is: a 40 MW array covering a square kilometre is a dot. So this is
    a layer of WHERE THE RECORD THINKS A PLANT IS, and it is drawn as points
    rather than footprints because footprints are not published and inventing
    them would be inventing the one thing the reader would trust it for.

    Returned whole rather than per viewport. The located register is 24,698
    points and about 4 MB of GeoJSON, which a map draws without help; a
    viewport query would add a round trip to every pan for a payload that fits
    in memory once.
    """
    import json

    where = ['p.geom IS NOT NULL']
    params: list = []
    if bbox:
        # west, south, east, north -- the order every GeoJSON bbox uses.
        where.append('p.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)')
        params.extend(float(v) for v in bbox)
    if kinds:
        where.append('p.kind = ANY(%s)')
        params.append(list(kinds))
    params.append(int(limit))

    with conn.cursor() as cur:
        cur.execute(f"""
            WITH metered AS (
                -- In the record either directly or through the cluster ONS
                -- curtails, because the curtailment record names clusters and
                -- the detail record names plants, and a plant reached only by
                -- the second is still one this slice can answer about.
                -- DISTINCT BEFORE THE UNION, and it is 7.5x. Without it
                -- the union deduplicates 19,088,880 detail rows against 680
                -- cluster rows and takes 4.1 seconds; with it the index on
                -- ceg_core yields the 560 distinct values and it takes 0.54.
                -- The set is identical either way -- UNION already dedupes --
                -- so this is only about how much the planner is asked to sort.
                SELECT DISTINCT ceg_core FROM br.pv_detail
                UNION
                SELECT ceg_core FROM br.plant_cluster
            )
            SELECT p.ceg_core, p.name, p.kind, p.uf, p.municipality,
                   p.capacity_kw, p.operation_start,
                   (m.ceg_core IS NOT NULL) AS metered,
                   ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat
            FROM br.plant p
            LEFT JOIN metered m USING (ceg_core)
            WHERE {' AND '.join(where)}
            ORDER BY p.capacity_kw DESC NULLS LAST
            LIMIT %s
        """, params)
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]

    features = []
    for r in rows:
        features.append({
            'type': 'Feature',
            'geometry': {'type': 'Point',
                         'coordinates': [round(r['lon'], 5),
                                         round(r['lat'], 5)]},
            'properties': {
                'ceg': r['ceg_core'],
                'name': r['name'],
                'kind': r['kind'],
                'uf': r['uf'],
                'municipality': r['municipality'],
                'mw': (None if r['capacity_kw'] is None
                       else round(r['capacity_kw'] / 1000.0, 1)),
                'since': (None if r['operation_start'] is None
                          else str(r['operation_start'])),
                'metered': bool(r['metered']),
            },
        })

    with conn.cursor() as cur:
        cur.execute('SELECT count(*), count(geom) FROM br.plant')
        registered, located = cur.fetchone()
    return {
        'type': 'FeatureCollection',
        'features': features,
        # Counted over what was RETURNED, not over the register, because a
        # bbox or a kind filter makes those different numbers and a reader
        # comparing the legend to the map needs the one the map is showing.
        'counts': {
            'returned': len(features),
            'metered': sum(1 for f in features if f['properties']['metered']),
            'registered': registered,
            'located': located,
            'truncated': len(features) >= limit,
        },
    }



def network_geojson(conn, bbox=None, min_kv: float = 0.0) -> dict:
    """
    The transmission network as two layers, so a site's distance to it is
    visible before it is measured.

    TWO COLLECTIONS AND NOT ONE. A line is drawn as a line and a bus as a point,
    and MapLibre needs them apart; merging them would make the caller split
    them again by geometry type, which is a decision this already made.

    THE GEOMETRY IS THE SEGMENT BETWEEN TERMINALS, NOT THE ROUTE, and that has
    to travel with the layer rather than sit in documentation. ONS publishes a
    line's two ends and its length and never its path, so a line drawn from
    this is in the right place and on the wrong course. Measured against the
    published lengths, the real conductor runs 7.7 percent longer than its
    segment at the median and 40.8 percent at the ninetieth percentile.

    IT IS TRANSMISSION AND NOT DISTRIBUTION. The lines in service run 230 kV and
    above; the substations reach down to 69 kV because a 500/230/138 station has
    all three buses, but the circuits joining anything below 230 are not in this
    register. A site that cannot reach 230 kV is not thereby unconnectable --
    it is unanswerable from here.

    capacity_mva is null on 41 percent of lines in service. Null is a rating
    the register does not publish, never a line of no capacity, and no
    published value is zero.
    """
    lines_where = ['l.geom IS NOT NULL']
    subs_where = ['s.geom IS NOT NULL']
    lp: list = []
    sp: list = []
    if bbox:
        lines_where.append('l.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)')
        lp.extend(float(v) for v in bbox)
        subs_where.append('s.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)')
        sp.extend(float(v) for v in bbox)
    if min_kv:
        lines_where.append('l.voltage_kv >= %s')
        lp.append(float(min_kv))
        subs_where.append('s.voltage_kv >= %s')
        sp.append(float(min_kv))

    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT l.line_id, l.name, l.voltage_kv, l.capacity_mva,
                   l.in_service, l.published_length_km, l.straight_length_km,
                   ST_AsGeoJSON(l.geom) AS g
            FROM br.transmission_line l
            WHERE {' AND '.join(lines_where)}
            ORDER BY l.voltage_kv DESC NULLS LAST
        """, lp)
        cols = [d.name for d in cur.description]
        line_rows = [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]

        cur.execute(f"""
            SELECT s.bus, s.name, s.voltage_kv, s.uf, s.subsystem, s.operator,
                   ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat
            FROM br.substation s
            WHERE {' AND '.join(subs_where)}
            ORDER BY s.voltage_kv DESC NULLS LAST
        """, sp)
        cols = [d.name for d in cur.description]
        sub_rows = [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]

    import json as _json

    lines = {
        'type': 'FeatureCollection',
        'features': [{
            'type': 'Feature',
            'geometry': _json.loads(r['g']),
            'properties': {
                'id': r['line_id'],
                'name': (r['name'] or '').strip(),
                'kv': r['voltage_kv'],
                'mva': r['capacity_mva'],
                'in_service': bool(r['in_service']),
                # Both lengths, because their ratio is the route factor for
                # THIS line and a reader measuring a distance to it needs the
                # one that applies rather than the fleet median.
                'published_km': r['published_length_km'],
                'straight_km': (None if r['straight_length_km'] is None
                                else round(r['straight_length_km'], 1)),
            },
        } for r in line_rows],
    }
    substations = {
        'type': 'FeatureCollection',
        'features': [{
            'type': 'Feature',
            'geometry': {'type': 'Point',
                         'coordinates': [round(r['lon'], 5),
                                         round(r['lat'], 5)]},
            'properties': {
                'bus': r['bus'],
                'name': (r['name'] or '').strip(),
                'kv': r['voltage_kv'],
                'uf': r['uf'],
                'subsystem': r['subsystem'],
                'operator': (r['operator'] or '').strip() or None,
            },
        } for r in sub_rows],
    }
    rated = sum(1 for r in line_rows
                if r['in_service'] and r['capacity_mva'] is not None)
    in_service = sum(1 for r in line_rows if r['in_service'])
    return {
        'lines': lines,
        'substations': substations,
        'counts': {
            'lines': len(line_rows),
            'lines_in_service': in_service,
            'lines_with_rating': rated,
            'substations': len(sub_rows),
        },
        'route_factor': {'median': 1.077, 'p90': 1.408},
        'note': (
            'Lines are drawn as the straight segment between their terminals, '
            'which is all the register publishes. The conductor runs about 8 '
            'percent longer at the median and 41 percent at the ninetieth '
            'percentile. Transmission only: circuits below 230 kV are not in '
            'this register.'
        ),
    }


def series(conn, dataset: str, start: str, end: str, ceg_core=None,
           id_ons=None, aoi=None, columns=None):
    """
    The record for a window, for the plants asked for, as a frame.

    THE ONLY IMPLEMENTATION OF THIS QUESTION. ons.py once answered it too, from
    the published files, by reading a 93 MB month to keep a day of it -- which
    is all ONS itself offers. That path is gone and the store is a hard
    requirement of this slice, so the window arithmetic below exists once. Here
    the same question is an index lookup: measured at 0.001 s against 1.251 s
    for one plant over one day, and 0.267 s against 52.080 s over a year, with
    both returning identical rows.

    Three ways to say which plants, and they compose. `id_ons` addresses the
    record's own unit, including clusters, which have no CEG. `ceg_core`
    addresses an enterprise. `aoi` is a GeoJSON geometry and reaches plants
    through br.plant, so it can only find what ANEEL has a coordinate for --
    which is every photovoltaic plant in the record and none of the 142 wind
    clusters. That asymmetry is the record's, and plants_in_aoi states it.
    """
    import json

    import pandas as pd

    table = TABLES[dataset]['table']
    selected = ', '.join(columns) if columns else '*'
    sql = [f'SELECT {selected} FROM {table} WHERE instante >= %s '
           f'AND instante < %s']
    # Exclusive at the following midnight, for the reason ons.read gives: `end`
    # parses as 00:00 of its own day, and closing on the next midnight admits
    # the first record of the day after.
    params = [pd.Timestamp(start), pd.Timestamp(end) + pd.Timedelta(days=1)]

    if id_ons is not None:
        sql.append('AND id_ons = ANY(%s)')
        params.append([id_ons] if isinstance(id_ons, str) else list(id_ons))
    if ceg_core is not None:
        sql.append('AND ceg_core = ANY(%s)')
        params.append([ceg_core] if isinstance(ceg_core, str)
                      else list(ceg_core))
    if aoi is not None:
        sql.append(
            'AND ceg_core IN (SELECT ceg_core FROM br.plant '
            'WHERE ST_Intersects(geom, ST_GeomFromGeoJSON(%s)))')
        params.append(json.dumps(aoi))

    sql.append('ORDER BY instante')
    with conn.cursor() as cur:
        cur.execute(' '.join(sql), params)
        cols = [d.name for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def coverage(conn):
    """
    What the store holds, per dataset: periods, rows and the revision of each.

    A store is only trustworthy if it can say what is in it. Read straight from
    br.source_file rather than counted from the fact tables, so a period whose
    rows failed to load reports as absent instead of as present and empty.
    """
    with conn.cursor() as cur:
        cur.execute(
            'SELECT dataset, count(*), min(period), max(period), '
            'sum(row_count), max(loaded_utc) FROM br.source_file '
            'GROUP BY dataset ORDER BY dataset')
        return [
            {'dataset': d, 'periods': n, 'from': lo, 'to': hi,
             'rows': int(rows or 0), 'loaded_utc': when}
            for d, n, lo, hi, rows, when in cur.fetchall()
        ]


def load_network(conn, substations_parquet: Path, lines_parquet: Path) -> dict:
    """
    The substations and transmission lines, from the ONS equipment register.

    COORDINATES ARRIVE AS TEXT WITH A COMMA, and read as published they are
    strings that no spatial index can hold. Converted here rather than at the
    call site so a caller cannot get it right in one place and wrong in
    another.

    TERMINALS JOIN ON THE BUS NUMBER, NOT THE NAME. The name is padded with
    trailing spaces in one of the two columns -- nom_subestacao_para carries
    them and nom_subestacao_de does not -- so an untrimmed name join resolves
    2,292 lines on one end and ZERO on the other, and looks like a coverage
    problem rather than like whitespace. The bus number is an integer, unique
    across the 1,677 located substations, and resolves the same 95 percent
    without depending on how a name was typed.

    THE SEGMENT IS NOT THE ROUTE. See the schema. This returns the distribution
    of published length over segment length so the caller knows how much the
    straight line understates before using a distance from it.
    """
    import numpy as np
    import pandas as pd

    subs = pd.read_parquet(substations_parquet)
    for column in ('val_latitude', 'val_longitude'):
        subs[column] = pd.to_numeric(
            subs[column].astype(str).str.replace(',', '.'), errors='coerce')
    subs['name'] = subs['nom_subestacao'].astype(str).str.strip()
    subs = subs[subs['val_latitude'].notna() & subs['val_longitude'].notna()]
    # The bus is the key a line's terminals are resolved by, so a substation
    # without one cannot be reached from a line and cannot be stored under a
    # primary key. Counted rather than dropped silently.
    located = len(subs)
    subs = subs[subs['num_barra'].notna()]
    without_bus = located - len(subs)
    # One substation appears once per voltage level it operates at. The highest
    # is kept, because it is the level a transmission connection would be made
    # at and the one a line's terminal refers to.
    subs = subs.sort_values('val_niveltensao', ascending=False)
    subs = subs.drop_duplicates('num_barra', keep='first')

    with conn.cursor() as cur:
        cur.execute('TRUNCATE br.transmission_line')
        cur.execute('TRUNCATE br.substation CASCADE')
        with cur.copy('COPY br.substation (bus, name, voltage_kv, subsystem, '
                      'uf, operator, geom) FROM STDIN') as copy:
            for r in subs.itertuples(index=False):
                copy.write_row((
                    int(r.num_barra), r.name,
                    None if pd.isna(r.val_niveltensao) else float(r.val_niveltensao),
                    r.id_subsistema, r.id_estado, r.nom_agente_principal,
                    f'SRID=4326;POINT({r.val_longitude} {r.val_latitude})'))
    conn.commit()

    point = {int(r.num_barra): (float(r.val_longitude), float(r.val_latitude))
             for r in subs.itertuples(index=False)}

    lines = pd.read_parquet(lines_parquet)
    lines = lines.astype(object).where(lines.notna(), None)
    kept, ratios = 0, []
    with conn.cursor() as cur:
        with cur.copy(
            'COPY br.transmission_line (equipment, name, bus_from, bus_to, '
            'voltage_kv, capacity_mva, reactance_pu, published_length_km, '
            'straight_length_km, in_service, geom) FROM STDIN'
        ) as copy:
            for r in lines.itertuples(index=False):
                a = point.get(int(r.num_barra_de)) if r.num_barra_de else None
                b = point.get(int(r.num_barra_para)) if r.num_barra_para else None
                if a is None or b is None or a == b:
                    continue
                straight = _great_circle_km(a, b)
                published = (None if r.val_comprimento is None
                             else float(r.val_comprimento))
                if published and straight > 0:
                    ratios.append(published / straight)
                copy.write_row((
                    str(r.cod_equipamento).strip(), r.nom_linhadetransmissao,
                    int(r.num_barra_de), int(r.num_barra_para),
                    r.val_niveltensao_kv, r.val_capacidadeoperveraodialonga,
                    r.val_reatancia, published, straight,
                    r.dat_desativacao is None,
                    f'SRID=4326;LINESTRING({a[0]} {a[1]},{b[0]} {b[1]})'))
                kept += 1
    conn.commit()

    ratio = np.array(ratios) if ratios else np.array([np.nan])
    return {
        'substations': len(subs),
        'substations_without_bus': without_bus,
        'lines': kept,
        'lines_unresolved': len(lines) - kept,
        # How much longer the real route is than the segment stored for it.
        # A distance to the segment is short by roughly this factor.
        'route_over_segment': {
            'median': round(float(np.nanmedian(ratio)), 3),
            'p90': round(float(np.nanpercentile(ratio, 90)), 3),
            'n': len(ratios),
        },
    }


def _great_circle_km(a, b) -> float:
    """
    Distance between two lon/lat pairs, on a sphere.

    Enough for a line length that is itself an approximation of a route; the
    ellipsoidal correction is far below the error the straight segment already
    carries.
    """
    import math

    r = 6371.0088
    lon1, lat1 = (math.radians(v) for v in a)
    lon2, lat2 = (math.radians(v) for v in b)
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


#: The capacity-factor register's columns, and what they are here.
CAPACITY_COLUMNS = {
    'id_ons': 'id_ons',
    'nom_usina_conjunto': 'name',
    'nom_tipousina': 'kind',
    'id_subsistema': 'subsystem',
    'id_estado': 'uf',
    'cod_pontoconexao': 'connection_code',
    'nom_pontoconexao': 'connection_name',
    'val_capacidadeinstalada': 'capacity_mw',
    'val_latitudepontoconexao': 'conn_lat',
    'val_longitudepontoconexao': 'conn_lon',
    'val_latitudesecoletora': 'coll_lat',
    'val_longitudesecoletora': 'coll_lon',
}


def load_units(conn, capacity_csv: Path) -> dict:
    """
    The ONS unit register, from one month of the capacity-factor record.

    ONE MONTH IS ENOUGH AND MORE WOULD BE WORSE. The coordinate, the capacity
    and the connection point are static metadata repeated on every half-hourly
    row; reading a year of them would be sixty million rows to learn eighty-odd
    facts. The research takes the latest file for the same reason.

    KEYED ON id_ons, WHICH IS WHY THIS EXISTS. br.plant is the ANEEL register
    and reaches enterprises; the curtailment record is mostly clusters, which
    ANEEL has no row for. 83 of 87 units in that record join to nothing in
    br.plant and all of them are here.

    Replaces the table wholesale: it describes the register's present state,
    not its history.
    """
    import pandas as pd

    from terra.grid import ons

    frame = pd.read_csv(capacity_csv, usecols=list(CAPACITY_COLUMNS),
                        **ons.CSV_KWARGS)
    frame = frame.rename(columns=CAPACITY_COLUMNS)
    frame = frame.astype(object).where(frame.notna(), None)
    # One row per unit. Sorted by capacity so a unit whose capacity changed
    # mid-month keeps the larger, which is the plate rating rather than a
    # partial month's.
    frame = frame.sort_values('capacity_mw', ascending=False, na_position='last')
    frame = frame.drop_duplicates('id_ons', keep='first')

    def point(lon, lat):
        if lon is None or lat is None:
            return None
        return f'SRID=4326;POINT({float(lon)} {float(lat)})'

    rows = 0
    with conn.cursor() as cur:
        cur.execute('TRUNCATE br.ons_unit')
        copy_sql = ('COPY br.ons_unit (id_ons, name, kind, subsystem, uf, '
                    'connection_code, connection_name, capacity_mw, '
                    'geom_connection, geom_collector) FROM STDIN')
        with cur.copy(copy_sql) as copy:
            copy.set_types(['text', 'text', 'text', 'text', 'text', 'text',
                            'text', 'float8', 'text', 'text'])
            for r in frame.itertuples(index=False):
                copy.write_row((
                    r.id_ons, r.name, r.kind, r.subsystem, r.uf,
                    r.connection_code, r.connection_name,
                    None if r.capacity_mw is None else float(r.capacity_mw),
                    point(r.conn_lon, r.conn_lat),
                    point(r.coll_lon, r.coll_lat)))
                rows += 1
    conn.commit()
    with conn.cursor() as cur:
        cur.execute('SELECT count(*), count(geom_connection), '
                    'count(geom_collector) FROM br.ons_unit')
        total, conn_geom, coll_geom = cur.fetchone()
    return {'units': rows, 'stored': total,
            'with_connection_point': conn_geom,
            'with_collector': coll_geom}
