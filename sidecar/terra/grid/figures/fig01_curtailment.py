"""
Fig. 1 -- Photovoltaic curtailment in the SIN.

Ported from notebooks/01_curtailment_solar_sin.ipynb. The analysis is the
notebook's; only `read` changed, because the rows now come from an indexed
store instead of from thirty monthly CSVs streamed one at a time.

WHAT IT ESTABLISHES, and why it is first: the curtailment identity every later
figure uses, and the premise that motivates the rest of the series -- verified
generation stopped being a proxy for the resource, because a plant told not to
generate produced nothing its irradiance explains.

THE IDENTITY, stated once here and reused:

    corte = max(coalesce(reference_final, reference) - generation, 0)

restricted to rows carrying a reason code. Three things in that line are
load-bearing:

  * the COALESCE is not a nicety. reference_final is present on 5.3 percent of
    restricted rows and reference on 100 percent, so the fallback carries
    nineteen rows in twenty rather than an edge case.
  * the CLIP handles reference below verified generation, which happens on
    about a fifth of restricted rows. Those are counted and reported rather
    than silently absorbed -- a negative loss is a fact about the operator's
    estimate, not a number to hide.
  * the RESTRICTION FILTER is what makes it a cut. Without it the same
    subtraction over unrestricted rows is the estimate's own error, which is
    what the series' own Fig. 6 later measures.

val_geracaolimitada is NOT the cut, and the notebook proves it rather than
asserting it: it correlates 0.86 with verified generation and 0.02 with the
real loss. It is the imposed cap.
"""

from __future__ import annotations

import pandas as pd

#: Reason codes, in the operator's vocabulary and then in the reader's.
REASON_LABEL = {
    'ENE': 'Energetic',
    'CNF': 'Reliability',
    'REL': 'External unavailability',
    'PAR': 'Access opinion',
}


def read(conn, start: str | None = None, end: str | None = None) -> dict:
    """
    The half-hourly record, aggregated in the database rather than in pandas.

    THE NOTEBOOK'S LOOP IS NOW A GROUP BY. It read thirty monthly CSVs of about
    94,000 rows each and concatenated per-file aggregates; the same three
    aggregates come out of one indexed scan. The definition below is the
    notebook's, transcribed into SQL, and `analyse` receives frames of the same
    shape the loop produced.

    Returns the three raw aggregates plus the integrity counts, which are part
    of the result and not diagnostics: the share of rows carrying a restriction
    and the share whose reference falls below verified generation both appear
    in the published caption.
    """
    where = ['1 = 1']
    params: list = []
    if start:
        where.append('instante >= %s')
        params.append(pd.Timestamp(start))
    if end:
        where.append('instante < %s')
        params.append(pd.Timestamp(end) + pd.Timedelta(days=1))
    window = ' AND '.join(where)

    # The identity, once, as a SQL expression the three queries share.
    cut = ("GREATEST(COALESCE(reference_final, reference) - generation, 0)")
    restricted = 'reason_code IS NOT NULL'

    ts = pd.read_sql(f"""
        SELECT instante, subsystem AS id_subsistema,
               sum(generation) AS val_geracao,
               sum(CASE WHEN {restricted} THEN {cut} ELSE 0 END) AS corte_mw
        FROM br.pv_curtail WHERE {window}
        GROUP BY 1, 2 ORDER BY 1
    """, conn, params=params)

    attribution = pd.read_sql(f"""
        SELECT reason_code AS cod_razaorestricao,
               origin_code AS cod_origemrestricao,
               sum({cut}) AS corte_mw
        FROM br.pv_curtail WHERE {window} AND {restricted}
        GROUP BY 1, 2
    """, conn, params=params)

    # Grouped by id_ons alone, for the reason the notebook states: the same
    # identifier appears under spellings that differ by an accent, and grouping
    # by name would split one plant into two rows.
    plants = pd.read_sql(f"""
        SELECT c.id_ons,
               max(c.plant_name) AS nom_usina,
               max(c.subsystem)  AS id_subsistema,
               max(c.uf)         AS id_estado,
               sum(c.generation) AS val_geracao,
               sum(CASE WHEN {restricted} THEN {cut} ELSE 0 END) AS corte_mw,
               max(ST_Y(u.geom_collector))  AS lat,
               max(ST_X(u.geom_collector))  AS lon,
               max(u.capacity_mw)           AS cap_mw
        FROM br.pv_curtail c
        -- br.ons_unit and NOT br.plant, keyed on id_ons and not on the CEG.
        --
        -- The curtailment record is 95 percent CLUSTER rows carrying no CEG,
        -- and ANEEL has no row for a cluster: joining to br.plant reached 4 of
        -- 87 units and drew a map of four points where the published one draws
        -- the fleet. The operator's own register covers them because it is
        -- keyed the way the operator identifies them.
        --
        -- THE COLLECTOR COORDINATE, which is the one the published figure
        -- used. Not the connection point, and the two differ: the series' own
        -- Fig. 7 measured the collector substation at a median 1.9 km from the
        -- array, more than 750 m in 31 of 37 clusters, and had to redo an
        -- event study that the substation coordinate had returned null. For
        -- THIS figure the collector is what was drawn, so it is what is
        -- reproduced.
        LEFT JOIN br.ons_unit u
               ON u.id_ons = c.id_ons AND u.kind = 'Solar'
        WHERE {window}
        GROUP BY 1
    """, conn, params=params)

    integrity = pd.read_sql(f"""
        SELECT count(*) AS n_rows_total,
               count(*) FILTER (WHERE {restricted}) AS n_restrito,
               count(*) FILTER (
                   WHERE {restricted}
                     AND COALESCE(reference_final, reference) < generation
               ) AS n_ref_negativa
        FROM br.pv_curtail WHERE {window}
    """, conn, params=params).iloc[0].to_dict()

    return {'ts': ts, 'attribution': attribution, 'plants': plants,
            'integrity': integrity}


def analyse(frames: dict) -> dict:
    """
    The four source tables, identical in shape to the notebook's.

    THE TIME STEP IS DERIVED, NOT ASSUMED. The notebook takes the modal
    difference between consecutive stamps and asserts it lands in (0, 1] hours.
    Hard-coding 0.5 would be right today and silently wrong the day the
    operator publishes at another cadence -- and every energy figure below
    multiplies by it.
    """
    ts = frames['ts'].copy()
    ts['instante'] = pd.to_datetime(ts['instante'])

    step = ts['instante'].drop_duplicates().sort_values().diff().mode().iloc[0]
    dt_h = step.total_seconds() / 3600
    if not 0 < dt_h <= 1:
        raise ValueError(f'unexpected time step in the record: {step}')

    energy = ts.assign(
        gerada_mwh=ts['val_geracao'] * dt_h,
        cortada_mwh=ts['corte_mw'] * dt_h,
    )

    # (a) the SIN's diurnal profile
    sin = energy.groupby('instante', as_index=False)[
        ['val_geracao', 'corte_mw']].sum()
    sin['hora'] = sin['instante'].dt.hour + sin['instante'].dt.minute / 60
    diurnal = (sin.groupby('hora')
               .agg(geracao_mw=('val_geracao', 'mean'),
                    corte_mw=('corte_mw', 'mean'),
                    n=('val_geracao', 'size'))
               .reset_index())
    diurnal['disponivel_mw'] = diurnal['geracao_mw'] + diurnal['corte_mw']

    # (b) monthly rate by subsystem
    monthly = (energy.assign(period=energy['instante'].dt.to_period('M'))
               .groupby(['period', 'id_subsistema'], as_index=False)
               [['gerada_mwh', 'cortada_mwh']].sum())
    monthly['taxa'] = (monthly['cortada_mwh']
                       / (monthly['gerada_mwh'] + monthly['cortada_mwh']))
    monthly['data'] = monthly['period'].dt.to_timestamp()
    monthly['period'] = monthly['period'].astype(str)

    # (c) reason x origin, in GWh
    attr = frames['attribution'].dropna(subset=['cod_razaorestricao']).copy()
    attr['gwh'] = attr['corte_mw'] * dt_h / 1e3
    wide = (attr.pivot_table(index='cod_razaorestricao',
                             columns='cod_origemrestricao',
                             values='gwh', aggfunc='sum', fill_value=0.0)
            .reindex(columns=['SIS', 'LOC'], fill_value=0.0))
    wide = wide.loc[wide.sum(axis=1).sort_values().index].reset_index()

    # (d) the plants, for the map
    plants = frames['plants'].copy()
    plants['gerada_mwh'] = plants['val_geracao'] * dt_h
    plants['cortada_mwh'] = plants['corte_mw'] * dt_h
    plants['taxa_corte'] = (plants['cortada_mwh']
                            / (plants['gerada_mwh'] + plants['cortada_mwh']))

    total_ger = energy['gerada_mwh'].sum() / 1e6
    total_cut = energy['cortada_mwh'].sum() / 1e6
    integrity = frames['integrity']
    peak = diurnal.loc[diurnal['corte_mw'].idxmax()]

    return {
        'tables': {
            'diurnal': diurnal,
            'monthly': monthly,
            'attribution': wide,
            'plants': plants,
        },
        'headline': {
            'window': [str(ts['instante'].min().date()),
                       str(ts['instante'].max().date())],
            'step_hours': dt_h,
            'generated_twh': round(total_ger, 3),
            'curtailed_twh': round(total_cut, 3),
            'curtailment_rate': (round(total_cut / (total_ger + total_cut), 4)
                                 if total_ger + total_cut else None),
            'peak_hour': float(peak['hora']),
            'peak_cut_mw': round(float(peak['corte_mw']), 1),
            'peak_share_of_available': (
                round(float(peak['corte_mw'] / peak['disponivel_mw']), 4)
                if peak['disponivel_mw'] else None),
            'plants': int(plants['id_ons'].nunique()),
        },
        # Not diagnostics: the share of restricted rows and the share whose
        # reference falls below verified generation are both in the published
        # caption, and the second is the one a reader has to see to know the
        # clip is doing something.
        'integrity': {
            'rows': int(integrity['n_rows_total']),
            'restricted': int(integrity['n_restrito']),
            'reference_below_verified': int(integrity['n_ref_negativa']),
        },
    }
