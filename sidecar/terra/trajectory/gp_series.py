"""
The gp_series model: a field's NDVI trajectory with its 95 % interval, from the
Sentinel-2 series TERRA reads over a polygon.

The series is one acquisition per date: the median over the polygon's clear
pixels of B02, B03, B04, B08 and of NDVI and EVI per pixel. The six medians are
standardised and projected on three whitened principal components. Each
component is fitted with a Gaussian process whose covariance is a damped
seasonal oscillator plus a local smooth term, with Student-t noise handled by
reweighting, and the oscillator's period is scaled per field by the multiplier
of highest evidence. The NDVI is rebuilt from the three components, and its
interval is mean +/- t_nu * sqrt(a * latent + b * noise), with (a, b, nu) for
the field's region, or the global scale outside the regions it was fitted on.

Only numpy and scipy are used. The parameters come from one JSON file, which
holds numbers only, so loading it runs no code.

Ported from terra_signal_spectrum/models/gp_series/gp_series.py (gp_series
0.1.0), where it was checked against the code its numbers come from. The
arithmetic is that file's, line for line; only annotations were added here.
tests/test_trajectory.py holds a field it was run on there and what it
returned, and a change that moves any NDVI or bound by more than 1e-9 fails it.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import ArrayLike
from scipy import stats

CHANNELS = ('B02', 'B03', 'B04', 'B08', 'NDVI', 'EVI')
NDVI = CHANNELS.index('NDVI')
LEVEL = 0.95
# Below this many clean acquisitions a trajectory says more about the kernel than the field.
MIN_ACQUISITIONS = 3
# The period multiplier is chosen by evidence only from this many clean acquisitions on.
MIN_FOR_MULTIPLIER = 8
REWEIGHTING = 5
JITTER = 1e-6
KERNEL_KEYS = ('oscillator', 'local', 'noise', 'period', 'oscillator_length', 'local_length')

Kernel = dict[str, float]


@dataclass(frozen=True)
class Scale:
    """The interval's scale: latent weight a, noise weight b, Student-t degrees of freedom (inf: Gaussian)."""
    a: float
    b: float
    nu: float

    def quantile(self) -> float:
        tail = (1 + LEVEL) / 2
        return float(stats.norm.ppf(tail) if np.isinf(self.nu) else stats.t.ppf(tail, self.nu))


@dataclass(frozen=True)
class Parameters:
    min_clear_fraction: float
    mean: np.ndarray        # (6,)
    scale: np.ndarray       # (6,)
    basis: np.ndarray       # (6, 3)
    pinv: np.ndarray        # (3, 6)
    kernels: tuple[Kernel, ...]
    multipliers: np.ndarray
    nu_fit: float
    clean_window: float
    clean_mad: float
    ndvi_residual: float
    ndvi_by_region: dict[str, Scale]
    ndvi_global: Scale


@dataclass(frozen=True)
class Trajectory:
    dates: np.ndarray           # datetime64[D], daily
    ndvi: np.ndarray
    lower: np.ndarray
    upper: np.ndarray
    observed_dates: np.ndarray  # the acquisitions used, after one per date
    observed_ndvi: np.ndarray
    kept: np.ndarray            # False where the acquisition was cleaned out
    multiplier: float
    scale_name: str             # the region whose scale was used, or 'global'


def _scale(value: Any, where: str) -> Scale:
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f'{where} is not [a, b, nu]')
    a, b, nu = value
    nu = np.inf if nu is None else float(nu)
    if not (float(a) > 0 and float(b) >= 0 and nu > 0):
        raise ValueError(f'{where} needs a > 0, b >= 0 and nu > 0 (or null)')
    return Scale(float(a), float(b), nu)


def load_parameters(raw: dict[str, Any]) -> Parameters:
    """Read and check the parameters JSON, as parsed."""
    if raw.get('channels') != list(CHANNELS):
        raise ValueError(f'the parameters are for channels {raw.get("channels")}, not {list(CHANNELS)}')
    pca = raw['pca']
    mean, scale = np.asarray(pca['mean'], float), np.asarray(pca['scale'], float)
    basis, pinv = np.asarray(pca['basis'], float), np.asarray(pca['pinv'], float)
    if mean.shape != (6,) or scale.shape != (6,) or basis.shape != (6, 3) or pinv.shape != (3, 6):
        raise ValueError('the PCA is not 6 channels by 3 components')
    if not (np.all(np.isfinite(basis)) and np.all(scale > 0)):
        raise ValueError('the PCA has a non-finite basis or a scale that is not positive')
    kernels = tuple(raw['kernels'])
    if len(kernels) != 3 or any(set(KERNEL_KEYS) - set(k) for k in kernels):
        raise ValueError(f'the kernels are not three objects with {", ".join(KERNEL_KEYS)}')
    for k in kernels:
        if not (k['noise'] > 0 and k['period'] > 0 and k['local_length'] > 0 and k['oscillator_length'] > 0
                and k['local'] >= 0 and k['oscillator'] >= 0):
            raise ValueError('a kernel has a variance below zero or a length that is not positive')
    ndvi = raw['interval_ndvi']
    return Parameters(
        min_clear_fraction=float(raw['min_clear_fraction']),
        mean=mean, scale=scale, basis=basis, pinv=pinv, kernels=kernels,
        multipliers=np.asarray(raw['period_multipliers'], float),
        nu_fit=float(raw['student_t_nu_fit']),
        clean_window=float(raw['clean']['window_days']), clean_mad=float(raw['clean']['mad_multiplier']),
        ndvi_residual=float(ndvi['residual_variance']),
        ndvi_by_region={r: _scale(v, f'interval_ndvi.by_region.{r}') for r, v in ndvi['by_region'].items()},
        ndvi_global=_scale(ndvi['global'], 'interval_ndvi.global'),
    )


def acquisitions(
    dates: ArrayLike, clear_fraction: ArrayLike, values: ArrayLike, min_clear: float
) -> tuple[np.ndarray, np.ndarray]:
    """
    One acquisition per date: those with at least min_clear of the polygon clear and every
    channel finite, and of two on one date (two orbits) the one with more of it clear.
    """
    dates = np.asarray(dates, dtype='datetime64[D]')
    clear = np.asarray(clear_fraction, float)
    values = np.asarray(values, float).reshape(len(dates), len(CHANNELS))
    usable = (clear >= min_clear) & np.isfinite(values).all(1)
    best: dict[Any, tuple[Any, np.ndarray]] = {}
    for d, c, v in zip(dates[usable], clear[usable], values[usable], strict=True):
        if d not in best or c > best[d][0]:
            best[d] = (c, v)
    order = sorted(best)
    return np.array(order, dtype='datetime64[D]'), np.array([best[d][1] for d in order]).reshape(-1, len(CHANNELS))


def clean(time: np.ndarray, y: np.ndarray, window: float, mad: float) -> np.ndarray:
    """Keep the observations within mad robust deviations of the median of their +/- window days."""
    keep = np.ones(len(time), bool)
    for d in range(y.shape[1]):
        residual = np.zeros(len(time))
        for i, day in enumerate(time):
            near = np.abs(time - day) <= window
            if near.sum() >= 3:
                residual[i] = y[i, d] - np.median(y[near, d])
        spread = 1.4826 * np.median(np.abs(residual)) + 1e-9
        keep &= np.abs(residual) <= mad * spread
    return keep


def _sq(lag: np.ndarray, length: float) -> np.ndarray:
    return np.exp(-(lag**2) / (2 * length**2))


def covariance(a: np.ndarray, b: np.ndarray, k: Kernel, multiplier: float = 1.0) -> np.ndarray:
    lag = a[:, None] - b[None]
    out = k['local'] * _sq(lag, k['local_length'])
    if k['oscillator'] > 0:
        out = out + k['oscillator'] * _sq(lag, k['oscillator_length']) * np.cos(
            2 * np.pi * lag / (k['period'] * multiplier))
    return out


def _weights(
    time: np.ndarray, z: np.ndarray, k: Kernel, nu: float, multiplier: float = 1.0
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Student-t reweighting; the weights after the last update, and those used in the last solve."""
    c = covariance(time, time, k, multiplier)
    w = np.ones(len(time))
    used, alpha = w, None
    for _ in range(REWEIGHTING):
        used = w
        alpha = np.linalg.solve(c + np.diag(k['noise'] / w) + JITTER * np.eye(len(time)), z)
        residual = z - c @ alpha
        w = (nu + 1) / (nu + residual**2 / k['noise'])
    # REWEIGHTING is positive, so the loop has run and alpha is set.
    assert alpha is not None
    return alpha, used, w


def _evidence(time: np.ndarray, z: np.ndarray, k: Kernel, multiplier: float, w: np.ndarray) -> float:
    c = covariance(time, time, k, multiplier) + np.diag(k['noise'] / w) + JITTER * np.eye(len(time))
    _, logdet = np.linalg.slogdet(c)
    return -0.5 * (z @ np.linalg.solve(c, z) + logdet)


def posterior(
    time: np.ndarray,
    y: np.ndarray,
    kernels: tuple[Kernel, ...],
    at: np.ndarray,
    multipliers: np.ndarray,
    nu: float,
) -> tuple[np.ndarray, np.ndarray, float]:
    """Posterior mean and latent variance of each component at the dates `at`, and the period multiplier."""
    center = np.median(y, 0)
    z = y - center
    multiplier = 1.0
    if len(time) >= MIN_FOR_MULTIPLIER:
        base = [_weights(time, z[:, d], k, nu)[2] for d, k in enumerate(kernels)]
        scores = [sum(_evidence(time, z[:, d], k, m, base[d]) for d, k in enumerate(kernels)) for m in multipliers]
        multiplier = float(multipliers[int(np.argmax(scores))])
    mean = np.empty((len(at), len(kernels)))
    var = np.empty((len(at), len(kernels)))
    for d, k in enumerate(kernels):
        alpha, used, _ = _weights(time, z[:, d], k, nu, multiplier)
        a = covariance(time, time, k, multiplier) + np.diag(k['noise'] / used) + JITTER * np.eye(len(time))
        cross = covariance(at, time, k, multiplier)
        mean[:, d] = cross @ alpha + center[d]
        prior = k['local'] + (k['oscillator'] if k['oscillator'] > 0 else 0.0)
        var[:, d] = np.maximum(prior - np.einsum('ij,ji->i', cross, np.linalg.solve(a, cross.T)), 0.0)
    return mean, var, multiplier


def trajectory(
    p: Parameters,
    dates: ArrayLike,
    clear_fraction: ArrayLike,
    values: ArrayLike,
    region: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> Trajectory:
    """
    The daily NDVI trajectory and its 95 % interval, from start to end (by default, from the
    first to the last clean acquisition). values is one row per acquisition, in CHANNELS order,
    in reflectance (BOA offset removed, divided by 10 000) for the bands.
    """
    when, raw = acquisitions(dates, clear_fraction, values, p.min_clear_fraction)
    if len(when) < MIN_ACQUISITIONS:
        raise ValueError(f'{len(when)} usable acquisitions; the model needs at least {MIN_ACQUISITIONS}')
    origin = when[0]
    days = (when - origin).astype(float)
    y = ((raw - p.mean) / p.scale) @ p.basis
    kept = clean(days, y, p.clean_window, p.clean_mad)
    if kept.sum() < MIN_ACQUISITIONS:
        raise ValueError(f'{int(kept.sum())} acquisitions left after cleaning; the model needs {MIN_ACQUISITIONS}')
    first = when[kept][0] if start is None else np.datetime64(start, 'D')
    last = when[kept][-1] if end is None else np.datetime64(end, 'D')
    grid = np.arange(first, last + np.timedelta64(1, 'D'), dtype='datetime64[D]')
    at = (grid - origin).astype(float)
    mean, var, multiplier = posterior(days[kept], y[kept], p.kernels, at, p.multipliers, p.nu_fit)

    w = p.scale[NDVI] * p.pinv[:, NDVI]
    noise = np.array([k['noise'] for k in p.kernels])
    ndvi = p.mean[NDVI] + mean @ w
    latent = var @ (w**2)
    noise_ndvi = float(noise @ (w**2)) + p.ndvi_residual
    name = region if region in p.ndvi_by_region else 'global'
    s = p.ndvi_by_region.get(region, p.ndvi_global) if region else p.ndvi_global
    half = s.quantile() * np.sqrt(s.a * latent + s.b * noise_ndvi)
    return Trajectory(dates=grid, ndvi=ndvi, lower=ndvi - half, upper=ndvi + half,
                      observed_dates=when, observed_ndvi=raw[:, NDVI], kept=kept,
                      multiplier=multiplier, scale_name=name)
