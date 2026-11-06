"""
What each kind of composition draws, from arrays already read.

Kept apart from the action, which reads scenes and writes files, so every
kind can be tested on arrays built in the test. Each returns the RGBA to draw,
the figures for the response, and -- where the colours stand for a physical
quantity -- the values themselves, which are what the GeoTIFF export carries.

The legend of a kind whose scale is set here (a change, a canopy variable, the
components, the clusters) is in the response as `legend`, so the client draws
the legend from the same numbers that drew the raster. The indices and the band
composites keep theirs in the client's catalogue, which a test compares with
composite.COMPOSITE_INDICES.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from terra.imagery import composite as comp
from terra.scenes import decompose, sl2p


@dataclass
class View:
    rgba: np.ndarray
    meta: dict[str, Any] = field(default_factory=dict)
    # The quantity itself, NaN where there is none, for the GeoTIFF export.
    values: np.ndarray | None = None


def _pct(part: float, whole: float) -> str:
    return f'{100.0 * part / whole:.0f} %' if whole else '0 %'


def valid(*arrays: np.ndarray) -> np.ndarray:
    """Cells where every array holds a reflectance: finite and above zero."""
    out = np.ones(arrays[0].shape, dtype=bool)
    for a in arrays:
        out &= np.isfinite(a) & (a > 0)
    return out


def water(green: np.ndarray, swir1: np.ndarray) -> np.ndarray:
    """Open water by MNDWI above zero (Xu 2006, the threshold the paper gives)."""
    return comp.normalized_difference(green, swir1) > 0


def index_values(spec: comp.CompositeIndex, arrays: list[np.ndarray], mask: np.ndarray,
                 green: np.ndarray | None = None, swir1: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """
    An index and the cells it is read over.

    For an index read over water only, the cells are narrowed to MNDWI above
    zero; `green` and `swir1` are then required.
    """
    mask = mask & valid(*arrays)
    if spec.water_only:
        if green is None or swir1 is None:
            raise ValueError('a water index needs B03 and B11 to find the water')
        mask = mask & valid(green, swir1) & water(green, swir1)
    return spec.formula(*arrays), mask


def pca_view(stack: np.ndarray, mask: np.ndarray, bands: tuple[str, ...], lo: float, hi: float) -> View:
    """The first three principal components as red, green and blue."""
    pcs = decompose.principal_components(stack, mask, n=3)
    rgba = comp.rgb_to_rgba(
        np.nan_to_num(pcs.scores[0]), np.nan_to_num(pcs.scores[1]), np.nan_to_num(pcs.scores[2]),
        mask, lo, hi,
    )
    rows = []
    for j, channel in enumerate(('R', 'G', 'B')):
        strongest = np.argsort(-np.abs(pcs.loadings[:, j]))[:2]
        rows.append({
            'label': f'{channel}, component {j + 1}',
            'value': f'{100 * pcs.explained[j]:.0f} % of the variance; mostly '
                     + ', '.join(bands[i] for i in strongest),
        })
    return View(rgba=rgba, meta={
        'explained': [round(float(e), 4) for e in pcs.explained],
        'legend': {
            'kind': 'stats',
            'subject': 'Principal components',
            'rows': rows,
            'note': 'Directions of variance in this scene. Their colours mean nothing outside it.',
        },
    })


def cluster_view(stack: np.ndarray, mask: np.ndarray, k: int, cell_ha: float) -> View:
    """k groups of similar reflectance, in the categorical colours, largest first."""
    labels = decompose.kmeans(stack, mask, k)
    colors = comp.CATEGORICAL[:k]
    rgba = comp.classes_to_rgba(labels, mask, colors)
    counts = np.bincount(labels[mask], minlength=k)
    total = int(counts.sum())
    return View(rgba=rgba, meta={
        'clusters': k,
        'legend': {
            'kind': 'classes',
            'subject': f'{k} clusters',
            'entries': [
                {
                    'name': f'Cluster {i + 1}',
                    'color': colors[i],
                    'pct': round(100.0 * counts[i] / total, 1) if total else 0.0,
                    'area_ha': round(float(counts[i]) * cell_ha, 1),
                }
                for i in range(k)
            ],
            'note': 'Groups of similar reflectance, not classes. Their numbers change from scene to scene.',
        },
    })


def change_scale(diff: np.ndarray, mask: np.ndarray) -> float:
    """
    The half-width of the change scale: the 98th percentile of the absolute
    change over the area, so one cell's extreme does not wash out the rest.
    """
    if not mask.any():
        return 1.0
    s = float(np.percentile(np.abs(diff[mask]), 98))
    return s if s > 0 else 1.0


def change_view(before: np.ndarray, after: np.ndarray, mask: np.ndarray, label: str,
                before_date: str, after_date: str) -> View:
    """
    After minus before, on a diverging ramp centred on no change.

    Centred on zero and symmetric, so white is no change in every raster and a
    fall and a rise of one size are one depth of colour.
    """
    diff = (after - before).astype(np.float32)
    s = change_scale(diff, mask)
    t = 0.5 + 0.5 * np.clip(diff / s, -1.0, 1.0)
    rgba = comp.scaled_to_rgba(t, mask, 'rdbu')
    values = np.where(mask, diff, np.nan).astype(np.float32)
    mean = float(diff[mask].mean()) if mask.any() else float('nan')
    return View(rgba=rgba, values=values, meta={
        'scale': round(s, 4),
        'legend': {
            'kind': 'stats',
            'subject': f'Change in {label}, {before_date} to {after_date}',
            'palette': 'rdbu',
            'low': f'-{s:.2f}, fell',
            'high': f'+{s:.2f}, rose',
            'rows': [
                {'label': 'Mean change', 'value': f'{mean:+.3f}'},
                {'label': 'Scale, 98th percentile', 'value': f'±{s:.3f}'},
            ],
            'note': (
                'Where the index moved, not why: a harvest, a later sowing, haze, or cloud '
                'in either scene all move it. Neither scene is cloud-masked.'
            ),
        },
    })


@dataclass(frozen=True)
class Variable:
    subject: str
    unit: str
    # From SNAP's unit to the one shown: LAI_Cab ug/cm2 to g/m2 (x 0.01),
    # LAI_Cw g/cm2 to kg/m2 (x 10).
    factor: float
    digits: int


VARIABLES = {
    'lai': Variable('Leaf area index', 'm²/m²', 1.0, 2),
    'fapar': Variable('Fraction of absorbed PAR', '', 1.0, 2),
    'fcover': Variable('Fraction of green cover', '', 1.0, 2),
    'ccc': Variable('Canopy chlorophyll content', 'g/m²', 0.01, 2),
    'cwc': Variable('Canopy water content', 'kg/m²', 10.0, 2),
}


def _network(sensor: str, platform: str) -> str:
    """Which network ran and, where it differs, which satellite took the scene: short, for the map's card."""
    code = sl2p.platform_code(platform) if platform else sensor
    return f'SL2P {sensor}' if code == sensor else f'SL2P {sensor} on {code}'


def biophysical_view(reflectance: np.ndarray, mask: np.ndarray, cosines: np.ndarray,
                     sensor: str, variable: str, sensor_note: str | None,
                     platform: str = '') -> View:
    """
    One SL2P variable over the area, on a fixed scale from zero to the
    network's published maximum, so one colour is one value in every scene.

    `reflectance` is (8, rows, cols) in sl2p.BANDS order.
    """
    var = VARIABLES[variable]
    net = sl2p.load(sensor, variable)
    cells = mask & np.all(np.isfinite(reflectance), axis=0)
    rows_in = reflectance[:, cells].T.astype(np.float64)
    est = sl2p.estimate(net, rows_in, np.broadcast_to(cosines, (len(rows_in), 3)))
    values = np.full(mask.shape, np.nan, dtype=np.float32)
    values[cells] = est.values * var.factor
    top = net.out_max * var.factor
    shown = np.isfinite(values)
    rgba = comp.scaled_to_rgba(np.clip(np.nan_to_num(values) / top, 0.0, 1.0), shown, 'viridis')
    n = int(cells.sum())
    unit = f' {var.unit}' if var.unit else ''
    mean = float(np.nanmean(values[shown])) if shown.any() else float('nan')
    rows = [
        {'label': 'Mean', 'value': f'{mean:.{var.digits}f}{unit}'},
        {'label': "Outside the training set's band ranges", 'value': _pct(float(est.out_of_bounds.sum()), n)},
        {'label': "Outside SNAP's definition domain", 'value': _pct(float(est.out_of_domain.sum()), n)},
        {'label': 'No value, beyond the range', 'value': _pct(float((est.too_low | est.too_high).sum()), n)},
        {'label': 'Network', 'value': _network(sensor, platform)},
    ]
    note = (
        "Estimated by ESA's SL2P network, trained on simulated canopies and not validated "
        'against field measurements here. Cloud is not masked: under cloud the network '
        'answers about the cloud.'
    )
    if sensor_note:
        note = f'{note} {sensor_note}.'
    return View(rgba=rgba, values=values, meta={
        'variable': variable,
        'legend': {
            'kind': 'stats',
            'subject': f'{var.subject}{f" ({var.unit})" if var.unit else ""}',
            'palette': 'viridis',
            'low': '0',
            'high': f'{top:g}{unit}',
            'rows': rows,
            'note': note,
        },
    })
