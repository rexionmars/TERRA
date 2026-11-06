"""
A scene's bands decomposed without any labels: principal components, and
clusters of similar reflectance.

Both answer "what in this scene differs from what", and neither says what the
differences are. A component is a direction of variance in this scene alone, so
its colours mean nothing outside it; a cluster is a group of cells whose bands
are alike, not a class, and its number changes from scene to scene.

The bands are standardised first (zero mean, unit variance over the area's
valid cells), so a band is weighed by how it varies rather than by its units:
short-wave infrared reflectance spans more than blue does, and without this it
would set the first component and most of the clusters by itself.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# How many cells the cluster centres are fitted on. Assigning every cell to its
# nearest centre is cheap; fitting is iterative, and a sample this size fixes
# the centres of a few groups to well within a reflectance unit's noise.
FIT_SAMPLE = 20_000
MAX_ITERATIONS = 100
# Cells assigned to centres per block, to bound memory over a large area.
ASSIGN_BLOCK = 500_000
SEED = 0


def standardise(stack: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """
    The valid cells of a (bands, rows, cols) stack, standardised per band.

    Returns (cells, bands). A band with no variance over the area becomes
    zeros, since it can separate nothing.
    """
    x = stack[:, mask].T.astype(np.float64)
    mean = x.mean(axis=0)
    std = x.std(axis=0)
    std[std == 0] = 1.0
    return (x - mean) / std


@dataclass
class Components:
    """The first components of a stack, with the share of variance each carries."""

    scores: np.ndarray  # (n, rows, cols), NaN outside the mask
    explained: np.ndarray  # (n,), fractions of the total variance
    loadings: np.ndarray  # (bands, n)


def principal_components(stack: np.ndarray, mask: np.ndarray, n: int = 3) -> Components:
    """
    Principal components of the standardised bands (Hotelling 1933, Journal of
    Educational Psychology 24, 417-441), from the eigenvectors of their
    correlation matrix.

    An eigenvector's sign is arbitrary, so each is turned to make its largest
    loading positive: the same scene then gives the same colours every time.
    """
    z = standardise(stack, mask)
    if z.shape[0] < 2:
        raise ValueError('fewer than two valid cells; there is no variance to decompose')
    corr = np.cov(z, rowvar=False)
    values, vectors = np.linalg.eigh(corr)
    order = np.argsort(values)[::-1]
    values, vectors = values[order], vectors[:, order]
    for j in range(vectors.shape[1]):
        if vectors[np.argmax(np.abs(vectors[:, j])), j] < 0:
            vectors[:, j] = -vectors[:, j]
    n = min(n, vectors.shape[1])
    scores = np.full((n, *mask.shape), np.nan, dtype=np.float32)
    projected = z @ vectors[:, :n]
    for j in range(n):
        scores[j][mask] = projected[:, j]
    total = float(values.clip(min=0).sum())
    explained = values[:n].clip(min=0) / total if total > 0 else np.zeros(n)
    return Components(scores=scores, explained=explained, loadings=vectors[:, :n])


def _nearest(z: np.ndarray, centres: np.ndarray) -> np.ndarray:
    """The index of each row's nearest centre, in blocks."""
    out = np.empty(z.shape[0], dtype=np.int32)
    for at in range(0, z.shape[0], ASSIGN_BLOCK):
        block = z[at : at + ASSIGN_BLOCK]
        d = ((block[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2)
        out[at : at + ASSIGN_BLOCK] = d.argmin(axis=1)
    return out


def _plus_plus(z: np.ndarray, k: int, rng: np.random.Generator) -> np.ndarray:
    """k-means++ seeding (Arthur and Vassilvitskii 2007, SODA '07, 1027-1035)."""
    centres = [z[rng.integers(len(z))]]
    for _ in range(1, k):
        d = np.min(((z[:, None, :] - np.array(centres)[None, :, :]) ** 2).sum(axis=2), axis=1)
        total = d.sum()
        pick = rng.integers(len(z)) if total == 0 else rng.choice(len(z), p=d / total)
        centres.append(z[pick])
    return np.array(centres)


def kmeans(stack: np.ndarray, mask: np.ndarray, k: int) -> np.ndarray:
    """
    Cluster labels for the valid cells of a stack, -1 elsewhere.

    Lloyd's algorithm (Lloyd 1982, IEEE Transactions on Information Theory 28,
    129-137) on the standardised bands, seeded by k-means++ with a fixed seed,
    fitted on a sample and then applied to every cell. Labels are numbered by
    size, the largest group first, so the numbering does not depend on where
    the seeding happened to start.
    """
    z = standardise(stack, mask)
    if len(z) < k:
        raise ValueError(f'{len(z)} valid cells cannot form {k} clusters')
    rng = np.random.default_rng(SEED)
    sample = z if len(z) <= FIT_SAMPLE else z[rng.choice(len(z), FIT_SAMPLE, replace=False)]
    centres = _plus_plus(sample, k, rng)
    labels = _nearest(sample, centres)
    for _ in range(MAX_ITERATIONS):
        moved = np.array(
            [sample[labels == c].mean(axis=0) if np.any(labels == c) else centres[c] for c in range(k)]
        )
        relabelled = _nearest(sample, moved)
        centres = moved
        if np.array_equal(relabelled, labels):
            break
        labels = relabelled
    every = _nearest(z, centres)
    by_size = np.argsort(-np.bincount(every, minlength=k), kind='stable')
    rank = np.empty(k, dtype=np.int32)
    rank[by_size] = np.arange(k, dtype=np.int32)
    out = np.full(mask.shape, -1, dtype=np.int32)
    out[mask] = rank[every]
    return out
