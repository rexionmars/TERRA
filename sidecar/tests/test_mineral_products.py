"""
What the mineral map reads beside the Tetracorder answer: the pass each cell is
taken from, the band positions, the agreement with EMIT L2B, and the layers.

The pass rule and the band position are checked against inputs whose answer is
known by construction; the L2B class table against the real metadata of one
L2B V001 file, saved in tests/data.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pytest

from terra.mineral import cover, features, l2b, mapping, render, tetracorder as tc

DATA = Path(__file__).parent / 'data'


def _bands(**over):
    b = {'red': 0.18, 'nir': 0.22, 'r2030': 0.30, 'r2100': 0.31, 'r2210': 0.28}
    b.update(over)
    return {k: np.array([[v]]) for k, v in b.items()}


# The exposure test and the choice of pass ------------------------------------------


def test_exposed_ground_passes_the_test():
    e = cover.exposure(_bands(), np.zeros((1, 1), dtype=bool))
    assert e.exposed[0, 0]
    assert e.ndvi[0, 0] == pytest.approx(0.1)
    assert e.cai[0, 0] == pytest.approx(-0.02)


@pytest.mark.parametrize(('over', 'why'), [
    ({'nir': 0.45}, 'NDVI 0.43: green vegetation'),
    ({'r2100': 0.27}, 'CAI +0.02: cellulose absorbing at 2.1 um, dry residue'),
])
def test_covered_ground_fails_the_test(over, why):
    e = cover.exposure(_bands(**over), np.zeros((1, 1), dtype=bool))
    assert not e.exposed[0, 0], why
    assert e.usable[0, 0]


def test_a_masked_observation_is_not_usable():
    e = cover.exposure(_bands(), np.ones((1, 1), dtype=bool))
    assert not e.usable[0, 0] and not e.exposed[0, 0]


def _exp(exposed, ndvi, usable=True):
    return cover.Exposure(ndvi=np.array([ndvi if usable else np.nan]), cai=np.array([0.0]),
                          exposed=np.array([exposed and usable]), usable=np.array([usable]))


def test_choice_prefers_exposed_then_lower_ndvi_then_rank():
    # An exposed pass beats a lower-NDVI pass that is not exposed.
    c = cover.choose([_exp(False, 0.05), _exp(True, 0.2)])
    assert c.pass_index[0] == 1 and c.exposed[0]
    # Among exposed passes, the lower NDVI.
    assert cover.choose([_exp(True, 0.2), _exp(True, 0.1)]).pass_index[0] == 1
    # A tie keeps the pass ranked first.
    assert cover.choose([_exp(True, 0.1), _exp(True, 0.1)]).pass_index[0] == 0
    # A cell no pass shows exposed takes its least green pass, flagged not exposed.
    c = cover.choose([_exp(False, 0.6), _exp(False, 0.4)])
    assert c.pass_index[0] == 1 and not c.exposed[0]
    # A cell no pass observed usably has none.
    assert cover.choose([_exp(True, 0.1, usable=False)]).pass_index[0] == -1


def _library_exposure():
    rules = tc.default_rules()
    lib = mapping._library_spectra(rules)
    ch = cover.band_channels(rules.wavelengths * 1000.0, ~rules.deleted)
    out = {}
    for e in rules.entries:
        s = lib.get(e.library)
        if s is None:
            continue
        x = cover.exposure(cover.band_means(s[None, :], ch), np.zeros(1, dtype=bool))
        out.setdefault(e.klass, []).append((bool(x.exposed[0]), float(x.cai[0]), e.title))
    return out


def test_the_counts_cover_py_states_hold_on_the_shipped_references():
    got = _library_exposure()

    def passing(k):
        return sum(p for p, _, _ in got[k]), len(got[k])

    for k in ('kaolinite', 'smectite', 'hematite', 'goethite', 'calcite', 'gypsum', 'dolomite', 'gibbsite'):
        n_pass, n = passing(k)
        assert n_pass == n, k
    assert passing('alunite') == (18, 21)
    assert passing('vegetation') == (0, 7)
    assert passing('talc_serpentine') == (1, 8)
    assert passing('biotite') == (0, 3)
    assert passing('jarosite') == (1, 5)
    dry = [c for _, c, t in got['vegetation'] if 'dry' in t and 'grass' in t and '+' not in t]
    assert len(dry) == 3 and min(dry) >= 0.030 and max(dry) <= 0.032


# Band position ----------------------------------------------------------------------


def _absorption(waves, centre, width, depth, slope=0.0002):
    continuum = 0.3 + slope * (waves - waves[0])
    return continuum * (1.0 - depth * np.exp(-0.5 * ((waves - centre) / width) ** 2))


@pytest.mark.parametrize('centre', [2196.0, 2207.5, 2219.0])
def test_al_oh_position_is_recovered_between_channels(centre):
    rules = tc.default_rules()
    waves = rules.wavelengths * 1000.0
    spec = _absorption(waves, centre, 12.0, 0.25)
    m = features.measure(spec[None, :], waves, features.ALOH)
    assert m.position[0] == pytest.approx(centre, abs=1.5)
    assert m.depth[0] == pytest.approx(0.25, abs=0.03)


def test_fe3_position_spans_the_deleted_water_channels():
    # 932-962 nm are deleted in the emit_c set; a band centred inside the gap
    # is still located from the channels on either side of it.
    rules = tc.default_rules()
    waves = rules.wavelengths * 1000.0
    spec = _absorption(waves, 945.0, 70.0, 0.3)
    spec[rules.deleted] = np.nan
    m = features.measure(spec[None, :], waves, features.FE3)
    assert m.position[0] == pytest.approx(945.0, abs=6.0)


def test_a_spectrum_without_the_band_has_no_position():
    rules = tc.default_rules()
    waves = rules.wavelengths * 1000.0
    flat = 0.3 + 0.0001 * (waves - waves[0])
    m = features.measure(flat[None, :], waves, features.ALOH)
    assert np.isnan(m.position[0])


def test_hematite_references_sit_shortward_of_goethite_references():
    rules = tc.default_rules()
    refs = {r['class']: r for r in features.reference_positions(
        rules, mapping._library_spectra(rules), rules.wavelengths * 1000.0, features.FE3)}
    assert refs['hematite']['references'] >= 10 and refs['goethite']['references'] >= 6
    assert refs['hematite']['median_nm'] < refs['goethite']['median_nm'] - 40.0


# EMIT L2B --------------------------------------------------------------------------


@pytest.fixture(scope='module')
def l2b_metadata():
    return json.loads((DATA / 'emit_l2b_min_001_metadata.json').read_text())['rows']


def test_every_l2b_index_gets_a_class(l2b_metadata):
    rules = tc.default_rules()
    table = l2b.class_table(l2b_metadata, rules)
    assert len(table) == len(l2b_metadata) == 294
    assert set(table.values()) <= set(rules.classes)
    assert l2b.match_steps(l2b_metadata, rules) == {'record': 231, 'title': 46, 'name': 17}


@pytest.mark.parametrize(('prefix', 'klass'), [
    ('Hematite.02+Quartz.98', 'hematite'),               # r06, by title
    ('Goethite WS222 coarse grain', 'goethite'),         # by name
    ('Nanohematite FBR93-34B2b', 'hematite'),            # by name, a suffix of a component
    ('Kaolinite CM9 (wxl)', 'kaolinite'),
    ('Muscovite GDS113 Ruby', 'illite_muscovite'),
    ('Schwertmannite BZ93-1', 'fe_sulfate'),
    ('Almandine WS479 Garnet', 'other'),
])
def test_l2b_references_take_the_class_of_the_same_mineral(l2b_metadata, prefix, klass):
    table = l2b.class_table(l2b_metadata, tc.default_rules())
    row = next(r for r in l2b_metadata if r['name'].startswith(prefix))
    assert table[row['index']] == klass


def test_agreement_codes():
    port = np.array([3, 3, 3, -1, -1, -2, 3])
    other = np.array([3, 4, -1, 4, -1, 3, -2])
    np.testing.assert_array_equal(
        l2b.agreement(port, other),
        [l2b.AGREE, l2b.DIFFER, l2b.PORT_ONLY, l2b.L2B_ONLY, l2b.NEITHER, l2b.UNCOMPARED, l2b.UNCOMPARED])


# Layers -----------------------------------------------------------------------------


def test_ramp_clamps_its_ends_and_leaves_missing_cells_transparent():
    v = np.array([[-5.0, 0.0, 0.5, 1.0, 9.0, np.nan]])
    rgba = render.ramp_rgba(v, 0.0, 1.0, ['#000000', '#ffffff'])
    np.testing.assert_array_equal(rgba[0, :, 0], [0, 0, 128, 255, 255, 0])
    np.testing.assert_array_equal(rgba[0, :, 3], [235, 235, 235, 235, 235, 0])


def test_class_layers_paint_one_hard_colour_per_code():
    codes = np.array([[0, 1, -1]])
    rgba = render.classes_rgba(codes, [{'color': '#102030'}, {'color': '#405060', 'alpha': 140}])
    assert tuple(rgba[0, 0]) == (16, 32, 48, 235)
    assert tuple(rgba[0, 1]) == (64, 80, 96, 140)
    assert rgba[0, 2, 3] == 0


def test_every_class_has_a_label_and_a_distinct_colour():
    rules = tc.default_rules()
    assert set(rules.classes) == set(mapping.CLASS_LABELS) == set(mapping.CLASS_COLORS)
    rgb = [render.hex_rgb(c) for c in mapping.CLASS_COLORS.values()]
    rgb += [mapping.NO_ANSWER_RGBA[:3], mapping.MASKED_RGBA[:3]]
    gaps = [max(abs(a - b) for a, b in zip(x, y, strict=True))
            for i, x in enumerate(rgb) for y in rgb[i + 1:]]
    # lib/classMask.ts resolves a near miss only when every pair differs by
    # more than twice its tolerance of 2; exact matches need only distinctness.
    assert min(gaps) > 4


def test_acid_sulfate_items_name_components_the_rules_carry():
    rules = tc.default_rules()
    present = {e.primary_component for e in rules.entries}
    for item in mapping.ACID_SULFATE:
        assert set(item['components']) & present, item['key']


# The rule file against the class table that built it ---------------------------------


def test_shipped_classes_are_what_the_builder_assigns(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location(
        'build_tetracorder_rules', Path(__file__).resolve().parents[1] / 'tools' / 'build_tetracorder_rules.py')
    assert spec and spec.loader
    builder = importlib.util.module_from_spec(spec)
    # Its dataclasses resolve their annotations through sys.modules.
    monkeypatch.setitem(sys.modules, spec.name, builder)
    spec.loader.exec_module(builder)
    copy = tmp_path / 'rules.json'
    shutil.copy(tc.RULES_FILE, copy)
    builder.reclass(copy)
    assert copy.read_text() == tc.RULES_FILE.read_text(), (
        'CLASS_COMPONENTS changed without --reclass: run '
        'python sidecar/tools/build_tetracorder_rules.py --reclass')
