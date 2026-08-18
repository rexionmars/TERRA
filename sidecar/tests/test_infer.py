"""Unit tests for vegetation indices, features, and RF smoke (offline)."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pytest

import infer

MODEL_DIR = Path(__file__).resolve().parents[2] / "model"


def test_calculate_ndvi_known_values():
    nir = np.array([[0.8, 0.2]], dtype=float)
    red = np.array([[0.2, 0.2]], dtype=float)
    ndvi = infer.calculate_ndvi(nir, red)
    assert ndvi.shape == (1, 2)
    assert abs(ndvi[0, 0] - 0.6) < 1e-6
    assert abs(ndvi[0, 1] - 0.0) < 1e-6


def test_calculate_ndvi_zero_denominator():
    ndvi = infer.calculate_ndvi(np.zeros((2, 2)), np.zeros((2, 2)))
    assert np.all(ndvi == 0)


def test_calculate_evi_and_savi_finite():
    nir = np.full((3, 3), 0.5)
    red = np.full((3, 3), 0.2)
    blue = np.full((3, 3), 0.1)
    evi = infer.calculate_evi(nir, red, blue)
    savi = infer.calculate_savi(nir, red)
    assert np.all(np.isfinite(evi))
    assert np.all(np.isfinite(savi))
    assert np.all((-1 <= evi) & (evi <= 1))
    assert np.all((-1 <= savi) & (savi <= 1))


def test_compute_index_features_shape():
    # 4 pixels × 6 timesteps
    ts = np.random.default_rng(0).random((4, 6))
    feat = infer.compute_index_features(ts)
    assert feat.shape == (4, 14)


def test_polygon_from_geojson():
    geom = {
        "type": "Polygon",
        "coordinates": [
            [
                [-53.54, -25.10],
                [-53.53, -25.10],
                [-53.53, -25.09],
                [-53.54, -25.09],
                [-53.54, -25.10],
            ]
        ],
    }
    poly = infer.polygon_from_geojson(geom)
    assert poly.is_valid
    assert poly.area > 0


def test_class_statistics():
    cmap = np.array([[39, 39, 3], [21, -1, 3]], dtype=np.int32)
    stats = infer.class_statistics(cmap)
    assert stats
    assert stats[0]["pixels"] >= stats[-1]["pixels"]
    total_pct = sum(s["pct"] for s in stats)
    assert abs(total_pct - 100.0) < 0.1
    ids = {s["class_id"] for s in stats}
    assert -1 not in ids


@pytest.mark.skipif(
    not (MODEL_DIR / "rf_classifier.joblib").is_file(),
    reason="trained RF artifacts not present",
)
def test_classify_from_features_rf_smoke():
    model = joblib.load(MODEL_DIR / "rf_classifier.joblib")
    scaler = joblib.load(MODEL_DIR / "scaler.joblib")
    label_encoder = joblib.load(MODEL_DIR / "label_encoder.joblib")
    feature_names = joblib.load(MODEL_DIR / "feature_names.joblib")
    n_feat = len(feature_names)
    assert n_feat == 80

    h, w = 4, 5
    valid = np.ones((h, w), dtype=bool)
    valid[0, 0] = False
    n_valid = int(valid.sum())
    rng = np.random.default_rng(42)
    # Mild random features in a plausible reflectance/index range
    X = rng.normal(loc=0.3, scale=0.1, size=(n_valid, n_feat))

    cmap, conf = infer.classify_from_features(X, valid, model, scaler, label_encoder)
    assert cmap.shape == (h, w)
    assert conf.shape == (h, w)
    assert cmap[0, 0] == -1
    preds = cmap[valid]
    assert set(preds.tolist()).issubset(set(label_encoder.classes_.tolist()))
    assert np.all(conf[valid] > 0)
    assert conf[0, 0] == 0


# Request parameter parsing.
#
# `req.get(key) or default` reads a deliberate 0 as an omission, because 0 is
# falsy. These pin the two helpers that replaced it and the parameters where
# zero is a value the caller can mean.


def test_request_number_defaults_only_on_absence():
    req = {"present_zero": 0, "present_value": 3.5, "explicit_null": None}
    assert infer.request_number(req, "present_zero", 0.5) == 0.0
    assert infer.request_number(req, "present_value", 0.5) == 3.5
    assert infer.request_number(req, "missing", 0.5) == 0.5
    assert infer.request_number(req, "explicit_null", 0.5) == 0.5
    # A default of None survives, for parameters whose absence is the signal.
    assert infer.request_number(req, "missing", None) is None
    assert infer.request_number({"utc_offset_hours": 0}, "utc_offset_hours",
                                None) == 0.0
    assert infer.request_number(req, "present_value", 0, int) == 3


def test_request_number_carries_a_zero_degradation_rate_through():
    """
    The reported defect: a user entering 0 %/yr received the 0.5 %/yr default,
    which on the lifetime-mean basis multiplied every energy figure by 0.94224
    instead of 1.0, 5.78 percent low, with nothing on screen saying so.
    """
    import energy

    rate = infer.request_number(
        {"degradation_rate_per_year": 0.0}, "degradation_rate_per_year",
        energy.DEGRADATION_RATE_PER_YEAR,
    )
    assert rate == 0.0
    assert energy.degradation_factor("lifetime_mean", rate) == 1.0
    default = energy.degradation_factor(
        "lifetime_mean", energy.DEGRADATION_RATE_PER_YEAR
    )
    assert abs(default - 0.942238) < 5e-7
    # Every figure the run reports was 5.78 percent below what the caller asked
    # for, which is the size of the silent substitution.
    assert abs((1.0 - default) - 0.0578) < 5e-5


def test_request_positive_admits_zero_only_where_zero_is_a_value():
    assert infer.request_positive({"a": 0}, "a", 1.0, allow_zero=True) == 0.0
    assert infer.request_positive({}, "a", 1.0, allow_zero=True) == 1.0
    assert infer.request_positive({"a": 2}, "a", 1.0) == 2.0
    # Zero years of record and a zero ground coverage ratio are broken
    # requests, not values: substituting the default would report a figure the
    # caller did not ask for under a parameter they did set.
    for bad in ({"a": 0}, {"a": -1}):
        with pytest.raises(SystemExit):
            infer.request_positive(bad, "a", 1.0)
    with pytest.raises(SystemExit):
        infer.request_positive({"a": -1}, "a", 1.0, allow_zero=True)


def test_the_power_cache_key_is_not_finer_than_the_grid_it_keys_on():
    """
    The key used solar.grid_key, which rounds to 0.01 degrees, about 1 km. Two
    AOIs inside one POWER cell then missed each other and each paid the roughly
    23 s hourly fetch, so the reuse the cache states it guarantees did not hold.
    """
    import solar
    import wind

    a = (-53.5048, -25.7434)
    b = (-53.5362, -25.5)
    assert solar.grid_key(*a) != solar.grid_key(*b)
    assert wind.grid_key(*a) == wind.grid_key(*b)
    assert infer.power_cell_key(*a) == infer.power_cell_key(*b)

    # Both grids have to agree, because 0.625 does not divide 1.0: these two
    # points share one MERRA-2 longitude cell and straddle the boundary between
    # two 1 degree radiation cells, so keying on the meteorology grid alone
    # would return one series under two different radiation cells.
    c, d = (-53.6, -25.5), (-53.45, -25.5)
    assert wind.grid_key(*c) == wind.grid_key(*d)
    assert infer.power_cell_key(*c) != infer.power_cell_key(*d)


def test_the_cached_power_series_reports_which_path_it_took(tmp_path):
    """
    Before this, a cached run and a fetched run produced byte-identical
    payloads. POWER reprocesses historical data, so a superseded revision can
    stay pinned to an externally benchmarked figure with nothing on screen
    saying the series was not fetched during the run.
    """
    import pandas as pd

    frame = pd.DataFrame({"ALLSKY_SFC_SW_DWN": [1.0, 2.0], "T2M": [20.0, 21.0]})
    calls = []

    def fetch(progress=None):
        calls.append(1)
        return frame

    args = (tmp_path, "hourly", -53.5048, -25.7434, "20160101", "20251231",
            ["ALLSKY_SFC_SW_DWN"])
    first, first_provenance = infer.cached_power_series(*args, fetch)
    assert calls == [1]
    assert first_provenance["source"] == "fetch"
    assert first_provenance["fetched_utc"].endswith("+00:00")
    assert first_provenance["cell_key"] == infer.power_cell_key(
        -53.5048, -25.7434
    )

    second, second_provenance = infer.cached_power_series(*args, fetch)
    assert calls == [1]
    assert second.equals(first)
    assert second_provenance["source"] == "cache"
    # The fetch date travels with the series rather than being inferred from
    # the file, whose modification time a copy or a restore would change.
    assert second_provenance["fetched_utc"] == first_provenance["fetched_utc"]
    assert "superseded revision" in second_provenance["note"]

    # A stored file with no stamp reports an unknown fetch date, not a fresh one.
    for stamp in tmp_path.glob("*.parquet.json"):
        stamp.unlink()
    _, third_provenance = infer.cached_power_series(*args, fetch)
    assert calls == [1]
    assert third_provenance["source"] == "cache"
    assert third_provenance["fetched_utc"] is None


def test_the_cached_power_series_is_reused_across_the_cell_not_the_centroid():
    """The cache miss the coarser key removes, measured on two real centroids."""
    import pandas as pd
    import tempfile

    frame = pd.DataFrame({"ALLSKY_SFC_SW_DWN": [1.0]})
    calls = []

    def fetch(progress=None):
        calls.append(1)
        return frame

    with tempfile.TemporaryDirectory() as d:
        cache = Path(d)
        for lon, lat in ((-53.5048, -25.7434), (-53.5362, -25.5)):
            infer.cached_power_series(
                cache, "hourly", lon, lat, "20160101", "20251231",
                ["ALLSKY_SFC_SW_DWN"], fetch,
            )
        assert calls == [1]


def _spectra_products(dn_by_band, n=3, shape=(4, 4)):
    """
    Products a month apart, all post-baseline-04.00, and a loader that answers
    in DN so the reflectance conversion under test is the real one.
    """
    return [
        {
            "id": f"S2_TEST_{i}",
            "date": datetime(2025, 5 + i, 4),
            "processing_baseline": "05.11",
        }
        for i in range(n)
    ], (
        lambda product, band, polygon, ref_profile, resolution="10m":
            np.full(shape, float(dn_by_band[band]), dtype=np.float64)
    )


def test_class_spectra_reports_the_corrected_convention_not_the_trained_one(
    monkeypatch,
):
    """
    A spectrum is a reported quantity, so it carries the baseline 04.00 offset.

    The distinction is the whole point of the seam on as_trained: at DN 1400
    the trained convention reads 0.140 and the physical one 0.040, and a figure
    labelled "reflectance" that shows the first is off by the offset in every
    band.
    """
    dn = {b: 1400 for b in infer.BAND_WAVELENGTH_NM}
    products, loader = _spectra_products(dn)
    monkeypatch.setattr(infer, "load_band_to_reference_grid", loader)
    cmap = np.full((4, 4), 39, dtype=np.int32)

    payload = infer.class_spectra(products, None, None, cmap, min_pixels=1)

    assert payload is not None
    means = {p["band"]: p["mean"] for p in payload["points"]}
    assert set(means) == set(infer.BAND_WAVELENGTH_NM)
    for band, mean in means.items():
        assert abs(mean - 0.04) < 1e-9, band
    assert "offset applied" in payload["convention"]


def test_class_spectra_names_the_one_acquisition_it_measured(monkeypatch):
    """
    The classification spans the period; the spectrum does not. Which scene it
    came from has to travel with it, or the curve reads as a seasonal mean.
    """
    dn = {b: 1200 for b in infer.BAND_WAVELENGTH_NM}
    products, loader = _spectra_products(dn, n=5)
    monkeypatch.setattr(infer, "load_band_to_reference_grid", loader)

    payload = infer.class_spectra(
        products, None, None, np.full((4, 4), 3, dtype=np.int32), min_pixels=1
    )

    middle = products[len(products) // 2]
    assert payload["scene_date"] == middle["date"].strftime("%Y-%m-%d")
    assert payload["scene_id"] == middle["id"]
    assert payload["n_scenes"] == 5


def test_class_spectra_drops_a_class_too_small_to_average(monkeypatch):
    """
    Under the floor the mean is a handful of pixels. Dropping the class states
    less than drawing it at a precision the sample does not carry.
    """
    dn = {b: 1500 for b in infer.BAND_WAVELENGTH_NM}
    products, loader = _spectra_products(dn, shape=(10, 10))
    monkeypatch.setattr(infer, "load_band_to_reference_grid", loader)
    cmap = np.full((10, 10), 39, dtype=np.int32)
    cmap[0, :3] = 21  # three pixels, under the floor

    payload = infer.class_spectra(products, None, None, cmap, min_pixels=30)

    ids = {p["class_id"] for p in payload["points"]}
    assert ids == {39}


def test_class_spectra_is_absent_rather_than_empty_when_nothing_is_classified(
    monkeypatch,
):
    dn = {b: 1500 for b in infer.BAND_WAVELENGTH_NM}
    products, loader = _spectra_products(dn)
    monkeypatch.setattr(infer, "load_band_to_reference_grid", loader)

    assert infer.class_spectra(
        products, None, None, np.full((4, 4), -1, dtype=np.int32)
    ) is None
    assert infer.class_spectra(
        [], None, None, np.full((4, 4), 39, dtype=np.int32)
    ) is None


class _Transform:
    """The affine fields infer.py reads, without pulling in rasterio."""

    def __init__(self, a, e, f):
        self.a, self.e, self.f = a, e, f


class _Crs:
    def __init__(self, geographic):
        self.is_geographic = geographic


def test_reference_pixel_size_reads_a_projected_grid_directly():
    """
    A Sentinel-2 COG is in UTM, so the transform is already metres and the
    pixel side is the transform. This is the case every classification takes.
    """
    profile = {
        "transform": _Transform(a=10.0, e=-10.0, f=7_300_000.0),
        "crs": _Crs(False),
        "height": 446,
    }
    assert infer.reference_pixel_size_m(profile) == 10.0


def test_reference_pixel_size_converts_a_geographic_grid():
    """
    And does not treat degrees as metres. Reading 0.0001 degrees as 0.0001 m
    would report a pixel a tenth of a millimetre across, which is the failure
    mode of reusing solar.pixel_size_m in the other direction.
    """
    profile = {
        "transform": _Transform(a=1e-4, e=-1e-4, f=0.0),
        "crs": _Crs(True),
        "height": 100,
    }
    metres = infer.reference_pixel_size_m(profile)
    # 1e-4 degrees of longitude at the equator, where cos is 1.
    assert abs(metres - 11.132) < 1e-6


def test_spectral_angle_ignores_brightness_but_not_shape():
    """
    The property the whole library comparison rests on.

    A material in shade is the same material scaled, and the angle must return
    zero for that or the comparison would be measuring illumination. A material
    whose shape differs must not return zero, or it could not measure anything.
    """
    leaf = [0.06, 0.13, 0.05, 0.47, 0.47, 0.32, 0.19]
    assert infer.spectral_angle(leaf, leaf) == pytest.approx(0.0, abs=1e-9)
    shaded = [v * 0.4 for v in leaf]
    assert infer.spectral_angle(leaf, shaded) == pytest.approx(0.0, abs=1e-9)
    # Red up and NIR down, which is what soil and row shadow do to a canopy.
    distorted = list(leaf)
    distorted[2] *= 1.7
    distorted[3] *= 0.49
    assert infer.spectral_angle(leaf, distorted) > 0.1


def test_library_limit_measures_the_leaf_to_canopy_distortion(tmp_path):
    """
    The reported ratio is canopy over leaf, per band, and the angle is taken on
    the same seven bands the reference carries.
    """
    reference = json.loads(infer.SOYBEAN_REFERENCE.read_text())["reference"]
    leaf = {b["band"]: b["reflectance"] for b in reference["bands"]}
    bands = [b for b, _ in infer.TERRA_BANDS]

    # A class that IS the reference, scaled: same shape, so angle zero.
    spectra = {
        "scene_date": "2025-09-26",
        "points": [
            {
                "class_id": 39, "name": "Soybean", "color": "#f5b3c8",
                "band": b, "wavelength_nm": infer.BAND_WAVELENGTH_NM[b],
                "n_pixels": 1000, "mean": leaf[b] * 0.5,
                "sd": 0.0, "p05": 0.0, "p95": 0.0,
            }
            for b in bands
        ],
    }
    payload = infer.library_limit(spectra)

    assert payload is not None
    assert payload["reference"]["n_spectra"] == 1131
    assert payload["reference"]["level"] == "leaf"
    cls = payload["classes"][0]
    assert cls["angle_rad"] == pytest.approx(0.0, abs=1e-6)
    for band in cls["bands"]:
        assert band["ratio"] == pytest.approx(0.5, abs=1e-3)


def test_library_limit_skips_a_class_missing_a_band():
    """
    A partial vector is an angle in a different space, not a smaller one, so
    the class is dropped rather than compared on whatever bands it has.
    """
    reference = json.loads(infer.SOYBEAN_REFERENCE.read_text())["reference"]
    leaf = {b["band"]: b["reflectance"] for b in reference["bands"]}
    bands = [b for b, _ in infer.TERRA_BANDS][:-1]  # B12 absent
    spectra = {
        "points": [
            {
                "class_id": 3, "name": "Forest Formation", "color": "#006400",
                "band": b, "wavelength_nm": infer.BAND_WAVELENGTH_NM[b],
                "n_pixels": 500, "mean": leaf[b],
                "sd": 0.0, "p05": 0.0, "p95": 0.0,
            }
            for b in bands
        ],
    }
    assert infer.library_limit(spectra) is None
