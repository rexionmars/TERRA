"""
Tetracorder's analysis stage, vectorised over pixels.

Clark et al. (2003, JGR 108(E12) 5131, eqs. 1-10) define the algorithm; the
Fortran in the Tetracorder repository fixes what the paper leaves open, and
where the two could be read differently this module follows the Fortran. Each
function names the routine it reproduces:

    feature_fit      bandmp.r / bandmpcv.r   one feature, continuum and least squares
    evaluate_entry   tp1mat.r                features, thresholds, NOT features
    classify         tp1all.r                one winner per group

The setup stage -- channels, reference continuum removal, area weights -- was
done once by sidecar/tools/build_tetracorder_rules.py and is read from
data/tetracorder_emit.json. Nothing here reads a request or a file other than
that one, so a test can hand it a spectrum and check a number.

A deleted channel is NaN. Tetracorder marks one with -1.23e34 and skips it in
every sum; the nan-aware reductions below skip it the same way, per pixel, so a
channel lost in one pixel does not remove it from the others.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

import numpy as np

DATA_DIR = Path(__file__).parent / 'data'
RULES_FILE = DATA_DIR / 'tetracorder_emit.json'

TINY = 1e-20  # bandmp.r's guard against a zero divisor, 0.1e-20


@dataclass(frozen=True)
class Feature:
    importance: str          # O optional, W weak, D diagnostic, M must have
    enabled: bool
    weight: float            # normalised area, 0 for weak and disabled features
    ftype: int = 1           # 1 absorption, -1 emission
    left: np.ndarray = field(default_factory=lambda: np.zeros(0, int))
    right: np.ndarray = field(default_factory=lambda: np.zeros(0, int))
    band: np.ndarray = field(default_factory=lambda: np.zeros(0, int))
    reference: np.ndarray = field(default_factory=lambda: np.zeros(0))
    minch: int = 0
    curved: bool = False
    outer_left: np.ndarray = field(default_factory=lambda: np.zeros(0, int))
    outer_right: np.ndarray = field(default_factory=lambda: np.zeros(0, int))
    spline_band: np.ndarray | None = None   # (n_band, 4): continuum at band channels
    spline_min: np.ndarray | None = None    # (4,): continuum at the minimum channel
    ct: tuple[float, float] | None = None
    lct: tuple[float, float] | None = None
    rct: tuple[float, float] | None = None
    lct_rct: tuple[float, float] | None = None
    rct_lct: tuple[float, float] | None = None
    rcbblc_gt: tuple[float, float] | None = None
    rcbblc_lt: tuple[float, float] | None = None
    lcbbrc_gt: tuple[float, float] | None = None
    lcbbrc_lt: tuple[float, float] | None = None
    rbd: tuple[float, float] | None = None


@dataclass(frozen=True)
class Not:
    entry: int
    feature: int
    depth: float
    relative_to: int | None
    fit: float


@dataclass(frozen=True)
class Entry:
    index: int
    ident: str
    title: str
    group: int
    klass: str
    components: tuple[tuple[str, float | None], ...]
    features: tuple[Feature, ...]
    thresholds: dict[str, tuple[float, float]]
    fratio: tuple[tuple[int, int, tuple[float, float, float, float]], ...]
    nots: tuple[Not, ...]
    competes_in: tuple[int, ...]


@dataclass(frozen=True)
class Rules:
    wavelengths: np.ndarray
    fwhm: np.ndarray
    deleted: np.ndarray                 # bool per channel
    entries: tuple[Entry, ...]
    reported_groups: tuple[int, ...]
    classes: tuple[str, ...]
    source: dict
    # The dataset's valid reflectance range; a value outside it is deleted in
    # that pixel and channel only (cubecorder.r, threshholdmin/threshholdmax).
    data_min: float = -np.inf
    data_max: float = np.inf

    def group_members(self, group: int) -> list[int]:
        """
        The entries that compete in `group`, in the order tp1all.r visits them:
        the group's own entries in file order, then group 0's.
        """
        own = [e.index for e in self.entries if e.group == group and group in e.competes_in]
        shared = [e.index for e in self.entries if e.group == 0 and group in e.competes_in]
        return own + shared


def natural_spline_weights(knots: np.ndarray, at: np.ndarray) -> np.ndarray:
    """
    The (len(at), 4) matrix taking the four continuum levels to the natural
    cubic spline through them, evaluated at `at`.

    bandmpcv.r fits IMSL icsicu with bpar = 0, a natural spline. The knots are
    fixed per feature, so the spline is linear in the four levels and its
    evaluation reduces to one matrix per feature, applied to every pixel.
    """
    from scipy.interpolate import CubicSpline

    out = np.empty((len(at), len(knots)))
    for j in range(len(knots)):
        unit = np.zeros(len(knots))
        unit[j] = 1.0
        out[:, j] = CubicSpline(knots, unit, bc_type='natural')(at)
    return out


def _pair(v) -> tuple[float, float] | None:
    if v is None:
        return None
    return (float(v[0]), float(v[1] if len(v) > 1 else v[0]))


def _limits(v, lo_default: float, hi_default: float) -> tuple[float, float] | None:
    """`ct n [m]`: a minimum and, when given, a maximum. getifeat.r."""
    if v is None:
        return None
    return (float(v[0]), float(v[1]) if len(v) > 1 else hi_default)


def load_rules(path: Path = RULES_FILE) -> Rules:
    raw = json.loads(Path(path).read_text())
    waves = np.asarray(raw['wavelengths_um'], dtype=np.float64)
    deleted = np.zeros(len(waves), dtype=bool)
    deleted[raw['deleted_channels']] = True
    entries = []
    for i, e in enumerate(raw['entries']):
        feats = []
        for f in e['features']:
            if not f['enabled']:
                feats.append(Feature(importance=f['importance'], enabled=False, weight=0.0))
                continue
            il, ir = f['band']
            band = np.arange(il, ir + 1)
            ref = np.array([np.nan if v is None else v for v in f['reference']], dtype=np.float64)
            kw: dict = {}
            if f['curved']:
                knots = np.asarray(f['curve_waves'], dtype=np.float64)
                kw = {
                    'curved': True,
                    'outer_left': np.asarray(f['outer_left'], int),
                    'outer_right': np.asarray(f['outer_right'], int),
                    'spline_band': natural_spline_weights(knots, waves[band]),
                    'spline_min': natural_spline_weights(knots, waves[[f['minch']]])[0],
                }
            feats.append(Feature(
                importance=f['importance'], enabled=True, weight=float(f['weight']),
                ftype=int(f['type']),
                left=np.asarray(f['left'], int), right=np.asarray(f['right'], int),
                band=band, reference=ref, minch=int(f['minch']),
                ct=_limits(f['ct'], 0.0, np.inf), lct=_limits(f['lct'], 0.0, np.inf),
                rct=_limits(f['rct'], 0.0, np.inf),
                lct_rct=_pair(f['lct_rct']), rct_lct=_pair(f['rct_lct']),
                rcbblc_gt=_pair(f['rcbblc_gt']), rcbblc_lt=_pair(f['rcbblc_lt']),
                lcbbrc_gt=_pair(f['lcbbrc_gt']), lcbbrc_lt=_pair(f['lcbbrc_lt']),
                rbd=_pair(f['rbd']),
                **kw,
            ))
        entries.append(Entry(
            index=i, ident=e['id'], title=e['title'], group=int(e['group']),
            klass=e['class'],
            components=tuple((c[0], c[1]) for c in e['components']),
            features=tuple(feats),
            thresholds={k: (float(v[0]), float(v[1])) for k, v in e['thresholds'].items()},
            fratio=tuple((r['a'], r['b'], tuple(r['range'])) for r in e['fratio']),
            nots=tuple(Not(n['entry'], n['feature'], n['depth'], n['relative_to'], n['fit'])
                       for n in e['nots']),
            competes_in=tuple(e['competes_in']),
        ))
    return Rules(
        wavelengths=waves,
        fwhm=np.asarray(raw['fwhm_um'], dtype=np.float64),
        deleted=deleted,
        entries=tuple(entries),
        reported_groups=tuple(raw['reported_groups']),
        classes=tuple(raw['classes']),
        source=raw['source'],
        data_min=_bound(raw.get('data_range', [None, None])[0], -np.inf),
        data_max=_bound(raw.get('data_range', [None, None])[1], np.inf),
    )


def _bound(v, default: float) -> float:
    return default if v is None else float(v)


@cache
def default_rules() -> Rules:
    return load_rules()


# One feature ------------------------------------------------------------------


@dataclass
class FeatureResult:
    fit: np.ndarray       # correlation coefficient F, eq. 7
    depth: np.ndarray     # band depth D of the fitted reference, eq. 2
    valid: np.ndarray     # False where bandmp.r returns its deleted-point sentinel
    conref: np.ndarray    # continuum at the band minimum
    conrefl: np.ndarray   # left continuum level
    conrefr: np.ndarray   # right continuum level


def _interval_mean(spectra: np.ndarray, idx: np.ndarray, waves: np.ndarray):
    """Mean level and mean wavelength of the valid channels in one interval."""
    vals = spectra[:, idx]
    ok = np.isfinite(vals)
    n = ok.sum(axis=1)
    with np.errstate(invalid='ignore', divide='ignore'):
        level = np.where(ok, vals, 0.0).sum(axis=1) / n
        wave = (ok * waves[idx]).sum(axis=1) / n
    return level, wave, n


def feature_fit(spectra: np.ndarray, waves: np.ndarray, f: Feature) -> FeatureResult:
    """
    Continuum removal and least-squares shape fit of one feature. bandmp.r
    (linear continuum) and bandmpcv.r (natural spline through four levels).

    The reference, continuum-removed at setup, is scaled by a + b*Lc to best
    match the observed continuum-removed spectrum Oc over the band channels
    (eq. 4-6). The fit is F = sqrt(|b * b'|), the correlation coefficient of the
    two (eq. 7); the depth is that of the scaled reference at the reference's
    band minimum, 1 - (Lc[min] + k)/(1 + k) with k = (1 - b)/b.
    """
    p = spectra.shape[0]
    avlc, avwlc, nl = _interval_mean(spectra, f.left, waves)
    avrc, avwrc, nr = _interval_mean(spectra, f.right, waves)
    valid = (nl > 0) & (nr > 0) & (avlc >= TINY) & (avrc >= TINY)

    if f.curved:
        assert f.spline_band is not None and f.spline_min is not None
        cvlc, _, nol = _interval_mean(spectra, f.outer_left, waves)
        cvrc, _, nor = _interval_mean(spectra, f.outer_right, waves)
        valid &= (nol > 0) & (nor > 0) & (cvlc >= TINY) & (cvrc >= TINY)
        levels = np.stack([cvlc, avlc, avrc, cvrc], axis=1)
        levels = np.where(np.isfinite(levels), levels, 0.0)
        cont = levels @ f.spline_band.T
        conref = levels @ f.spline_min
    else:
        span = avwrc - avwlc
        valid &= np.abs(span) >= TINY
        with np.errstate(invalid='ignore', divide='ignore'):
            a = (avrc - avlc) / span
        b0 = avrc - a * avwrc
        cont = a[:, None] * waves[f.band][None, :] + b0[:, None]
        conref = a * waves[f.minch] + b0

    obs = spectra[:, f.band]
    ref = f.reference[None, :]
    ok = np.isfinite(obs) & np.isfinite(ref) & (np.abs(cont) > TINY) & valid[:, None]
    with np.errstate(invalid='ignore', divide='ignore'):
        oc = np.where(ok, obs / np.where(ok, cont, 1.0), 0.0)
    lc = np.where(ok, ref, 0.0)
    n = ok.sum(axis=1).astype(np.float64)
    valid &= n > 0
    n_safe = np.where(n > 0, n, 1.0)

    suml = lc.sum(axis=1)
    sumll = (lc * lc).sum(axis=1)
    sumo = oc.sum(axis=1)
    sumol = (oc * lc).sum(axis=1)
    sumoo = (oc * oc).sum(axis=1)
    top = sumol - sumo * suml / n_safe
    bottom = sumll - suml * suml / n_safe
    with np.errstate(invalid='ignore', divide='ignore'):
        slope = np.where(np.abs(bottom) < TINY, 0.0, top / bottom)
    valid &= np.abs(slope) >= TINY
    slope_safe = np.where(valid, slope, 1.0)
    k = (1.0 - slope_safe) / slope_safe
    k1 = k + 1.0
    valid &= np.abs(k1) >= TINY
    k1_safe = np.where(valid, k1, 1.0)

    # Lc at the reference's minimum (or maximum, for an emission feature).
    lc_min = f.reference[f.minch - f.band[0]]
    depth = 1.0 - (lc_min + k) / k1_safe

    botm2 = sumoo - sumo * sumo / n_safe
    with np.errstate(invalid='ignore', divide='ignore'):
        bprime = np.where(np.abs(botm2) < TINY, 0.0, top / botm2)
    fit = np.sqrt(np.abs(slope_safe * bprime))

    # tp1mat.r treats a fit outside (0, 1.1) or a NaN as no answer.
    valid &= np.isfinite(fit) & (fit > 0.0) & (fit < 1.1) & np.isfinite(depth)
    zero = np.zeros(p)
    return FeatureResult(
        fit=np.where(valid, fit, zero),
        depth=np.where(valid, depth, zero),
        valid=valid,
        conref=np.where(valid, conref, zero),
        conrefl=np.where(valid, avlc, zero),
        conrefr=np.where(valid, avrc, zero),
    )


def _above(x: np.ndarray, n1: float, n2: float) -> np.ndarray:
    """
    Factor for `KEY> n1 n2` (tp1mat.r): 0 below n1, rising linearly to 1 at
    n2, 1 above. With n2 <= n1 the ramp is never entered: a hard cut at n1.
    """
    factor = np.where(x < n1, 0.0, 1.0)
    if n2 > n1:
        ramp = (x >= n1) & (x < n2)
        factor = np.where(ramp, (x - n1) / (n2 - n1), factor)
    return factor


def _below(x: np.ndarray, n1: float, n2: float) -> np.ndarray:
    """
    Factor for `KEY< n1 n2` as tp1mat.r evaluates it: 0 above n1, and between
    n2 and n1 the ramp (x - n1)/(n2 - n1). The first number is the rejection
    limit, so `rcbblc< 0.9 0.8` ramps from 1 at 0.8 to 0 at 0.9, and
    `rcbblc< 0.3 0.4`, whose ramp lies above its rejection limit, is a hard
    cut at 0.3.
    """
    factor = np.where(x > n1, 0.0, 1.0)
    if n1 > n2:
        ramp = (x <= n1) & (x > n2)
        factor = np.where(ramp, (x - n1) / (n2 - n1), factor)
    return factor


def feature_constraints(r: FeatureResult, f: Feature) -> tuple[np.ndarray, np.ndarray]:
    """
    The per-feature constraints of tp1mat.r, in its order: continuum levels,
    continuum slopes, band shoulders, reflectance times band depth.

    Order matters and is kept. Each fuzzy factor scales the depth before the
    next constraint reads it, and the shoulder and r*bd tests are computed
    from that scaled depth, as they are in the Fortran.
    """
    fit, depth = r.fit.copy(), r.depth.copy()
    keep = r.valid & (np.abs(depth) >= 1e-7)
    for lim, level in ((f.ct, r.conref), (f.lct, r.conrefl), (f.rct, r.conrefr)):
        if lim is not None:
            keep &= (level >= lim[0]) & (level <= lim[1])
    fit = np.where(keep, fit, 0.0)
    depth = np.where(keep, depth, 0.0)

    def apply(factor: np.ndarray) -> None:
        nonlocal fit, depth
        fit = fit * factor
        depth = depth * factor

    def floor(v: np.ndarray) -> np.ndarray:
        return np.where(np.abs(v) < 1e-7, 1e-7, v)

    with np.errstate(invalid='ignore', divide='ignore'):
        if f.lct_rct is not None:
            apply(_above(np.minimum(r.conrefl, 1e19) / np.maximum(r.conrefr, 1e-7), *f.lct_rct))
        if f.rct_lct is not None:
            apply(_above(np.minimum(r.conrefr, 1e19) / np.maximum(r.conrefl, 1e-7), *f.rct_lct))
        for lim, numerator_right, op in (
            (f.rcbblc_gt, True, _above), (f.rcbblc_lt, True, _below),
            (f.lcbbrc_gt, False, _above), (f.lcbbrc_lt, False, _below),
        ):
            if lim is None:
                continue
            bottom = r.conref * (1.0 - depth)
            right_up, left_up = r.conrefr - bottom, r.conrefl - bottom
            if numerator_right:
                x = np.minimum(right_up, 1e19) / floor(left_up)
            else:
                x = np.minimum(left_up, 1e19) / floor(right_up)
            apply(op(x, *lim))
        if f.rbd is not None:
            rbd = np.where(depth / f.ftype <= 1e-6, 0.0, r.conref * depth)
            # tp1mat.r takes the lower limit of this ramp from the lct/rct
            # option (zcontlgtr(1,...)), not from r*bd's own first number
            # (zrtimesbd(1,...)). Reproduced, so that a pixel scores here as it
            # scores in Tetracorder and in EMIT L2B. Without an lct/rct option
            # the lower limit is 0; with one, typically 0.9, no r*bd value
            # reaches it and the feature never passes.
            lo = f.lct_rct[0] if f.lct_rct is not None else 0.0
            apply(_above(rbd, lo, f.rbd[1]))

    return fit, depth


# One entry --------------------------------------------------------------------


@dataclass
class EntryResult:
    fit: np.ndarray              # weighted fit Fw, eq. 8, after thresholds
    depth: np.ndarray            # weighted depth Dw
    fd: np.ndarray               # weighted fit * depth FDw
    feature_fit: list[np.ndarray]
    feature_depth: list[np.ndarray]


def _ramp(x: np.ndarray, lim: tuple[float, float]) -> tuple[np.ndarray, np.ndarray]:
    """(reject, factor) for a `KEY> z1 z2` threshold. tp1mat.r."""
    z1, z2 = lim
    reject = x < z1
    factor = np.ones_like(x)
    if z2 > z1:
        fuzzy = (~reject) & (x < z2)
        factor = np.where(fuzzy, (x - z1) / (z2 - z1), 1.0)
    return reject, factor


def evaluate_entry(spectra: np.ndarray, rules: Rules, e: Entry,
                   done: list[EntryResult | None]) -> EntryResult:
    """
    Weighted fit, depth and fit*depth of one reference, with every constraint
    of its command-file entry applied. tp1mat.r.

    `done` holds the entries already evaluated for these pixels; a NOT feature
    reads the per-feature fit and depth of an earlier entry from it.
    """
    p = spectra.shape[0]
    zfit = [np.zeros(p) for _ in e.features]
    zdepth = [np.zeros(p) for _ in e.features]
    alive = np.ones(p, dtype=bool)
    sumf, sumd, sumfd = np.zeros(p), np.zeros(p), np.zeros(p)

    for k, f in enumerate(e.features):
        if f.enabled:
            r = feature_fit(spectra, rules.wavelengths, f)
            fit, depth = feature_constraints(r, f)
            fit = np.where(alive, fit, 0.0)
            depth = np.where(alive, depth, 0.0)
            absent = depth / f.ftype <= 1e-6
            if f.importance != 'O':
                # A required feature missing: this feature and every later one
                # are zeroed and the material is not identified.
                lost = alive & absent
                for j in range(k, len(e.features)):
                    zfit[j] = np.where(lost, 0.0, zfit[j])
                    zdepth[j] = np.where(lost, 0.0, zdepth[j])
                alive &= ~absent
            present = (~absent).astype(np.float64)
        else:
            fit = depth = np.zeros(p)
            present = np.zeros(p)
            if f.importance in ('W', 'M'):
                alive[:] = False
        if f.importance != 'W':
            sumf += fit * present * f.weight
            xbd = depth * f.weight * (f.ftype if f.enabled else 0)
            sumd += xbd
            sumfd += xbd * fit
        zfit[k] = np.where(alive, fit, zfit[k])
        zdepth[k] = np.where(alive, depth, zdepth[k])

    # Where a required feature was missing, the features before it keep their
    # values: tp1mat.r zeroes only from the failing feature onward, and a NOT
    # feature of a later entry may read one of the earlier ones.
    ofit = np.where(alive, sumf, 0.0)
    odepth = np.where(alive, sumd, 0.0)
    ofd = np.where(alive, sumfd, 0.0)

    t = e.thresholds

    def all_three(x, key):
        nonlocal ofit, odepth, ofd
        if key not in t:
            return
        reject, factor = _ramp(x, t[key])
        ofit = np.where(reject, 0.0, ofit * factor)
        odepth = np.where(reject, 0.0, odepth * factor)
        ofd = np.where(reject, 0.0, ofd * factor)

    all_three(ofit, 'fitall')
    all_three(np.abs(odepth), 'depthall')
    all_three(ofd, 'fdall')

    for a, b, (r1, r2, r3, r4) in e.fratio:
        on = ofit > 0.0
        den = np.where(np.abs(zdepth[b]) < 1e-14, 1e-14, zdepth[b])
        x = zdepth[a] / den
        low_reject, low_factor = _ramp(x, (r1, r2))
        high_reject = x > r4
        high_factor = np.where((x > r3) & (r4 > r3), (x - r3) / (r4 - r3), 1.0)
        # tp1mat.r's upper ramp scales by (x - r3)/(r4 - r3) as written.
        factor = np.where(on, low_factor * high_factor, 1.0)
        reject = on & (low_reject | high_reject)
        ofit = np.where(reject, 0.0, ofit * factor)
        odepth = np.where(reject, 0.0, odepth * factor)
        ofd = np.where(reject, 0.0, ofd * factor)

    def one(target, x, key):
        if key not in t:
            return target
        reject, factor = _ramp(x, t[key])
        return np.where(reject, 0.0, target * factor)

    ofit = one(ofit, ofit, 'fit')
    odepth = one(odepth, np.abs(odepth), 'depth')
    odepth = one(odepth, ofit, 'depth_fit')
    ofd = one(ofd, ofd, 'fd')
    ofd = one(ofd, ofit, 'fd_fit')
    ofd = one(ofd, odepth, 'fd_depth')

    if e.nots:
        on = ofit > 0.0
        for n in e.nots:
            other = done[n.entry]
            if other is None:
                continue
            nd = np.abs(other.feature_depth[n.feature])
            if n.relative_to is not None:
                own = np.abs(zdepth[n.relative_to])
                nd = nd / np.where(own > 1e-13, own, 1e-13)
            found = on & (nd > n.depth) & (other.feature_fit[n.feature] > n.fit)
            ofit = np.where(found, 0.0, ofit)
            odepth = np.where(found, 0.0, odepth)
            ofd = np.where(found, 0.0, ofd)

    return EntryResult(ofit, odepth, ofd, zfit, zdepth)


# All entries, one winner per group ----------------------------------------------


@dataclass
class GroupResult:
    entry: np.ndarray   # index into rules.entries, -1 where nothing was identified
    fit: np.ndarray
    depth: np.ndarray
    fd: np.ndarray


def classify(spectra: np.ndarray, rules: Rules | None = None,
             chunk: int = 16384) -> dict[int, GroupResult]:
    """
    The best-fitting reference of each reported group, per pixel. tp1all.r.

    `spectra` is (pixels, channels) reflectance on the rules' wavelength grid,
    NaN where a channel is unusable. The winner is the entry with the highest
    weighted fit, the first in visiting order on a tie; a pixel where that fit
    or its depth is zero has no answer (Clark et al., 2003, section 2.8).
    """
    rules = rules or default_rules()
    spectra = np.asarray(spectra, dtype=np.float64)
    if spectra.ndim != 2 or spectra.shape[1] != len(rules.wavelengths):
        raise ValueError(
            f'spectra must be (pixels, {len(rules.wavelengths)}), got {spectra.shape}'
        )
    spectra = spectra.copy()
    spectra[:, rules.deleted] = np.nan
    with np.errstate(invalid='ignore'):
        spectra[(spectra < rules.data_min) | (spectra > rules.data_max)] = np.nan
    p = spectra.shape[0]
    out = {g: GroupResult(np.full(p, -1, dtype=np.int32), np.zeros(p, np.float32),
                          np.zeros(p, np.float32), np.zeros(p, np.float32))
           for g in rules.reported_groups}
    members = {g: rules.group_members(g) for g in rules.reported_groups}

    for start in range(0, p, chunk):
        sl = slice(start, min(start + chunk, p))
        block = spectra[sl]
        done: list[EntryResult | None] = [None] * len(rules.entries)
        for e in rules.entries:
            done[e.index] = evaluate_entry(block, rules, e, done)
        for g, idx in members.items():
            fits = np.stack([done[i].fit for i in idx], axis=1)  # type: ignore[union-attr]
            best = np.argmax(fits, axis=1)
            chosen = np.asarray(idx)[best]
            rows = np.arange(block.shape[0])
            bfit = fits[rows, best]
            bdepth = np.stack([done[i].depth for i in idx], axis=1)[rows, best]  # type: ignore[union-attr]
            bfd = np.stack([done[i].fd for i in idx], axis=1)[rows, best]  # type: ignore[union-attr]
            found = (bfit > 0.0) & (bdepth > 0.0)
            out[g].entry[sl] = np.where(found, chosen, -1)
            out[g].fit[sl] = np.where(found, bfit, 0.0)
            out[g].depth[sl] = np.where(found, bdepth, 0.0)
            out[g].fd[sl] = np.where(found, bfd, 0.0)
    return out
