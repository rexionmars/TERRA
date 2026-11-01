"""
Where a raster's corners fall, which is what the map pins it to.

The expected rotation is worked from the meridian convergence of a transverse
Mercator grid, gamma = dlon * sin(lat), and not read off the code under test.
"""

import math

from pyproj import CRS, Transformer
from rasterio.transform import from_origin

from terra.imagery import grid as ref_grid

UTM_22S = CRS.from_epsg(32722)  # central meridian -51
CASCAVEL = (-53.46, -24.95)


def _grid_at(lon, lat, width=1000, height=500, pixel=10.0):
    x, y = Transformer.from_crs('EPSG:4326', UTM_22S, always_xy=True).transform(lon, lat)
    return {'crs': UTM_22S, 'transform': from_origin(x, y, pixel, pixel), 'width': width, 'height': height}


def test_corners_run_clockwise_from_the_top_left():
    tl, tr, br, bl = ref_grid.profile_corners(_grid_at(*CASCAVEL))
    assert tl[0] < tr[0] and bl[0] < br[0]  # west to east
    assert tl[1] > bl[1] and tr[1] > br[1]  # north to south


def test_the_first_corner_is_the_point_the_grid_starts_at():
    tl, *_ = ref_grid.profile_corners(_grid_at(*CASCAVEL))
    assert math.isclose(tl[0], CASCAVEL[0], abs_tol=1e-9)
    assert math.isclose(tl[1], CASCAVEL[1], abs_tol=1e-9)


def test_the_grid_turns_by_the_meridian_convergence():
    tl, tr, *_ = ref_grid.profile_corners(_grid_at(*CASCAVEL))
    lon, lat = CASCAVEL
    # Across the top edge, in local metres, the grid's east axis against true east.
    east = (tr[0] - tl[0]) * math.cos(math.radians(lat))
    north = tr[1] - tl[1]
    measured = math.degrees(math.atan2(north, east))
    expected = (lon - (-51.0)) * math.sin(math.radians(lat))
    assert abs(expected) > 1.0, 'the case has to be one where the rotation is visible'
    assert math.isclose(abs(measured), abs(expected), abs_tol=0.02)


def test_a_grid_on_its_central_meridian_does_not_turn():
    tl, tr, *_ = ref_grid.profile_corners(_grid_at(-51.0, -24.95, width=2, height=2))
    assert math.isclose(tl[1], tr[1], abs_tol=1e-7)
