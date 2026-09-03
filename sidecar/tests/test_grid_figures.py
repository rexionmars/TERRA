"""
The ported series against the series it was ported from.

THIS IS THE TEST THE PORT EXISTS TO PASS. Every other check in this repository
asks whether code runs; these ask whether it produces the same numbers as the
research it claims to reproduce. `lucertae/data/processed/figNN_source_*.csv`
are the published tables, and a port that drifts from them has stopped being a
port whatever else it does.

Skipped, not failed, when the research tree or a loaded store is absent: this
is a comparison against an artefact that lives outside the repository, and a
red suite on a machine that simply has neither would train people to ignore it.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

RESEARCH = Path(os.environ.get('LUCERTAE_DIR', '/Users/fox/estudos/lucertae'))
PROCESSED = RESEARCH / 'data' / 'processed'

# The window the notebooks read: the record's start to the last COMPLETE month.
# Stated here because it is the whole of the difference between a port that
# matches and one that looks 3.6 percent off -- 883 days against 852, which is
# exactly one month, and nothing to do with the analysis.
WINDOW = ('2024-04-01', '2026-07-31')


def _store():
    from terra.grid import store
    try:
        conn = store.connect({})
    except Exception as e:  # noqa: BLE001 -- any failure to open is a skip
        pytest.skip(f'no grid store to read: {e}')
    held = {c['dataset'] for c in store.coverage(conn)}
    if 'pv_curtailment' not in held:
        conn.close()
        pytest.skip('the store holds no pv_curtailment')
    return conn


def _published(name: str):
    path = PROCESSED / name
    if not path.exists():
        pytest.skip(f'the research table {name} is not on this machine')
    import pandas as pd
    return pd.read_csv(path)


def test_figure_one_reproduces_the_published_diurnal_profile():
    """
    Forty-eight half-hourly means, generation and cut, against the published
    table. Exact rather than approximate: the same rows through the same
    arithmetic must give the same numbers, and a tolerance here would hide the
    kind of drift this test exists to catch.
    """
    pd = pytest.importorskip('pandas')
    from terra.grid.figures import fig01_curtailment as fig

    conn = _store()
    try:
        out = fig.analyse(fig.read(conn, start=WINDOW[0], end=WINDOW[1]))
    finally:
        conn.close()

    got = out['tables']['diurnal'].set_index('hora')
    want = _published('fig1_source_diurnal.csv').set_index('hora')

    assert list(got.columns) == list(want.columns)
    assert len(got) == len(want) == 48
    # The day count first: it is the one difference that moves every figure
    # below it, and reporting it as a column mismatch would be misleading.
    assert int(got['n'].max()) == int(want['n'].max())
    for column in ('geracao_mw', 'corte_mw', 'disponivel_mw'):
        pd.testing.assert_series_equal(
            got[column], want[column], check_names=False, rtol=1e-6)


def test_figure_one_reproduces_the_published_attribution():
    """
    Reason by origin, in GWh. Three reasons survive in the record and the
    energetic one carries no local share at all -- a zero that is a finding,
    not a gap.
    """
    pd = pytest.importorskip('pandas')
    from terra.grid.figures import fig01_curtailment as fig

    conn = _store()
    try:
        out = fig.analyse(fig.read(conn, start=WINDOW[0], end=WINDOW[1]))
    finally:
        conn.close()

    got = out['tables']['attribution'].set_index('cod_razaorestricao')
    want = _published('fig1_source_attribution.csv').set_index(
        'cod_razaorestricao')

    assert set(got.index) == set(want.index)
    for column in ('SIS', 'LOC'):
        # 1e-5, and the extra decade is float32, not drift.
        #
        # The store keeps the value columns as `real` and the research read
        # float64 from CSV. Over a 700,000-row sum that accumulates to about
        # three parts per million -- measured: 13,599.334 against 13,599.376
        # GWh. The diurnal test above holds at 1e-6 because those are means of
        # 852 values, not sums of 700,000.
        #
        # Not fixed by widening the column: double precision over four value
        # columns and 22 million rows is roughly 350 MB bought for 3 ppm on a
        # figure quoted to one decimal.
        pd.testing.assert_series_equal(
            got[column], want.loc[got.index, column],
            check_names=False, rtol=1e-5)


def test_figure_one_reproduces_the_published_plant_table():
    """
    THE TEST THAT WAS MISSING, and the panel it would have caught.

    The first version of this file compared the diurnal profile and the
    attribution and stopped there. Both passed while the map panel drew FOUR
    points where the published one draws eighty-five, because the plant table
    was joined to br.plant -- the ANEEL register, keyed on the enterprise CEG.
    The curtailment record is 95 percent cluster rows carrying no CEG, so 83 of
    87 units matched nothing and came back with a null coordinate.

    A green suite around a panel that is missing 95 percent of its marks is
    worse than no suite: it says the port is verified.
    """
    pd = pytest.importorskip('pandas')
    from terra.grid.figures import fig01_curtailment as fig

    conn = _store()
    try:
        out = fig.analyse(fig.read(conn, start=WINDOW[0], end=WINDOW[1]))
    finally:
        conn.close()

    got = out['tables']['plants'].set_index('id_ons')
    want = _published('fig1_source_plants.csv').set_index('id_ons')

    assert sorted(got.columns) == sorted(want.columns)
    assert len(got) == len(want)
    assert set(got.index) == set(want.index)

    # The count is the assertion. Georeferencing comes from the operator's own
    # register keyed on id_ons, because ANEEL has no row for a cluster.
    assert int(got['lat'].notna().sum()) == int(want['lat'].notna().sum())

    aligned = want.loc[got.index]
    # Coordinates are copied, not computed: exact.
    pd.testing.assert_series_equal(
        got['lat'].dropna(), aligned['lat'].dropna(),
        check_names=False, rtol=0)
    pd.testing.assert_series_equal(
        got['cap_mw'].dropna(), aligned['cap_mw'].dropna(),
        check_names=False, rtol=0)
    # Sums over about 42,000 intervals in float32; see the attribution test.
    for column in ('val_geracao', 'corte_mw', 'taxa_corte'):
        pd.testing.assert_series_equal(
            got[column], aligned[column], check_names=False, rtol=1e-4)


def test_the_payload_carries_no_value_json_cannot_hold():
    """
    Python writes a float NaN as the bare token NaN, which is not JSON: the Go
    decoder answers "invalid character 'N' looking for beginning of value" and
    the run fails at the transport with a message about nothing that went
    wrong. A plant with no coordinate produced exactly that.

    Checked on the serialised form rather than on the frame, because the frame
    is where the NaN is legitimate and the wire is where it is not.
    """
    import json
    import math

    from terra.grid.figures import fig01_curtailment as fig

    conn = _store()
    try:
        out = fig.analyse(fig.read(conn, start=WINDOW[0], end=WINDOW[1]))
    finally:
        conn.close()

    for name, frame in out['tables'].items():
        for row in frame.astype(object).where(frame.notna(), None).values.tolist():
            for cell in row:
                assert not (isinstance(cell, float) and math.isnan(cell)), (
                    f'{name} carries a NaN, which json.dumps writes as a token '
                    f'no JSON decoder accepts')
        # And the whole thing has to survive a strict encode.
        json.dumps(frame.astype(object).where(frame.notna(), None)
                   .values.tolist(), allow_nan=False, default=str)


def test_the_curtailment_rate_matches_the_published_headline():
    """21.6 percent, which is the number the caption states."""
    from terra.grid.figures import fig01_curtailment as fig

    conn = _store()
    try:
        out = fig.analyse(fig.read(conn, start=WINDOW[0], end=WINDOW[1]))
    finally:
        conn.close()

    assert out['headline']['curtailment_rate'] == pytest.approx(0.216, abs=5e-4)


def test_the_time_step_is_derived_and_not_assumed():
    """
    Half an hour today. Hard-coding it would be right now and silently wrong
    the day the operator publishes at another cadence -- and every energy
    figure multiplies by it.
    """
    from terra.grid.figures import fig01_curtailment as fig

    conn = _store()
    try:
        out = fig.analyse(fig.read(conn, start=WINDOW[0], end=WINDOW[1]))
    finally:
        conn.close()

    assert out['headline']['step_hours'] == 0.5


def test_a_system_figure_declares_that_it_takes_no_area():
    """
    Fig. 1 is about the SIN. Answered over a polygon it would be a different
    quantity under the same name, so the spec says so and the action refuses
    rather than dropping the polygon silently.
    """
    from terra.grid.figures.spec import FIGURES

    assert FIGURES[1].scope == 'system'
    assert 'pv_curtailment' in FIGURES[1].needs


def test_every_figure_carries_the_readings_it_retires():
    """
    Four of the twelve correct an earlier one. A caller shown Fig. 10 without
    Fig. 12 is reading a result the series itself demoted to one robustness
    test in three, so `supersedes` travels with the payload.
    """
    from terra.grid.figures.spec import FIGURES

    for number, spec in FIGURES.items():
        assert spec.number == number
        assert spec.scope in ('site', 'system')
        assert spec.title and spec.module
        for retired in spec.supersedes:
            assert retired != number
