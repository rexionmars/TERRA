"""
CBERS-4A WPM true colour over an area, read from a scene written here.

The scene is a GeoTIFF in the layout INPE publishes: three 8-bit bands, 0 as no
data, 2 m pixels on UTM zone 22S. Its data fills only the western half of its
grid, as the camera's tilted strip fills only part of the grid an item's
footprint describes.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin
from shapely.geometry import box

from terra.scenes import cbers4a

# 1 km by 1 km at 2 m, near Cascavel, Paraná.
LEFT, TOP, SIZE, PIXEL = 250_000.0, 7_240_000.0, 500, 2.0


@pytest.fixture
def scene(tmp_path: Path) -> Path:
    path = tmp_path / 'CBERS4A_WPM_PCA_RGB321_20240419_210_145.tif'
    rng = np.random.default_rng(1)
    data = rng.integers(20, 230, (3, SIZE, SIZE), dtype=np.uint8)
    data[:, :, SIZE // 2:] = 0
    with rasterio.open(
        path, 'w', driver='GTiff', height=SIZE, width=SIZE, count=3, dtype='uint8',
        crs='EPSG:32722', transform=from_origin(LEFT, TOP, PIXEL, PIXEL), nodata=0,
    ) as dst:
        dst.write(data)
    return path


def lonlat_box(x0: float, y0: float, x1: float, y1: float):
    """A box given in the scene's UTM metres, as a polygon in degrees."""
    to = Transformer.from_crs(32722, 4326, always_xy=True)
    (lon0, lon1), (lat0, lat1) = to.transform([x0, x1], [y0, y1])
    return box(min(lon0, lon1), min(lat0, lat1), max(lon0, lon1), max(lat0, lat1))


WHOLE = lonlat_box(LEFT + 20, TOP - SIZE * PIXEL + 20, LEFT + SIZE * PIXEL - 20, TOP - 20)
EAST = lonlat_box(LEFT + SIZE * PIXEL * 0.6, TOP - 800, LEFT + SIZE * PIXEL * 0.9, TOP - 200)


def test_the_share_of_the_area_with_data_is_measured_on_the_pixels(scene: Path) -> None:
    assert cbers4a._coverage(str(scene), WHOLE) == pytest.approx(0.5, abs=0.03)
    assert cbers4a._coverage(str(scene), EAST) == 0.0


def test_a_scene_whose_strip_misses_the_area_is_left_out(
        scene: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def item(id_: str, day: int):
        return SimpleNamespace(
            id=id_, datetime=datetime(2024, 4, day),
            assets={'tci': SimpleNamespace(href=str(scene)),
                    'thumbnail': SimpleNamespace(href='https://example/thumb.png')},
        )

    monkeypatch.setattr(cbers4a, '_items', lambda polygon, start, end: [
        item('CBERS4A_WPM_PCA_RGB321_20240401_210_145', 1),
        item('CBERS4A_WPM_PCA_RGB321_20240419_210_145', 19),
    ])
    found = cbers4a.list_scenes(WHOLE, '2024-01-01', '2024-12-31')
    assert [s.date for s in found] == ['2024-04-19', '2024-04-01']
    assert found[0].coverage == pytest.approx(0.5, abs=0.03)
    assert found[0].preview == 'https://example/thumb.png'
    assert cbers4a.list_scenes(EAST, '2024-01-01', '2024-12-31') == []


def test_the_view_is_drawn_inside_the_area_and_where_the_scene_has_data(scene: Path) -> None:
    drawn = cbers4a.view(str(scene), WHOLE, 2, 98)
    alpha = drawn.rgba[:, :, 3]
    h, w = alpha.shape
    assert drawn.pixel_m == pytest.approx(PIXEL)
    assert alpha[h // 2, w // 4] == 255
    assert alpha[h // 2, 3 * w // 4] == 0
    assert drawn.coverage == pytest.approx(0.5, abs=0.03)
    assert str(drawn.profile['crs']) == 'EPSG:32722'


def test_a_large_area_is_read_from_an_overview_and_says_at_what_pixel(
        scene: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cbers4a, 'MAX_PX', 100)
    drawn = cbers4a.view(str(scene), WHOLE, 2, 98)
    assert max(drawn.rgba.shape[:2]) <= 100
    assert drawn.pixel_m > PIXEL * 4


def test_a_scene_is_named_by_its_path_and_row() -> None:
    assert cbers4a.path_row('CBERS4A_WPM_PCA_RGB321_20240419_210_145') == '210/145'
    assert cbers4a.path_row('odd') == ''


def test_the_view_says_where_it_came_from() -> None:
    [src] = cbers4a.imagery_source()
    assert src['catalogue_collection'] == 'CB4A-WPM-PCA-FUSED-1'
    assert src['url'] == 'https://data.inpe.br/bdc/stac/v1'


class _Gateway:
    """A catalogue that answers 502 with an HTML page `fails` times, then lists `items`."""

    def __init__(self, fails: int, items: list) -> None:
        self.fails, self.items, self.calls = fails, items, 0

    def open(self, url: str):
        self.calls += 1
        if self.calls <= self.fails:
            raise RuntimeError('<html><head><title>502 Bad Gateway</title></head></html>')
        return SimpleNamespace(search=lambda **kw: SimpleNamespace(items=lambda: iter(self.items)))


def test_a_catalogue_that_fails_once_is_asked_again(monkeypatch: pytest.MonkeyPatch) -> None:
    import pystac_client

    from terra import stac

    monkeypatch.setattr(stac, 'RETRY_WAITS', (0, 0, 0))
    item = SimpleNamespace(id='x', geometry=WHOLE.__geo_interface__)
    gateway = _Gateway(fails=1, items=[item])
    monkeypatch.setattr(pystac_client, 'Client', SimpleNamespace(open=gateway.open))
    assert cbers4a._items(WHOLE, '2024-01-01', '2024-12-31') == [item]
    assert gateway.calls == 2


def test_a_catalogue_that_keeps_failing_is_reported_in_words(monkeypatch: pytest.MonkeyPatch) -> None:
    import pystac_client

    from terra import stac

    monkeypatch.setattr(stac, 'RETRY_WAITS', (0, 0, 0))
    monkeypatch.setattr(pystac_client, 'Client', SimpleNamespace(open=_Gateway(fails=9, items=[]).open))
    with pytest.raises(stac.Unavailable) as raised:
        cbers4a._items(WHOLE, '2024-01-01', '2024-12-31')
    assert 'INPE Brazil Data Cube is temporarily unavailable' in str(raised.value)
    assert '<html>' not in str(raised.value)
