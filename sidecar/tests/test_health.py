"""Vegetation health: the arithmetic of one season against earlier ones."""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest
from pyproj import CRS
from rasterio.transform import from_origin

from terra.health import series
from terra.imagery import mosaic


def obs(d: str, ndvi: float, ndre: float = 0.3, clear: float = 1.0, ndvi_map=None) -> series.Observation:
    return series.Observation(date=d, ndvi=ndvi, ndre=ndre, clear_fraction=clear, ndvi_map=ndvi_map)


def test_the_same_day_earlier_seasons_ago_and_the_29th_of_february():
    assert series.shift_years('2025-10-01', -3) == '2022-10-01'
    assert series.shift_years('2024-02-29', -1) == '2023-02-28'
    assert series.window_of('2025-10-01', '2026-03-31', 2) == ('2023-10-01', '2024-03-31')


def test_days_of_the_year_meet_around_the_new_year():
    assert series.doy_distance('2025-12-28', '2023-01-03') == 6
    assert series.doy_distance('2025-06-01', '2022-06-17') == 16


def test_a_date_against_the_earlier_seasons_within_the_window():
    current = obs('2025-12-20', 0.62, 0.30)
    reference = [
        (1, obs('2024-12-10', 0.80, 0.40)),
        (2, obs('2023-12-25', 0.84, 0.42)),
        (3, obs('2022-12-30', 0.82, 0.41)),
        # Outside the window: the same field in another month.
        (1, obs('2024-10-01', 0.20, 0.10)),
    ]
    a = series.against(current, reference, window=16)
    assert a['baseline_n'] == 3
    assert a['ndvi_mean'] == pytest.approx(0.82)
    # sd of (0.80, 0.84, 0.82) is 0.02 exactly: (0.62 - 0.82) / 0.02 = -10.
    assert a['ndvi_z'] == pytest.approx(-10.0, abs=1e-3)
    assert a['ndre_z'] is not None and a['ndre_z'] < 0


def test_a_spread_too_narrow_to_divide_by_is_floored():
    current = obs('2025-12-20', 0.80)
    reference = [(1, obs('2024-12-20', 0.82)), (2, obs('2023-12-20', 0.82))]
    a = series.against(current, reference, window=16)
    assert a['ndvi_sd'] == 0.0
    assert a['ndvi_z'] == pytest.approx((0.80 - 0.82) / series.SD_FLOOR, abs=1e-3)


def test_one_reference_date_gives_a_mean_and_no_departure():
    a = series.against(obs('2025-12-20', 0.8), [(1, obs('2024-12-21', 0.7))], window=16)
    assert a['baseline_n'] == 1
    assert a['ndvi_mean'] == pytest.approx(0.7)
    assert a['ndvi_z'] is None


def test_two_orbits_of_one_date_keep_the_clearer():
    kept = series.one_per_date([obs('2025-11-02', 0.5, clear=0.4), obs('2025-11-02', 0.6, clear=0.9), obs('2025-10-01', 0.3)])
    assert [(o.date, o.ndvi) for o in kept] == [('2025-10-01', 0.3), ('2025-11-02', 0.6)]


def test_the_map_shows_the_latest_date_clear_enough():
    current = [obs('2025-12-01', 0.7, clear=0.9), obs('2025-12-20', 0.8, clear=0.4)]
    assert series.map_date(current).date == '2025-12-01'
    assert series.map_date([obs('2025-12-20', 0.8, clear=0.4), obs('2025-12-25', 0.8, clear=0.5)]).date == '2025-12-25'


def test_the_anomaly_map_is_the_date_minus_the_median_of_earlier_seasons():
    shown = obs('2025-12-20', 0.7, ndvi_map=np.array([[0.7, 0.5], [np.nan, 0.9]], dtype=np.float32))
    earlier = [
        obs('2024-12-18', 0.8, ndvi_map=np.array([[0.8, 0.6], [0.5, np.nan]], dtype=np.float32)),
        obs('2023-12-22', 0.8, ndvi_map=np.array([[0.9, 0.4], [0.5, np.nan]], dtype=np.float32)),
        obs('2022-12-20', 0.8, ndvi_map=np.array([[0.7, 0.5], [0.5, np.nan]], dtype=np.float32)),
    ]
    diff = series.anomaly_map(shown, earlier)
    assert diff[0, 0] == pytest.approx(-0.1)
    assert diff[0, 1] == pytest.approx(0.0)
    assert np.isnan(diff[1, 0])  # no value on the shown date
    assert np.isnan(diff[1, 1])  # no earlier value
    assert np.isnan(series.anomaly_map(shown, [])).all()


def _grid(n: int) -> mosaic.Grid:
    return mosaic.Grid(crs=CRS.from_epsg(32722), transform=from_origin(0, 0, 10, 10), width=n, height=n)


def _scene(d: str, baseline: str | None) -> mosaic.Scene:
    item = SimpleNamespace(id='x', properties={'s2:processing_baseline': baseline} if baseline else {})
    return mosaic.Scene(date=d, items=[item], cloud_cover=0.0)


def test_an_acquisition_is_read_as_reflectance_over_its_clear_cells(monkeypatch):
    n = 4
    inside = np.ones((n, n), dtype=bool)
    # Digital numbers carrying the 04.00 offset of 1000: reflectance 0.05 red, 0.45 NIR.
    bands = {'B04': 1500, 'B08': 5500, 'B05': 2000, 'B8A': 5000}
    scl = np.full((n, n), 4, dtype=np.uint8)
    scl[0, :] = 9  # one row of cloud

    def read_asset(items, asset, grid, resampling, dtype):
        if asset == 'SCL':
            return scl.copy()
        return np.full((n, n), bands[asset], dtype=dtype)

    monkeypatch.setattr(mosaic, 'read_asset', read_asset)
    o = series.observe(_scene('2025-12-20', '05.11'), _grid(n), inside, keep_map=True)
    assert o is not None
    assert o.clear_fraction == pytest.approx(0.75)
    assert o.ndvi == pytest.approx((0.45 - 0.05) / (0.45 + 0.05), abs=1e-4)
    assert o.ndre == pytest.approx((0.40 - 0.10) / (0.40 + 0.10), abs=1e-4)
    assert o.ndvi_map is not None and np.isnan(o.ndvi_map[0]).all()

    # Mostly cloud: not an observation.
    scl[:3, :] = 9
    assert series.observe(_scene('2025-12-21', '05.11'), _grid(n), inside, keep_map=False) is None
