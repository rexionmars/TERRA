"""
The wavelength of an absorption, where Tetracorder named the mineral that makes it.

Tetracorder answers which reference fits a cell best. Within one mineral class
the position of the diagnostic absorption still moves with composition, and
that movement is the question in two settings common in Brazil:

    fe3    The Fe3+ crystal-field band near 0.9 um sits at shorter wavelengths
           in hematite than in goethite, so its position over cells identified
           as either tracks the hematite:goethite proportion (Cudahy and
           Ramanaidou, 1997, Australian Journal of Earth Sciences 44:411-420):
           the itabirites and canga of the Quadrilatero Ferrifero, and the
           Hm/(Hm+Gt) contrast between red and yellow Latosols.
    aloh   The Al-OH band near 2.2 um of white mica moves from about 2190 to
           2225 nm as Al is replaced by Mg and Fe (Tschermak substitution), a
           vector of hydrothermal alteration (van Ruitenbeek et al., 2006,
           Remote Sensing of Environment 102:211-222).

THE MEASUREMENT: the continuum is the straight line between the highest
reflectance in a left and a right shoulder interval; the reflectance is divided
by it; the lowest channel in the search interval is found; and a quadratic is
fitted by least squares to the channels within a half-width of it, whose
vertex is the position (Rodger et al., 2012, Remote Sensing of Environment
118:273-283). The intervals below are this module's choice, not a published
standard. Where EMIT's deleted channels fall inside the fit, as 932-962 nm
does across the goethite band, the fit spans the gap with the channels on
either side.

WHAT THE NUMBER IS NOT. A fitted position depends on the intervals, the fit
and the spectral sampling, so it is comparable between cells of one map, not
with a laboratory value. The same measurement is therefore made on the
library references the rules carry (reference_positions), and a reading of a
cell's position is a reading against those.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Window:
    key: str
    title: str
    left: tuple[float, float]       # nm; the left shoulder is the maximum here
    right: tuple[float, float]      # nm; the right shoulder is the maximum here
    search: tuple[float, float]     # nm; where the lowest channel is looked for
    half_width: float               # nm either side of it, the quadratic's span
    group: int                      # the Tetracorder group whose answer selects cells
    classes: tuple[str, ...]        # the classes of that answer a position is read for


FE3 = Window('fe3', 'Fe3+ crystal-field band', left=(700.0, 800.0), right=(1170.0, 1300.0),
             search=(800.0, 1000.0), half_width=60.0, group=1, classes=('hematite', 'goethite'))
ALOH = Window('aloh', 'Al-OH band', left=(2110.0, 2150.0), right=(2240.0, 2280.0),
              search=(2170.0, 2235.0), half_width=15.0, group=2,
              classes=('illite_muscovite', 'smectite'))
WINDOWS = (FE3, ALOH)


@dataclass
class Position:
    position: np.ndarray    # nm, NaN where no vertex was found
    depth: np.ndarray       # 1 - continuum-removed reflectance at the vertex


def _shoulder(spectra: np.ndarray, waves: np.ndarray, lo: float, hi: float):
    """Highest reflectance in [lo, hi] per pixel and the wavelength it is at."""
    idx = np.where((waves >= lo) & (waves <= hi))[0]
    vals = spectra[:, idx]
    ok = np.isfinite(vals).any(axis=1)
    pick = np.argmax(np.where(np.isfinite(vals), vals, -np.inf), axis=1)
    level = vals[np.arange(len(vals)), pick]
    return np.where(ok, level, np.nan), np.where(ok, waves[idx][pick], np.nan)


def measure(spectra: np.ndarray, waves_nm: np.ndarray, w: Window) -> Position:
    """
    The fitted band position and depth of window `w` for each spectrum.
    `spectra` is (pixels, channels), NaN where a channel is unusable.
    """
    spectra = np.asarray(spectra, dtype=np.float64)
    p = spectra.shape[0]
    pos = np.full(p, np.nan)
    depth = np.full(p, np.nan)
    if p == 0:
        return Position(pos, depth)
    rl, wl = _shoulder(spectra, waves_nm, *w.left)
    rr, wr = _shoulder(spectra, waves_nm, *w.right)
    span = np.where((rl > 0) & (rr > 0) & (wr > wl), wr - wl, np.nan)
    with np.errstate(invalid='ignore', divide='ignore'):
        slope = (rr - rl) / span
        cont = rl[:, None] + slope[:, None] * (waves_nm[None, :] - wl[:, None])
        cr = spectra / cont
    inside = (waves_nm[None, :] > wl[:, None]) & (waves_nm[None, :] < wr[:, None])
    cr = np.where(inside & np.isfinite(cr), cr, np.nan)

    search = np.where((waves_nm >= w.search[0]) & (waves_nm <= w.search[1]))[0]
    sub = cr[:, search]
    has = np.isfinite(sub).any(axis=1)
    lowest = search[np.argmin(np.where(np.isfinite(sub), sub, np.inf), axis=1)]

    # Pixels sharing a lowest channel share the fit's channels, so the
    # least-squares matrix is built once per lowest channel.
    for ch in np.unique(lowest[has]):
        rows = np.where(has & (lowest == ch))[0]
        near = np.where(np.abs(waves_nm - waves_nm[ch]) <= w.half_width)[0]
        y = cr[np.ix_(rows, near)]
        # A channel missing from every pixel (a deleted channel) is left out of
        # the fit; one missing from some pixels only leaves those unmeasured.
        cols = np.isfinite(y).any(axis=0)
        near, y = near[cols], y[:, cols]
        complete = np.isfinite(y).all(axis=1)
        x = waves_nm[near] - waves_nm[ch]
        if len(near) < 3 or not ((x < 0).any() and (x > 0).any()):
            continue
        design = np.stack([x * x, x, np.ones_like(x)], axis=1)
        good = rows[complete]
        if len(good) == 0:
            continue
        coef, *_ = np.linalg.lstsq(design, y[complete].T, rcond=None)
        a, b, c = coef
        with np.errstate(invalid='ignore', divide='ignore'):
            vx = -b / (2.0 * a)
            vy = c - b * b / (4.0 * a)
        # A depth at floating-point resolution is a fit to rounding, not a band:
        # a straight spectrum divided by its own continuum is 1 to within 1e-15,
        # and whether that noise has a minimum inside the window depends on the
        # BLAS. 1e-9 is far below any depth a reflectance can carry.
        ok = (a > 0) & (np.abs(vx) <= w.half_width) & np.isfinite(vx) & (np.abs(1.0 - vy) > 1e-9)
        pos[good] = np.where(ok, waves_nm[ch] + vx, np.nan)
        depth[good] = np.where(ok, 1.0 - vy, np.nan)
    return Position(pos, depth)


def reference_positions(rules, spectra_by_record: dict[str, np.ndarray],
                        waves_nm: np.ndarray, w: Window) -> list[dict]:
    """
    The same measurement on every library reference of the window's classes,
    in its group: per class, how many references gave a position and their
    range. The yardstick a cell's position is read against.
    """
    out = []
    for klass in w.classes:
        found = []
        for e in rules.entries:
            if e.klass != klass or e.group != w.group:
                continue
            spec = spectra_by_record.get(e.library)
            if spec is None:
                continue
            m = measure(spec[None, :], waves_nm, w)
            if np.isfinite(m.position[0]):
                found.append(float(m.position[0]))
        if found:
            out.append({'class': klass, 'references': len(found),
                        'min_nm': round(min(found), 1), 'max_nm': round(max(found), 1),
                        'median_nm': round(float(np.median(found)), 1)})
    return out
