"""Offline tests for band composite / index helpers."""

import numpy as np

import composite


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
    r = np.random.rand(8, 8).astype(np.float32)
    g = np.random.rand(8, 8).astype(np.float32)
    b = np.random.rand(8, 8).astype(np.float32)
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
