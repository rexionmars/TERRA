"""
The rollup answers what the record answers.

THE TWO PATHS ALREADY DISAGREED ONCE. br.pv_daily replaced a query that joined
19,088,880 detail rows to 2,854,800 curtailment rows on cluster and instant,
and the first version of the view left out the cluster membership's time
bound -- so for the 106 plants of 556 that appear under more than one cluster,
every detail row matched each of its memberships and the period count was
inflated. The AOI it was validated over happened to hold none of them, and it
passed.

So this is a PAIRED test by construction: the same window, the same area, both
paths, compared field by field. It is the only thing standing between a change
to the view and a reading that is quietly 2 percent wrong.

COUNTS EXACTLY, ENERGY TO A TOLERANCE. The periods are integers and any
difference in them is a join defect. The energies are sums of float4 columns in
a different association order, which moves the total by about four parts in a
hundred thousand -- real, bounded, and not a disagreement about what was
summed.
"""

from __future__ import annotations

import pytest

pytest.importorskip('psycopg')

from terra.grid import curtailment, store  # noqa: E402

# Sol do Cerrado, whose seventeen plants sit inside one cluster, and Sao
# Goncalo, whose plants sit inside three at once. The second is the one that
# exercises the defect above; the first is kept because it is the area every
# other measurement in this slice was taken over.
AREAS = {
    'sol-do-cerrado': [[[-43.845, -15.435], [-43.775, -15.435],
                        [-43.775, -15.350], [-43.845, -15.350],
                        [-43.845, -15.435]]],
    'sao-goncalo': [[[-45.32, -10.14], [-45.24, -10.14],
                     [-45.24, -10.08], [-45.32, -10.08],
                     [-45.32, -10.14]]],
}
# One month, so the direct path is seconds rather than a minute. The defect
# this guards is per-row and shows in any window that contains it.
START, END = '2026-08-01', '2026-08-31'

DIRECT = """
    WITH dentro AS (
        SELECT p.ceg_core FROM br.plant p
        WHERE p.geom IS NOT NULL
          AND ST_Intersects(p.geom, ST_GeomFromGeoJSON(%s))
    )
    SELECT count(DISTINCT d.id_ons)                          AS plants,
           count(*)                                          AS periods,
           count(*) FILTER (WHERE c.reason_code IS NOT NULL) AS restricted,
           sum(d.gen_estimated) / 2.0                        AS expected,
           sum(d.gen_estimated - d.gen_verified) / 2.0       AS withheld
    FROM br.pv_detail d
    JOIN dentro USING (ceg_core)
    LEFT JOIN br.plant_cluster pc
           ON pc.ceg_core = d.ceg_core
          AND d.instante BETWEEN pc.valid_from AND pc.valid_to
    LEFT JOIN br.pv_curtail c
           ON c.cluster_key = pc.cluster_key AND c.instante = d.instante
    WHERE d.instante >= %s AND d.instante < %s
"""


@pytest.fixture(scope='module')
def conn():
    try:
        c = store.connect({'br_store_dsn': 'postgresql:///terra_br'})
    except Exception as e:  # noqa: BLE001 -- any failure here means no store
        pytest.skip(f'no local grid store: {e}')
    with c.cursor() as cur:
        cur.execute("SELECT to_regclass('br.pv_daily')")
        if cur.fetchone()[0] is None:
            pytest.skip('the store holds no br.pv_daily')
        cur.execute('SELECT count(*) FROM br.pv_daily')
        if cur.fetchone()[0] == 0:
            pytest.skip('br.pv_daily is empty; run store.refresh_rollup')
    return c


@pytest.mark.parametrize('name', sorted(AREAS))
def test_the_rollup_and_the_record_agree_over_one_area(conn, name):
    import json

    import pandas as pd

    aoi = {'type': 'Polygon', 'coordinates': AREAS[name]}
    with conn.cursor() as cur:
        cur.execute(DIRECT, (json.dumps(aoi), pd.Timestamp(START),
                             pd.Timestamp(END) + pd.Timedelta(days=1)))
        cols = [d.name for d in cur.description]
        direct = dict(zip(cols, cur.fetchone(), strict=True))

    if not direct['plants']:
        pytest.skip(f'{name} holds no metered plant in this window')

    got = curtailment.curtailment_context(conn, aoi, START, END)
    assert got is not None

    # Integers, exactly. A difference here is a join that matched a row twice.
    assert got['plants_in_aoi'] == direct['plants']
    assert got['periods'] == direct['periods']
    assert got['periods_under_restriction'] == direct['restricted']

    # Energy, to four parts in a hundred thousand: float4 summed in a
    # different order, which is arithmetic and not disagreement.
    for key, ref in (('expected_mwh', direct['expected']),
                     ('withheld_mwh', direct['withheld'])):
        assert ref, f'{key} has no reference value to compare against'
        assert abs(got[key] - float(ref)) / abs(float(ref)) < 1e-4, (
            f'{name}: {key} {got[key]} against {ref}')


class _Cursor:
    """A cursor that answers whatever the case under test needs it to."""

    def __init__(self, answers):
        self._answers = list(answers)
        self._last = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, *_a, **_k):
        self._last = self._answers.pop(0)

    def fetchone(self):
        return self._last


class _Conn:
    def __init__(self, answers):
        self._answers = answers

    def cursor(self):
        return _Cursor(self._answers)


@pytest.mark.parametrize(
    ('answers', 'because'),
    [
        ([(None,)], 'the view does not exist'),
        ([('br.pv_daily',), (0,)], 'the view exists and is empty'),
    ],
)
def test_the_reading_refuses_rather_than_falling_back(answers, because, capsys):
    """
    An absent or unbuilt rollup fails with WHAT TO RUN, not with a slower
    answer.

    Two implementations of one question is what terra/grid/actions.py refuses
    for the store as a whole, and for the same reason: they can disagree, and
    these two already did. So the guard has to raise, and the message has to
    carry the command -- a refusal that does not say what to do next is a
    traceback on a settings screen.
    """
    # protocol.fail writes the error as JSON on stderr and exits, which is the
    # contract the shell reads. Asserting on the exception type alone would
    # pass for a refusal that told the reader nothing.
    with pytest.raises(SystemExit):
        curtailment._require_rollup(_Conn(answers))
    assert 'refresh_rollup' in capsys.readouterr().err, because


def test_the_reading_needs_no_default_str_to_serialise(conn):
    """
    Every value is a type JSON has, which `default=str` otherwise hides.

    THE ACTION SERIALISES WITH default=str, and that is what made this
    necessary. It exists for dates, which have no JSON type and must become
    strings -- but it applies to everything, so a Decimal that leaked in
    silently became a QUOTED NUMBER. Go then refused the whole payload with
    "cannot unmarshal string into Go struct field ... of type float64", and the
    reading died at the transport with a message about nothing that went wrong.

    That is exactly what happened when the query moved from count(*) to sum():
    sum() over an integer column returns NUMERIC, psycopg hands back a Decimal,
    and Decimal / Decimal is a Decimal. The two counts were already cast; the
    quotient of them was not.

    So this dumps STRICTLY. Anything that would have needed default= raises
    here, next to the frame that produced it, rather than in another language.
    """
    import json

    aoi = {'type': 'Polygon', 'coordinates': AREAS['sol-do-cerrado']}
    got = curtailment.curtailment_context(conn, aoi, START, END)
    if got is None:
        pytest.skip('no metered plant in this window')
    # No default=, deliberately: the point is that none is needed.
    json.dumps(got)
