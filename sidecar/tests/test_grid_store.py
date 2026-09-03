"""
What the store keys the Brazilian record on, and how it reads an absent CEG.

Both were wrong in the first schema, and both fail in a way the other does not.
Keyed on ceg, the wind record collides 142 ways at every half hour and the load
raises -- loud, and caught on the first attempt. Carrying '-' through as a
string does not raise: it stores 142 clusters under one identifier that joins to
no plant, and the result is a query that returns nothing for a reason nothing
in the data reports.
"""

from __future__ import annotations

import pytest

from terra.grid import congestion, curtailment, store


def test_a_unit_ceg_reduces_to_the_enterprise_one_ANEEL_publishes():
    """ONS names a generating unit, ANEEL names the enterprise behind it."""
    assert store.ceg_core('UFV.RS.SP.034111-8.01') == 'UFV.RS.SP.034111-8'
    assert store.ceg_core('EOL.CV.RN.029139-1.01') == 'EOL.CV.RN.029139-1'


def test_an_enterprise_ceg_passes_through_unchanged():
    """
    So the same function serves ANEEL's CodCEG and the ONS ceg. Applied to a
    core CEG by a rule that always strips, the join key loses a field and
    matches nothing.
    """
    assert store.ceg_core('UFV.RS.SP.034111-8') == 'UFV.RS.SP.034111-8'
    assert store.ceg_core('UHE.PH.MG.000123-4') == 'UHE.PH.MG.000123-4'


def test_the_dash_ONS_writes_for_a_cluster_reads_as_no_ceg_at_all():
    """
    Every cluster row of the wind record carries ceg as a literal '-': 211,296
    of the 227,664 lines of 2026-08, across 142 clusters. Kept as a string it is
    an identifier they all share.
    """
    assert store.ceg_core('-') is None
    assert store.ceg_core(' - ') is None
    assert store.ceg_core('') is None
    assert store.ceg_core(None) is None


def test_every_mapped_column_is_written_to_a_distinct_target():
    """
    Two source columns mapped onto one target silently drop a value, and the
    COPY still succeeds because the column count is unchanged.
    """
    for dataset, spec in store.TABLES.items():
        targets = list(spec['columns'].values())
        assert len(targets) == len(set(targets)), dataset


def test_both_records_are_keyed_on_id_ons_which_every_row_carries():
    """
    id_ons is populated on every row of both records and is unique with the
    instant; ceg is not. The mapping has to carry it or the primary key has no
    column to fill it.
    """
    for dataset, spec in store.TABLES.items():
        assert spec['columns'].get('id_ons') == 'id_ons', dataset
    assert 'PRIMARY KEY (id_ons, instante)' in store.SCHEMA


def test_the_schema_declares_ceg_nullable_so_a_cluster_row_can_be_stored():
    """
    NOT NULL on ceg rejects every cluster row of the wind record, which is
    93 percent of it, and the load fails on data that is not malformed.
    """
    for table in ('br.pv_detail', 'br.pv_curtail'):
        block = store.SCHEMA.split(f'CREATE TABLE IF NOT EXISTS {table} (')[1]
        block = block.split(');')[0]
        ceg_line = [ln for ln in block.splitlines()
                    if ln.strip().startswith('ceg ')][0]
        assert 'NOT NULL' not in ceg_line, table


def test_the_conflict_table_exists_so_a_discarded_row_is_recoverable():
    """
    56 instants in the photovoltaic record have two rows for one plant, and 48
    of them disagree in value. Keeping one silently is indistinguishable from a
    load that lost rows.
    """
    assert 'CREATE TABLE IF NOT EXISTS br.load_conflict' in store.SCHEMA
    for column in ('id_ons', 'instante', 'n_rows', 'identical'):
        assert column in store.SCHEMA.split('br.load_conflict (')[1]


def test_the_primary_key_survives_the_duplicates_rather_than_being_dropped():
    """
    The constraint is what surfaced the 56 in the first place, and it is right
    about the other 18,938,027 rows. Relaxing it to accommodate them would give
    up the guarantee everywhere to accommodate 0.0006 percent.
    """
    assert store.SCHEMA.count('PRIMARY KEY (id_ons, instante)') == 2


def test_the_schema_warns_that_the_operator_flag_is_incomplete():
    """
    A caller who filters on irradiance_bad alone keeps readings ninety times
    the solar constant. The warning belongs where the column is defined,
    because the column name is what a caller sees.
    """
    assert 'irradiance_bad IS THE OPERATOR' in store.SCHEMA
    assert '123,312' in store.SCHEMA


def test_the_loader_reads_a_zero_coordinate_as_absent():
    """
    ANEEL writes an absent coordinate as 0.0, and 432 of 25,130 enterprises are
    recorded that way. Stored as given they are a point in the Gulf of Guinea,
    and an AOI near the origin returns 432 Brazilian plants.
    """
    source = (store.__file__.replace('.pyc', '.py'))
    with open(source) as fh:
        body = fh.read()
    assert 'float(r.lat) == 0.0 and float(r.lon) == 0.0' in body


def test_an_absent_ceg_is_stored_as_null_not_as_the_text_nan():
    """
    pandas turns a None returned by Series.map into NaN on an object column,
    and NaN is not None. Guarded with `is not None` the branch never fires and
    psycopg writes the float as the four characters 'nan' -- absence disguised
    as a value, which is what ceg_core exists to remove. It reached 2,685,264
    rows of the curtailment record before this was caught, so the loader builds
    these columns as Python lists and this pins that.
    """
    source = store.__file__.replace('.pyc', '.py')
    with open(source) as fh:
        body = fh.read()
    assert "raw = frame['ceg'].tolist()" in body
    assert "cores = [ceg_core(v) for v in raw]" in body
    assert "frame['ceg'].map(" not in body


def test_cluster_key_agrees_across_the_two_records_spellings():
    """
    The detail record writes 'Conj. Marangatu' and the curtailment record
    'CONJ. MARANGATU'. Normalised, 79 of 79 clusters match across the two.
    """
    assert store.cluster_key('Conj. Marangatu') == 'MARANGATU'
    assert store.cluster_key('CONJ. MARANGATU') == 'MARANGATU'
    assert store.cluster_key('CONJ. BABILÔNIA CENTRO') == 'BABILONIA CENTRO'
    assert store.cluster_key('Conj. Juazeiro II 230 kV') == 'JUAZEIRO II 230 KV'


def test_the_network_tables_carry_a_surrogate_key_not_the_equipment_code():
    """
    cod_equipamento repeats on 4 of 2,332 rows, and the repeats are real: one
    code is both a 600 kV line and the converter on it. Declared a primary key
    it rejects the load.
    """
    block = store.SCHEMA.split('CREATE TABLE IF NOT EXISTS br.transmission_line (')[1]
    block = block.split(');')[0]
    assert 'line_id            bigserial PRIMARY KEY' in block
    assert 'equipment          text,' in block


def test_the_line_geometry_is_declared_a_segment_not_a_route():
    """
    ONS publishes a line's terminals and its length, never its path. A distance
    to the stored segment is a lower bound, and the schema has to say so where
    the column is defined rather than leave it to be discovered.
    """
    assert 'THE GEOMETRY IS A STRAIGHT SEGMENT' in store.SCHEMA
    assert 'LOWER' in store.SCHEMA


def test_the_great_circle_matches_a_known_separation():
    """One degree of latitude is about 111.2 km on this sphere."""
    assert store._great_circle_km((-45.0, -10.0), (-45.0, -11.0)) == \
        pytest.approx(111.2, abs=0.5)
    assert store._great_circle_km((-45.0, -10.0), (-45.0, -10.0)) == 0.0


def test_the_reason_split_names_which_origins_a_project_can_act_on():
    """
    ENE/SIS is 69 percent of the record and is a national surplus no site can
    site its way out of; CNF/LOC is a constraint at one connection. Collapsed to
    a most-frequent reason both read as ENE, and the distinction that decides
    whether moving the project helps is gone.
    """
    assert curtailment.LOCAL_ORIGIN == 'LOC'
    for code in ('ENE', 'CNF', 'REL', 'PAR'):
        assert code in curtailment.REASON_MEANING


def test_the_total_is_split_because_it_sums_two_different_things():
    """
    withheld_mwh spans the whole window, so it carries energy taken under
    restriction AND the operator's estimate error while free -- and the second
    is often negative. At one AOI that is 192,976 against -39,437, so the
    by_reason table sums to more than the headline. Unsplit, the two look like
    an arithmetic error.
    """
    source = curtailment.__file__.replace('.pyc', '.py')
    with open(source) as fh:
        body = fh.read()
    assert "'withheld_under_restriction_mwh'" in body
    assert "'estimate_gap_when_free_mwh'" in body
    assert 'frequently NEGATIVE' in body


def test_the_cluster_join_is_bounded_by_the_membership_window():
    """
    23 percent of plants change cluster over the record. A join on cluster_key
    alone attributes a quarter of the fleet's curtailment to the cluster it was
    not in at the time.
    """
    source = curtailment.__file__.replace('.pyc', '.py')
    with open(source) as fh:
        body = fh.read()
    assert 'BETWEEN pc.valid_from AND pc.valid_to' in body
    assert body.count('BETWEEN pc.valid_from AND pc.valid_to') >= 1
