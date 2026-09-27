"""
Fuzzy c-means on standardised seasons, and the two indices MZA reads to choose
the number of zones. No imagery here: an array of cells by seasons in,
memberships and figures out.

THE DISTANCE IS DIAGONAL, NOT MAHALANOBIS. MZA offers Euclidean, diagonal and
Mahalanobis distances. With the seasons standardised, the diagonal distance is
the Euclidean distance between them, and each season weighs the same. The
Mahalanobis distance was tried first and dropped: its covariance is the whole
field's, and where every season shows the same pattern -- which is what a zone
is -- that pattern is the covariance's leading direction, which whitening
scales down to the weight of the noise across the others. Three NDVI levels
repeated over four seasons (tests/test_zones.py) came out with two of the
three levels mixed under it, and apart under the diagonal distance.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# As in MZA (Fridgen et al., 2004): the fuzziness exponent, the iteration cap
# and the change in memberships below which the iteration stops.
FUZZINESS = 1.30
MAX_ITER = 300
TOLERANCE = 1e-4
# Cells the centres are fitted on at most; every cell is then assigned to the
# fitted centres. Fixed seed, so a run repeated gives the same zones.
FIT_CELLS = 200_000
SEED = 0


def standardise(layers: np.ndarray) -> np.ndarray:
    """Each column to zero mean and unit variance over its finite rows."""
    layers = np.asarray(layers, dtype=np.float64)
    mean = np.nanmean(layers, axis=0)
    sd = np.nanstd(layers, axis=0)
    sd = np.where(sd > 0, sd, 1.0)
    return (layers - mean) / sd


def _initial_centres(z: np.ndarray, c: int) -> np.ndarray:
    """
    Centres spread along the data's first principal axis, at the quantiles
    (i + 0.5) / c: deterministic, and apart from each other from the start.
    """
    centred = z - z.mean(axis=0)
    _, _, vt = np.linalg.svd(centred, full_matrices=False)
    score = centred @ vt[0]
    order = np.argsort(score)
    n = len(z)
    return np.stack([z[order[min(n - 1, int((i + 0.5) / c * n))]] for i in range(c)])


def memberships(z: np.ndarray, centres: np.ndarray, m: float = FUZZINESS) -> np.ndarray:
    """u[k, i]: the membership of cell k in zone i, rows summing to one."""
    d2 = ((z[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2)
    d2 = np.maximum(d2, 1e-12)
    # u_ik = 1 / sum_j (d_ik / d_jk)^(2/(m-1)), written on squared distances,
    # each row divided by its smallest distance first. The exponent is 3.33 at
    # m = 1.30, and a small distance raised to minus that overflows: float32
    # layers from the imagery turned every membership into inf / inf = NaN.
    # Relative to the row's minimum, every term is at most one.
    p = 1.0 / (m - 1.0)
    inv = (d2 / d2.min(axis=1, keepdims=True)) ** (-p)
    return inv / inv.sum(axis=1, keepdims=True)


@dataclass
class Partition:
    centres: np.ndarray  # in standardised units
    u: np.ndarray  # memberships of the cells the partition was computed on
    iterations: int
    fpi: float
    nce: float


def fpi(u: np.ndarray) -> float:
    """
    Fuzziness performance index (Odeh et al., 1992): 0 for a crisp partition,
    1 for one where every cell belongs equally to every zone.

    Defined as 1 - F', F' = (cF - 1) / (c - 1) the normalised partition
    coefficient and F = sum u^2 / n Bezdek's partition coefficient; that is
    c / (c - 1) * (1 - F).
    """
    n, c = u.shape
    return float((c / (c - 1.0)) * (1.0 - (u**2).sum() / n))


def nce(u: np.ndarray) -> float:
    """
    Normalised classification entropy as MZA computes it: the partition
    entropy -(1/n) sum u log u, scaled by n / (n - c). Natural logarithm.
    """
    n, c = u.shape
    with np.errstate(divide='ignore', invalid='ignore'):
        h = -np.nansum(np.where(u > 0, u * np.log(u), 0.0)) / n
    return float(h * n / (n - c))


def fuzzy_c_means(z: np.ndarray, c: int, m: float = FUZZINESS) -> Partition:
    """
    Bezdek's fuzzy c-means on standardised data `z` (cells by seasons).

    The centres are fitted on at most FIT_CELLS cells drawn with a fixed seed;
    the memberships returned, and the indices, are those of every cell against
    the fitted centres.
    """
    rng = np.random.default_rng(SEED)
    fit = z if len(z) <= FIT_CELLS else z[rng.choice(len(z), FIT_CELLS, replace=False)]
    centres = _initial_centres(fit, c)
    u = memberships(fit, centres, m)
    iterations = 0
    while iterations < MAX_ITER:
        iterations += 1
        w = u**m
        centres = (w.T @ fit) / w.sum(axis=0)[:, None]
        nu = memberships(fit, centres, m)
        change = float(np.abs(nu - u).max())
        u = nu
        if change < TOLERANCE:
            break
    u_all = memberships(z, centres, m)
    return Partition(centres=centres, u=u_all, iterations=iterations, fpi=fpi(u_all), nce=nce(u_all))


def suggest(partitions: dict[int, Partition]) -> int:
    """
    The number of zones that ranks best on FPI and NCE together; the fewer
    zones on a tie, since a zone the machinery cannot tell apart is one the
    applicator cannot either.
    """
    ks = sorted(partitions)
    rank_f = {k: r for r, k in enumerate(sorted(ks, key=lambda k: partitions[k].fpi))}
    rank_n = {k: r for r, k in enumerate(sorted(ks, key=lambda k: partitions[k].nce))}
    return min(ks, key=lambda k: (rank_f[k] + rank_n[k], k))
