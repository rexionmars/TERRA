"""Unit tests for domain-shift distance metrics (offline)."""

from __future__ import annotations

import numpy as np

from terra.landcover import domain_shift as ds


def test_kl_identical_is_near_zero():
    p = np.array([0.25, 0.25, 0.25, 0.25])
    assert ds.kl_divergence(p, p) < 1e-9


def test_kl_diverges_when_mass_moves():
    p = np.array([0.7, 0.1, 0.1, 0.1])
    q = np.array([0.1, 0.1, 0.1, 0.7])
    assert ds.kl_divergence(p, q) > 0.5


def test_cva_magnitude_and_angle():
    a = np.array([0.0, 0.0, 1.0])
    b = np.array([3.0, 4.0, 1.0])
    assert abs(ds.cva_magnitude(a, b) - 5.0) < 1e-9
    ang = ds.cva_angle_red_nir(0.1, 0.4, 0.2, 0.4)  # +red only
    assert ang is not None
    assert abs(ang - 0.0) < 1.0


def test_mmd_rbf_near_zero_for_two_draws_from_one_distribution():
    """
    Two independent samples of the same law, which is the null the statistic
    is defined against. Not a sample against itself: the cross term would then
    include the self-similarity diagonal while the two within-sample terms
    exclude theirs, and the unbiased estimator returns a structurally negative
    value that says nothing about the distributions.
    """
    rng = np.random.default_rng(0)
    X = rng.normal(size=(60, 5))
    Y = rng.normal(size=(60, 5))
    out = ds.mmd_rbf(X, Y)
    assert out["mmd2"] is not None
    assert abs(out["mmd2"]) < 5e-2
    # The bandwidth travels with the estimate: MMD is not comparable across
    # gammas, so a report that dropped it would not be readable.
    assert out["gamma"] is not None and out["gamma"] > 0
    assert out["n_a"] == 60 and out["n_b"] == 60


def test_mmd_rbf_separates_shifted_samples():
    rng = np.random.default_rng(0)
    X = rng.normal(loc=0.0, size=(60, 5))
    Y = rng.normal(loc=3.0, size=(60, 5))
    Z = rng.normal(loc=0.0, size=(60, 5))
    apart = ds.mmd_rbf(X, Y)["mmd2"]
    same = ds.mmd_rbf(X, Z)["mmd2"]
    assert apart > same
    # A three-sigma separation in every dimension is far from the null, not
    # merely above it.
    assert apart > 0.5


def test_f1_from_confusion_perfect():
    M = [[10, 0], [0, 10]]
    out = ds.f1_from_confusion(M)
    assert out["macro_f1"] == 1.0
    assert all(c["f1"] == 1.0 for c in out["per_class"])


def test_f1_from_confusion_imbalanced():
    # High commission on class 0
    M = [[5, 5], [0, 10]]
    out = ds.f1_from_confusion(M)
    assert out["macro_f1"] is not None
    assert 0 < out["macro_f1"] < 1


def test_build_fingerprint_spectral():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(200, 80))
    fp = ds.build_fingerprint(X, sample_n=64, rng=rng)
    assert fp is not None
    assert fp["space"] == "spectral_rf"
    assert fp["n_features"] == 80
    assert len(fp["mean"]) == 80
    assert len(fp["sample"]) == 64
    assert len(fp["ndvi_hist"]["probs"]) == ds.NDVI_BINS


def test_build_fingerprint_ndvi_only():
    v = np.linspace(0.1, 0.8, 100)
    fp = ds.build_fingerprint(None, ndvi_values=v, sample_n=32)
    assert fp is not None
    assert fp["space"] == "ndvi_only"
    assert fp["n_features"] == 1


def test_compare_refuses_to_standardise_without_a_scaler():
    """
    A fingerprint built with no scaler cannot be expressed in training units,
    and the comparison says so instead of producing a number in mixed ones.
    """
    rng = np.random.default_rng(1)
    Xa = rng.normal(loc=0.0, size=(80, 20))
    Xb = rng.normal(loc=1.0, size=(80, 20))
    fp_a = ds.build_fingerprint(Xa, sample_n=40, rng=rng)
    fp_b = ds.build_fingerprint(Xb, sample_n=40, rng=rng)
    report = ds.compare_fingerprints(fp_a, fp_b)
    assert report["same_space"] is True
    assert report["standardised"] is False
    # Raw distances still travel; the standardised ones do not exist.
    assert report["cva_magnitude"] is not None and report["cva_magnitude"] > 0
    assert report["cva_magnitude_sd"] is None
    assert report["mmd_rbf"]["mmd2"] is None
    assert report["feature_shift"] is None
    assert report["kl_ndvi"] is not None
    assert report["projection"] is not None
    assert report["projection"]["method"] == "pca"
    assert len(report["projection"]["points"]) > 0


def test_compare_standardises_when_both_carry_a_scaler():
    rng = np.random.default_rng(1)
    d = 20
    Xa = rng.normal(loc=0.0, size=(80, d))
    Xb = rng.normal(loc=1.0, size=(80, d))
    # The scaler that ships with the model: fitted on the source domain, so
    # B's displacement is expressed in the units the forest was fitted in.
    mean = Xa.mean(axis=0)
    scale = Xa.std(axis=0)
    names = [f"f{i}" for i in range(d)]
    imp = np.full(d, 1.0 / d)
    kw = dict(
        sample_n=40,
        rng=rng,
        scaler_mean=mean,
        scaler_scale=scale,
        feature_names=names,
        feature_importances=imp,
    )
    fp_a = ds.build_fingerprint(Xa, **kw)
    fp_b = ds.build_fingerprint(Xb, **kw)
    assert fp_a["z_mean"] is not None and fp_b["z_mean"] is not None

    report = ds.compare_fingerprints(fp_a, fp_b)
    assert report["standardised"] is True
    assert report["cva_magnitude_sd"] is not None
    assert report["mmd_rbf"]["mmd2"] is not None
    # A shift of one raw unit against a unit-variance scaler is about one
    # training standard deviation per feature.
    assert report["cva_magnitude_sd"] > 0

    shift = report["feature_shift"]
    assert shift is not None and len(shift) > 0
    row = shift[0]
    assert set(row) >= {"feature", "z_a", "z_b", "gap_sd", "weighted"}
    assert row["feature"] in names
    # Sorted by displacement, largest first.
    gaps = [abs(r["gap_sd"]) for r in shift]
    assert gaps == sorted(gaps, reverse=True)


def test_compare_refuses_across_feature_spaces():
    rng = np.random.default_rng(3)
    fp_spectral = ds.build_fingerprint(rng.normal(size=(60, 20)), sample_n=20, rng=rng)
    fp_ndvi = ds.build_fingerprint(None, ndvi_values=np.linspace(0.1, 0.8, 60))
    report = ds.compare_fingerprints(fp_spectral, fp_ndvi)
    assert report["same_space"] is False
    assert report["standardised"] is False


def test_compare_with_agreement_f1():
    rng = np.random.default_rng(2)
    X = rng.normal(size=(50, 10))
    fp = ds.build_fingerprint(X, sample_n=20, rng=rng)
    agr = {
        "n_reference_cells": 100,
        "n_outside_legend": 10,
        "overall_pct": 80.0,
        "quantity_disagreement_pct": 5.0,
        "allocation_disagreement_pct": 15.0,
        "matrix": [[40, 5], [5, 40]],
    }
    report = ds.compare_fingerprints(fp, fp, agreement_a=agr)
    assert report["agreement_a"]["macro_f1"] is not None
    assert report["agreement_a"]["outside_legend_pct"] == 9.09 or abs(
        report["agreement_a"]["outside_legend_pct"] - 100.0 * 10 / 110
    ) < 0.1


def test_project_pca_labels():
    A = np.zeros((10, 4))
    B = np.ones((10, 4))
    out = ds.project_pca(A, B, max_points=20)
    domains = {p["domain"] for p in out["points"]}
    assert domains == {"A", "B"}


def _scaled_pair(d=20, n=80, loc_b=1.0, seed=11, d_b=None):
    """Two fingerprints sharing the scaler fitted on A, as a real pair does."""
    rng = np.random.default_rng(seed)
    Xa = rng.normal(loc=0.0, size=(n, d))
    Xb = rng.normal(loc=loc_b, size=(n, d_b or d))
    mean = Xa.mean(axis=0)
    scale = Xa.std(axis=0)

    def kw(width):
        return dict(
            sample_n=40,
            rng=np.random.default_rng(seed),
            scaler_mean=mean[:width] if width <= d else np.r_[mean, np.ones(width - d)],
            scaler_scale=scale[:width] if width <= d else np.r_[scale, np.ones(width - d)],
            feature_names=[f"f{i}" for i in range(width)],
            feature_importances=np.full(width, 1.0 / width),
        )

    return (
        ds.build_fingerprint(Xa, **kw(d)),
        ds.build_fingerprint(Xb, **kw(d_b or d)),
    )


def test_same_space_is_not_satisfied_by_the_name_alone():
    """
    Two `spectral_rf` fingerprints of different width are different spaces.

    A model refitted over more dates produces a wider fingerprint under the
    same name, and the change vector then truncated to the shorter of the two
    in silence -- the failure the module documents for spectral-against-NDVI,
    one level up and harder to see because both sides answer to the same name.
    """
    fp_a, fp_b = _scaled_pair(d=20, d_b=24)
    assert fp_a["space"] == fp_b["space"] == "spectral_rf"
    report = ds.compare_fingerprints(fp_a, fp_b)
    assert report["same_space"] is False
    assert report["standardised"] is False
    assert report["cva_magnitude_sd"] is None
    assert report["feature_shift"] is None


def test_projection_follows_the_space_the_distances_use():
    """
    The projection is standardised whenever the distances are.

    It used to run on the raw samples while the MMD beside it ran on the
    standardised ones. A PCA is euclidean geometry, so its axes were set by
    whichever feature carried the largest raw units -- on this model the
    acquisition indices, which span 0..21 against reflectances near 0.1. The
    two clouds then separated by when the scenes were taken, which reads
    exactly like a domain difference and is not one.
    """
    fp_a, fp_b = _scaled_pair(seed=12)
    report = ds.compare_fingerprints(fp_a, fp_b)
    assert report["standardised"] is True
    assert report["projection"]["space"] == "standardised"

    # And it says so honestly when it could not standardise.
    for fp in (fp_a, fp_b):
        fp["z_mean"] = None
        fp["z_var"] = None
    raw = ds.compare_fingerprints(fp_a, fp_b)
    assert raw["standardised"] is False
    assert raw["projection"]["space"] == "raw"


def test_feature_shift_is_capped_at_twelve_rows():
    """
    The table is a top-N by displacement, and the N was never pinned. A cap
    that silently grew would turn a readable panel into the whole feature set.
    """
    fp_a, fp_b = _scaled_pair(d=40, seed=13)
    report = ds.compare_fingerprints(fp_a, fp_b)
    assert len(report["feature_shift"]) == 12


def test_per_class_f1_carries_the_class_it_is_about():
    """
    `matrix_classes` travelled in the agreement payload all along and was not
    read, so each per-class row came back identified by a bare axis position.
    A per-class figure whose class is unknown is not a per-class figure.
    """
    fp_a, fp_b = _scaled_pair(seed=14)
    classes = [3, 21, 39]
    # Rows predicted, columns reference. Class 3 is over-called: its row sums
    # to 10 and its column to 13, so precision and recall have to differ.
    matrix = [[8, 1, 1], [3, 9, 1], [2, 0, 8]]
    report = ds.compare_fingerprints(
        fp_a,
        fp_b,
        agreement_a={
            "matrix": matrix,
            "matrix_classes": classes,
            "n_reference_cells": 30,
            "n_outside_legend": 0,
        },
    )
    per = report["agreement_a"]["per_class_f1"]
    assert [r["class_id"] for r in per] == classes
    assert all(r["f1"] is not None for r in per)
    # Precision and recall differ per class here, which is what distinguishes
    # a class the model over-calls from one it misses.
    assert per[0]["precision"] != per[0]["recall"]


def test_per_class_f1_leaves_the_class_null_without_the_axis_order():
    """Absent `matrix_classes` gives an unlabelled row, not a wrong label."""
    fp_a, fp_b = _scaled_pair(seed=15)
    report = ds.compare_fingerprints(
        fp_a,
        fp_b,
        agreement_a={"matrix": [[5, 1], [1, 5]], "n_reference_cells": 12},
    )
    per = report["agreement_a"]["per_class_f1"]
    assert [r["class_id"] for r in per] == [None, None]
    assert [r["index"] for r in per] == [0, 1]
