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


def test_mmd_linear_zero_when_same_mean():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(40, 5))
    Y = X + rng.normal(scale=0.01, size=X.shape)
    # Same distribution → small MMD; identical means → ~0
    assert ds.mmd_linear(X, X) < 1e-9


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


def test_compare_fingerprints_report():
    rng = np.random.default_rng(1)
    Xa = rng.normal(loc=0.0, size=(80, 20))
    Xb = rng.normal(loc=1.0, size=(80, 20))
    fp_a = ds.build_fingerprint(Xa, sample_n=40, rng=rng)
    fp_b = ds.build_fingerprint(Xb, sample_n=40, rng=rng)
    report = ds.compare_fingerprints(fp_a, fp_b)
    assert report["kl_ndvi"] is not None
    assert report["cva_magnitude"] is not None and report["cva_magnitude"] > 0
    assert report["mmd_linear"] is not None and report["mmd_linear"] > 0
    assert report["projection"] is not None
    assert report["projection"]["method"] == "pca"
    assert len(report["projection"]["points"]) > 0


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
