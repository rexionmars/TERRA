"""Unit tests for domain-shift distance metrics (offline)."""

from __future__ import annotations

import numpy as np

import domain_shift as ds


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
