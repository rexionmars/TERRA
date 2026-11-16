"""
The NDVI trajectory: the gp_series model as ported, the series it reads, the
region its interval is scaled for, and the action, without the network.
"""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from pyproj import CRS
from rasterio.transform import from_origin
from scipy import stats
from shapely.geometry import Point, box

from terra.imagery import cog, mosaic
from terra.trajectory import actions, gp_series as g, region, series

DATA = Path(__file__).resolve().parent / 'data' / 'gp_series'
PACKAGE = DATA / 'package'
PARAMETERS = PACKAGE / 'parameters.json'
# A Mato Grosso training field as TERRA reads it, and what gp_series 0.1.0
# returned for it where the model was built (terra_signal_spectrum,
# models/gp_series/fixture, make_fixture.py).
REFERENCE = DATA / 'reference'
TOLERANCE = 1e-9


@pytest.fixture(scope='module')
def params() -> g.Parameters:
    return g.load_parameters(json.loads(PARAMETERS.read_text()))


def season(days: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Six channels of a field with one crop cycle, as reflectance and indices."""
    ndvi = 0.25 + 0.55 * np.exp(-((days - 120) ** 2) / (2 * 35.0**2))
    red = 0.12 - 0.08 * (ndvi - 0.25) / 0.55
    nir = 0.25 + 0.20 * (ndvi - 0.25) / 0.55
    x = np.column_stack([red * 0.6, red * 0.9, red, nir, ndvi, ndvi * 0.75])
    return x + rng.normal(0, 0.004, x.shape)


# The model, as ported.


def test_the_ported_model_returns_what_it_returned_where_it_was_built(params):
    inp = json.loads((REFERENCE / 'input.json').read_text())
    exp = json.loads((REFERENCE / 'expected.json').read_text())
    assert inp['channels'] == list(g.CHANNELS)
    values = np.array([[np.nan if v is None else v for v in row] for row in inp['values']], float)
    out = g.trajectory(params, np.array(inp['dates'], dtype='datetime64[D]'), inp['clear_fraction'],
                       values, region=inp['region'])
    assert out.dates.astype(str).tolist() == exp['dates']
    for key in ('ndvi', 'lower', 'upper'):
        np.testing.assert_allclose(getattr(out, key), exp[key], rtol=0, atol=TOLERANCE, err_msg=key)
    assert out.observed_dates.astype(str).tolist() == exp['observed_dates']
    np.testing.assert_allclose(out.observed_ndvi, exp['observed_ndvi'], rtol=0, atol=TOLERANCE)
    assert out.kept.tolist() == exp['kept']
    assert out.multiplier == exp['multiplier']
    assert out.scale_name == exp['scale_name'] == 'MT'


def test_one_acquisition_per_date_the_clearer_one():
    dates = np.array(['2020-09-05', '2020-09-05', '2020-09-10', '2020-09-15'], dtype='datetime64[D]')
    values = np.array([[1.0] * 6, [2.0] * 6, [3.0] * 6, [np.nan] + [4.0] * 5])
    when, raw = g.acquisitions(dates, [0.4, 0.8, 0.1, 0.5], values, 0.3)
    np.testing.assert_array_equal(when, np.array(['2020-09-05'], dtype='datetime64[D]'))
    np.testing.assert_array_equal(raw, [[2.0] * 6])


def test_parameters_that_do_not_fit_are_refused():
    raw = json.loads(PARAMETERS.read_text())
    bad = json.loads(json.dumps(raw))
    bad['pca']['basis'] = bad['pca']['basis'][:5]
    with pytest.raises(ValueError, match='6 channels by 3'):
        g.load_parameters(bad)
    bad = json.loads(json.dumps(raw))
    bad['channels'] = bad['channels'][::-1]
    with pytest.raises(ValueError, match='channels'):
        g.load_parameters(bad)
    bad = json.loads(json.dumps(raw))
    bad['interval_ndvi']['global'] = [0.0, 0.1, 4]
    with pytest.raises(ValueError, match='a > 0'):
        g.load_parameters(bad)


def test_the_interval_widens_in_a_gap(params):
    rng = np.random.default_rng(0)
    days = np.concatenate([np.arange(0, 80, 5), np.arange(140, 260, 5)])  # no observation from day 80 to 140
    origin = np.datetime64('2020-09-01')
    out = g.trajectory(params, origin + days.astype('timedelta64[D]'), np.ones(len(days)), season(days, rng), region='MT')
    width = out.upper - out.lower
    offset = (out.dates - origin).astype(int)
    assert width[offset == 110][0] > 1.5 * width[offset == 200][0]
    assert np.all(out.lower <= out.ndvi) and np.all(out.ndvi <= out.upper)
    assert out.scale_name == 'MT'


def test_a_region_outside_the_fitted_ones_takes_the_global_scale(params):
    rng = np.random.default_rng(1)
    days = np.arange(0, 300, 6)
    origin = np.datetime64('2020-09-01')
    x = season(days, rng)
    out = g.trajectory(params, origin + days.astype('timedelta64[D]'), np.ones(len(days)), x, region='RS')
    assert out.scale_name == 'global'
    s = params.ndvi_global
    q = stats.norm.ppf(0.975) if np.isinf(s.nu) else stats.t.ppf(0.975, s.nu)
    assert s.quantile() == pytest.approx(q)


def test_too_few_acquisitions_are_refused(params):
    dates = np.array(['2020-09-05', '2020-09-10'], dtype='datetime64[D]')
    with pytest.raises(ValueError, match='at least 3'):
        g.trajectory(params, dates, [1.0, 1.0], np.full((2, 6), 0.3))


# The series it reads.


def _grid(n: int) -> mosaic.Grid:
    return mosaic.Grid(crs=CRS.from_epsg(32721), transform=from_origin(0, 0, 10, 10), width=n, height=n)


def _scene(d: str, iid: str = 'x') -> mosaic.Scene:
    # Processing baseline 05.11: the digital numbers carry an offset of -1000.
    item = SimpleNamespace(id=iid, properties={'s2:processing_baseline': '05.11'})
    return mosaic.Scene(date=d, items=[item], cloud_cover=0.0)


def test_an_acquisition_is_the_median_over_the_clear_cells_with_data(monkeypatch):
    n = 4
    inside = np.ones((n, n), dtype=bool)
    inside[:, 3] = False  # the area is three columns of four: 12 cells
    scl = np.full((n, n), 4, dtype=np.uint8)
    scl[0, :] = 9  # one row of cloud: 9 of the area's cells left
    red = np.full((n, n), 1500, dtype=np.uint16)  # reflectance 0.05 with the offset added
    red[1, :3] = [1600, 1700, 3000]  # a bright cell the mean would follow and the median does not
    red[2, 0] = 0  # no data in one band: not counted

    def read_asset(items, asset, grid, resampling, dtype):
        if asset == 'SCL':
            return scl.copy()
        return red.copy() if asset == 'B04' else np.full((n, n), 5500, dtype=dtype)

    monkeypatch.setattr(mosaic, 'read_asset', read_asset)
    a = series.read(_scene('2025-12-20'), _grid(n), inside, min_clear=0.3)
    counted = inside & (scl != 9) & (red > 0)
    assert a.clear_fraction == pytest.approx(int(counted.sum()) / 12) == pytest.approx(8 / 12)
    red_refl = (red[counted].astype(np.float64) - 1000) / 10000
    assert a.values[2] == pytest.approx(np.median(red_refl), abs=1e-6)
    assert a.values[2] != pytest.approx(np.mean(red_refl), abs=1e-4)
    assert a.values[3] == pytest.approx(0.45, abs=1e-6)
    assert a.values[4] == pytest.approx(np.median((0.45 - red_refl) / (0.45 + red_refl)), abs=1e-6)
    assert np.isfinite(a.values).all()


def test_an_acquisition_too_cloudy_to_count_is_not_read_past_its_classification(monkeypatch):
    n = 4
    reads: list[str] = []

    def read_asset(items, asset, grid, resampling, dtype):
        reads.append(asset)
        scl = np.full((n, n), 9, dtype=np.uint8)
        scl[0, 0] = 4  # one clear cell of sixteen
        return scl

    monkeypatch.setattr(mosaic, 'read_asset', read_asset)
    a = series.read(_scene('2025-12-21'), _grid(n), np.ones((n, n), dtype=bool), min_clear=0.3)
    assert reads == ['SCL']
    assert a.clear_fraction == pytest.approx(1 / 16)
    assert np.isnan(a.values).all()


# The region.


def _square(lon: float, lat: float, side_deg: float = 0.003):
    h = side_deg / 2
    return box(lon - h, lat - h, lon + h, lat + h)


# Sorriso, Mato Grosso; Luis Eduardo Magalhaes, Bahia, which the box of
# Tocantins also holds; Passo Fundo, Rio Grande do Sul.
SORRISO = (-55.711, -12.545)
LEM = (-45.786, -12.096)
PASSO_FUNDO = (-52.407, -28.262)


def test_an_area_in_mato_grosso_is_in_its_region():
    assert region.region_of(_square(*SORRISO)) == 'MT'


def test_an_area_in_western_bahia_is_in_bahia_though_another_state_box_holds_it():
    assert region.region_of(_square(*LEM)) == 'BA'


def test_an_area_outside_the_calibrated_states_has_no_region():
    assert region.region_of(_square(*PASSO_FUNDO)) is None


def test_an_area_close_to_a_border_has_no_region():
    outline = region.outlines()['MT']
    cx, cy = outline.centroid.coords[0]
    # A vertex of the outline, moved about 500 m towards the state's centre.
    for x, y in outline.exterior.coords[::25]:
        step = 0.0045 / np.hypot(cx - x, cy - y)
        near = Point(x + (cx - x) * step, y + (cy - y) * step)
        if outline.contains(near):
            break
    else:
        pytest.fail('no vertex of the outline moved inside it')
    assert region.region_of(_square(near.x, near.y, side_deg=0.001)) is None


# The action.


def _dn(reflectance: float) -> int:
    return int(round(reflectance * 10000)) + 1000


def _run(monkeypatch, tmp_path, polygon, cloudy: set[int], n_scenes: int = 40):
    """The action over `polygon`, its scenes faked: one crop cycle, 6 days apart."""
    days = np.arange(n_scenes) * 6
    channels = season(days.astype(float), np.random.default_rng(2))
    origin = np.datetime64('2020-09-01')
    scenes = [_scene(str(origin + np.timedelta64(int(d), 'D')), iid=f's{i}') for i, d in enumerate(days)]
    index = {s.items[0].id: i for i, s in enumerate(scenes)}

    def read_asset(items, asset, grid, resampling, dtype):
        i = index[items[0].id]
        shape = (grid.height, grid.width)
        if asset == 'SCL':
            return np.full(shape, 9 if i in cloudy else 4, dtype=dtype)
        band = series.BANDS.index(asset)
        return np.full(shape, _dn(channels[i, band]), dtype=dtype)

    monkeypatch.setattr(cog, 'configure', lambda: None)
    monkeypatch.setattr(mosaic, 'search_scenes', lambda *a, **k: list(scenes))
    monkeypatch.setattr(mosaic, 'read_asset', read_asset)
    req = {
        'action': 'series_trajectory',
        'polygon_geojson': polygon.__geo_interface__,
        'start': '2020-09-01',
        'end': '2021-08-31',
        'model_path': str(PACKAGE),
    }
    actions.trajectory(req, tmp_path)


@pytest.mark.parametrize(('place', 'scale'), [(SORRISO, 'MT'), (PASSO_FUNDO, 'global')])
def test_the_action_returns_the_trajectory_with_the_scale_of_its_region(
        monkeypatch, tmp_path, capsys, place, scale):
    _run(monkeypatch, tmp_path, _square(*place), cloudy={3, 4, 5})
    out = json.loads(capsys.readouterr().out)['trajectory']
    assert out['scale'] == scale
    assert out['region'] == (None if scale == 'global' else scale)
    assert out['model'] == {
        'id': 'gp_series', 'version': '0.1.0', 'name': 'Gaussian Process',
        'digest': '2055cc9e731cc3d9714e0f7544b45152ad0cbe6b9ae897e38bc1e2a68810a132',
    }
    assert (out['scenes_found'], out['scenes_read'], len(out['observations'])) == (40, 40, 37)
    assert out['level'] == 0.95
    days = np.array(out['dates'], dtype='datetime64[D]')
    assert np.all(np.diff(days) == np.timedelta64(1, 'D'))
    assert len(out['ndvi']) == len(out['lower']) == len(out['upper']) == len(days)
    assert np.all(np.array(out['lower']) <= np.array(out['upper']))
    assert all(o['clear_fraction'] == 1.0 for o in out['observations'])


def test_too_few_clear_dates_are_a_sentence_and_not_a_traceback(monkeypatch, tmp_path, capsys):
    with pytest.raises(SystemExit):
        _run(monkeypatch, tmp_path, _square(*SORRISO), cloudy=set(range(2, 40)))
    err = capsys.readouterr().err.strip().splitlines()[-1]
    message = json.loads(err)['error']
    assert message == (
        '2 dates from 2020-09-01 to 2021-08-31 saw at least 30 % of the area clearly, '
        'and the trajectory needs 3. Choose a longer period.'
    )


def test_a_model_of_another_family_is_refused_by_name(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(actions, 'FAMILY', 'another_family')
    with pytest.raises(SystemExit):
        _run(monkeypatch, tmp_path, _square(*SORRISO), cloudy=set())
    message = json.loads(capsys.readouterr().err.strip().splitlines()[-1])['error']
    assert message == (
        'Gaussian Process is a gp_series model; the NDVI trajectory runs a another_family model'
    )
