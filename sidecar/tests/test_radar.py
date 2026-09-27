"""Sentinel-1 radar: the arithmetic of a series, without the network."""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from terra.radar import series


def obs(d: str, vh: float, cr: float, orbit: int = 170) -> series.Observation:
    return series.Observation(
        date=d,
        relative_orbit=orbit,
        orbit_state='descending',
        platform='sentinel-1c',
        vv_db=vh - cr,
        vh_db=vh,
        cr_db=cr,
        water_fraction=0.0,
        valid_fraction=1.0,
    )


def item(iid: str, d: str, orbit: int, assets=('vv', 'vh')):
    return SimpleNamespace(
        id=iid,
        assets={a: None for a in assets},
        properties={'datetime': f'{d}T09:03:19Z', 'sat:relative_orbit': orbit, 'sat:orbit_state': 'descending', 'platform': 'sentinel-1c'},
    )


def test_slices_of_one_pass_are_one_acquisition_and_orbits_stay_apart():
    passes = series.group_acquisitions(
        [
            item('b', '2025-10-01', 170),
            item('a', '2025-10-01', 170),
            item('c', '2025-10-01', 97),
            item('d', '2025-09-19', 170),
            item('e', '2025-09-20', 170, assets=('vv',)),
        ]
    )
    assert [(p.date, p.relative_orbit, [i.id for i in p.items]) for p in passes] == [
        ('2025-09-19', 170, ['d']),
        ('2025-10-01', 97, ['c']),
        ('2025-10-01', 170, ['a', 'b']),
    ]


def test_the_lee_filter_keeps_a_flat_field_and_smooths_its_speckle():
    flat = np.full((40, 40), 0.05, dtype=np.float32)
    assert np.allclose(series.lee_filter(flat)[5:-5, 5:-5], 0.05, rtol=1e-5)

    rng = np.random.default_rng(0)
    # Speckle of an intensity image with ENL looks: gamma-distributed, mean 1.
    speckled = rng.gamma(series.ENL, 1 / series.ENL, size=(80, 80)).astype(np.float32) * 0.05
    filtered = series.lee_filter(speckled)[8:-8, 8:-8]
    assert filtered.std() < 0.5 * speckled[8:-8, 8:-8].std()
    assert filtered.mean() == pytest.approx(0.05, rel=0.05)


def test_the_lee_filter_leaves_no_data_as_no_data():
    img = np.full((20, 20), 0.05, dtype=np.float32)
    img[:, :5] = np.nan
    out = series.lee_filter(img)
    assert np.isnan(out[:, :5]).all()
    assert np.isfinite(out[:, 5:]).all()


def test_means_are_taken_in_power_and_a_pass_that_sees_little_is_not_counted():
    acq = series.Acquisition('2025-10-01', 170, 'descending', 'sentinel-1c', [])
    inside = np.ones((10, 10), dtype=bool)
    vv = np.full((10, 10), 0.1, dtype=np.float32)
    vh = np.full((10, 10), 0.01, dtype=np.float32)
    vh[:, :5] = 0.03  # mean power 0.02: -16.99 dB, where the mean of dB would be -17.61
    o = series.measure(acq, vv, vh, inside, keep=False)
    assert o is not None
    assert o.vv_db == pytest.approx(-10.0)
    assert o.vh_db == pytest.approx(10 * np.log10(0.02))
    assert o.cr_db == pytest.approx(10 * np.log10(0.2))
    assert o.water_fraction == 0.0

    vv[:, :2] = np.nan  # 80% of the area covered
    assert series.measure(acq, vv, vh, inside, keep=False) is None


def test_calm_water_is_read_as_water_and_a_field_is_not():
    water_vv = np.full((20, 20), 10 ** (-21 / 10), dtype=np.float32)
    water_vh = np.full((20, 20), 10 ** (-27 / 10), dtype=np.float32)
    field_vv = np.full((20, 20), 10 ** (-9 / 10), dtype=np.float32)
    field_vh = np.full((20, 20), 10 ** (-15 / 10), dtype=np.float32)
    # Wind-roughened water: VV up to -15 dB, VH still low.
    windy_vv = np.full((20, 20), 10 ** (-15 / 10), dtype=np.float32)
    assert series.water_mask(water_vv, water_vh).all()
    assert series.water_mask(windy_vv, water_vh).all()
    assert not series.water_mask(field_vv, field_vh).any()


# A season in one orbit: winter crop standing, harvested, soybean up and harvested.
SEASON = [
    ('2025-09-19', -13.0, -5.5),
    ('2025-10-01', -12.1, -4.8),
    ('2025-10-13', -11.1, -4.6),
    ('2025-10-25', -17.4, -7.6),  # winter crop off: VH -6.3 dB, CR -3.0 dB
    ('2025-11-06', -16.5, -7.4),
    ('2025-11-18', -15.0, -6.9),
    ('2025-12-12', -14.0, -6.2),
    ('2026-01-05', -13.4, -5.8),
    ('2026-01-29', -13.7, -5.6),
    ('2026-02-10', -17.6, -8.3),  # soybean off: VH -3.9 dB, CR -2.7 dB
    ('2026-02-22', -17.2, -8.1),
]


def test_every_canopy_loss_of_a_season_is_found():
    found = series.orbit_losses([obs(d, vh, cr) for d, vh, cr in SEASON])
    assert [(x['date_from'], x['date_to']) for x in found] == [
        ('2025-10-13', '2025-10-25'),
        ('2026-01-29', '2026-02-10'),
    ]


def test_the_soil_drying_after_rain_is_not_a_loss():
    # VH down by 3.5 dB, VV with it: the cross ratio barely moves.
    s = [obs('2025-09-19', -14.0, -6.0), obs('2025-10-01', -13.0, -5.8), obs('2025-10-13', -12.0, -5.6),
         obs('2025-10-25', -15.5, -5.9), obs('2025-11-06', -15.0, -6.0)]
    assert series.orbit_losses(s) == []


def test_orbits_that_see_one_loss_narrow_its_window():
    a = [obs(d, vh, cr, orbit=170) for d, vh, cr in SEASON[:5]]
    # The same loss seen by another orbit, between 12 and 20 October.
    b = [
        obs('2025-09-24', -12.8, -5.2, orbit=97),
        obs('2025-10-06', -11.9, -4.8, orbit=97),
        obs('2025-10-12', -11.5, -4.6, orbit=97),
        obs('2025-10-20', -17.0, -7.5, orbit=97),
        obs('2025-11-01', -16.8, -7.4, orbit=97),
    ]
    events = series.losses(a + b)
    assert len(events) == 1
    e = events[0]
    assert (e['date_from'], e['date_to'], e['n_orbits'], e['orbits_agree']) == ('2025-10-13', '2025-10-20', 2, True)
    assert e['date'] == '2025-10-16'


def test_a_short_orbit_series_finds_nothing():
    assert series.orbit_losses([obs(d, vh, cr) for d, vh, cr in SEASON[:3]]) == []
