"""
Surface water and flood mapping from Sentinel-2 spectral water indices.

Descriptive, with no model and no trained legend: the output is a thresholded
spectral index, so it carries none of the fixed-legend domain-shift limitation
that applies to the classifier.

Indices, with the paper each comes from:

    NDWI  = (green - nir)   / (green + nir)                 McFeeters (1996)
    MNDWI = (green - swir1) / (green + swir1)               Xu (2006)
    AWEI  = 4(green - swir1) - (0.25 nir + 2.75 swir2)      Feyisa et al. (2014)

AWEI here is the non-shadow variant, AWEI_nsh. Bands are B03 green, B8A narrow
NIR, B11 swir1 and B12 swir2. B8A rather than B08 is deliberate: the research
prototype this is ported from built its stack on the Prithvi band set, whose NIR
slot is B8A (865 nm, 20 m). Using B08 would change NDWI and AWEI and would not
reproduce the reference series.

Ported from mestrado/flood_mapping_analysis.ipynb. The index algebra, the Otsu
implementation and the threshold bounds are carried over unchanged. One thing is
deliberately NOT carried over; see per_date_valid_mask.
"""

from __future__ import annotations

import numpy as np

INDEX_NAMES = ("NDWI", "MNDWI", "AWEI")

# The primary threshold, not a failure fallback. Zero is the literature cut for
# NDWI (McFeeters 1996) and MNDWI (Xu 2006), and Feyisa et al. (2014) propose it
# for AWEI_nsh as well. AWEI is on a different, unbounded scale.
DEFAULT_THRESHOLD = 0.0

PRIMARY_INDEX = "MNDWI"

# Empirical guard keeping Otsu from wandering into a degenerate split when the
# AOI is almost entirely land. No stated derivation in the source. The lower
# bound binds often -- on the reference properties it saturates on 12 of 22,
# 9 of 21 and 20 of 20 dates -- so a saturated threshold is flagged rather than
# presented as an estimate.
OTSU_CLIP_LOW = -0.2
OTSU_CLIP_HIGH = 0.4

# Occurrence band treated as ephemeral rather than permanent water.
EPHEMERAL_OCC_LOW = 0.15
EPHEMERAL_OCC_HIGH = 0.70

# Bands each index consumes, used both to read rasters and to decide validity.
INDEX_BANDS = {
    "NDWI": ("B03", "B8A"),
    "MNDWI": ("B03", "B11"),
    "AWEI": ("B03", "B8A", "B11", "B12"),
}

_EPS = 1e-8


def compute_water_indices(green, nir, swir1, swir2) -> dict:
    """
    The three indices for one date. Reflectance is expected in [0, 1].

    The epsilon sits inside the denominator, as in the source. Do not substitute
    a masked division: the value on a fully zero pixel is then exactly 0.0,
    which the validity mask is responsible for excluding rather than the
    arithmetic.

    No clipping to [-1, 1]. composite.calculate_ndwi clips and uses a bare
    denominator, so it is not equivalent and must not be reused here. AWEI is
    unbounded by construction.
    """
    with np.errstate(divide="ignore", invalid="ignore"):
        ndwi = (green - nir) / (green + nir + _EPS)
        mndwi = (green - swir1) / (green + swir1 + _EPS)
        awei = 4.0 * (green - swir1) - (0.25 * nir + 2.75 * swir2)
    return {
        "NDWI": np.nan_to_num(ndwi, nan=0.0),
        "MNDWI": np.nan_to_num(mndwi, nan=0.0),
        "AWEI": np.nan_to_num(awei, nan=0.0),
    }


def otsu_threshold(values: np.ndarray, nbins: int = 256) -> float:
    """
    Between-class-variance threshold (Otsu 1979), carried over unchanged.

    Three details are load-bearing and must not be tidied away: the histogram is
    binned over the actual data range of the values passed in, so the bin edges
    move from date to date; the class means use bin centres; and the return value
    is the midpoint of the winning bin.

    Returns 0.0 for a degenerate input, which callers report as such rather than
    presenting it as an estimated threshold.
    """
    v = values[np.isfinite(values)]
    if v.size < 50:
        return 0.0
    hist, bin_edges = np.histogram(v, bins=nbins)
    hist = hist.astype(float)
    if hist.sum() == 0:
        return 0.0
    prob = hist / hist.sum()
    omega = np.cumsum(prob)
    mu = np.cumsum(prob * (bin_edges[:-1] + bin_edges[1:]) / 2.0)
    mu_t = mu[-1]
    sigma_b = (mu_t * omega - mu) ** 2 / (omega * (1.0 - omega) + 1e-12)
    idx = int(np.nanargmax(sigma_b))
    return float(0.5 * (bin_edges[idx] + bin_edges[idx + 1]))


def otsu_threshold_for_date(values: np.ndarray) -> tuple[float, bool, bool]:
    """
    Otsu threshold with the empirical bounds applied.

    Returns (threshold, clipped, degenerate). `clipped` means the bound was
    reached and the value is a bound rather than an estimate; `degenerate` means
    the histogram had too few finite samples to threshold at all.
    """
    finite = values[np.isfinite(values)]
    degenerate = finite.size < 50
    raw = otsu_threshold(values)
    thr = float(np.clip(raw, OTSU_CLIP_LOW, OTSU_CLIP_HIGH))
    clipped = (not degenerate) and thr != raw
    return thr, clipped, degenerate


def per_date_valid_mask(aoi_valid: np.ndarray, bands: dict, index: str) -> np.ndarray:
    """
    Pixels inside the AOI that were actually observed on this date.

    THIS IS THE ONE DELIBERATE DEPARTURE FROM THE SOURCE. The prototype built a
    single validity mask as a union over dates, so a pixel missing on one date
    was still counted on that date. Its bands are then zero, every ratio index
    evaluates to exactly (0 - 0) / (0 + 0 + eps) = 0.0, and the comparison is
    `index >= 0.0`, so the pixel is counted as water. On the three reference
    properties almost every pixel-date the prototype reported as water at the
    fixed threshold is a no-data pixel rather than water: 906 of 909, 980 of 985
    and 1171 of 1171.

    Carrying that over would have produced a water product measuring missing
    observations. Validity is therefore evaluated per date, from the bands the
    selected index actually consumes.
    """
    mask = np.asarray(aoi_valid, dtype=bool)
    for name in INDEX_BANDS.get(index, INDEX_BANDS[PRIMARY_INDEX]):
        arr = bands.get(name)
        if arr is None:
            continue
        mask = mask & (arr > 0)
    return mask


def water_mask_for_date(
    index_frame: np.ndarray, date_valid: np.ndarray, threshold: float
) -> np.ndarray:
    """
    Water is the high tail of the index. The comparison is >=, as in the source.

    Validity is applied on both sides: the caller thresholds only observed
    pixels, and the result is intersected with them again so an unobserved pixel
    can never be reported as water.
    """
    return date_valid & (index_frame >= threshold)


def water_fraction_pct(mask: np.ndarray, denominator: np.ndarray) -> float:
    """Water as a percentage of the pixels the denominator marks."""
    n = int(denominator.sum())
    if n <= 0:
        return 0.0
    return float(100.0 * int(mask.sum()) / n)


def occurrence_map(masks: list[np.ndarray], observed: list[np.ndarray]) -> np.ndarray:
    """
    Fraction of the dates a pixel was observed on which it was water.

    The denominator is per pixel, so a pixel seen on four dates and wet on one
    reads 0.25 whether or not other pixels were seen more often. The prototype
    divided by the total number of dates, which mixes dryness with absence.

    NaN where a pixel was never observed.
    """
    if not masks:
        return np.zeros((0, 0), dtype=float)
    wet = np.sum(np.stack(masks, axis=0), axis=0).astype(float)
    seen = np.sum(np.stack(observed, axis=0), axis=0).astype(float)
    out = np.full(wet.shape, np.nan, dtype=float)
    np.divide(wet, seen, out=out, where=seen > 0)
    return out


def classify_occurrence(occ: np.ndarray) -> dict:
    """
    Split observed pixels into occurrence bands.

    Ephemeral is the flood signal: water on some dates but not most. Above the
    upper bound the pixel is standing water rather than a flood event.
    """
    seen = np.isfinite(occ)
    o = np.where(seen, occ, -1.0)
    ephemeral = seen & (o >= EPHEMERAL_OCC_LOW) & (o <= EPHEMERAL_OCC_HIGH)
    persistent = seen & (o > EPHEMERAL_OCC_HIGH)
    never = seen & (o < EPHEMERAL_OCC_LOW)
    return {
        "ephemeral": ephemeral,
        "persistent": persistent,
        "rarely_or_never": never,
    }


def occurrence_to_rgba(occ: np.ndarray) -> np.ndarray:
    """
    Colour the occurrence map on a fixed 0 to 1 scale.

    composite.index_to_rgba cannot be reused: it always applies a percentile
    stretch, which is right for an unbounded index but wrong here. Occurrence is
    an absolute fraction, so a stretch would render an AOI peaking at 0.2 the
    same as one that is permanently flooded, and any legend beside it would be
    wrong. Unobserved pixels are transparent.
    """
    import composite as comp

    seen = np.isfinite(occ)
    t = np.clip(np.nan_to_num(occ, nan=0.0), 0.0, 1.0).astype(np.float32)
    rgb = comp._lerp_cmap(t, comp._BLUES)
    h, w = occ.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = (rgb[..., 0] * 255).astype(np.uint8)
    rgba[..., 1] = (rgb[..., 1] * 255).astype(np.uint8)
    rgba[..., 2] = (rgb[..., 2] * 255).astype(np.uint8)
    rgba[..., 3] = np.where(seen, 255, 0).astype(np.uint8)
    return rgba


def max_minus_median_index(
    index_cube: np.ndarray, observed_cube: np.ndarray
) -> np.ndarray:
    """
    Per-pixel anomaly: the wettest observation minus the typical one.

    Computed only over dates the pixel was observed on, so an absent date cannot
    pull the median down and manufacture an anomaly. NaN where a pixel has fewer
    than two observations.
    """
    masked = np.where(observed_cube, index_cube, np.nan)
    counts = observed_cube.sum(axis=0)
    with np.errstate(invalid="ignore", all="ignore"):
        med = np.nanmedian(masked, axis=0)
        mx = np.nanmax(masked, axis=0)
        delta = mx - med
    return np.where(counts >= 2, delta, np.nan)
