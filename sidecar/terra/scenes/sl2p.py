"""
Canopy variables from Sentinel-2 reflectance by ESA's SL2P networks.

The algorithm is the one in ESA's SNAP biophysical processor, described in
Weiss and Baret (2016), "S2ToolBox Level 2 products: LAI, FAPAR, FCOVER",
version 1.1: for each variable, a network with one hidden layer of five tansig
neurons and a linear output, trained on PROSAIL simulations, over eight bands
and three angle cosines. The weights in data/sl2p are SNAP's own, version 3_0
(see data/sl2p/README.md), and tests/test_sl2p.py checks this implementation
against SNAP's published test cases.

The variables, in SNAP's names and units:

  LAI     leaf area index, m2 of leaf per m2 of ground
  FAPAR   fraction of absorbed photosynthetically active radiation
  FCOVER  fraction of the ground covered by green vegetation
  LAI_Cab canopy chlorophyll content, LAI times leaf chlorophyll in ug/cm2
  LAI_Cw  canopy water content, LAI times leaf water in g/cm2

The last two are a leaf quantity times LAI, so their units are the leaf's per
area of ground. SNAP labels them "g/cm2" and "g/m2"; the values its own test
cases give (a canopy of LAI 5.3 with LAI_Cab 294) are the ug/cm2 of PROSAIL's
leaf chlorophyll times LAI, and that is the unit used here.

As in SNAP, an input outside the network's definition domain is flagged and
still computed, and an output within the tolerance of a bound is set to the
bound. An output beyond the bound by more than the tolerance is no value: the
Java operator keeps it with a flag, but SNAP's published test cases give NaN
there, and the test cases are what this implementation is checked against.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cache
from pathlib import Path

import numpy as np

DATA = Path(__file__).resolve().parent / 'data' / 'sl2p'

# The network's inputs, in its order: eight bands, then cos(view zenith),
# cos(sun zenith) and cos(sun azimuth - view azimuth).
BANDS = ('B03', 'B04', 'B05', 'B06', 'B07', 'B8A', 'B11', 'B12')

# SNAP's file names for each variable, by the name a request sends.
VARIABLES = {
    'lai': 'LAI',
    'fapar': 'FAPAR',
    'fcover': 'FCOVER',
    'ccc': 'LAI_Cab',
    'cwc': 'LAI_Cw',
}


@dataclass(frozen=True)
class Network:
    normalisation: np.ndarray  # (11, 2): min and max of each input
    w1: np.ndarray  # (5, 11)
    b1: np.ndarray  # (5,)
    w2: np.ndarray  # (5,)
    b2: float
    denormalisation: tuple[float, float]
    tolerance: float
    out_min: float
    out_max: float
    domain_min: np.ndarray  # (8,)
    domain_max: np.ndarray  # (8,)
    domain_keys: np.ndarray  # sorted cell codes of the definition domain


def _read(path: Path) -> np.ndarray:
    return np.atleast_2d(np.loadtxt(path, delimiter=',', dtype=np.float64))


def _cell_codes(cells: np.ndarray) -> np.ndarray:
    """One integer per row of 1-based grid indices (0..11 each), for set lookups."""
    codes = np.zeros(cells.shape[0], dtype=np.int64)
    for i in range(cells.shape[1]):
        codes += cells[:, i].astype(np.int64) * (13**i)
    return codes


@cache
def load(sensor: str, variable: str) -> Network:
    """The network for one sensor (S2A or S2B) and one variable (a VARIABLES key)."""
    name = VARIABLES[variable]
    folder = DATA / sensor / name

    def f(part: str) -> np.ndarray:
        return _read(folder / f'{name}_{part}')

    extreme = f('ExtremeCases')[0]
    minmax = f('DefinitionDomain_MinMax')
    denorm = f('Denormalisation')[0]
    return Network(
        normalisation=f('Normalisation'),
        w1=f('Weights_Layer1_Neurons'),
        b1=f('Weights_Layer1_Bias')[0],
        w2=f('Weights_Layer2_Neurons')[0],
        b2=float(f('Weights_Layer2_Bias')[0][0]),
        denormalisation=(float(denorm[0]), float(denorm[1])),
        tolerance=abs(float(extreme[0])),
        out_min=float(extreme[1]),
        out_max=float(extreme[2]),
        domain_min=minmax[0],
        domain_max=minmax[1],
        domain_keys=np.unique(_cell_codes(f('DefinitionDomain_Grid'))),
    )


def raw_output(net: Network, inputs: np.ndarray) -> np.ndarray:
    """
    The network's output for rows of 11 inputs, before any thresholding.

    X' = 2 (X - Xmin) / (Xmax - Xmin) - 1, a tansig hidden layer (equal to
    tanh), a linear output, and Y = 0.5 (Y' + 1) (Ymax - Ymin) + Ymin -- the
    normalisation and denormalisation SNAP writes beside the weights.
    """
    lo, hi = net.normalisation[:, 0], net.normalisation[:, 1]
    x = 2.0 * (inputs - lo) / (hi - lo) - 1.0
    hidden = np.tanh(x @ net.w1.T + net.b1)
    y = hidden @ net.w2 + net.b2
    y_min, y_max = net.denormalisation
    return 0.5 * (y + 1.0) * (y_max - y_min) + y_min


def within_bounds(net: Network, reflectance: np.ndarray) -> np.ndarray:
    """Whether each row of eight reflectances lies inside the per-band bounds."""
    return np.all((reflectance >= net.domain_min) & (reflectance <= net.domain_max), axis=1)


def in_domain(net: Network, reflectance: np.ndarray) -> np.ndarray:
    """
    Whether each row of eight reflectances lies inside the definition domain.

    Inside the per-band bounds, and in a cell of the ten-step grid over those
    bounds that the training set populated: SNAP's own test, a band at a time
    and then the combination, with SNAP's projection,
    floor(10 (x - min) / (max - min) + 1).

    THE SECOND TEST IS STRICT, and is reported apart for that reason. Over one
    area of cropland and forest in Mato Grosso it failed for most cells inside
    the bounds, dense forest included, and SNAP's own tests skip a flagged case
    rather than check the flag, so nothing published says the grid and the
    projection agree on where a cell starts. Shifting the projection by one
    cell did not make it fit either. The test is kept as SNAP writes it, and
    the per-band test is reported beside it so a reader can tell the two apart.
    """
    within = within_bounds(net, reflectance)
    span = net.domain_max - net.domain_min
    cells = np.floor(10.0 * (reflectance - net.domain_min) / span + 1.0)
    cells = np.clip(cells, 0, 12)
    return within & np.isin(_cell_codes(cells), net.domain_keys)


@dataclass
class Estimate:
    values: np.ndarray
    out_of_bounds: np.ndarray
    out_of_domain: np.ndarray
    too_low: np.ndarray
    too_high: np.ndarray


def estimate(net: Network, reflectance: np.ndarray, angles_cos: np.ndarray) -> Estimate:
    """
    The variable for rows of eight reflectances and three angle cosines.

    Within the tolerance of a bound the value is set to it; beyond, it is NaN
    and flagged, as in SNAP's test cases.
    """
    raw = raw_output(net, np.concatenate([reflectance, angles_cos], axis=1))
    lo, hi, tol = net.out_min, net.out_max, net.tolerance
    values = raw.copy()
    values[(raw > lo - tol) & (raw < lo)] = lo
    values[(raw > hi) & (raw < hi + tol)] = hi
    too_low = raw < lo - tol
    too_high = raw > hi + tol
    values[too_low | too_high] = np.nan
    return Estimate(
        values=values,
        out_of_bounds=~within_bounds(net, reflectance),
        out_of_domain=~in_domain(net, reflectance),
        too_low=too_low,
        too_high=too_high,
    )


def angle_cosines(view_zenith: float, sun_zenith: float, sun_azimuth: float, view_azimuth: float) -> np.ndarray:
    """The network's three angle inputs, from degrees."""
    r = np.radians
    return np.array(
        [np.cos(r(view_zenith)), np.cos(r(sun_zenith)), np.cos(r(sun_azimuth - view_azimuth))]
    )


def platform_code(platform: str) -> str:
    """'Sentinel-2C' as 'S2C': the short name a legend row has room for."""
    p = platform.upper().replace('-', '').replace('SENTINEL', 'S')
    return p if p.startswith('S2') else platform


def sensor_for(platform: str) -> tuple[str, str | None]:
    """
    The network to use for a platform, and a note where it is not the platform's own.

    SNAP 3_0 publishes networks for Sentinel-2A and 2B. Sentinel-2C carries the
    same instrument design with its own spectral responses, and no network of
    its own exists at that version; its scenes are run through 2A's, and the
    result says so.
    """
    p = platform_code(platform)
    if p.endswith('2B'):
        return 'S2B', None
    if p.endswith('2A'):
        return 'S2A', None
    return 'S2A', f'{platform} has no SL2P network of its own; the Sentinel-2A network was used'
