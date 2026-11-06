"""Offline tests for band composite / index helpers."""

import numpy as np

from terra.imagery import composite


def test_percentile_stretch_basic():
    arr = np.arange(100, dtype=np.float32).reshape(10, 10)
    mask = np.ones_like(arr, dtype=bool)
    out = composite.percentile_stretch(arr, mask, 0, 100)
    assert out.min() >= 0.0
    assert out.max() <= 1.0
    assert abs(float(out[0, 0]) - 0.0) < 1e-5
    assert abs(float(out[-1, -1]) - 1.0) < 1e-5


def test_percentile_stretch_masked():
    arr = np.ones((4, 4), dtype=np.float32) * 50
    mask = np.zeros((4, 4), dtype=bool)
    mask[1:3, 1:3] = True
    arr[mask] = np.linspace(10, 90, mask.sum(), dtype=np.float32)
    out = composite.percentile_stretch(arr, mask, 2, 98)
    assert np.all(out[~mask] == 0)
    assert np.any(out[mask] > 0)


def test_ndwi_ndmi_range():
    green = np.array([[0.1, 0.4]], dtype=np.float32)
    nir = np.array([[0.3, 0.2]], dtype=np.float32)
    swir = np.array([[0.2, 0.1]], dtype=np.float32)
    ndwi = composite.calculate_ndwi(green, nir)
    ndmi = composite.calculate_ndmi(nir, swir)
    assert ndwi.min() >= -1 and ndwi.max() <= 1
    assert ndmi.min() >= -1 and ndmi.max() <= 1
    assert ndwi[0, 0] < 0  # nir > green
    assert ndwi[0, 1] > 0


def test_rgb_to_rgba_shape():
    # Seeded, and the seed is the point: this asserts shape, dtype and the
    # alpha channel, so the values only have to be plausible reflectances --
    # but an unseeded draw makes a failure impossible to reproduce, and
    # np.random.rand draws from the legacy global state that any other test
    # can advance.
    rng = np.random.default_rng(20240115)
    r = rng.random((8, 8), dtype=np.float32)
    g = rng.random((8, 8), dtype=np.float32)
    b = rng.random((8, 8), dtype=np.float32)
    mask = np.ones((8, 8), dtype=bool)
    mask[0, 0] = False
    rgba = composite.rgb_to_rgba(r, g, b, mask)
    assert rgba.shape == (8, 8, 4)
    assert rgba.dtype == np.uint8
    assert rgba[0, 0, 3] == 0
    assert rgba[1, 1, 3] == 255


def test_index_to_rgba_shape():
    idx = np.linspace(-0.5, 0.9, 16, dtype=np.float32).reshape(4, 4)
    mask = np.ones((4, 4), dtype=bool)
    rgba = composite.index_to_rgba(idx, mask, "ndvi")
    assert rgba.shape == (4, 4, 4)
    assert rgba[..., 3].min() == 255


def test_presets_and_allowed():
    assert composite.RGB_PRESETS["true_color"] == ("B04", "B03", "B02")
    assert "ndvi" in composite.ALLOWED_INDICES
    assert "B11" in composite.ALLOWED_BANDS


def test_every_band_a_composition_can_ask_for_is_collected_from_stac():
    # A band left out of the scene's assets fails at render time, with the
    # area drawn and the scene chosen: "Band B06 not in STAC assets".
    from terra.imagery import sentinel2

    collected = set(sentinel2.REQUIRED_BANDS) | set(sentinel2.EXTRA_BANDS)
    assert set(composite.ALLOWED_BANDS) <= collected


def test_every_catalogued_index_reads_loadable_bands_and_names_a_ramp():
    for name, spec in composite.COMPOSITE_INDICES.items():
        assert set(spec.bands) <= set(composite.ALLOWED_BANDS), name
        assert spec.ramp in composite.CONTINUOUS_STOPS, name


def test_the_first_four_indices_keep_the_ramps_they_were_drawn_with():
    # NDVI and EVI on RdYlGn, NDWI and NDMI on Blues, as before the catalogue.
    idx = np.linspace(-0.5, 0.9, 16, dtype=np.float32).reshape(4, 4)
    mask = np.ones((4, 4), dtype=bool)
    for name, stops in (("ndvi", "rdylgn"), ("evi", "rdylgn"), ("ndwi", "blues"), ("ndmi", "blues")):
        drawn = composite.index_to_rgba(idx, mask, name)
        low = composite.CONTINUOUS_STOPS[stops][0]
        assert tuple(drawn[0, 0, :3]) == tuple(int(c * 255) for c in low), name


def _one(value: float) -> np.ndarray:
    return np.array([[value]], dtype=np.float32)


def test_msavi_at_a_known_canopy():
    # NIR 0.5, red 0.05: (2 - sqrt(4 - 3.6)) / 2 = 0.6838.
    assert abs(float(composite.calculate_msavi(_one(0.5), _one(0.05))[0, 0]) - 0.6838) < 1e-3


def test_msavi_over_negative_red_is_finite():
    assert np.isfinite(composite.calculate_msavi(_one(0.5), _one(-0.2))).all()


def test_gci_is_nir_over_green_less_one():
    assert abs(float(composite.calculate_gci(_one(0.4), _one(0.1))[0, 0]) - 3.0) < 1e-5


def test_gci_is_zero_where_green_is_zero():
    assert float(composite.calculate_gci(_one(0.4), _one(0.0))[0, 0]) == 0.0


def test_psri_is_red_less_blue_over_red_edge():
    psri = composite.calculate_psri(_one(0.1), _one(0.05), _one(0.4))
    assert abs(float(psri[0, 0]) - 0.125) < 1e-5


def test_a_moisture_stress_ratio_above_one_is_not_clipped():
    assert float(composite.band_ratio(_one(0.5), _one(0.2))[0, 0]) == 2.5


def test_a_normalized_difference_of_two_zeros_is_zero():
    assert float(composite.normalized_difference(_one(0.0), _one(0.0))[0, 0]) == 0.0


def test_write_rgba_geotiff(tmp_path):
    from rasterio.transform import from_bounds

    rgba = np.zeros((4, 4, 4), dtype=np.uint8)
    rgba[..., :3] = 128
    rgba[..., 3] = 255
    rgba[0, 0, 3] = 0
    transform = from_bounds(-50, -20, -49.9, -19.9, 4, 4)
    profile = {
        "height": 4,
        "width": 4,
        "crs": "EPSG:4326",
        "transform": transform,
    }
    out = tmp_path / "comp.tif"
    composite.write_rgba_geotiff(rgba, profile, out)
    assert out.exists()
    assert out.stat().st_size > 0
