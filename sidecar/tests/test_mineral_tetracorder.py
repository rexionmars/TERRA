"""
The Tetracorder port against its own references and against its equations.

The reference spectra are the USGS library records the rules were built from,
convolved to EMIT's 285 channels (s06emitc, r06emitc), shipped beside the rules
for exactly this: a reference spectrum is the one input whose answer is known.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from terra.mineral import tetracorder as tc

RULES_JSON = tc.RULES_FILE
SPECTRA = tc.DATA_DIR / 'tetracorder_emit_spectra.npz'


@pytest.fixture(scope='module')
def rules():
    return tc.default_rules()


@pytest.fixture(scope='module')
def library():
    data = np.load(SPECTRA)
    values = data['values'].astype(np.float64)
    values[values < -1e30] = np.nan
    return dict(zip([str(r) for r in data['records']], values, strict=True))


@pytest.fixture(scope='module')
def raw_entries():
    return json.loads(RULES_JSON.read_text())['entries']


def spectrum_of(ident, raw_entries, library):
    for e in raw_entries:
        if e['id'] == ident:
            lib, rec = e['library']
            return library[f'{lib}:{rec}']
    raise KeyError(ident)


# The rule file ---------------------------------------------------------------


def test_rules_record_their_source(rules):
    assert rules.source['expert_system'] == 'tetracorder5.27e.cmds/cmd.lib.setup.t5.27e1'
    assert rules.source['components_from'] == 'tetracorder6.00a.cmds/cmd.lib.setup.t6.00a6'
    assert rules.source['dataset'] == 'emit_c'
    assert len(rules.wavelengths) == 285
    assert rules.wavelengths[0] == pytest.approx(0.381, abs=1e-3)
    assert rules.wavelengths[-1] == pytest.approx(2.493, abs=1e-3)


def test_weights_of_every_entry_sum_to_one(rules):
    for e in rules.entries:
        total = sum(f.weight for f in e.features if f.importance != 'W')
        assert total == pytest.approx(1.0, abs=1e-9), e.ident


def test_not_features_point_to_earlier_entries(rules):
    # getnotfeat.r searches materials 1..imat-1 only.
    for e in rules.entries:
        for n in e.nots:
            assert n.entry < e.index, e.ident
            assert n.feature < len(rules.entries[n.entry].features)


def test_group_zero_competes_in_both_reported_groups(rules):
    veg = next(e for e in rules.entries if e.ident == 'vegetation1')
    assert veg.group == 0
    assert set(veg.competes_in) == {1, 2}
    # tp1all.r visits the group's own entries first, then group 0's.
    members = rules.group_members(2)
    first_shared = next(i for i, m in enumerate(members) if rules.entries[m].group == 0)
    assert all(rules.entries[m].group == 2 for m in members[:first_shared])


def test_deleted_channels_are_the_emit_c_set(rules):
    # DELETED.channels/delete_emit_c: 1t4 75t79 99t106 128t148 188t214 218 219t221 226 280t285
    expect = set()
    for a, b in ((1, 4), (75, 79), (99, 106), (128, 148), (188, 214), (218, 221), (226, 226), (280, 285)):
        expect.update(range(a - 1, b))
    assert set(np.where(rules.deleted)[0]) == expect


# One feature: equations 2-7 of Clark et al. (2003) ------------------------------


def _synthetic_feature(n=40):
    waves = np.linspace(2.0, 2.4, n)
    band = np.arange(5, n - 5)
    centre = 2.2
    lib = 1.0 - 0.4 * np.exp(-0.5 * ((waves - centre) / 0.03) ** 2)
    ref_cr = lib[band]  # the reference continuum is 1 at the intervals
    minch = band[np.argmin(ref_cr)]
    f = tc.Feature(
        importance='D', enabled=True, weight=1.0, ftype=1,
        left=np.arange(0, 5), right=np.arange(n - 5, n), band=band,
        reference=ref_cr, minch=int(minch),
    )
    return waves, lib, f


def test_scaled_reference_fits_exactly_and_recovers_its_contrast():
    # O = continuum * (a + b*Lc) with a = 1 - b: a feature of the reference's
    # shape at contrast b. Equation 4 solves for b; eq. 7 gives F = 1; the
    # depth is b times the reference depth.
    waves, lib, f = _synthetic_feature()
    continuum = 0.2 + 0.1 * (waves - 2.0)
    b = 0.35
    obs = continuum * ((1.0 - b) + b * lib)
    r = tc.feature_fit(obs[None, :], waves, f)
    assert r.valid[0]
    assert r.fit[0] == pytest.approx(1.0, abs=1e-9)
    # Eq. 2 on the scaled reference: b * (1 - Lc at its sampled minimum). The
    # Gaussian's tails reach the continuum intervals at the 1e-6 level, so the
    # agreement is to that level, not to rounding.
    assert r.depth[0] == pytest.approx(b * (1.0 - f.reference.min()), rel=1e-5)
    assert r.conref[0] == pytest.approx(continuum[f.minch], rel=1e-5)


def test_unrelated_shape_fits_poorly():
    waves, _, f = _synthetic_feature()
    shifted = 1.0 - 0.3 * np.exp(-0.5 * ((waves - 2.33) / 0.02) ** 2)
    r = tc.feature_fit(shifted[None, :] * 0.25, waves, f)
    assert r.fit[0] < 0.5


def test_deleted_channel_is_skipped_per_pixel():
    waves, lib, f = _synthetic_feature()
    obs = np.stack([0.3 * lib, 0.3 * lib])
    obs[1, f.band[3]] = np.nan
    r = tc.feature_fit(obs, waves, f)
    assert r.valid.all()
    assert r.fit[1] == pytest.approx(1.0, abs=1e-9)


def test_dark_continuum_is_no_answer():
    # bandmp.r refuses a continuum below 1e-20.
    waves, lib, f = _synthetic_feature()
    r = tc.feature_fit((lib * 0.0)[None, :], waves, f)
    assert not r.valid[0]
    assert r.fit[0] == 0.0


def test_below_constraint_follows_the_fortran_argument_order():
    x = np.array([0.1, 0.35, 0.5, 0.85, 0.95])
    # rcbblc< 0.9 0.8: full below 0.8, ramp to 0 at 0.9, rejected above.
    np.testing.assert_allclose(tc._below(x, 0.9, 0.8), [1, 1, 1, 0.5, 0])
    # rcbblc< 0.3 0.4: the ramp lies above the rejection limit, so a hard cut.
    np.testing.assert_allclose(tc._below(x, 0.3, 0.4), [1, 0, 0, 0, 0])


def test_above_constraint_ramps_between_its_limits():
    x = np.array([0.8, 0.95, 1.2])
    np.testing.assert_allclose(tc._above(x, 0.9, 1.1), [0, 0.25, 1])


# The expert system on its own references ------------------------------------------


@pytest.mark.parametrize(('ident', 'group', 'klass'), [
    ('hematite.fine.gr.gds76', 1, 'hematite'),
    ('goethite.medgr.ws222', 1, 'goethite'),
    ('kaolwxl', 2, 'kaolinite'),
    ('gibbsite', 2, 'gibbsite'),
    ('montna', 2, 'smectite'),
    ('calcite.ws272.g2', 2, 'calcite'),
])
def test_reference_spectrum_is_identified_as_its_class(rules, raw_entries, library, ident, group, klass):
    spec = spectrum_of(ident, raw_entries, library)
    res = tc.classify(spec[None, :], rules)[group]
    assert res.entry[0] >= 0
    assert rules.entries[res.entry[0]].klass == klass
    assert res.fit[0] > 0.9


def test_features_in_separate_regions_are_both_found(rules, raw_entries, library):
    # Clark et al. (2003) section 2.9: a group answers per wavelength region,
    # so an areal mixture of an iron oxide and a clay is reported as both.
    hem = spectrum_of('hematite.fine.gr.gds76', raw_entries, library)
    kao = spectrum_of('kaolwxl', raw_entries, library)
    mix = 0.5 * hem + 0.5 * kao
    res = tc.classify(mix[None, :], rules)
    assert rules.entries[res[1].entry[0]].klass == 'hematite'
    assert rules.entries[res[2].entry[0]].klass == 'kaolinite'


def test_green_vegetation_wins_the_group_it_competes_in(rules, raw_entries, library):
    veg = spectrum_of('vegetation1', raw_entries, library)
    res = tc.classify(veg[None, :], rules)
    assert rules.entries[res[1].entry[0]].klass == 'vegetation'


def test_featureless_spectrum_has_no_answer(rules):
    flat = np.full((1, len(rules.wavelengths)), 0.3)
    res = tc.classify(flat, rules)
    for g in rules.reported_groups:
        assert res[g].entry[0] == -1
        assert res[g].depth[0] == 0.0


def test_an_unusable_pixel_does_not_disturb_its_neighbours(rules, raw_entries, library):
    kao = spectrum_of('kaolwxl', raw_entries, library)
    block = np.stack([kao, np.full_like(kao, np.nan), kao])
    res = tc.classify(block, rules)[2]
    assert res.entry[1] == -1
    assert res.entry[0] == res.entry[2] >= 0


def test_wrong_channel_count_is_refused(rules):
    with pytest.raises(ValueError, match='285'):
        tc.classify(np.zeros((1, 224)), rules)
