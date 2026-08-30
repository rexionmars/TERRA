"""
Domain-shift diagnostics between two classification runs.

Quantifies distribution discrepancy (KL, CVA/L2, linear MMD) from compact
per-run fingerprints cached at classify time, plus F1 from MapBiomas
agreement matrices when present. PCA / capped t-SNE project pooled feature
samples for a source-vs-target scatter.

Adversarial adaptation (KL-ADDA and friends) is intentionally out of scope.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import numpy.typing as npt

# Cap stored / compared feature rows so run JSON stays manageable.
DEFAULT_SAMPLE_N = 512
NDVI_BINS = 32
NDVI_RANGE = (-0.2, 1.0)
# Spectral RF feature layout (see infer.build_feature_matrix): B04/B08 means.
IDX_B04_MEAN = 42 + 2 * 4  # after NDVI/EVI/SAVI (42) + B02,B03
IDX_B08_MEAN = 42 + 3 * 4


def _as_float_list(arr: np.ndarray, nd: int = 6) -> list[float]:
    return [float(round(float(x), nd)) for x in np.asarray(arr, dtype=np.float64).ravel()]


def histogram_ndvi(values: np.ndarray, n_bins: int = NDVI_BINS) -> dict[str, list[float]]:
    """Fixed-edge NDVI histogram (counts normalised to a probability mass)."""
    lo, hi = NDVI_RANGE
    edges = np.linspace(lo, hi, n_bins + 1)
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    if v.size == 0:
        counts = np.zeros(n_bins, dtype=np.float64)
    else:
        v = np.clip(v, lo, hi)
        hist, _ = np.histogram(v, bins=edges)
        counts = hist.astype(np.float64)
    total = counts.sum()
    probs = counts / total if total > 0 else counts
    return {
        "edges": _as_float_list(edges, 4),
        "counts": _as_float_list(counts, 2),
        "probs": _as_float_list(probs, 6),
    }


def build_fingerprint(
    feature_matrix: np.ndarray | None,
    *,
    ndvi_values: np.ndarray | None = None,
    sample_n: int = DEFAULT_SAMPLE_N,
    rng: np.random.Generator | None = None,
    scaler_mean: np.ndarray | None = None,
    scaler_scale: np.ndarray | None = None,
    feature_names: list[str] | None = None,
    feature_importances: np.ndarray | None = None,
) -> dict[str, Any] | None:
    """
    Compact domain fingerprint for a single run.

    Prefer the spectral RF feature matrix (N, 80). When only an NDVI map is
    available (Prithvi / TT paths), store an NDVI-only fingerprint so KL still
    works and MMD/CVA degrade gracefully.
    """
    rng = rng or np.random.default_rng(0)

    if feature_matrix is not None and feature_matrix.size > 0:
        X = np.asarray(feature_matrix, dtype=np.float64)
        if X.ndim != 2 or X.shape[0] == 0:
            return None
        n, d = X.shape
        take = min(sample_n, n)
        if take < n:
            idx = rng.choice(n, size=take, replace=False)
            sample = X[idx]
        else:
            sample = X
        mean = sample.mean(axis=0)
        var = sample.var(axis=0)
        # NDVI mean feature is column 0 of the index block.
        ndvi_col = sample[:, 0] if d > 0 else np.array([])
        if ndvi_values is not None:
            ndvi_hist = histogram_ndvi(ndvi_values)
        else:
            ndvi_hist = histogram_ndvi(ndvi_col)
        red_nir = None
        if d > IDX_B08_MEAN:
            red_nir = {
                "red_mean": float(round(float(mean[IDX_B04_MEAN]), 6)),
                "nir_mean": float(round(float(mean[IDX_B08_MEAN]), 6)),
            }
        """
        Standardised against the TRAINING statistics, not against this run.

        The raw feature space cannot be measured with a Euclidean norm: the 80
        features carry three unit systems -- index values in [-1,1], reflectance
        around 0.1, and *_peak_idx / *_min_idx which are ACQUISITION POSITIONS,
        integers 0..21. Their training standard deviations run from 0.0065 to
        5.70, a ratio of 882, so a raw distance is dominated by which scene the
        peak happened to fall on. Measured on synthetic runs drawn from the
        training distribution, the six index features accounted for 99.7% of
        the squared distance and the sixteen reflectance features for 0.0%.

        The scaler that ships with the model carries the training mean and
        scale, which is what the forest was fitted on -- `classify_from_features`
        calls `scaler.transform` before predicting. Expressing the fingerprint
        in those units puts the distance in the space the model actually sees,
        and a z of 3 means "three training standard deviations from anything the
        forest was shown".
        """
        z_mean = z_var = None
        if scaler_mean is not None and scaler_scale is not None:
            sm = np.asarray(scaler_mean, dtype=np.float64).ravel()
            ss = np.asarray(scaler_scale, dtype=np.float64).ravel()
            if sm.size >= d and ss.size >= d:
                safe = np.where(ss[:d] > 0, ss[:d], 1.0)
                z_mean = (mean - sm[:d]) / safe
                z_var = var / (safe ** 2)

        return {
            "space": "spectral_rf",
            "n_features": int(d),
            "n_pixels": int(n),
            "n_sample": int(sample.shape[0]),
            "mean": _as_float_list(mean),
            "var": _as_float_list(var),
            # In training standard deviations. Absent where the scaler was not
            # available, which is what tells the comparison to refuse.
            "z_mean": _as_float_list(z_mean) if z_mean is not None else None,
            "z_var": _as_float_list(z_var) if z_var is not None else None,
            "feature_names": list(feature_names[:d]) if feature_names else None,
            "feature_importances": (
                _as_float_list(np.asarray(feature_importances).ravel()[:d])
                if feature_importances is not None
                else None
            ),
            "ndvi_hist": ndvi_hist,
            "red_nir": red_nir,
            # float32 rounded — enough for MMD/PCA, keeps JSON smaller.
            "sample": np.round(sample.astype(np.float32), 5).tolist(),
        }

    if ndvi_values is not None:
        v = np.asarray(ndvi_values, dtype=np.float64)
        v = v[np.isfinite(v)]
        if v.size == 0:
            return None
        take = min(sample_n, v.size)
        if take < v.size:
            idx = rng.choice(v.size, size=take, replace=False)
            sample_1d = v[idx]
        else:
            sample_1d = v
        # 1-d "feature" so compare still runs (MMD/CVA on NDVI only).
        sample = sample_1d.reshape(-1, 1)
        return {
            "space": "ndvi_only",
            "n_features": 1,
            "n_pixels": int(v.size),
            "n_sample": int(sample.shape[0]),
            "mean": _as_float_list(sample.mean(axis=0)),
            "var": _as_float_list(sample.var(axis=0)),
            # No training statistics for a one-column NDVI space; the absence is
            # what stops it being compared against a spectral fingerprint.
            "z_mean": None,
            "z_var": None,
            "feature_names": ["NDVI_mean"],
            "feature_importances": None,
            "ndvi_hist": histogram_ndvi(v),
            "red_nir": None,
            "sample": np.round(sample.astype(np.float32), 5).tolist(),
        }

    return None


def kl_divergence(p: npt.ArrayLike, q: npt.ArrayLike,
                  eps: float = 1e-9) -> float:
    """KL(P || Q) on discrete probability vectors with additive smoothing."""
    p = np.asarray(p, dtype=np.float64).ravel()
    q = np.asarray(q, dtype=np.float64).ravel()
    if p.size == 0 or q.size == 0 or p.size != q.size:
        return float("nan")
    p = p + eps
    q = q + eps
    p = p / p.sum()
    q = q / q.sum()
    return float(np.sum(p * np.log(p / q)))


def cva_magnitude(mean_a: npt.ArrayLike, mean_b: npt.ArrayLike) -> float:
    """Euclidean magnitude between two mean feature vectors (Change Vector Analysis)."""
    a = np.asarray(mean_a, dtype=np.float64).ravel()
    b = np.asarray(mean_b, dtype=np.float64).ravel()
    n = min(a.size, b.size)
    if n == 0:
        return float("nan")
    return float(np.linalg.norm(a[:n] - b[:n]))


def cva_angle_red_nir(
    red_a: float, nir_a: float, red_b: float, nir_b: float
) -> float | None:
    """
    Direction of the change vector in the red–NIR plane, degrees [0, 360).

    Useful when seasonality (Nordeste) and deforestation pull in different
    spectral directions.
    """
    dr = float(red_b) - float(red_a)
    dn = float(nir_b) - float(nir_a)
    if abs(dr) < 1e-12 and abs(dn) < 1e-12:
        return None
    ang = math.degrees(math.atan2(dn, dr))
    if ang < 0:
        ang += 360.0
    return float(round(ang, 2))


def mmd_rbf(
    Xa: np.ndarray, Xb: np.ndarray, *, gamma: float | None = None
) -> dict[str, Any]:
    """
    Unbiased MMD^2 with a Gaussian kernel, and the bandwidth it used.

    NOT the linear kernel this replaced. With k(x,y)=x·y the statistic reduces
    to ||mu_a - mu_b||, which is the change-vector magnitude computed a second
    way -- on real runs the two agreed to the last reported digit, so the report
    carried one measurement under two names. A linear kernel is also blind by
    construction to any difference that leaves the means equal, which is the
    shape of conditional shift: the same class emitting a different spectrum
    with a similar centre.

    A Gaussian kernel is characteristic (Gretton et al. 2012, JMLR 13:723-773),
    so MMD = 0 if and only if the two distributions are equal. Bandwidth by the
    median heuristic over the pooled pairwise distances. The unbiased estimator
    can go slightly negative on samples from one distribution; that is reported
    as it is rather than clamped, because a small negative IS the signal that
    the two are indistinguishable at this sample size.

    Power decays with dimension (Ramdas et al. 2015), and 80 features against
    512 rows is not a regime where a small value licenses "no shift".
    """
    A = np.asarray(Xa, dtype=np.float64)
    B = np.asarray(Xb, dtype=np.float64)
    if A.ndim != 2 or B.ndim != 2 or A.shape[0] < 2 or B.shape[0] < 2:
        return {"mmd2": None, "gamma": None, "n_a": 0, "n_b": 0}
    d = min(A.shape[1], B.shape[1])
    A = A[:, :d]
    B = B[:, :d]

    def sq(P: np.ndarray, Q: np.ndarray) -> np.ndarray:
        return (
            (P * P).sum(1)[:, None] + (Q * Q).sum(1)[None, :] - 2.0 * P @ Q.T
        ).clip(min=0.0)

    saa, sbb, sab = sq(A, A), sq(B, B), sq(A, B)
    if gamma is None:
        pooled = np.concatenate([saa.ravel(), sbb.ravel(), sab.ravel()])
        med = float(np.median(pooled[pooled > 0])) if np.any(pooled > 0) else 0.0
        gamma = 1.0 / med if med > 0 else 1.0

    m, n = A.shape[0], B.shape[0]
    kaa = np.exp(-gamma * saa)
    kbb = np.exp(-gamma * sbb)
    kab = np.exp(-gamma * sab)
    # Diagonals excluded: the unbiased estimator, which does not reward a
    # sample for containing itself.
    np.fill_diagonal(kaa, 0.0)
    np.fill_diagonal(kbb, 0.0)
    mmd2 = (
        kaa.sum() / (m * (m - 1))
        + kbb.sum() / (n * (n - 1))
        - 2.0 * kab.mean()
    )
    return {
        "mmd2": float(round(float(mmd2), 6)),
        "gamma": float(round(float(gamma), 6)),
        "n_a": int(m),
        "n_b": int(n),
    }


def feature_shift_table(
    fp_a: dict[str, Any], fp_b: dict[str, Any], *, top: int = 12
) -> list[dict[str, Any]] | None:
    """
    Which features moved, in training standard deviations, and which matter.

    The figure a researcher can act on. A single distance says the domains
    differ; this says WHERE -- and because the units are the training scaler's,
    a value of 3 means the target sits three training standard deviations from
    the centre of what the forest was fitted on, per feature.

    `weighted` multiplies the gap by the forest's own impurity importance for
    that feature. A large move in a feature the model barely splits on is not
    the same finding as a small move in one it depends on. Impurity importance
    is biased toward high-cardinality features (Strobl et al. 2007), so it
    ranks rather than quantifies -- both columns are reported and neither is
    presented as the answer alone.
    """
    za = fp_a.get("z_mean")
    zb = fp_b.get("z_mean")
    if not za or not zb:
        return None
    a = np.asarray(za, dtype=np.float64)
    b = np.asarray(zb, dtype=np.float64)
    d = min(a.size, b.size)
    if d == 0:
        return None
    names = fp_a.get("feature_names") or fp_b.get("feature_names") or []
    imp = fp_a.get("feature_importances") or fp_b.get("feature_importances")
    gap = b[:d] - a[:d]
    weight = np.asarray(imp, dtype=np.float64)[:d] if imp else np.ones(d)
    rows: list[dict[str, Any]] = [
        {
            "feature": names[i] if i < len(names) else f"f{i}",
            "z_a": float(round(float(a[i]), 3)),
            "z_b": float(round(float(b[i]), 3)),
            "gap_sd": float(round(float(gap[i]), 3)),
            "importance": float(round(float(weight[i]), 5)) if imp else None,
            "weighted": float(round(float(abs(gap[i]) * weight[i]), 5)),
        }
        for i in range(d)
    ]
    rows.sort(key=lambda r: -abs(float(r["gap_sd"])))
    return rows[:top]


def f1_from_confusion(
    matrix: list[list[int]] | np.ndarray,
    classes: list[int] | None = None,
) -> dict[str, Any]:
    """
    Per-class and macro F1 from a confusion matrix.

    Convention matches sidecar/lulc.agreement_against_reference: rows = predicted,
    columns = reference.

    `classes` is the matrix's own axis order, which the caller already sends as
    `matrix_classes` and this function did not read. Without it each row was
    identified by a bare position, so a per-class F1 could not be attached to a
    class -- and a per-class figure whose class is unknown is not a per-class
    figure. The macro average is unaffected either way.

    Note on the macro convention: classes with no predictions AND no reference
    cells have an undefined F1 and are skipped rather than counted as zero, so
    this reads higher than a convention that counts them. Stated because the
    two are not comparable and the difference is not visible in the number.
    """
    M = np.asarray(matrix, dtype=np.float64)
    if M.ndim != 2 or M.shape[0] == 0 or M.shape[0] != M.shape[1]:
        return {"macro_f1": None, "per_class": []}
    k = M.shape[0]
    ids = list(classes) if classes and len(classes) >= k else None
    per = []
    f1s: list[float] = []
    for i in range(k):
        tp = M[i, i]
        fp = M[i, :].sum() - tp
        fn = M[:, i].sum() - tp
        prec = tp / (tp + fp) if (tp + fp) > 0 else None
        rec = tp / (tp + fn) if (tp + fn) > 0 else None
        if prec is None or rec is None or (prec + rec) == 0:
            f1 = None
        else:
            f1 = float(2 * prec * rec / (prec + rec))
            f1s.append(f1)
        per.append({
            "index": i,
            "class_id": ids[i] if ids else None,
            "precision": None if prec is None else float(round(prec, 4)),
            "recall": None if rec is None else float(round(rec, 4)),
            "f1": None if f1 is None else float(round(f1, 4)),
        })
    macro = float(round(sum(f1s) / len(f1s), 4)) if f1s else None
    return {"macro_f1": macro, "per_class": per}


def project_pca(
    Xa: np.ndarray, Xb: np.ndarray, max_points: int = 800
) -> dict[str, Any]:
    """2D PCA of pooled samples; points tagged by domain ('A' / 'B')."""
    A = np.asarray(Xa, dtype=np.float64)
    B = np.asarray(Xb, dtype=np.float64)
    d = min(A.shape[1], B.shape[1])
    A, B = A[:, :d], B[:, :d]
    # Cap each side so the scatter stays readable.
    half = max(1, max_points // 2)
    rng = np.random.default_rng(1)
    if A.shape[0] > half:
        A = A[rng.choice(A.shape[0], half, replace=False)]
    if B.shape[0] > half:
        B = B[rng.choice(B.shape[0], half, replace=False)]
    X = np.vstack([A, B])
    labels = (["A"] * A.shape[0]) + (["B"] * B.shape[0])
    Xc = X - X.mean(axis=0, keepdims=True)
    # Economy SVD — avoids sklearn dependency for the hot path.
    _, _, vt = np.linalg.svd(Xc, full_matrices=False)
    comps = vt[:2].T  # (d, 2)
    if comps.shape[1] == 1:
        comps = np.hstack([comps, np.zeros((d, 1))])
    Z = Xc @ comps[:, :2]
    return {
        "method": "pca",
        "points": [
            {
                "x": float(round(float(Z[i, 0]), 5)),
                "y": float(round(float(Z[i, 1]), 5)),
                "domain": labels[i],
            }
            for i in range(Z.shape[0])
        ],
    }


def project_tsne(
    Xa: np.ndarray, Xb: np.ndarray, max_points: int = 600
) -> dict[str, Any] | None:
    """Optional t-SNE projection; returns None when sklearn is unavailable."""
    try:
        from sklearn.manifold import TSNE
    except Exception:
        return None
    A = np.asarray(Xa, dtype=np.float64)
    B = np.asarray(Xb, dtype=np.float64)
    d = min(A.shape[1], B.shape[1])
    A, B = A[:, :d], B[:, :d]
    half = max(1, max_points // 2)
    rng = np.random.default_rng(2)
    if A.shape[0] > half:
        A = A[rng.choice(A.shape[0], half, replace=False)]
    if B.shape[0] > half:
        B = B[rng.choice(B.shape[0], half, replace=False)]
    X = np.vstack([A, B])
    labels = (["A"] * A.shape[0]) + (["B"] * B.shape[0])
    n = X.shape[0]
    perp = max(5, min(30, (n - 1) // 3))
    Z = TSNE(
        n_components=2,
        perplexity=perp,
        init="pca",
        learning_rate="auto",
        random_state=0,
    ).fit_transform(X)
    return {
        "method": "tsne",
        "points": [
            {
                "x": float(round(float(Z[i, 0]), 5)),
                "y": float(round(float(Z[i, 1]), 5)),
                "domain": labels[i],
            }
            for i in range(Z.shape[0])
        ],
    }


def _sample_matrix(fp: dict[str, Any]) -> np.ndarray:
    return np.asarray(fp.get("sample") or [], dtype=np.float64)


def _width(fp: dict[str, Any]) -> int:
    """
    The feature space's width, from the mean vector rather than the declaration.

    `n_features` is written beside the vectors and could disagree with them;
    the length of `mean` is what every distance below actually indexes.
    """
    mean = fp.get("mean")
    if isinstance(mean, list):
        return len(mean)
    n = fp.get("n_features")
    return int(n) if isinstance(n, int) else -1


def _standardise(X: np.ndarray, fp: dict[str, Any]) -> np.ndarray:
    """
    A stored sample in training standard deviations.

    The fingerprint keeps the raw sample for provenance and the standardised
    MEAN beside it; the scaler's own mean and scale are recoverable from the
    pair, since z = (mean - m) / s was formed from the same raw mean. Rather
    than invert that, the per-feature training scale is derived from the raw
    and standardised variances the fingerprint already stores.
    """
    var = fp.get("var")
    zvar = fp.get("z_var")
    zmean = fp.get("z_mean")
    mean = fp.get("mean")
    if not (var and zvar and zmean and mean):
        return X
    v = np.asarray(var, dtype=np.float64)
    zv = np.asarray(zvar, dtype=np.float64)
    m = np.asarray(mean, dtype=np.float64)
    z = np.asarray(zmean, dtype=np.float64)
    d = min(X.shape[1], v.size, zv.size, m.size, z.size)
    # s^2 = var / z_var, taken where z_var is usable; elsewhere leave the
    # column alone rather than divide by something meaningless.
    with np.errstate(divide="ignore", invalid="ignore"):
        s = np.sqrt(np.where(zv[:d] > 0, v[:d] / zv[:d], 1.0))
    s = np.where(np.isfinite(s) & (s > 0), s, 1.0)
    centre = m[:d] - z[:d] * s
    return (X[:, :d] - centre) / s


def _agreement_block(agreement: dict[str, Any] | None, label: str) -> dict[str, Any] | None:
    if not agreement:
        return None
    matrix = agreement.get("matrix")
    # `matrix_classes` travelled in this payload all along and was not read, so
    # every per-class row came back identified by a bare axis position.
    f1 = (
        f1_from_confusion(matrix, agreement.get("matrix_classes"))
        if matrix
        else {"macro_f1": None, "per_class": []}
    )
    n_ref = int(agreement.get("n_reference_cells") or 0)
    n_out = int(agreement.get("n_outside_legend") or 0)
    outside_pct = (
        float(round(100.0 * n_out / (n_ref + n_out), 2)) if (n_ref + n_out) > 0 else None
    )
    return {
        "label": label,
        "overall_pct": agreement.get("overall_pct"),
        "n_outside_legend": n_out,
        "outside_legend_pct": outside_pct,
        "quantity_disagreement_pct": agreement.get("quantity_disagreement_pct"),
        "allocation_disagreement_pct": agreement.get("allocation_disagreement_pct"),
        "macro_f1": f1.get("macro_f1"),
        "per_class_f1": f1.get("per_class"),
    }


def compare_fingerprints(
    fp_a: dict[str, Any],
    fp_b: dict[str, Any],
    *,
    agreement_a: dict[str, Any] | None = None,
    agreement_b: dict[str, Any] | None = None,
    include_tsne: bool = False,
) -> dict[str, Any]:
    """Build a DomainShiftReport from two fingerprints (+ optional agreements)."""
    hist_a = (fp_a.get("ndvi_hist") or {}).get("probs") or []
    hist_b = (fp_b.get("ndvi_hist") or {}).get("probs") or []
    kl_ab = kl_divergence(hist_a, hist_b)
    kl_ba = kl_divergence(hist_b, hist_a)
    # Symmetric average — a single scalar for the card.
    kl_sym = (
        float(round(0.5 * (kl_ab + kl_ba), 6))
        if math.isfinite(kl_ab) and math.isfinite(kl_ba)
        else None
    )

    """
    Comparable at all?

    A spectral fingerprint has 80 features; an NDVI-only one has a single
    column that means something else -- the temporal mean, not the feature the
    forest calls NDVI_mean in a standardised space. Taking min(80, 1) columns
    produced a number from two different quantities, and it was reported with
    no more warning than a `space` field nobody had to read.

    THE NAME IS NOT ENOUGH, THOUGH, and this was a string comparison alone. Two
    fingerprints both called `spectral_rf` but of different width -- a model
    refitted with more dates, so a different `n_dates_model`, is the ordinary
    way to get there -- passed as the same space, and `cva_magnitude` then
    truncated to `min(d_a, d_b)` in silence. That is the same failure the
    paragraph above describes, one level up and harder to see, because both
    sides answer to the same name. Width is part of the identity of a feature
    space, so it is part of the test.
    """
    same_space = (
        fp_a.get("space") == fp_b.get("space")
        and _width(fp_a) == _width(fp_b)
    )
    za = fp_a.get("z_mean")
    zb = fp_b.get("z_mean")
    standardised = bool(za) and bool(zb) and same_space

    """
    In training standard deviations where both sides carry them.

    The raw magnitude is kept beside it for provenance, but it is not the
    figure to read: measured against the shipped scaler, the six acquisition
    index features carry 99.7% of a raw distance and the sixteen reflectance
    features none of it.
    """
    raw = cva_magnitude(fp_a.get("mean") or [], fp_b.get("mean") or [])
    mag = float(round(raw, 6)) if math.isfinite(raw) else None
    mag_sd = None
    if standardised:
        # `standardised` is bool(za) and bool(zb), so neither is None here.
        assert za is not None and zb is not None
        v = cva_magnitude(za, zb)
        mag_sd = float(round(v, 6)) if math.isfinite(v) else None

    rn_a = fp_a.get("red_nir") or {}
    rn_b = fp_b.get("red_nir") or {}
    angle = None
    if rn_a and rn_b:
        angle = cva_angle_red_nir(
            rn_a.get("red_mean", 0),
            rn_a.get("nir_mean", 0),
            rn_b.get("red_mean", 0),
            rn_b.get("nir_mean", 0),
        )

    Xa = _sample_matrix(fp_a)
    Xb = _sample_matrix(fp_b)
    """
    On the standardised samples, so the kernel's median bandwidth is not set by
    whichever feature happens to carry the largest raw units.
    """
    mmd = {"mmd2": None, "gamma": None, "n_a": 0, "n_b": 0}
    if standardised and Xa.size and Xb.size:
        mmd = mmd_rbf(_standardise(Xa, fp_a), _standardise(Xb, fp_b))

    """
    On the standardised samples too, for the reason the MMD gives.

    Both projections took the raw samples while the MMD above was deliberately
    moved off them, and the argument that moved it applies here unchanged: a
    PCA is euclidean geometry, so its axes are set by whichever feature carries
    the largest raw units. On this model that is the acquisition indices, which
    span 0..21 against reflectances near 0.1 -- so the scatter the panel drew
    separated the two runs mostly by WHEN their scenes were taken. t-SNE
    inherits the same defect through its own distance metric.

    Which space it was done in travels with the result, because a projection
    whose axes carry no units still has a space, and PCA on raw features and
    PCA on standardised ones are two different pictures.
    """
    projection = None
    if Xa.ndim == 2 and Xb.ndim == 2 and Xa.shape[0] > 1 and Xb.shape[0] > 1:
        Pa, Pb = (
            (_standardise(Xa, fp_a), _standardise(Xb, fp_b))
            if standardised
            else (Xa, Xb)
        )
        if include_tsne:
            projection = project_tsne(Pa, Pb) or project_pca(Pa, Pb)
        else:
            projection = project_pca(Pa, Pb)
        if projection is not None:
            projection["space"] = "standardised" if standardised else "raw"

    return {
        "space_a": fp_a.get("space"),
        "space_b": fp_b.get("space"),
        "kl_ndvi": kl_sym,
        "kl_ndvi_a_to_b": float(round(kl_ab, 6)) if math.isfinite(kl_ab) else None,
        "kl_ndvi_b_to_a": float(round(kl_ba, 6)) if math.isfinite(kl_ba) else None,
        "same_space": same_space,
        "standardised": standardised,
        "cva_magnitude": mag,
        "cva_magnitude_sd": mag_sd,
        "cva_angle_red_nir_deg": angle,
        "mmd_rbf": mmd,
        "feature_shift": feature_shift_table(fp_a, fp_b) if standardised else None,
        "ndvi_hist_a": fp_a.get("ndvi_hist"),
        "ndvi_hist_b": fp_b.get("ndvi_hist"),
        "agreement_a": _agreement_block(agreement_a, "A"),
        "agreement_b": _agreement_block(agreement_b, "B"),
        "projection": projection,
    }


#: Keys dropped from a cohort row. The histograms are 32 bins x 3 arrays each
#: and the projection is up to 800 points; over N targets that is most of the
#: payload, and the cohort reading consumes none of it -- it is a scatter of
#: scalars and a table. A reader who wants them opens the pair.
_COHORT_OMIT = ("ndvi_hist_a", "ndvi_hist_b", "projection", "feature_shift")


def compare_cohort(
    source: dict[str, Any],
    targets: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    One source measured against each of N targets.

    WHY THIS IS ONE CALL AND NOT N. The transferability question has a star
    topology: one region the model was fitted on, and every other measured
    against it. For N areas that is N-1 comparisons, and driving them from the
    frontend would spawn N-1 Python processes, each paying the numpy and
    sklearn import before doing arithmetic on 512 rows. The comparison itself
    is cheap; the process is not.

    `compare_fingerprints` is called unchanged, so a cohort row and the pair
    view cannot disagree about a number. What differs is only what is kept --
    see `_COHORT_OMIT`.

    Each row carries its own qualifiers. They are not a footnote here: a target
    whose fingerprint is not in the source's space, or which carries no scaler,
    has a distance in different units from the rest, and averaging or plotting
    it beside them is the unqualified comparison the qualifiers exist to
    prevent. The caller is expected to separate them, and `comparable` says
    which is which so that decision is not a re-derivation.
    """
    source_fp = source.get("fingerprint") or {}
    rows: list[dict[str, Any]] = []
    for target in targets:
        fp = target.get("fingerprint") or {}
        report = compare_fingerprints(
            source_fp,
            fp,
            agreement_a=source.get("agreement"),
            agreement_b=target.get("agreement"),
            include_tsne=False,
        )
        row = {k: v for k, v in report.items() if k not in _COHORT_OMIT}
        row["id"] = target.get("id")
        row["label"] = target.get("label")
        # Both qualifiers, resolved to the one question the caller asks: may
        # this row sit on the same axis as the others?
        row["comparable"] = bool(report["same_space"] and report["standardised"])
        rows.append(row)
    return {
        "source": {
            "id": source.get("id"),
            "label": source.get("label"),
            "space": source_fp.get("space"),
            "agreement": _agreement_block(source.get("agreement"), "source"),
        },
        "targets": rows,
    }
