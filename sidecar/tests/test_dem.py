"""
Checks on the DEM read: grid arithmetic, the buffer, the merge, the alignment.

Offline by construction. Nothing here touches Planetary Computer, and the STAC
call itself is not exercised -- a test that needs the network is a test that
fails for a reason unrelated to the code, and the part of `fetch` worth pinning
is the geometry it hands to `read_merged`, which is reachable without it.

The tiles are synthetic and written to disk, so `read_merged` runs the real
rasterio merge over real files rather than over a stand-in. The field on them
is analytic, which is what makes the seam checkable: if the merge misplaced a
tile by one cell the comparison against the closed form fails by the gradient.
"""

import math

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

import dem

# One arcsecond, the spacing of every 30 m product in the set.
ARCSEC = 1.0 / 3600.0


def elevation_field(lon, lat):
    """A smooth analytic surface, so a merged value has a value to be checked against."""
    return 1000.0 * lon + 500.0 * lat


def write_tile(path, x0, y0, width, height, res, nodata=None, fill=None):
    """A GeoTIFF holding `elevation_field` sampled at cell centres."""
    transform = from_origin(x0, y0, res, res)
    cols = np.arange(width)
    rows = np.arange(height)
    lon = x0 + (cols + 0.5) * res
    lat = y0 - (rows + 0.5) * res
    data = elevation_field(lon[None, :], lat[:, None]).astype("float32")
    if fill is not None:
        data[:] = np.where(fill(lon[None, :], lat[:, None]), nodata, data)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=height,
        width=width,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=transform,
        nodata=nodata,
    ) as dst:
        dst.write(data, 1)
    return str(path)


# ------------------------------------------------------------------ the buffer


def test_buffer_bounds_widens_by_the_requested_distance():
    """A buffer in metres, converted to degrees, measures back as those metres."""
    bounds = (-46.70, -23.60, -46.60, -23.50)

    widened = dem.buffer_bounds(bounds, 3000.0)

    m_lon, m_lat = dem.metres_per_degree(-23.55)
    assert (bounds[0] - widened[0]) * m_lon == pytest.approx(3000.0)
    assert (bounds[1] - widened[1]) * m_lat == pytest.approx(3000.0)
    assert (widened[2] - bounds[2]) * m_lon == pytest.approx(3000.0)
    assert (widened[3] - bounds[3]) * m_lat == pytest.approx(3000.0)


def test_buffer_in_degrees_grows_with_latitude_in_longitude_only():
    """
    The same metre buffer is more degrees of longitude near the pole.

    A buffer applied in degrees rather than metres would be the failure this
    guards: at 60 degrees it would reach half as far east as it does north.
    """
    equator = dem.buffer_bounds((0.0, -0.05, 0.1, 0.05), 5000.0)
    high = dem.buffer_bounds((0.0, 59.95, 0.1, 60.05), 5000.0)

    dlon_eq = equator[0] - 0.0
    dlon_high = high[0] - 0.0
    assert dlon_high < dlon_eq
    assert dlon_eq / dlon_high == pytest.approx(math.cos(math.radians(60.0)), rel=1e-3)
    # Latitude is unaffected: a degree of latitude is the same length anywhere
    # in this approximation.
    assert (equator[3] - 0.05) == pytest.approx(high[3] - 60.05)


def test_buffer_is_floored_on_a_small_aoi():
    """A 3 km AOI would take 600 m at the fraction, below one first-order channel."""
    bounds = (0.0, 0.0, 3000.0 / dem.metres_per_degree(0.0)[0], 0.02)

    assert dem.recommended_buffer_m(bounds) == dem.BUFFER_MIN_M


def test_buffer_is_capped_on_a_large_aoi():
    """A 50 km AOI would take 10 km at the fraction; the cost cap holds it to 5 km."""
    m_lon, _ = dem.metres_per_degree(0.0)
    bounds = (0.0, 0.0, 50_000.0 / m_lon, 0.02)

    assert dem.recommended_buffer_m(bounds) == dem.BUFFER_MAX_M


def test_buffer_follows_the_aoi_between_the_floor_and_the_cap():
    m_lon, _ = dem.metres_per_degree(0.0)
    bounds = (0.0, 0.0, 20_000.0 / m_lon, 0.02)

    assert dem.recommended_buffer_m(bounds) == pytest.approx(4000.0, rel=1e-3)


def test_buffer_sizes_off_the_longer_side():
    """A long thin AOI is buffered for its length, where the inflow is widest."""
    m_lon, m_lat = dem.metres_per_degree(0.0)
    wide = (0.0, 0.0, 20_000.0 / m_lon, 1000.0 / m_lat)

    assert dem.recommended_buffer_m(wide) == pytest.approx(4000.0, rel=1e-3)


def test_negative_buffer_is_refused():
    with pytest.raises(ValueError):
        dem.buffer_bounds((0.0, 0.0, 1.0, 1.0), -1.0)


# -------------------------------------------------------------- grid arithmetic


def test_snap_bounds_lands_on_the_source_grid():
    """Every snapped edge is an integer number of cells from the grid origin."""
    transform = from_origin(-47.0, -23.0, ARCSEC, ARCSEC)
    raw = (-46.70123, -23.60321, -46.59876, -23.49111)

    snapped = dem.snap_bounds(raw, transform)

    for value, origin in ((snapped[0], -47.0), (snapped[2], -47.0)):
        assert (value - origin) / ARCSEC == pytest.approx(
            round((value - origin) / ARCSEC), abs=1e-6
        )
    for value in (snapped[1], snapped[3]):
        assert (-23.0 - value) / ARCSEC == pytest.approx(
            round((-23.0 - value) / ARCSEC), abs=1e-6
        )


def test_snap_bounds_never_shrinks_the_window():
    """
    Snapping widens. A snap that rounded inward would trim the buffer, which is
    the one part of the window that exists to not be trimmed.
    """
    transform = from_origin(-47.0, -23.0, ARCSEC, ARCSEC)
    raw = (-46.70123, -23.60321, -46.59876, -23.49111)

    w, s, e, n = dem.snap_bounds(raw, transform)

    assert w <= raw[0] and s <= raw[1]
    assert e >= raw[2] and n >= raw[3]
    assert (e - w) - (raw[2] - raw[0]) < 2 * ARCSEC


def test_snap_bounds_is_idempotent_on_bounds_already_aligned():
    """
    Bounds already on the grid come back unchanged, at every offset.

    Swept rather than sampled at one offset because the failure is arithmetic,
    not structural: (x0 + k*rx - x0) / rx lands a few ulp below k for most k and
    exactly on it for the rest, so a single offset has roughly even odds of
    missing it. Without the epsilon the floor then drops to k-1 and the window
    grows by a cell every time it is snapped -- and each product's window is
    snapped once per read, so the reference grid would depend on how the buffer
    happened to round.
    """
    transform = from_origin(-47.0, -23.0, ARCSEC, ARCSEC)

    for k in range(1, 200):
        aligned = (
            -47.0 + k * ARCSEC,
            -23.0 - (k + 50) * ARCSEC,
            -47.0 + (k + 80) * ARCSEC,
            -23.0 - k * ARCSEC,
        )
        assert dem.snap_bounds(aligned, transform) == pytest.approx(aligned, abs=1e-12)


def test_snap_bounds_refuses_a_rotated_or_south_up_transform():
    from rasterio.transform import Affine

    with pytest.raises(ValueError):
        dem.snap_bounds((0, 0, 1, 1), Affine(ARCSEC, 0.001, 0, 0.001, -ARCSEC, 1))
    with pytest.raises(ValueError):
        dem.snap_bounds((0, 0, 1, 1), Affine(ARCSEC, 0, 0, 0, ARCSEC, 0))


def test_grids_match_detects_a_half_cell_offset():
    """
    The offset that decides whether nasadem is read resampled or not.

    A pixel-is-point product and a pixel-is-area product over the same degree
    tile have the same resolution and differ only by half a cell in the origin.
    Compared in degrees against a fixed tolerance that difference disappears
    into the magnitude of the origin, and a resampled product would be reported
    as measured.
    """
    a = dem.Grid(from_origin(-47.0, -23.0, ARCSEC, ARCSEC), 100, 100, "EPSG:4326")
    shifted = dem.Grid(
        from_origin(-47.0 + 0.5 * ARCSEC, -23.0, ARCSEC, ARCSEC), 100, 100, "EPSG:4326"
    )
    same = dem.Grid(from_origin(-47.0, -23.0, ARCSEC, ARCSEC), 100, 100, "EPSG:4326")

    assert dem.grids_match(a, same)
    assert not dem.grids_match(a, shifted)


def test_grids_of_different_resolution_or_shape_do_not_match():
    a = dem.Grid(from_origin(-47.0, -23.0, ARCSEC, ARCSEC), 100, 100, "EPSG:4326")
    coarse = dem.Grid(from_origin(-47.0, -23.0, 3 * ARCSEC, 3 * ARCSEC), 100, 100, "EPSG:4326")
    smaller = dem.Grid(from_origin(-47.0, -23.0, ARCSEC, ARCSEC), 99, 100, "EPSG:4326")

    assert not dem.grids_match(a, coarse)
    assert not dem.grids_match(a, smaller)


def test_payload_grid_bounds_enclose_the_cells():
    grid = dem.Grid(from_origin(-47.0, -23.0, ARCSEC, ARCSEC), 120, 80, "EPSG:4326")

    block = dem.payload_grid(grid)

    assert block["width"] == 120 and block["height"] == 80
    assert block["bounds"]["lon_min"] == pytest.approx(-47.0)
    assert block["bounds"]["lon_max"] == pytest.approx(-47.0 + 120 * ARCSEC)
    assert block["bounds"]["lat_max"] == pytest.approx(-23.0)
    assert block["bounds"]["lat_min"] == pytest.approx(-23.0 - 80 * ARCSEC)


def test_cell_size_of_an_arcsecond_grid_is_about_thirty_metres():
    grid = dem.Grid(from_origin(-47.0, -23.0, ARCSEC, ARCSEC), 100, 100, "EPSG:4326")

    dx, dy = dem.cell_size_m(grid)

    assert dx == pytest.approx(28.4, abs=0.2)
    assert dy == pytest.approx(30.7, abs=0.2)


# ---------------------------------------------------------------- merging tiles


def test_merge_of_two_adjacent_tiles_reproduces_the_field_across_the_seam(tmp_path):
    """
    The failure solar.fetch_dem has: a window straddling a tile edge.

    Two tiles abut at longitude 0.03. Reading only the first would return the
    left half of the window and nothing else. The check is against the analytic
    field, so a tile placed one cell off fails by the gradient rather than by
    looking plausible.
    """
    res = 10 * ARCSEC
    left = write_tile(tmp_path / "left.tif", 0.00, 0.05, 108, 108, res)
    right = write_tile(tmp_path / "right.tif", 0.30, 0.05, 108, 108, res)
    window = (0.25, -0.05, 0.35, 0.02)

    array, transform, crs = dem.read_merged([left, right], window)

    assert crs == rasterio.crs.CRS.from_epsg(4326)
    assert np.isfinite(array).all()
    rows, cols = np.indices(array.shape)
    lon = transform.c + (cols + 0.5) * transform.a
    lat = transform.f + (rows + 0.5) * transform.e
    assert array == pytest.approx(elevation_field(lon, lat), abs=1e-2)
    # The seam is inside the window, so the test would pass on the left tile
    # alone if the window did not actually cross it.
    assert transform.c < 0.30 < transform.c + array.shape[1] * transform.a


def test_merge_returns_only_the_requested_window(tmp_path):
    """The window is the snapped buffer, not the union of the tiles."""
    res = 10 * ARCSEC
    left = write_tile(tmp_path / "left.tif", 0.00, 0.05, 108, 108, res)
    right = write_tile(tmp_path / "right.tif", 0.30, 0.05, 108, 108, res)
    window = (0.25, -0.05, 0.35, 0.02)

    array, transform, _ = dem.read_merged([left, right], window)

    assert array.shape[1] * transform.a == pytest.approx(0.10, abs=res)
    assert array.shape[0] * -transform.e == pytest.approx(0.07, abs=res)


def test_merge_reads_the_first_tile_without_resampling_it(tmp_path):
    """
    The reference product is copied, not interpolated.

    The window is deliberately mid-cell. If the snap were dropped, the output
    origin would sit half a cell off the source grid and every value would be a
    nearest-neighbour pick from a shifted position -- which for this analytic
    field shows up as a constant offset of half a cell times the gradient.
    """
    res = 10 * ARCSEC
    tile = write_tile(tmp_path / "tile.tif", 0.00, 0.05, 108, 108, res)
    # Every edge deliberately a fraction of a cell from the tile's grid.
    window = (3.4 * res, 0.05 - 41.6 * res, 27.2 * res, 0.05 - 2.3 * res)

    array, transform, _ = dem.read_merged([tile], window)

    offset_cells = (transform.c - 0.0) / res
    assert offset_cells == pytest.approx(round(offset_cells), abs=1e-9)
    rows, cols = np.indices(array.shape)
    lon = transform.c + (cols + 0.5) * transform.a
    lat = transform.f + (rows + 0.5) * transform.e
    assert array == pytest.approx(elevation_field(lon, lat), abs=1e-2)


def test_merge_refuses_a_window_the_tiles_do_not_cover(tmp_path):
    """A gap between tiles would otherwise arrive as NaN inside the drainage network."""
    res = 10 * ARCSEC
    left = write_tile(tmp_path / "left.tif", 0.00, 0.05, 36, 36, res)
    far = write_tile(tmp_path / "far.tif", 0.50, 0.05, 36, 36, res)

    with pytest.raises(RuntimeError, match="uncovered"):
        dem.read_merged([left, far], (0.05, -0.05, 0.55, 0.02))


def test_merge_refuses_tiles_in_mixed_crs(tmp_path):
    res = 10 * ARCSEC
    a = write_tile(tmp_path / "a.tif", 0.00, 0.05, 108, 108, res)
    b = tmp_path / "b.tif"
    with rasterio.open(
        b, "w", driver="GTiff", height=10, width=10, count=1, dtype="float32",
        crs="EPSG:3857", transform=from_origin(0, 0, 30, 30),
    ) as dst:
        dst.write(np.zeros((10, 10), "float32"), 1)

    with pytest.raises(RuntimeError, match="more than one CRS"):
        dem.read_merged([a, str(b)], (0.01, 0.01, 0.02, 0.02))


def test_merge_turns_the_void_sentinel_into_nan(tmp_path):
    """
    NASADEM writes -32768 into voids and does not always declare it as nodata.

    Carried through as a number, a void becomes a 32 km deep pit: the depression
    fill would raise the whole basin to reach it and the flood extent would be
    wrong far beyond the void itself.
    """
    res = 10 * ARCSEC
    path = tmp_path / "void.tif"
    transform = from_origin(0.0, 0.05, res, res)
    data = np.full((36, 36), 100.0, dtype="float32")
    data[10:14, 10:14] = -32768.0
    with rasterio.open(
        path, "w", driver="GTiff", height=36, width=36, count=1, dtype="float32",
        crs="EPSG:4326", transform=transform, nodata=None,
    ) as dst:
        dst.write(data, 1)

    array, _, _ = dem.read_merged([str(path)], (0.0, 0.0, 0.09, 0.05))

    assert np.isnan(array).sum() == 16
    assert np.nanmin(array) == pytest.approx(100.0)


def test_merge_refuses_a_window_with_no_valid_elevation(tmp_path):
    res = 10 * ARCSEC
    path = tmp_path / "allvoid.tif"
    with rasterio.open(
        path, "w", driver="GTiff", height=36, width=36, count=1, dtype="float32",
        crs="EPSG:4326", transform=from_origin(0.0, 0.05, res, res), nodata=-9999.0,
    ) as dst:
        dst.write(np.full((36, 36), -9999.0, "float32"), 1)

    with pytest.raises(RuntimeError, match="no valid elevation"):
        dem.read_merged([str(path)], (0.0, 0.0, 0.09, 0.05))


def test_merge_of_no_tiles_is_an_error():
    with pytest.raises(RuntimeError):
        dem.read_merged([], (0.0, 0.0, 1.0, 1.0))


# ------------------------------------------------------- onto a reference grid


def test_resample_of_a_coarse_grid_replicates_cells_in_blocks():
    """cop90 onto the cop30 grid: one 90 m value covers a 3 by 3 block of 30 m cells."""
    coarse = dem.Grid(from_origin(0.0, 0.0, 3 * ARCSEC, 3 * ARCSEC), 4, 4, "EPSG:4326")
    fine = dem.Grid(from_origin(0.0, 0.0, ARCSEC, ARCSEC), 12, 12, "EPSG:4326")
    values = np.arange(16, dtype="float32").reshape(4, 4)

    moved = dem.resample_onto(values, coarse, fine)

    assert moved.shape == (12, 12)
    assert np.array_equal(moved, np.repeat(np.repeat(values, 3, axis=0), 3, axis=1))


def test_resample_invents_no_value_that_was_not_measured():
    """
    Nearest, not bilinear. The agreement count is a count over measurements, and
    an interpolated elevation would put a product's vote on a value the product
    never reported.
    """
    coarse = dem.Grid(from_origin(0.0, 0.0, 3 * ARCSEC, 3 * ARCSEC), 5, 5, "EPSG:4326")
    fine = dem.Grid(from_origin(0.0, 0.0, ARCSEC, ARCSEC), 15, 15, "EPSG:4326")
    rng = np.random.default_rng(0)
    values = rng.normal(500.0, 40.0, (5, 5)).astype("float32")

    moved = dem.resample_onto(values, coarse, fine)

    assert set(np.unique(moved)) <= set(np.unique(values))


def test_resample_marks_cells_outside_the_source_as_nan():
    source = dem.Grid(from_origin(0.0, 0.0, ARCSEC, ARCSEC), 5, 5, "EPSG:4326")
    wider = dem.Grid(from_origin(0.0, 0.0, ARCSEC, ARCSEC), 8, 5, "EPSG:4326")

    moved = dem.resample_onto(np.ones((5, 5), "float32"), source, wider)

    assert np.isfinite(moved[:, :5]).all()
    assert np.isnan(moved[:, 5:]).all()


def test_align_mask_leaves_an_unresampled_product_untouched():
    """A product already on the reference grid must not make a round trip through warp."""
    grid = dem.Grid(from_origin(0.0, 0.0, ARCSEC, ARCSEC), 6, 6, "EPSG:4326")
    read = dem.ProductRead(
        product=dem.COLLECTIONS["cop30"],
        array=np.zeros((6, 6), "float32"),
        grid=grid,
        reference=grid,
        resampled=False,
    )
    mask = np.zeros((6, 6), bool)
    mask[2:4, 2:4] = True

    assert np.array_equal(dem.align_mask(mask, read), mask)


def test_align_mask_of_a_coarse_product_stays_boolean_and_conserves_area():
    """
    A 90 m mask on a 30 m grid covers nine times the cells and the same ground.

    The threshold in align_mask has to leave the field binary: a mask that came
    back as 0.5 somewhere would be counted as half a vote in the agreement
    raster, and the raster is defined as a count of products.
    """
    coarse = dem.Grid(from_origin(0.0, 0.0, 3 * ARCSEC, 3 * ARCSEC), 4, 4, "EPSG:4326")
    fine = dem.Grid(from_origin(0.0, 0.0, ARCSEC, ARCSEC), 12, 12, "EPSG:4326")
    read = dem.ProductRead(
        product=dem.COLLECTIONS["cop90"],
        array=np.zeros((4, 4), "float32"),
        grid=coarse,
        reference=fine,
        resampled=True,
    )
    mask = np.zeros((4, 4), bool)
    mask[1:3, 1:3] = True

    aligned = dem.align_mask(mask, read)

    assert aligned.dtype == bool
    assert aligned.sum() == mask.sum() * 9


def test_align_mask_counts_cells_outside_the_source_as_dry():
    coarse = dem.Grid(from_origin(0.0, 0.0, 3 * ARCSEC, 3 * ARCSEC), 4, 4, "EPSG:4326")
    wider = dem.Grid(from_origin(0.0, 0.0, ARCSEC, ARCSEC), 15, 12, "EPSG:4326")
    read = dem.ProductRead(
        product=dem.COLLECTIONS["cop90"],
        array=np.zeros((4, 4), "float32"),
        grid=coarse,
        reference=wider,
        resampled=True,
    )

    aligned = dem.align_mask(np.ones((4, 4), bool), read)

    assert aligned[:, :12].all()
    assert not aligned[:, 12:].any()


# ---------------------------------------------------------------- the catalogue


def test_every_product_resolves_by_short_id_and_by_collection_id():
    for pid, product in dem.COLLECTIONS.items():
        assert dem.resolve(pid) is product
        assert dem.resolve(product.collection) is product


def test_the_default_set_is_the_four_products_and_starts_at_cop30():
    """
    cop30 is first because it defines the reference grid, and it is the one
    collection the rest of the application already reads (solar.py).
    """
    assert dem.DEFAULT_IDS[0] == "cop30"
    assert set(dem.DEFAULT_IDS) == set(dem.COLLECTIONS)
    assert len(dem.DEFAULT_IDS) == 4


def test_the_set_carries_no_srtmgl1_and_records_the_substitution():
    """
    Planetary Computer does not serve SRTMGL1, so alos-dem takes that slot. The
    envelope is therefore over TERRA's DEM set and not the study's, which is the
    reason the payload may not quote the study's IoU range as its own.
    """
    collections = {p.collection for p in dem.COLLECTIONS.values()}
    assert "srtmgl1" not in collections
    assert "alos-dem" in collections


def test_only_cop90_is_coarser_than_thirty_metres():
    for pid, product in dem.COLLECTIONS.items():
        expected = 90.0 if pid == "cop90" else 30.0
        assert product.native_resolution_m == expected


def test_an_unknown_product_is_named_in_the_error():
    with pytest.raises(ValueError, match="srtmgl1"):
        dem.resolve("srtmgl1")


def test_describe_carries_the_fields_the_payload_row_needs():
    grid = dem.Grid(from_origin(0.0, 0.0, ARCSEC, ARCSEC), 6, 6, "EPSG:4326")
    read = dem.ProductRead(
        product=dem.COLLECTIONS["cop90"],
        array=np.zeros((6, 6), "float32"),
        grid=grid,
        reference=grid,
        resampled=True,
    )

    assert read.describe() == {
        "id": "cop90",
        "collection": "cop-dem-glo-90",
        "native_resolution_m": 90.0,
        "resampled": True,
    }
