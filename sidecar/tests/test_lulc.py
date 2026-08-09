"""Unit tests for MapBiomas LULC descriptive helpers (offline)."""

from __future__ import annotations

import numpy as np

import lulc


def test_hex_to_rgb():
    assert lulc.hex_to_rgb("#006d2c") == (0, 109, 44)
    assert lulc.hex_to_rgb("4292c6") == (66, 146, 198)


def test_pixel_area_ha_positive():
    ha = lulc.pixel_area_ha((0.0001, -0.0001), lat=-25.0)
    assert ha > 0


def test_shannon_and_pielou():
    h = lulc.shannon_diversity([50.0, 50.0])
    assert abs(h - np.log(2)) < 1e-6
    assert abs(lulc.pielou_evenness(h, 2) - 1.0) < 1e-6
    assert lulc.shannon_diversity([]) == 0.0
    assert lulc.pielou_evenness(0.5, 1) == 0.0


def test_composition_from_array():
    arr = np.array([[39, 39, 3], [21, 0, 3]], dtype=np.int32)
    rows = lulc.composition_from_array(arr, px_ha=0.01)
    assert rows
    ids = {r["class_id"] for r in rows}
    assert 0 not in ids  # nodata excluded
    assert 39 in ids and 3 in ids
    assert abs(sum(r["pct"] for r in rows) - 100.0) < 0.1
    assert rows[0]["area_ha"] >= rows[-1]["area_ha"]


def test_metrics_from_composition():
    arr = np.full((10, 10), 39, dtype=np.int32)
    arr[:3, :] = 3
    composition = lulc.composition_from_array(arr, px_ha=0.01)
    metrics = lulc.metrics_from_composition(composition, area_ha=1.0, n_pixels=100)
    assert metrics["n_classes"] == 2
    assert metrics["dominant_class"]
    assert metrics["shannon_h"] > 0
    assert 0 <= metrics["pielou_j"] <= 1
    assert metrics["soja_pct"] > 0


def test_groups_from_composition():
    composition = [
        {
            "group": "Annual cropland (soybean)",
            "pct": 60.0,
            "area_ha": 6.0,
            "class_id": 39,
        },
        {
            "group": "Natural vegetation",
            "pct": 40.0,
            "area_ha": 4.0,
            "class_id": 3,
        },
    ]
    groups = lulc.groups_from_composition(composition)
    assert len(groups) == 2
    assert abs(sum(g["pct"] for g in groups) - 100.0) < 0.01


def _write_reference_raster(path, *, res_deg, width, height, origin=(-53.6, -25.0)):
    """Small georeferenced raster standing in for a MapBiomas Collection tile."""
    import rasterio
    from rasterio.transform import from_origin

    transform = from_origin(origin[0], origin[1], res_deg, res_deg)
    data = np.arange(width * height, dtype=np.uint8).reshape(height, width) % 250 + 1
    profile = {
        "driver": "GTiff",
        "height": height,
        "width": width,
        "count": 1,
        "dtype": "uint8",
        "crs": "EPSG:4326",
        "transform": transform,
    }
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data, 1)
    return transform


def test_reference_cell_grid_groups_pixels_by_native_cell(tmp_path):
    """
    A 30 m reference resampled onto a 10 m grid gives about nine pixels per
    native cell, so the distinct-cell count must be about one ninth of the
    pixel count rather than equal to it.
    """
    from rasterio.transform import from_origin

    mb_path = tmp_path / "reference.tif"
    # 3x coarser than the target grid, in the same CRS, sharing an origin.
    coarse_res = 0.0003
    _write_reference_raster(mb_path, res_deg=coarse_res, width=8, height=8)

    fine_res = coarse_res / 3.0
    ref_profile = {
        "height": 9,
        "width": 9,
        "crs": "EPSG:4326",
        "transform": from_origin(-53.6, -25.0, fine_res, fine_res),
    }

    cell_ids = lulc.reference_cell_grid(ref_profile, str(mb_path))
    assert cell_ids is not None
    assert cell_ids.shape == (9, 9)

    all_pixels = np.ones((9, 9), dtype=bool)
    n_cells = lulc.distinct_reference_cells(cell_ids, all_pixels)
    # 81 fine pixels fall inside a 3x3 block of native cells.
    assert n_cells == 9
    assert n_cells < int(all_pixels.sum())


def test_distinct_reference_cells_edge_cases():
    cell_ids = np.array([[1, 1], [2, 2]], dtype=np.int64)
    assert lulc.distinct_reference_cells(cell_ids, np.ones((2, 2), bool)) == 2
    assert lulc.distinct_reference_cells(cell_ids, np.zeros((2, 2), bool)) == 0
    # Without a mapping the count is absent, never substituted by the pixel count.
    assert lulc.distinct_reference_cells(None, np.ones((2, 2), bool)) is None


def test_reference_cell_grid_missing_raster_returns_none(tmp_path):
    ref_profile = {
        "height": 2,
        "width": 2,
        "crs": "EPSG:4326",
        "transform": __import__("rasterio").transform.from_origin(0, 0, 1, 1),
    }
    assert lulc.reference_cell_grid(ref_profile, str(tmp_path / "absent.tif")) is None


def test_pred_vs_ref_reports_cells_and_pixels_separately():
    pred = np.array([[39, 39, 39], [39, 39, 39], [3, 3, 3]], dtype=np.int32)
    ref = np.array([[39, 39, 39], [39, 39, 39], [3, 3, 3]], dtype=np.int32)
    # Each row of three pixels came from one native cell.
    cell_ids = np.array([[10, 10, 10], [10, 10, 10], [20, 20, 20]], dtype=np.int64)

    rows = lulc.pred_vs_ref_composition(pred, ref, cell_ids=cell_ids)
    by_id = {r["class_id"]: r for r in rows}

    assert by_id[39]["pixels_ref"] == 6
    assert by_id[39]["n_reference_cells"] == 1
    assert by_id[3]["pixels_ref"] == 3
    assert by_id[3]["n_reference_cells"] == 1
    # Percentages are pixel fractions and are unchanged by the cell accounting.
    assert abs(by_id[39]["pct_ref"] - 66.67) < 0.01


def test_pred_vs_ref_without_cell_ids_omits_the_field():
    pred = np.array([[39, 3]], dtype=np.int32)
    ref = np.array([[39, 3]], dtype=np.int32)
    rows = lulc.pred_vs_ref_composition(pred, ref)
    assert all("n_reference_cells" not in r for r in rows)
    assert all("pixels_ref" in r for r in rows)
