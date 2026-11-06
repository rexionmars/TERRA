"""Where the CCI Biomass tiles are, and how an area's figures are scaled."""

from __future__ import annotations

import numpy as np
import pytest
from rasterio.transform import from_origin

from terra.biomass import actions, cci


def test_a_tile_is_named_for_its_north_west_corner():
    assert cci.tile_name(-10, -60) == 'S10W060'
    assert cci.tile_name(0, 0) == 'N00E000'
    assert cci.tile_name(50, 10) == 'N50E010'


def test_an_area_in_mato_grosso_falls_in_one_tile():
    assert cci.tiles_over(-55.50, -12.06, -55.44, -12.00) == [(-10, -60)]


def test_an_area_across_a_tile_edge_reads_both_tiles():
    assert sorted(cci.tiles_over(-50.2, -20.1, -49.8, -19.9)) == sorted(
        [(-20, -60), (-20, -50), (-10, -60), (-10, -50)]
    )


def test_the_url_is_the_published_file_name():
    assert cci.tile_url(2022, -10, -60) == (
        'https://dap.ceda.ac.uk/neodc/esacci/biomass/data/agb/maps/v6.0/geotiff/2022/'
        'S10W060_ESACCI-BIOMASS-L4-AGB-MERGED-100m-2022-fv6.0.tif'
    )
    assert '-AGB_SD-' in cci.tile_url(2022, -10, -60, deviation=True)


def test_a_year_the_map_does_not_cover_is_refused_before_any_read():
    from shapely.geometry import box

    with pytest.raises(ValueError, match='no map for 2012'):
        cci.read(box(-55.5, -12.1, -55.4, -12.0), 2012)


def test_a_cell_at_the_equator_is_about_a_hectare_and_narrows_towards_the_pole():
    step = 1 / 1125  # the map's 0.000888 degree
    equator = cci.cell_area_ha(from_origin(0, step / 2, step, step), 1)[0]
    sixty = cci.cell_area_ha(from_origin(0, 60 + step / 2, step, step), 1)[0]
    assert equator == pytest.approx(0.98, abs=0.01)
    assert sixty == pytest.approx(equator / 2, rel=0.01)


def test_the_scale_top_is_never_under_fifty_and_rounds_up_to_fifty():
    assert actions.scale_top(np.array([0.0, 5.0, 12.0])) == 50.0
    assert actions.scale_top(np.linspace(0, 210, 1000)) == 250.0
