"""
EMIT search, geometry and the mapping loop, without the network.

The CMR fixture is a trimmed real response (two EMIT L2A V001 granules over the
Quadrilatero Ferrifero, Minas Gerais). OPeNDAP reads are replaced by arrays
built here, because what is under test is what this code does with them.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import box

from terra import protocol
from terra.mineral import emit, mapping, tetracorder as tc

CMR_FIXTURE = Path(__file__).parent / 'data' / 'cmr_emit_l2a_rfl_001.json'
AREA = box(-43.95, -20.25, -43.85, -20.15)
# The box the fixture was queried with; it meets both granules' footprints.
QUERY_BOX = box(-44.2, -20.4, -43.6, -19.9)


def test_granules_are_parsed_and_filtered_by_cloud():
    body = json.loads(CMR_FIXTURE.read_text())
    got = emit.parse_granules(body, QUERY_BOX, max_cloud=100.0, version='001')
    assert {g.ur for g in got} == {
        'EMIT_L2A_RFL_001_20240830T135446_2424309_051',
        'EMIT_L2A_RFL_001_20231227T154141_2336110_019',
    }
    clear = emit.parse_granules(body, QUERY_BOX, max_cloud=10.0, version='001')
    assert [g.ur for g in clear] == ['EMIT_L2A_RFL_001_20240830T135446_2424309_051']
    assert clear[0].acquisition == '20240830T135446'
    assert clear[0].footprint.intersects(QUERY_BOX)


def test_an_area_outside_every_footprint_matches_nothing():
    body = json.loads(CMR_FIXTURE.read_text())
    far = box(-60.0, -5.0, -59.9, -4.9)
    assert emit.parse_granules(body, far, max_cloud=100.0, version='001') == []


def test_version_001_mask_is_a_file_of_the_same_granule():
    g = emit.Granule('EMIT_L2A_RFL_001_20240830T135446_2424309_051', 'C2408750690-LPCLOUD',
                     '2024-08-30T13:54:46Z', 0.0, AREA, '001')
    m = emit.find_mask(g)
    assert m is not None
    assert m.ur == 'EMIT_L2A_MASK_001_20240830T135446_2424309_051'
    assert m.concept == g.concept
    assert m.data_url.endswith(
        'EMITL2ARFL.001/EMIT_L2A_RFL_001_20240830T135446_2424309_051/'
        'EMIT_L2A_MASK_001_20240830T135446_2424309_051.nc')


def test_search_keeps_the_newest_version_of_an_acquisition(monkeypatch):
    body = json.loads(CMR_FIXTURE.read_text())
    v2 = json.loads(json.dumps(body))
    for it in v2['items']:
        it['umm']['GranuleUR'] = it['umm']['GranuleUR'].replace('_001_', '_002_').rsplit('_', 2)[0]
    pages = {'002': v2, '001': body}
    monkeypatch.setattr(emit, '_get', lambda url, *, auth, params=None, timeout=0, what='':
                        json.dumps(pages[params['version']]).encode())
    got = emit.search(QUERY_BOX, '2023-01-01', '2024-12-31')
    assert len(got) == 2
    assert all(g.version == '002' for g in got)
    assert got[0].cloud_cover == 0


def test_missing_token_says_how_to_provide_one(monkeypatch):
    monkeypatch.delenv(emit.TOKEN_ENV, raising=False)
    with pytest.raises(protocol.Unavailable, match='Earthdata'):
        emit._token()


def test_output_grid_covers_the_area_at_granule_spacing():
    gt = [-44.5, 0.000542232520256367, 0.0, -19.6, 0.0, -0.000542232520256367]
    grid = emit.output_grid(AREA, gt)
    assert grid.dlon == pytest.approx(gt[1])
    ext = grid.extent()
    assert ext['lon_min'] == pytest.approx(-43.95)
    assert ext['lon_max'] >= -43.85
    assert ext['lat_min'] <= -20.25
    # About 57 m by 60 m at 20 S.
    assert grid.cell_area_ha()[0] == pytest.approx(0.36, rel=0.08)


def test_placement_inverts_the_geometry_lookup_table(monkeypatch):
    # A 6 x 8 ortho grid (origin lon 0, lat 6, 1-degree cells) whose cell
    # (y, x) holds the 1-based instrument indices (y + 1, x + 11), except one
    # cell that observed nothing.
    gt = [0.0, 1.0, 0.0, 6.0, 0.0, -1.0]
    glt_y, glt_x = np.mgrid[0:6, 0:8]
    glt_x = glt_x + 11
    glt_y = glt_y + 1
    glt_x[2, 3] = 0
    st = emit.Structure(shapes={'/location/glt_x': (6, 8)},
                        attributes={'geotransform': [str(v) for v in gt]})

    def fake_read(g, slabs):
        ys, xs = slabs['/location/glt_x']
        return {'/location/glt_x': glt_x[ys, xs], '/location/glt_y': glt_y[ys, xs]}

    monkeypatch.setattr(emit, 'read', fake_read)
    # Output cell centres: lon 2.5..5.5, lat 4.5..2.5, so output (r, c) falls
    # in ortho cell (r + 1, c + 2), whose instrument pixel is (r + 1, c + 12).
    grid = emit.OutputGrid(2.0, 5.0, 1.0, 1.0, 4, 3)
    inside = np.ones((3, 4), dtype=bool)
    inside[0, 0] = False
    p = emit.place(None, st, grid, inside)

    r, c = np.mgrid[0:3, 0:4]
    expect_row, expect_col = r + 1, c + 12
    expect_row[0, 0] = expect_col[0, 0] = -1      # outside the area
    expect_row[1, 1] = expect_col[1, 1] = -1      # ortho (2, 3) holds no observation
    np.testing.assert_array_equal(p.row, expect_row)
    np.testing.assert_array_equal(p.col, expect_col)


def test_mapping_places_each_answer_on_the_cell_that_observed_it(monkeypatch, tmp_path):
    rules = tc.default_rules()
    data = np.load(tc.DATA_DIR / 'tetracorder_emit_spectra.npz')
    lib = dict(zip([str(r) for r in data['records']], data['values'].astype(np.float64), strict=True))
    raw = json.loads(tc.RULES_FILE.read_text())['entries']

    def spec(ident):
        e = next(e for e in raw if e['id'] == ident)
        return lib[f"{e['library'][0]}:{e['library'][1]}"]

    kao, hem = spec('kaolwxl'), spec('hematite.fine.gr.gds76')
    gran = emit.Granule('EMIT_L2A_RFL_001_20240830T135446_2424309_051', 'C', '2024-08-30T13:54:46Z',
                        0.0, AREA.buffer(1.0), '001')
    grid = emit.OutputGrid(-43.95, -20.15, 0.05, 0.05, 2, 2)

    monkeypatch.setattr(emit, 'search', lambda *a, **k: [gran])
    monkeypatch.setattr(emit, 'structure', lambda g: emit.Structure(
        shapes={}, attributes={'geotransform': ['-43.95', '0.05', '0', '-20.15', '0', '-0.05']}))
    monkeypatch.setattr(emit, 'output_grid', lambda poly, gt: grid)
    monkeypatch.setattr(emit, 'place', lambda g, st, gr, inside: emit.Placement(
        row=np.array([[0, 0], [1, -1]], dtype=np.int32),
        col=np.array([[0, 1], [0, -1]], dtype=np.int32)))
    monkeypatch.setattr(emit, 'band_parameters', lambda g, st: {
        'wavelengths': rules.wavelengths * 1000.0, 'fwhm': rules.fwhm * 1000.0,
        'good_wavelengths': np.ones(len(rules.wavelengths))})
    monkeypatch.setattr(emit, 'find_mask', lambda g: None)

    def fake_blocks(g, st, placement, mask, progress=None):
        yield emit.Block(rows=np.array([0, 0, 1]), cols=np.array([0, 1, 0]),
                         reflectance=np.stack([kao, hem, kao]).copy(),
                         masked=np.array([False, False, True]))

    monkeypatch.setattr(emit, 'blocks', fake_blocks)
    result = mapping.run(AREA, '2024-01-01', '2024-12-31', rules=rules)

    g2, g1 = result.entry[2], result.entry[1]
    assert rules.entries[g2[0, 0]].klass == 'kaolinite'
    assert rules.entries[g1[0, 1]].klass == 'hematite'
    assert g2[1, 0] == mapping.NOT_OBSERVED and result.masked[1, 0]   # cloud
    assert g2[1, 1] == mapping.NOT_OBSERVED and not result.masked[1, 1]  # no pixel

    payload = result.to_payload(tmp_path)
    assert payload['observed_cells'] == 2
    assert payload['masked_cells'] == 1
    assert Path(payload['groups'][0]['class_png']).exists()
    assert Path(payload['geotiff']).exists()
    classes = {row['class'] for grp in payload['groups'] for row in grp['classes']}
    assert {'kaolinite', 'hematite'} <= classes
    assert any('no L2A mask' in n for n in payload['notes'])


def test_no_granule_is_a_stated_failure(monkeypatch):
    monkeypatch.setattr(emit, 'search', lambda *a, **k: [])
    with pytest.raises(mapping.NoScene, match='no EMIT'):
        mapping.run(AREA, '2024-01-01', '2024-01-31')
