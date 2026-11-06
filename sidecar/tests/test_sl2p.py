"""SL2P against SNAP's own test cases, and the angle reading it depends on."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from terra.scenes import angles, sl2p

DATA = Path(__file__).resolve().parent / 'data'
# Column of each variable in the fixture, after the 11 inputs.
COLUMN = {'fapar': 11, 'fcover': 12, 'lai': 13, 'ccc': 14, 'cwc': 15}
# The published values carry five or six significant figures.
RELATIVE = 1e-3


@pytest.mark.parametrize('sensor', ['S2A', 'S2B'])
@pytest.mark.parametrize('variable', sorted(COLUMN))
def test_each_network_reproduces_snaps_test_cases(sensor, variable):
    rows = np.loadtxt(DATA / f'sl2p_snap_cases_{sensor}.csv', delimiter=',')
    expected = rows[:, COLUMN[variable]]
    got = sl2p.estimate(sl2p.load(sensor, variable), rows[:, :8], rows[:, 8:11]).values

    assert np.array_equal(np.isnan(got), np.isnan(expected))
    ok = np.isfinite(expected)
    scale = np.maximum(np.abs(expected[ok]), 1e-2 * sl2p.load(sensor, variable).out_max)
    assert np.max(np.abs(got[ok] - expected[ok]) / scale) < RELATIVE


def test_an_output_beyond_the_tolerance_is_no_value():
    net = sl2p.load('S2A', 'lai')
    far_above = net.out_max + 10 * net.tolerance
    # A network whose output is a constant, to put it where the test wants it.
    flat = sl2p.Network(**{**net.__dict__, 'w2': np.zeros(5), 'b2': 1.0, 'denormalisation': (0.0, far_above)})
    est = sl2p.estimate(flat, np.full((1, 8), 0.1), np.ones((1, 3)))
    assert np.isnan(est.values[0]) and est.too_high[0]


def test_a_reflectance_outside_the_band_bounds_is_out_of_domain():
    net = sl2p.load('S2A', 'lai')
    inside = (net.domain_min + net.domain_max) / 2
    outside = inside.copy()
    outside[0] = net.domain_max[0] + 0.1
    flags = sl2p.in_domain(net, np.stack([outside]))
    assert not flags[0]


def test_sentinel_2c_runs_through_the_2a_network_and_says_so():
    sensor, note = sl2p.sensor_for('Sentinel-2C')
    assert sensor == 'S2A' and note and 'Sentinel-2C' in note
    assert sl2p.sensor_for('Sentinel-2B') == ('S2B', None)


def _metadata(view_azimuths: tuple[str, str]) -> str:
    """A tile metadata document in the shape of MTD_TL.xml, two detectors over one node."""
    def grid(value: str) -> str:
        row = ' '.join([value] * 3)
        return f'<Values_List><VALUES>{row}</VALUES><VALUES>{row}</VALUES><VALUES>{row}</VALUES></Values_List>'

    detectors = ''.join(
        f'<Viewing_Incidence_Angles_Grids bandId="0" detectorId="{i}">'
        f'<Zenith><COL_STEP>5000</COL_STEP>{grid(z)}</Zenith>'
        f'<Azimuth><COL_STEP>5000</COL_STEP>{grid(a)}</Azimuth>'
        '</Viewing_Incidence_Angles_Grids>'
        for i, (z, a) in enumerate([('4.0', view_azimuths[0]), ('6.0', view_azimuths[1])])
    )
    return (
        '<n1:Level-2A_Tile_ID xmlns:n1="https://psd-14.sentinel2.eo.esa.int/PSD/S2_PDI_Level-2A_Tile_Metadata.xsd">'
        '<n1:Geometric_Info><Tile_Geocoding>'
        '<HORIZONTAL_CS_CODE>EPSG:32721</HORIZONTAL_CS_CODE>'
        '<Geoposition resolution="10"><ULX>699960</ULX><ULY>8700040</ULY></Geoposition>'
        '</Tile_Geocoding><Tile_Angles>'
        f'<Sun_Angles_Grid><Zenith>{grid("30.0")}</Zenith><Azimuth>{grid("60.0")}</Azimuth></Sun_Angles_Grid>'
        f'{detectors}'
        '</Tile_Angles></n1:Geometric_Info></n1:Level-2A_Tile_ID>'
    )


def _point_on_node(col: int, row: int) -> tuple[float, float]:
    from pyproj import Transformer

    to_geo = Transformer.from_crs('EPSG:32721', 'EPSG:4326', always_xy=True)
    return to_geo.transform(699960 + col * 5000, 8700040 - row * 5000)


def test_angles_are_read_at_the_node_and_averaged_over_detectors():
    lon, lat = _point_on_node(1, 1)
    got = angles.angles_at(_metadata(('100.0', '110.0')), lon, lat)
    assert got.sun_zenith == 30.0 and got.sun_azimuth == 60.0
    assert got.view_zenith == pytest.approx(5.0)
    assert got.view_azimuth == pytest.approx(105.0)


def test_azimuths_either_side_of_north_average_to_north():
    lon, lat = _point_on_node(1, 1)
    got = angles.angles_at(_metadata(('359.0', '1.0')), lon, lat)
    assert min(got.view_azimuth, 360 - got.view_azimuth) == pytest.approx(0.0, abs=1e-9)


def test_a_node_no_detector_saw_is_refused():
    lon, lat = _point_on_node(1, 1)
    with pytest.raises(ValueError, match='no detector'):
        angles.angles_at(_metadata(('NaN', 'NaN')).replace('4.0', 'NaN').replace('6.0', 'NaN'), lon, lat)


def test_a_point_off_the_tile_is_refused():
    lon, lat = _point_on_node(10, 10)
    with pytest.raises(ValueError, match='off the tile'):
        angles.angles_at(_metadata(('100.0', '110.0')), lon, lat)
