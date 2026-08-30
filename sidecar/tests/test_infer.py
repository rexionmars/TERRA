"""Unit tests for vegetation indices, features, and RF smoke (offline)."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pytest

from terra import actions, protocol, registry
from terra.imagery import indices, sentinel2

MODEL_DIR = Path(__file__).resolve().parents[2] / "model"


def test_calculate_ndvi_known_values():
    nir = np.array([[0.8, 0.2]], dtype=float)
    red = np.array([[0.2, 0.2]], dtype=float)
    ndvi = indices.calculate_ndvi(nir, red)
    assert ndvi.shape == (1, 2)
    assert abs(ndvi[0, 0] - 0.6) < 1e-6
    assert abs(ndvi[0, 1] - 0.0) < 1e-6


def test_calculate_ndvi_zero_denominator():
    ndvi = indices.calculate_ndvi(np.zeros((2, 2)), np.zeros((2, 2)))
    assert np.all(ndvi == 0)


def test_calculate_evi_and_savi_finite():
    nir = np.full((3, 3), 0.5)
    red = np.full((3, 3), 0.2)
    blue = np.full((3, 3), 0.1)
    evi = indices.calculate_evi(nir, red, blue)
    savi = indices.calculate_savi(nir, red)
    assert np.all(np.isfinite(evi))
    assert np.all(np.isfinite(savi))
    assert np.all((-1 <= evi) & (evi <= 1))
    assert np.all((-1 <= savi) & (savi <= 1))


def test_compute_index_features_shape():
    # 4 pixels × 6 timesteps
    ts = np.random.default_rng(0).random((4, 6))
    feat = actions.compute_index_features(ts)
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
    poly = actions.polygon_from_geojson(geom)
    assert poly.is_valid
    assert poly.area > 0


def test_class_statistics():
    cmap = np.array([[39, 39, 3], [21, -1, 3]], dtype=np.int32)
    stats = actions.class_statistics(cmap)
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

    cmap, conf = actions.classify_from_features(X, valid, model, scaler, label_encoder)
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
    assert protocol.request_number(req, "present_zero", 0.5) == 0.0
    assert protocol.request_number(req, "present_value", 0.5) == 3.5
    assert protocol.request_number(req, "missing", 0.5) == 0.5
    assert protocol.request_number(req, "explicit_null", 0.5) == 0.5
    # A default of None survives, for parameters whose absence is the signal.
    assert protocol.request_number(req, "missing", None) is None
    assert protocol.request_number({"utc_offset_hours": 0}, "utc_offset_hours",
                                None) == 0.0
    assert protocol.request_number(req, "present_value", 0, int) == 3


def test_request_number_carries_a_zero_degradation_rate_through():
    """
    The reported defect: a user entering 0 %/yr received the 0.5 %/yr default,
    which on the lifetime-mean basis multiplied every energy figure by 0.94224
    instead of 1.0, 5.78 percent low, with nothing on screen saying so.
    """
    import energy

    rate = protocol.request_number(
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
    assert protocol.request_positive({"a": 0}, "a", 1.0, allow_zero=True) == 0.0
    assert protocol.request_positive({}, "a", 1.0, allow_zero=True) == 1.0
    assert protocol.request_positive({"a": 2}, "a", 1.0) == 2.0
    # Zero years of record and a zero ground coverage ratio are broken
    # requests, not values: substituting the default would report a figure the
    # caller did not ask for under a parameter they did set.
    for bad in ({"a": 0}, {"a": -1}):
        with pytest.raises(SystemExit):
            protocol.request_positive(bad, "a", 1.0)
    with pytest.raises(SystemExit):
        protocol.request_positive({"a": -1}, "a", 1.0, allow_zero=True)


def test_the_power_cache_key_is_not_finer_than_the_grid_it_keys_on():
    """
    The key used sun_power.request_point, which rounds to 0.01 degrees, about 1 km. Two
    AOIs inside one POWER cell then missed each other and each paid the roughly
    23 s hourly fetch, so the reuse the cache states it guarantees did not hold.
    """
    from terra.sun import nasa_power as sun_power
    from terra.energy import wind  # noqa: F401

    a = (-53.5048, -25.7434)
    b = (-53.5362, -25.5)
    assert sun_power.request_point(*a) != sun_power.request_point(*b)
    assert sun_power.meteorology_cell(*a) == sun_power.meteorology_cell(*b)
    assert actions.power_cell_key(*a) == actions.power_cell_key(*b)

    # Both grids have to agree, because 0.625 does not divide 1.0: these two
    # points share one MERRA-2 longitude cell and straddle the boundary between
    # two 1 degree radiation cells, so keying on the meteorology grid alone
    # would return one series under two different radiation cells.
    c, d = (-53.6, -25.5), (-53.45, -25.5)
    assert sun_power.meteorology_cell(*c) == sun_power.meteorology_cell(*d)
    assert actions.power_cell_key(*c) != actions.power_cell_key(*d)


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
    first, first_provenance = actions.cached_power_series(*args, fetch)
    assert calls == [1]
    assert first_provenance["source"] == "fetch"
    assert first_provenance["fetched_utc"].endswith("+00:00")
    assert first_provenance["cell_key"] == actions.power_cell_key(
        -53.5048, -25.7434
    )

    second, second_provenance = actions.cached_power_series(*args, fetch)
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
    _, third_provenance = actions.cached_power_series(*args, fetch)
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
            actions.cached_power_series(
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
    dn = {b: 1400 for b in actions.BAND_WAVELENGTH_NM}
    products, loader = _spectra_products(dn)
    monkeypatch.setattr(sentinel2, "load_band_to_reference_grid", loader)
    cmap = np.full((4, 4), 39, dtype=np.int32)

    payload = actions.class_spectra(products, None, None, cmap, min_pixels=1)

    assert payload is not None
    means = {p["band"]: p["mean"] for p in payload["points"]}
    assert set(means) == set(actions.BAND_WAVELENGTH_NM)
    for band, mean in means.items():
        assert abs(mean - 0.04) < 1e-9, band
    assert "offset applied" in payload["convention"]


def test_class_spectra_names_the_one_acquisition_it_measured(monkeypatch):
    """
    The classification spans the period; the spectrum does not. Which scene it
    came from has to travel with it, or the curve reads as a seasonal mean.
    """
    dn = {b: 1200 for b in actions.BAND_WAVELENGTH_NM}
    products, loader = _spectra_products(dn, n=5)
    monkeypatch.setattr(sentinel2, "load_band_to_reference_grid", loader)

    payload = actions.class_spectra(
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
    dn = {b: 1500 for b in actions.BAND_WAVELENGTH_NM}
    products, loader = _spectra_products(dn, shape=(10, 10))
    monkeypatch.setattr(sentinel2, "load_band_to_reference_grid", loader)
    cmap = np.full((10, 10), 39, dtype=np.int32)
    cmap[0, :3] = 21  # three pixels, under the floor

    payload = actions.class_spectra(products, None, None, cmap, min_pixels=30)

    ids = {p["class_id"] for p in payload["points"]}
    assert ids == {39}


def test_class_spectra_is_absent_rather_than_empty_when_nothing_is_classified(
    monkeypatch,
):
    dn = {b: 1500 for b in actions.BAND_WAVELENGTH_NM}
    products, loader = _spectra_products(dn)
    monkeypatch.setattr(sentinel2, "load_band_to_reference_grid", loader)

    assert actions.class_spectra(
        products, None, None, np.full((4, 4), -1, dtype=np.int32)
    ) is None
    assert actions.class_spectra(
        [], None, None, np.full((4, 4), 39, dtype=np.int32)
    ) is None


class _Transform:
    """The affine fields actions.py reads, without pulling in rasterio."""

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
    assert actions.reference_pixel_size_m(profile) == 10.0


def test_reference_pixel_size_converts_a_geographic_grid():
    """
    And does not treat degrees as metres. Reading 0.0001 degrees as 0.0001 m
    would report a pixel a tenth of a millimetre across, which is the failure
    mode of reusing terra.terrain.slope.pixel_size_m in the other direction.
    """
    profile = {
        "transform": _Transform(a=1e-4, e=-1e-4, f=0.0),
        "crs": _Crs(True),
        "height": 100,
    }
    metres = actions.reference_pixel_size_m(profile)
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
    assert actions.spectral_angle(leaf, leaf) == pytest.approx(0.0, abs=1e-9)
    shaded = [v * 0.4 for v in leaf]
    assert actions.spectral_angle(leaf, shaded) == pytest.approx(0.0, abs=1e-9)
    # Red up and NIR down, which is what soil and row shadow do to a canopy.
    distorted = list(leaf)
    distorted[2] *= 1.7
    distorted[3] *= 0.49
    assert actions.spectral_angle(leaf, distorted) > 0.1


def test_spectral_angle_holds_scale_invariance_at_every_scale():
    """
    The same property as above, asserted across a range of scales rather than
    at one, because a single scale does not test it on every machine.

    The test above uses 0.4, and on arm64 that particular product happens to
    round to a cosine of exactly 1.0, so it passed there while the same code
    returned 2.1e-8 radians on x86_64. The assertion was right and the platform
    was hiding the defect: the angle came from arccos of a cosine, and arccos
    has an infinite derivative at 1, so a rounding error of 2.2e-16 emerged
    amplified by seven orders of magnitude.

    Fifteen scales do not depend on which of them rounds cleanly. Under the
    previous implementation this fails on x86_64 AND on arm64.
    """
    leaf = [0.06, 0.13, 0.05, 0.47, 0.47, 0.32, 0.19]
    for scale in (0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 0.9,
                  1.1, 1.3, 1.7, 2.0, 3.0, 5.0, 10.0):
        scaled = [v * scale for v in leaf]
        angle = actions.spectral_angle(leaf, scaled)
        assert angle == pytest.approx(0.0, abs=1e-12), (
            f"the same material at {scale}x brightness reads as {angle:.3e} rad "
            f"from itself; the angle is measuring illumination"
        )


def test_library_limit_measures_the_leaf_to_canopy_distortion(tmp_path):
    """
    The reported ratio is canopy over leaf, per band, and the angle is taken on
    the same seven bands the reference carries.
    """
    reference = json.loads(actions.SOYBEAN_REFERENCE.read_text())["reference"]
    leaf = {b["band"]: b["reflectance"] for b in reference["bands"]}
    bands = [b for b, _ in actions.TERRA_BANDS]

    # A class that IS the reference, scaled: same shape, so angle zero.
    spectra = {
        "scene_date": "2025-09-26",
        "points": [
            {
                "class_id": 39, "name": "Soybean", "color": "#f5b3c8",
                "band": b, "wavelength_nm": actions.BAND_WAVELENGTH_NM[b],
                "n_pixels": 1000, "mean": leaf[b] * 0.5,
                "sd": 0.0, "p05": 0.0, "p95": 0.0,
            }
            for b in bands
        ],
    }
    payload = actions.library_limit(spectra)

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
    reference = json.loads(actions.SOYBEAN_REFERENCE.read_text())["reference"]
    leaf = {b["band"]: b["reflectance"] for b in reference["bands"]}
    bands = [b for b, _ in actions.TERRA_BANDS][:-1]  # B12 absent
    spectra = {
        "points": [
            {
                "class_id": 3, "name": "Forest Formation", "color": "#006400",
                "band": b, "wavelength_nm": actions.BAND_WAVELENGTH_NM[b],
                "n_pixels": 500, "mean": leaf[b],
                "sd": 0.0, "p05": 0.0, "p95": 0.0,
            }
            for b in bands
        ],
    }
    assert actions.library_limit(spectra) is None


# The flood envelope dispatcher.
#
# The handler is what turns two modules into one product: it reads four DEM
# products, puts them on one grid, runs the envelope and writes the agreement
# raster out. These pin the parts of that composition that fail silently -- the
# size ceiling, the alignment sliver, and the colouring of a raster whose
# majority is dry.


def _flood_grid(height, width, step_deg, lon_min=-53.54, lat_max=-25.71):
    """A north-up EPSG:4326 grid, the shape dem.fetch_set returns."""
    import rasterio
    from rasterio.transform import Affine

    from terra.terrain import dem

    transform = Affine.translation(lon_min, lat_max) * Affine.scale(step_deg, -step_deg)
    return dem.Grid(transform=transform, width=width, height=height,
                    crs=rasterio.crs.CRS.from_epsg(4326))


def _flood_valley(height, width, centre, cross_slope, along_slope=0.01):
    """The V-shaped valley test_flood.py uses: HAND is the distance to the axis."""
    across = np.abs(np.arange(width) - centre).astype(float) * cross_slope
    along = np.arange(height, 0, -1, dtype=float) * along_slope
    return 100.0 + across[None, :] + along[:, None]


def _flood_reads(height=48, width=52):
    """
    Four products over one window: three on the reference grid, one at 3x the
    cell size, which is the arrangement Planetary Computer actually returns.
    """
    from terra.terrain import dem

    step = 1.0 / 3600.0
    reference = _flood_grid(height, width, step)
    coarse = _flood_grid(height // 3, width // 3, step * 3)

    fine = _flood_valley(height, width, width / 2, 1.0)
    rng = np.random.default_rng(7)
    reads = [
        dem.ProductRead(product=dem.resolve("cop30"), array=fine,
                        grid=reference, reference=reference, resampled=False),
        dem.ProductRead(product=dem.resolve("nasadem"),
                        array=fine + rng.normal(0.0, 0.4, fine.shape),
                        grid=reference, reference=reference, resampled=False),
        dem.ProductRead(product=dem.resolve("alos"),
                        array=fine + rng.normal(0.0, 0.8, fine.shape),
                        grid=reference, reference=reference, resampled=False),
        dem.ProductRead(product=dem.resolve("cop90"),
                        array=_flood_valley(height // 3, width // 3,
                                            width / 6, 3.0, along_slope=0.03),
                        grid=coarse, reference=reference, resampled=True),
    ]
    return reads


def test_the_flood_envelope_action_answers_under_its_own_key(tmp_path, monkeypatch,
                                                             capsys):
    """
    The handler end to end, with the catalogue replaced and everything else real.

    What it pins is the composition: the coarse product reaches the envelope on
    the shared grid, the payload the frontend and the Go layer are written
    against arrives under "flood", and the agreement raster leaves as files
    because it cannot travel as JSON.
    """
    from terra.terrain import dem
    import rasterio

    reads = _flood_reads()
    monkeypatch.setattr(dem, "fetch_set", lambda *a, **k: reads)

    actions.action_flood_envelope(
        {
            "polygon_geojson": {
                "type": "Polygon",
                "coordinates": [[[-53.54, -25.72], [-53.53, -25.72],
                                 [-53.53, -25.71], [-53.54, -25.71],
                                 [-53.54, -25.72]]],
            },
            # 0.5 km2 is 556 cells of 30 m and nothing in a 48 by 52 window
            # reaches it, which would leave no drainage network at all.
            "drainage_km2": 0.02,
            "inset_margin_cells": 4,
        },
        tmp_path,
    )

    out = capsys.readouterr()
    payload = json.loads(out.out)["flood"]

    assert [row["id"] for row in payload["products"]] == [
        "cop30", "nasadem", "alos", "cop90",
    ]
    assert payload["reference_threshold_m"] == 1.0
    assert payload["thresholds_m"] == [1.0, 2.0, 5.0, 10.0, 20.0]
    # The AOI is the top-left 36 by 36 cells of the window the chain ran over:
    # 0.01 degrees of the grid's 1/3600 degree cells on each axis. The window
    # is 48 by 51 -- the read is 48 by 52 and the coarse product covers 51 of
    # those columns, so the last one is trimmed. Four products, so every cell
    # of the AOI is counted 0 to 4 and the counts account for the AOI, not for
    # the window.
    counts = payload["agreement"]["counts"]
    assert len(counts) == 5
    assert payload["aoi"]["cells"] == 36 * 36
    assert payload["aoi"]["window_cells"] == 48 * 51
    assert (payload["grid"]["width"], payload["grid"]["height"]) == (51, 48)
    assert sum(counts) == 36 * 36
    # Six unordered pairs at each of the five thresholds.
    assert len(payload["pairs"]) == 30
    assert len(payload["envelope"]) == 5
    assert payload["buffer_m"] > 0

    # The coarse product is the one that crossed a resampling, and every pair it
    # is in is flagged, which is what lets a reader separate the alignment from
    # the terrain.
    resampled = {row["id"]: row["resampled"] for row in payload["products"]}
    assert resampled == {"cop30": False, "nasadem": False, "alos": False,
                         "cop90": True}
    for pair in payload["pairs"]:
        assert pair["resampled"] == ("cop90" in (pair["dem_a"], pair["dem_b"]))

    # The GeoTIFF is the chain's own output over the whole computed window, on
    # the grid the payload describes; the payload counts the AOI part of it.
    with rasterio.open(payload["agreement_tif"]) as src:
        agreement = src.read(1)
        assert src.width == payload["grid"]["width"]
        assert src.height == payload["grid"]["height"]
    assert agreement.max() <= 4
    assert int((agreement[:36, :36] == 4).sum()) == counts[4]
    # The buffer is where the difference between the two shows: the window
    # holds unanimous cells the report does not count.
    assert int((agreement == 4).sum()) > counts[4]

    # The PNG is what goes on the map, so it is the AOI and not the window.
    with rasterio.open(payload["agreement_png"]) as src:
        assert (src.height, src.width) == (36, 36)
        alpha = src.read(4)
    assert int((alpha > 0).sum()) == int((agreement[:36, :36] > 0).sum())
    # And the payload says where to put it, in the field shape the water
    # overlay is placed from.
    assert set(payload["extent"]) == {"lon_min", "lat_min", "lon_max", "lat_max"}
    bounds = payload["grid"]["bounds"]
    assert payload["extent"]["lon_min"] == pytest.approx(bounds["lon_min"])
    assert payload["extent"]["lat_max"] == pytest.approx(bounds["lat_max"])
    assert payload["extent"]["lon_max"] == pytest.approx(
        bounds["lon_min"] + 36 / 3600.0
    )
    assert payload["extent"]["lat_min"] == pytest.approx(
        bounds["lat_max"] - 36 / 3600.0
    )

    # Progress reaches the caller as one line per unit of real work, not as a
    # jump per stage: four reads are replaced here, so what is left is four
    # terrain chains and five thresholds.
    steps = [json.loads(line)["progress"]
             for line in out.err.strip().splitlines()]
    assert steps == sorted(steps)
    assert steps[-1] == 100
    assert len(steps) >= 4 + 5


def _flood_run(tmp_path, monkeypatch, capsys, coordinates):
    """The action over one polygon, with the catalogue replaced by _flood_reads."""
    from terra.terrain import dem

    monkeypatch.setattr(dem, "fetch_set", lambda *a, **k: _flood_reads())
    actions.action_flood_envelope(
        {
            "polygon_geojson": {"type": "Polygon", "coordinates": [coordinates]},
            "drainage_km2": 0.02,
            "inset_margin_cells": 4,
        },
        tmp_path,
    )
    return json.loads(capsys.readouterr().out)["flood"]


# The window _flood_reads puts on the grid, after the trim: 48 rows and 51
# columns of 1/3600 degree from the north-west corner. Written in degrees here
# because that is what a polygon carries.
CELL_DEG = 1.0 / 3600.0
WINDOW_LON_MIN, WINDOW_LAT_MAX = -53.54, -25.71
WINDOW_ROWS, WINDOW_COLS = 48, 51


def test_the_flood_areas_are_over_the_polygon_and_scale_with_it(tmp_path,
                                                                monkeypatch,
                                                                capsys):
    """
    A polygon over half the window reports half the window's cells.

    The figures used to be taken over the whole array the terrain chain ran on,
    which is the AOI plus its buffer: on one observed run that reported 76.2
    km2 of class areas for an AOI of about 20 km2. Here the AOI is exactly half
    the computed window, so every cell count and every area has a value that
    can be written down before the run.
    """
    lon_mid = WINDOW_LON_MIN + (WINDOW_COLS // 2) * CELL_DEG
    lat_bottom = WINDOW_LAT_MAX - WINDOW_ROWS * CELL_DEG

    payload = _flood_run(tmp_path, monkeypatch, capsys, [
        [WINDOW_LON_MIN, WINDOW_LAT_MAX], [lon_mid, WINDOW_LAT_MAX],
        [lon_mid, lat_bottom], [WINDOW_LON_MIN, lat_bottom],
        [WINDOW_LON_MIN, WINDOW_LAT_MAX],
    ])

    half_cells = WINDOW_ROWS * (WINDOW_COLS // 2)
    assert payload["aoi"]["window_cells"] == WINDOW_ROWS * WINDOW_COLS
    assert payload["aoi"]["cells"] == half_cells
    assert payload["aoi"]["area_km2"] == pytest.approx(
        payload["aoi"]["window_area_km2"] * half_cells
        / (WINDOW_ROWS * WINDOW_COLS), abs=5e-4
    )
    assert sum(payload["agreement"]["counts"]) == half_cells
    # Every product's extent is inside the AOI too, and its fraction is of the
    # AOI: over the window each of these would read as a much drier place.
    for row in payload["products"]:
        assert row["cells"] <= half_cells
        assert row["area_frac"] == pytest.approx(row["cells"] / half_cells,
                                                 abs=5e-7)


def test_an_l_shaped_flood_aoi_reports_the_l_and_not_its_bounding_box(tmp_path,
                                                                      monkeypatch,
                                                                      capsys):
    """
    The notch of an L is outside the figures and transparent on the overlay.

    A user who draws an L is asking about the L. A reporting mask taken from
    the polygon's bounding box passes every proportional check -- a rectangle
    covering half the window still reports half of it -- and silently puts the
    quarter of the window the user cut out back into every area, count and IoU.
    This L is the whole window minus its bottom-right quarter, so the two
    implementations differ by 24 by 25 cells.
    """
    lon_mid = WINDOW_LON_MIN + (WINDOW_COLS // 2) * CELL_DEG
    lon_right = WINDOW_LON_MIN + WINDOW_COLS * CELL_DEG
    lat_mid = WINDOW_LAT_MAX - (WINDOW_ROWS // 2) * CELL_DEG
    lat_bottom = WINDOW_LAT_MAX - WINDOW_ROWS * CELL_DEG

    payload = _flood_run(tmp_path, monkeypatch, capsys, [
        [WINDOW_LON_MIN, WINDOW_LAT_MAX], [lon_right, WINDOW_LAT_MAX],
        [lon_right, lat_mid], [lon_mid, lat_mid], [lon_mid, lat_bottom],
        [WINDOW_LON_MIN, lat_bottom], [WINDOW_LON_MIN, WINDOW_LAT_MAX],
    ])

    notch_rows, notch_cols = WINDOW_ROWS // 2, WINDOW_COLS - WINDOW_COLS // 2
    l_cells = WINDOW_ROWS * WINDOW_COLS - notch_rows * notch_cols
    assert notch_rows * notch_cols == 24 * 26
    assert payload["aoi"]["cells"] == l_cells
    assert sum(payload["agreement"]["counts"]) == l_cells

    # The overlay covers the bounding box, because an image is a rectangle, and
    # is transparent over the notch, because the figures do not include it.
    import rasterio

    with rasterio.open(payload["agreement_png"]) as src:
        assert (src.height, src.width) == (WINDOW_ROWS, WINDOW_COLS)
        alpha = src.read(4)
    assert int(alpha[notch_rows:, WINDOW_COLS // 2:].sum()) == 0
    assert int((alpha > 0).sum()) > 0


def test_the_flood_reporting_mask_follows_the_polygon_cell_by_cell():
    """
    The rasterisation itself, away from the rest of the action.

    A cell is in when its centre is in the polygon. The L above is built on
    that rule, and this is where the rule is pinned: a cell the boundary merely
    clips is out, so the reported area does not grow by half a cell all the way
    round the AOI.
    """
    from shapely.geometry import box

    grid = _flood_grid(WINDOW_ROWS, WINDOW_COLS, CELL_DEG)
    # 2.2 cells wide and 2.2 tall from the north-west corner, so the third row
    # and column of cells is clipped by the boundary rather than covered.
    polygon = box(WINDOW_LON_MIN, WINDOW_LAT_MAX - 2.2 * CELL_DEG,
                  WINDOW_LON_MIN + 2.2 * CELL_DEG, WINDOW_LAT_MAX)

    mask = actions.aoi_reporting_mask(polygon, grid)

    assert mask.shape == (WINDOW_ROWS, WINDOW_COLS)
    # Centres sit at 0.5, 1.5 and 2.5 cells: the first two are inside the
    # boundary at 2.2 and the clipped one is not.
    assert int(mask.sum()) == 4
    assert mask[:2, :2].all()


def test_the_flood_envelope_refuses_an_aoi_it_cannot_hold_in_memory(capsys):
    """
    The refusal names the AOI, the limit and why the alternative is not taken.

    Downsampling to fit would be the silent option, and it is the one thing this
    analysis cannot do: it measures how far four DEM products disagree, and
    reading them at a resolution none of them has changes that measurement.
    """
    with pytest.raises(SystemExit):
        actions.action_flood_envelope(
            {
                "polygon_geojson": {
                    "type": "Polygon",
                    "coordinates": [[[-53.9, -25.9], [-53.0, -25.9],
                                     [-53.0, -25.0], [-53.9, -25.0],
                                     [-53.9, -25.9]]],
                }
            },
            Path("."),
        )
    error = json.loads(capsys.readouterr().err.strip())["error"]
    # The size the user drew, in the units they drew it in.
    assert "90.5 by 99.5 km" in error
    assert "4 million" in error
    assert "coarser resolution" in error


def test_the_renamed_ring_parameter_is_refused_under_its_old_name(capsys):
    """
    edge_margin_cells is gone, and a caller still sending it is told so.

    Ignoring an unknown key is the silent failure here: the request would run,
    the ring would fall back to the 1 km default, and the payload would report
    a margin the caller did not ask for. The names differ because the rings do:
    the old one was cut from the border of the buffered window, the new one
    from inside the AOI polygon.
    """
    with pytest.raises(SystemExit):
        actions.action_flood_envelope(
            {
                "polygon_geojson": {
                    "type": "Polygon",
                    "coordinates": [[[-53.54, -25.72], [-53.53, -25.72],
                                     [-53.53, -25.71], [-53.54, -25.72]]],
                },
                "edge_margin_cells": 30,
            },
            Path("."),
        )
    error = json.loads(capsys.readouterr().err.strip())["error"]
    assert "inset_margin_cells" in error


def test_the_flood_envelope_needs_two_products_and_says_which_exist(capsys):
    with pytest.raises(SystemExit):
        actions.action_flood_envelope(
            {
                "polygon_geojson": {
                    "type": "Polygon",
                    "coordinates": [[[-53.54, -25.72], [-53.53, -25.72],
                                     [-53.53, -25.71], [-53.54, -25.72]]],
                },
                "dem_ids": ["cop30"],
            },
            Path("."),
        )
    error = json.loads(capsys.readouterr().err.strip())["error"]
    assert "needs at least two" in error
    assert "cop90" in error


def test_the_common_window_trims_the_alignment_sliver_but_not_an_interior_void():
    """
    A product moved onto the reference grid can miss it by one column at the
    border, which is what the trim is for. A void away from the border is a hole
    in the product, and shrinking the window around it would report a smaller
    area with nothing on screen saying why.
    """
    full = np.ones((6, 8))
    sliver = full.copy()
    sliver[:, -1] = np.nan
    # One column costs one column, not the four rows a row-first peel would
    # spend before reaching it.
    assert actions.common_covered_window([full, sliver], 4) == (0, 6, 0, 7)

    holed = full.copy()
    holed[3, 4] = np.nan
    assert actions.common_covered_window([full, holed], 4) is None

    # And a sliver wider than the alignment can explain is not a sliver.
    wide = full.copy()
    wide[:, -5:] = np.nan
    assert actions.common_covered_window([full, wide], 4) is None
    assert actions.common_covered_window([full, np.full((6, 8), np.nan)], 4) is None


def test_the_agreement_colouring_leaves_the_cells_no_product_calls_wet_clear():
    """
    Zero has to be transparent rather than the palest tone of the ramp. Most of
    a window is dry, and painting it the first colour of a blue ramp would draw
    a flood over the whole AOI at an opacity a reader reads as shallow water.
    """
    counts = np.array([[0, 1], [2, 4]], dtype=np.uint8)
    rgba = actions.agreement_rgba(counts, 4)

    assert rgba.shape == (2, 2, 4)
    assert rgba[0, 0, 3] == 0
    assert (rgba[0, 1, 3], rgba[1, 0, 3], rgba[1, 1, 3]) == (255, 255, 255)
    # More products agreeing reads as a darker blue, so the ramp is ordered.
    def luminance(pixel):
        return int(pixel[0]) + int(pixel[1]) + int(pixel[2])
    assert luminance(rgba[0, 1]) > luminance(rgba[1, 0]) > luminance(rgba[1, 1])


def test_the_flood_envelope_is_registered_under_the_name_the_shell_sends():
    assert registry.resolve("flood_envelope") is actions.action_flood_envelope


FLOOD_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "internal" / "research" / "testdata" / "flood_b.json"
)


@pytest.mark.skipif(not FLOOD_FIXTURE.is_file(), reason="flood fixture not recorded")
def test_the_recorded_flood_payload_carries_every_field_the_other_layers_read():
    """
    The recorded run the Go and TypeScript layers are tested against.

    Those layers cannot detect a field this sidecar stops emitting: they decode
    what the fixture holds, and a fixture recorded from an older payload would
    let all three agree on a shape the sidecar no longer produces. This is the
    one test that reads the fixture from the side that writes it.
    """
    payload = json.loads(FLOOD_FIXTURE.read_text())["flood"]

    for key in ("reference_threshold_m", "thresholds_m", "drainage_km2",
                "cell_size_m", "grid", "buffer_m", "aoi", "extent", "products",
                "agreement", "pairs", "envelope", "inset_margin_cells",
                "qualifier", "assumptions"):
        assert key in payload, key
    assert set(payload["cell_size_m"]) == {"x", "y"}
    assert set(payload["grid"]["bounds"]) == {
        "lon_min", "lat_min", "lon_max", "lat_max",
    }
    assert set(payload["extent"]) == {"lon_min", "lat_min", "lon_max", "lat_max"}
    assert set(payload["aoi"]) == {"cells", "area_km2", "inset_cells",
                                   "window_cells", "window_area_km2",
                                   "frac_of_window"}

    for row in payload["products"]:
        assert set(row) == {"id", "collection", "native_resolution_m",
                            "resampled", "cells", "area_km2", "area_frac"}
    for row in payload["pairs"]:
        assert set(row) == {"dem_a", "dem_b", "threshold_m", "iou",
                            "iou_inset", "area_ratio_b_over_a", "resampled"}
    for row in payload["envelope"]:
        assert set(row) == {"threshold_m", "iou_min", "iou_max",
                            "iou_min_inset", "iou_max_inset"}
    assert set(payload["agreement"]) == {
        "counts", "unanimous_wet_km2", "contested_km2", "unanimous_dry_km2",
        "contested_frac_of_wet",
    }

    n_products = len(payload["products"])
    n_thresholds = len(payload["thresholds_m"])
    # One agreement level per possible count, 0 to N, and every AOI cell in
    # one. Over the AOI and not the window: the recording was made with a
    # buffer, so the window holds several times the ground the figures cover,
    # and a payload whose counts summed to the window would be the defect this
    # fixture was re-recorded to catch.
    assert len(payload["agreement"]["counts"]) == n_products + 1
    assert sum(payload["agreement"]["counts"]) == payload["aoi"]["cells"]
    assert (payload["aoi"]["window_cells"]
            == payload["grid"]["width"] * payload["grid"]["height"])
    assert payload["aoi"]["cells"] < payload["aoi"]["window_cells"]
    # The overlay sits inside the window it was cut from.
    assert payload["extent"]["lon_min"] >= payload["grid"]["bounds"]["lon_min"]
    assert payload["extent"]["lat_max"] <= payload["grid"]["bounds"]["lat_max"]
    assert len(payload["pairs"]) == n_thresholds * n_products * (n_products - 1) // 2
    assert len(payload["envelope"]) == n_thresholds
    # The agreement raster is built at a threshold the envelope also reports, or
    # the map on screen would have no measure of its own spread beside it.
    assert payload["reference_threshold_m"] in payload["thresholds_m"]

    # The provenance the figures cannot travel without: this is TERRA's own DEM
    # set, not the study's, and a HAND threshold is not a flood depth.
    assert "Planetary Computer" in payload["qualifier"]
    assert "E-hand-flood-baseline" in payload["qualifier"]
    assert "not a hydrodynamic model" in payload["qualifier"]
