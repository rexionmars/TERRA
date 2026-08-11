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


# --- Agreement against the reference ---------------------------------------
#
# These protect the distinction the whole panel exists to make: composition
# equality is not agreement. Each case below is constructed so the expected
# figures are known exactly, because an accuracy that is merely plausible is
# worse than none -- it is still believed.


def _cell_grid(h=30, w=30, block=3):
    """A 10 m grid whose pixels carry the id of the 30 m cell above them."""
    yy, xx = np.mgrid[0:h, 0:w]
    return (yy // block) * (w // block) + (xx // block)


def test_agreement_counts_reference_cells_not_pixels():
    """
    The denominator is the number of independent label observations.

    MapBiomas is native at 30 m, so nine 10 m pixels carry one label. Counting
    pixels would state nine times the sample size and an interval about three
    times too narrow.
    """
    cells = _cell_grid()
    ref = np.full((30, 30), 39)
    pred = ref.copy()
    out = lulc.agreement_against_reference(pred, ref, cells)
    assert out["n_reference_cells"] == 100  # not 900
    assert out["overall_pct"] == 100.0


def test_equal_composition_can_be_total_disagreement():
    """
    The case the composition panel cannot see.

    Swapping two classes in equal measure reproduces the reference composition
    exactly and is wrong on every cell. Composition reports both classes at
    50/50 and looks perfect; agreement reports zero.
    """
    cells = _cell_grid()
    half = cells < 50
    pred = np.where(half, 39, 41)
    ref = np.where(half, 41, 39)

    comp = {r["class_id"]: r for r in lulc.pred_vs_ref_composition(pred, ref, cells)}
    assert comp[39]["pct_ref"] == comp[39]["pct_pred"]  # composition agrees
    assert comp[41]["pct_ref"] == comp[41]["pct_pred"]

    out = lulc.agreement_against_reference(pred, ref, cells)
    assert out["overall_pct"] == 0.0
    # All of the disagreement is allocation: the amounts match, the places do not.
    assert out["allocation_disagreement_pct"] == 100.0
    assert out["quantity_disagreement_pct"] == 0.0


def test_disagreement_decomposition_sums_to_the_complement_of_accuracy():
    """Pontius & Millones (2011): OA + quantity + allocation = 100%."""
    cells = _cell_grid()
    ref = np.where(cells < 50, 39, 41)
    pred = ref.copy()
    pred[(cells >= 30) & (cells < 50)] = 41  # 20 cells wrong, one direction

    out = lulc.agreement_against_reference(pred, ref, cells)
    total = (
        out["overall_pct"]
        + out["quantity_disagreement_pct"]
        + out["allocation_disagreement_pct"]
    )
    assert abs(total - 100.0) < 1e-6
    assert out["overall_pct"] == 80.0
    # One-directional error is a quantity difference, not a misplacement.
    assert out["quantity_disagreement_pct"] == 20.0
    assert out["allocation_disagreement_pct"] == 0.0


def test_producers_and_users_accuracy_are_distinct():
    """
    A map that over-calls one class scores perfectly on one and poorly on the
    other, which is why neither is reported alone.
    """
    cells = _cell_grid()
    ref = np.where(cells < 50, 39, 41)
    pred = ref.copy()
    pred[(cells >= 30) & (cells < 50)] = 41

    out = lulc.agreement_against_reference(pred, ref, cells)
    per = {c["class_id"]: c for c in out["per_class"]}
    # 30 of the 50 soybean cells were found.
    assert per[39]["producers_pct"] == 60.0
    # Everything called soybean really is soybean.
    assert per[39]["users_pct"] == 100.0
    # Every 41 cell was found, but 70 cells were called 41 and only 50 are.
    assert per[41]["producers_pct"] == 100.0
    assert abs(per[41]["users_pct"] - 100.0 * 50 / 70) < 0.01


def test_majority_decides_a_cell():
    """A minority of dissenting pixels does not flip its reference cell."""
    cells = _cell_grid()
    ref = np.full((30, 30), 39)
    pred = ref.copy()
    _, xx = np.mgrid[0:30, 0:30]
    pred[(cells == 0) & (xx % 3 == 0)] = 41  # 3 of 9 pixels dissent
    out = lulc.agreement_against_reference(pred, ref, cells)
    assert out["overall_pct"] == 100.0


def test_reference_classes_outside_the_legend_are_excluded_not_counted_wrong():
    """
    The classifier has no label for water or urban, so a cell carrying one is
    not a misclassification. Counting it as an error would conflate "wrong"
    with "not representable", and the count is reported instead.
    """
    cells = _cell_grid()
    ref = np.where(cells < 10, 33, 39)  # 10 cells of water
    pred = np.full((30, 30), 39)
    out = lulc.agreement_against_reference(pred, ref, cells)
    assert out["n_outside_legend"] == 10
    assert out["n_reference_cells"] == 90
    assert out["overall_pct"] == 100.0  # perfect on what it can represent


def test_agreement_is_absent_without_the_cell_mapping():
    """
    No cell mapping means no honest denominator, so nothing is reported. An
    accuracy computed over the wrong n is worse than a missing one.
    """
    ref = np.full((30, 30), 39)
    assert lulc.agreement_against_reference(ref.copy(), ref, None) is None


def test_wilson_interval_stays_inside_the_unit_interval():
    """
    The reason it is Wilson and not Wald: at a proportion of 1 the normal
    approximation gives a zero-width interval, and near 0 it runs negative.
    """
    lo, hi = lulc._wilson_interval(20, 20)
    assert lo > 0 and hi <= 100.0 and lo < 100.0
    lo, hi = lulc._wilson_interval(0, 20)
    assert lo >= 0.0 and hi > 0.0
    # Wider at n=20 than at n=2000 for the same proportion.
    n_small = lulc._wilson_interval(16, 20)
    n_large = lulc._wilson_interval(1600, 2000)
    assert (n_small[1] - n_small[0]) > (n_large[1] - n_large[0])
