"""The field-boundary product: grid, scene grouping, tiling, polygons, weights."""

from __future__ import annotations

import hashlib
from types import SimpleNamespace

import numpy as np
import pytest
from shapely.geometry import box, shape

from terra import protocol
from terra.fields import polygons, scenes, segment, weights

# --- grid -------------------------------------------------------------------


def test_reference_grid_is_utm_south_on_the_ten_metre_lattice():
    area = box(-53.24, -25.34, -53.18, -25.28)
    grid = scenes.reference_grid(area, buffer_m=320.0)
    assert grid.crs.to_epsg() == 32722
    assert grid.transform.a == 10.0 and grid.transform.e == -10.0
    assert grid.transform.c % 10 == 0 and grid.transform.f % 10 == 0
    left, bottom, right, top = grid.bounds
    minx, miny, maxx, maxy = scenes.to_grid_crs(area, grid.crs).bounds
    assert left <= minx - 320 and right >= maxx + 320
    assert bottom <= miny - 320 and top >= maxy + 320


def test_area_mask_covers_the_area_and_not_the_margin():
    area = box(-53.22, -25.32, -53.20, -25.30)
    grid = scenes.reference_grid(area, buffer_m=500.0)
    inside = scenes.area_mask(area, grid)
    assert inside.any() and not inside.all()
    # The margin is 50 cells wide on every side.
    assert not inside[:40].any() and not inside[-40:].any()
    assert not inside[:, :40].any() and not inside[:, -40:].any()


# --- scene grouping ---------------------------------------------------------


def _item(item_id, date, orbit, cloud, assets=(*scenes.BANDS, 'SCL')):
    return SimpleNamespace(
        id=item_id,
        properties={
            'datetime': f'{date}T13:38:31Z',
            'sat:relative_orbit': orbit,
            'eo:cloud_cover': cloud,
        },
        assets={a: SimpleNamespace(href=f'{item_id}/{a}.tif') for a in assets},
    )


def test_tiles_of_one_pass_are_one_scene_and_passes_are_apart():
    items = [
        _item('T22JBT_a', '2024-10-31', 124, 12.0),
        _item('T21JZN_a', '2024-10-31', 124, 3.0),
        _item('T22JBT_b', '2024-11-05', 124, 1.0),
        # Same date, other orbit: a second pass.
        _item('T22JBT_c', '2024-10-31', 81, 5.0),
    ]
    found = scenes.group_scenes(items)
    assert [(s.date, len(s.items)) for s in found] == [
        ('2024-11-05', 1),
        ('2024-10-31', 1),
        ('2024-10-31', 2),
    ]
    # The scene's cloud cover is its worst tile's.
    assert found[-1].cloud_cover == 12.0


def test_an_item_missing_a_band_or_the_classification_is_left_out():
    items = [
        _item('no_scl', '2024-10-31', 124, 1.0, assets=scenes.BANDS),
        _item('no_nir', '2024-10-31', 124, 1.0, assets=('B04', 'B03', 'B02', 'SCL')),
    ]
    assert scenes.group_scenes(items) == []


def test_unusable_classification_values():
    scl = np.array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], dtype=np.uint8)
    assert scenes.usable(scl).tolist() == [
        False, False, True, False, True, True, True, True, False, False, False, True,
    ]


def test_network_input_is_a_then_b_over_three_thousand():
    a = np.full((4, 2, 2), 3000.0, dtype=np.float32)
    b = np.full((4, 2, 2), 1500.0, dtype=np.float32)
    x = scenes.network_input(a, b)
    assert x.shape == (8, 2, 2)
    assert np.allclose(x[:4], 1.0) and np.allclose(x[4:], 0.5)


# --- tiling -----------------------------------------------------------------


@pytest.mark.parametrize('size,tile,margin', [(100, 64, 8), (48, 64, 8), (1000, 1024, 64)])
def test_tile_cores_cover_the_axis_exactly_once(size, tile, margin):
    origins = segment.tile_origins(size, tile, margin)
    step = tile - 2 * margin
    covered = np.zeros(size, dtype=int)
    for o in origins:
        covered[o:min(o + step, size)] += 1
    assert (covered == 1).all()


def test_tiled_prediction_equals_whole_image_prediction_for_a_pointwise_net():
    torch = pytest.importorskip('torch')
    net = torch.nn.Conv2d(8, 3, kernel_size=1)
    torch.manual_seed(0)
    torch.nn.init.normal_(net.weight)
    rng = np.random.default_rng(0)
    x = rng.random((8, 70, 90), dtype=np.float32)
    whole = segment.predict(net, x, resize=1, tile=4096, margin=0)
    tiled = segment.predict(net, x, resize=1, tile=64, margin=16)
    assert whole.shape == (3, 70, 90)
    assert np.allclose(whole, tiled, atol=1e-5)
    assert np.allclose(whole.sum(axis=0), 1.0, atol=1e-5)


def test_resize_returns_the_input_grid():
    torch = pytest.importorskip('torch')
    net = torch.nn.Conv2d(8, 3, kernel_size=1)
    x = np.zeros((8, 33, 17), dtype=np.float32)
    assert segment.predict(net, x, resize=2, tile=64, margin=8).shape == (3, 33, 17)


# --- polygons ---------------------------------------------------------------


def _synthetic():
    """Two interior blocks split by a boundary row, on a grid over one area."""
    area = box(-53.22, -25.32, -53.20, -25.30)
    grid = scenes.reference_grid(area, buffer_m=0.0)
    h, w = grid.height, grid.width
    classes = np.zeros((h, w), dtype=np.uint8)
    classes[10:60, 10:120] = segment.CLASS_INTERIOR
    classes[60, 10:120] = segment.CLASS_BOUNDARY
    classes[61:100, 10:120] = segment.CLASS_INTERIOR
    prob = np.where(classes == segment.CLASS_INTERIOR, 0.9, 0.1).astype(np.float32)
    return area, grid, classes, prob


def test_each_interior_region_becomes_one_field_largest_first():
    area, grid, classes, prob = _synthetic()
    valid = np.ones_like(classes, dtype=bool)
    features = polygons.fields_from_classes(
        classes, prob, valid, grid, area, min_area_m2=500, simplify_m=0
    )
    assert [f['properties']['field'] for f in features] == [1, 2]
    areas = [f['properties']['area_ha'] for f in features]
    # 50 x 110 and 39 x 110 cells of 100 m^2.
    assert areas == pytest.approx([55.0, 42.9], abs=1e-6)
    assert all(f['properties']['mean_interior_prob'] == pytest.approx(0.9) for f in features)
    # WGS84 out.
    minx, miny, maxx, maxy = shape(features[0]['geometry']).bounds
    assert -54 < minx < maxx < -53 and -26 < miny < maxy < -25


def test_masked_cells_are_not_field_and_small_regions_are_dropped():
    area, grid, classes, prob = _synthetic()
    valid = np.ones_like(classes, dtype=bool)
    valid[61:100] = False
    classes[150:152, 150:152] = segment.CLASS_INTERIOR  # 400 m^2
    features = polygons.fields_from_classes(
        classes, prob, valid, grid, area, min_area_m2=500, simplify_m=0
    )
    assert len(features) == 1
    assert features[0]['properties']['area_ha'] == pytest.approx(55.0)


def test_fields_are_clipped_to_the_area():
    area, grid, classes, prob = _synthetic()
    valid = np.ones_like(classes, dtype=bool)
    left, bottom, right, top = grid.bounds
    # The area's western half only, in WGS84.
    half = scenes.to_grid_crs(area, grid.crs)
    from pyproj import Transformer
    from shapely.ops import transform as shp_transform

    cut = box(left, bottom, left + 650.0, top).intersection(half)
    back = Transformer.from_crs(grid.crs, 'EPSG:4326', always_xy=True)
    west = shp_transform(back.transform, cut)
    features = polygons.fields_from_classes(
        classes, prob, valid, grid, west, min_area_m2=500, simplify_m=0
    )
    # Columns 10..64 of each block remain.
    assert [f['properties']['area_ha'] for f in features] == pytest.approx(
        [27.5, 21.45], abs=0.2
    )


def test_a_region_the_area_cuts_in_two_becomes_two_fields():
    area, grid, classes, prob = _synthetic()
    valid = np.ones_like(classes, dtype=bool)
    from pyproj import Transformer
    from shapely.geometry import MultiPolygon
    from shapely.ops import transform as shp_transform

    # Two strips of the area, each crossing both blocks, with a gap between
    # them: every block is cut into a western and an eastern part.
    left, bottom, right, top = grid.bounds
    utm = scenes.to_grid_crs(area, grid.crs)
    strips = MultiPolygon([
        box(left, bottom, left + 550.0, top).intersection(utm),
        box(left + 750.0, bottom, right, top).intersection(utm),
    ])
    back = Transformer.from_crs(grid.crs, 'EPSG:4326', always_xy=True)
    features = polygons.fields_from_classes(
        classes, prob, valid, grid, shp_transform(back.transform, strips),
        min_area_m2=500, simplify_m=0,
    )
    assert len(features) == 4
    assert all(f['geometry']['type'] == 'Polygon' for f in features)
    assert [f['properties']['field'] for f in features] == [1, 2, 3, 4]
    areas = [f['properties']['area_ha'] for f in features]
    assert areas == sorted(areas, reverse=True)
    # Figures over each part's own cells.
    assert all(f['properties']['mean_interior_prob'] == pytest.approx(0.9) for f in features)


def test_cropland_share_is_the_mean_over_the_field():
    area, grid, classes, prob = _synthetic()
    valid = np.ones_like(classes, dtype=bool)
    cropland = np.zeros_like(classes, dtype=bool)
    cropland[10:35, 10:120] = True  # half of the northern block
    features = polygons.fields_from_classes(
        classes, prob, valid, grid, area, min_area_m2=500, simplify_m=0, cropland=cropland
    )
    # Largest first: the northern block, then the southern.
    assert [f['properties']['cropland_share'] for f in features] == pytest.approx([0.5, 0.0])


def test_area_summary():
    feats = [{'properties': {'area_ha': v}} for v in (1.0, 2.0, 3.0, 10.0)]
    s = polygons.area_summary(feats)
    assert s['total'] == 16.0 and s['median'] == 2.5 and s['max'] == 10.0
    assert polygons.area_summary([]) is None


# --- weights ----------------------------------------------------------------


class _Resp:
    def __init__(self, payload: bytes):
        self.payload = payload

    def iter_content(self, chunk_size):
        for i in range(0, len(self.payload), 7):
            yield self.payload[i:i + 7]


def _checkpoint(payload: bytes, digest: str | None = None) -> weights.Checkpoint:
    return weights.Checkpoint(
        name='TEST',
        title='test weights',
        url='https://example.invalid/test.ckpt',
        sha256=digest or hashlib.sha256(payload).hexdigest(),
        size_bytes=len(payload),
        license='CC0',
    )


def test_download_is_verified_and_moved_into_place(tmp_path):
    payload = b'field boundaries' * 10
    seen = []
    path = weights.ensure(
        _checkpoint(payload), tmp_path,
        progress=lambda frac, msg: seen.append(frac),
        fetch=lambda url: _Resp(payload),
    )
    assert path.read_bytes() == payload
    assert not list(tmp_path.glob('*.part'))
    assert seen and seen[-1] == pytest.approx(1.0)


def test_a_download_that_does_not_match_the_digest_is_deleted(tmp_path):
    payload = b'field boundaries'
    with pytest.raises(protocol.Unavailable, match='digest'):
        weights.ensure(
            _checkpoint(payload, digest='0' * 64), tmp_path,
            fetch=lambda url: _Resp(payload),
        )
    assert list(tmp_path.iterdir()) == []


def test_a_file_already_present_is_not_fetched_again(tmp_path):
    payload = b'field boundaries'
    ckpt = _checkpoint(payload)
    (tmp_path / ckpt.filename).write_bytes(payload)

    def refuse(url):
        raise AssertionError('fetched a checkpoint already on disk')

    assert weights.ensure(ckpt, tmp_path, fetch=refuse).read_bytes() == payload


def test_a_failed_download_says_what_was_missing(tmp_path):
    def broken(url):
        raise OSError('connection reset')

    with pytest.raises(protocol.Unavailable, match='could not be downloaded'):
        weights.ensure(_checkpoint(b'x'), tmp_path, fetch=broken)
    assert list(tmp_path.iterdir()) == []


def test_the_default_checkpoint_is_registered():
    assert weights.lookup(None).name == weights.DEFAULT
    with pytest.raises(ValueError, match='unknown'):
        weights.lookup('NOT_A_CHECKPOINT')
