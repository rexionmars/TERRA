"""Unit tests for the surface water / flood mapping helpers (offline)."""

from __future__ import annotations

import numpy as np

from terra.water import indices as water


def test_index_formulas_match_the_published_definitions():
    green = np.array([[0.20]], dtype=np.float32)
    nir = np.array([[0.10]], dtype=np.float32)
    swir1 = np.array([[0.05]], dtype=np.float32)
    swir2 = np.array([[0.04]], dtype=np.float32)

    out = water.compute_water_indices(green, nir, swir1, swir2)

    # McFeeters (1996)
    assert abs(out["NDWI"][0, 0] - (0.20 - 0.10) / (0.20 + 0.10)) < 1e-6
    # Xu (2006)
    assert abs(out["MNDWI"][0, 0] - (0.20 - 0.05) / (0.20 + 0.05)) < 1e-6
    # Feyisa et al. (2014), non-shadow variant
    expected_awei = 4.0 * (0.20 - 0.05) - (0.25 * 0.10 + 2.75 * 0.04)
    assert abs(out["AWEI"][0, 0] - expected_awei) < 1e-6


def test_indices_are_not_clipped():
    """AWEI is unbounded; clipping to [-1, 1] would silently distort it."""
    green = np.array([[0.9]], dtype=np.float32)
    nir = np.array([[0.0]], dtype=np.float32)
    swir1 = np.array([[0.0]], dtype=np.float32)
    swir2 = np.array([[0.0]], dtype=np.float32)
    out = water.compute_water_indices(green, nir, swir1, swir2)
    assert out["AWEI"][0, 0] > 1.0


def test_no_data_pixels_are_not_reported_as_water():
    """
    The regression this module exists to avoid.

    A pixel with no observation has every band at zero, so each ratio index
    evaluates to exactly (0 - 0) / (0 + 0 + eps) = 0.0 and passes the fixed
    threshold of `index >= 0`. Counting it as water measures missing data. The
    per-date validity mask is what keeps it out.
    """
    green = np.array([[0.0, 0.20]], dtype=np.float32)
    swir1 = np.array([[0.0, 0.05]], dtype=np.float32)
    nir = np.zeros((1, 2), dtype=np.float32)
    swir2 = np.zeros((1, 2), dtype=np.float32)
    aoi = np.ones((1, 2), dtype=bool)

    frame = water.compute_water_indices(green, nir, swir1, swir2)["MNDWI"]
    # Left pixel is no-data yet its index is exactly at the threshold.
    assert frame[0, 0] == 0.0

    date_valid = water.per_date_valid_mask(
        aoi, {"B03": green, "B11": swir1}, "MNDWI"
    )
    assert not date_valid[0, 0]
    assert date_valid[0, 1]

    mask = water.water_mask_for_date(frame, date_valid, water.DEFAULT_THRESHOLD)
    assert not mask[0, 0], "no-data pixel must never be counted as water"


def test_per_date_valid_mask_uses_only_the_bands_the_index_needs():
    aoi = np.ones((1, 1), dtype=bool)
    bands = {
        "B03": np.array([[0.2]], dtype=np.float32),
        "B11": np.array([[0.1]], dtype=np.float32),
        "B8A": np.zeros((1, 1), dtype=np.float32),
        "B12": np.zeros((1, 1), dtype=np.float32),
    }
    # MNDWI does not read NIR, so a zero NIR must not invalidate the pixel.
    assert water.per_date_valid_mask(aoi, bands, "MNDWI")[0, 0]
    # NDWI does read NIR.
    assert not water.per_date_valid_mask(aoi, bands, "NDWI")[0, 0]
    # AWEI reads all four.
    assert not water.per_date_valid_mask(aoi, bands, "AWEI")[0, 0]


def test_otsu_separates_a_bimodal_distribution():
    values = np.concatenate([
        np.full(500, -0.5, dtype=np.float32),
        np.full(500, 0.5, dtype=np.float32),
    ])
    thr = water.otsu_threshold(values)
    assert -0.5 < thr < 0.5


def test_otsu_reports_degenerate_input_rather_than_guessing():
    thr, clipped, degenerate = water.otsu_threshold_for_date(
        np.array([0.1, 0.2], dtype=np.float32)
    )
    assert degenerate
    assert thr == 0.0
    assert not clipped


def test_otsu_clip_is_flagged_when_it_binds():
    """
    The lower bound binds on most dates of the reference properties, so a
    saturated value must be distinguishable from an estimated one.
    """
    values = np.concatenate([
        np.full(500, -0.95, dtype=np.float32),
        np.full(500, -0.85, dtype=np.float32),
    ])
    thr, clipped, degenerate = water.otsu_threshold_for_date(values)
    assert not degenerate
    assert clipped
    assert thr == water.OTSU_CLIP_LOW


def test_water_fraction_is_a_percentage_of_observed_pixels():
    mask = np.array([[True, False, False, False]])
    observed = np.array([[True, True, True, True]])
    assert water.water_fraction_pct(mask, observed) == 25.0
    # No observation at all yields zero rather than a division error.
    assert water.water_fraction_pct(mask, np.zeros((1, 4), bool)) == 0.0


def test_occurrence_divides_by_dates_the_pixel_was_observed_on():
    """
    A pixel seen twice and wet once is at 0.5, even when other dates exist that
    it was absent from. Dividing by the total date count would conflate being
    dry with not being seen.
    """
    masks = [
        np.array([[True, False]]),
        np.array([[False, False]]),
        np.array([[False, False]]),
    ]
    observed = [
        np.array([[True, True]]),
        np.array([[True, True]]),
        np.array([[False, True]]),  # first pixel not observed on the last date
    ]
    occ = water.occurrence_map(masks, observed)
    assert abs(occ[0, 0] - 0.5) < 1e-9
    assert occ[0, 1] == 0.0


def test_occurrence_is_nan_where_never_observed():
    masks = [np.array([[False]])]
    observed = [np.array([[False]])]
    occ = water.occurrence_map(masks, observed)
    assert np.isnan(occ[0, 0])


def test_classify_occurrence_bands():
    occ = np.array([[0.0, 0.3, 0.9, np.nan]])
    out = water.classify_occurrence(occ)
    assert out["rarely_or_never"][0, 0]
    assert out["ephemeral"][0, 1]
    assert out["persistent"][0, 2]
    # An unobserved pixel belongs to no band.
    assert not any(out[k][0, 3] for k in out)


def test_anomaly_ignores_unobserved_dates():
    cube = np.array([
        [[0.1]],
        [[0.4]],
        [[0.0]],  # unobserved; a raw median would be dragged toward zero
    ], dtype=np.float32)
    observed = np.array([[[True]], [[True]], [[False]]])
    delta = water.max_minus_median_index(cube, observed)
    # Median over the two observed dates is 0.25, max is 0.4.
    assert abs(delta[0, 0] - (0.4 - 0.25)) < 1e-6


def test_anomaly_needs_two_observations():
    cube = np.array([[[0.1]], [[0.4]]], dtype=np.float32)
    observed = np.array([[[True]], [[False]]])
    delta = water.max_minus_median_index(cube, observed)
    assert np.isnan(delta[0, 0])


def test_occurrence_rgba_uses_a_fixed_scale():
    """
    Occurrence is an absolute fraction, so a percentile stretch would render an
    AOI peaking at 0.2 identically to a permanently flooded one.
    """
    low = water.occurrence_to_rgba(np.array([[0.0, 0.2]]))
    high = water.occurrence_to_rgba(np.array([[0.0, 1.0]]))
    # Same input value, same colour, regardless of the rest of the array.
    assert tuple(low[0, 0, :3]) == tuple(high[0, 0, :3])
    # A higher occurrence is a different colour, not the same stretched one.
    assert tuple(low[0, 1, :3]) != tuple(high[0, 1, :3])
    # Unobserved pixels are transparent.
    assert water.occurrence_to_rgba(np.array([[np.nan]]))[0, 0, 3] == 0
