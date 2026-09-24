"""
Which pass shows a cell's ground most openly.

Green vegetation and dry plant residue each suppress a mineral answer, and
over Brazilian cropland a field is bare for weeks between harvest and the next
sowing, while no-till farming leaves straw on it for most of the rest. EMIT
observes a place on few, irregular passes; a cell covered on one may be bare on
another. Each cell therefore takes its answer from the pass in which it is
least covered, judged from that pass's own spectrum.

THE TEST for exposed ground has two parts:

    NDVI between -0.15 and 0.25, the green-vegetation limit of the GEOS3
    bare-soil test (Dematte et al., 2018, Remote Sensing of Environment
    212:161-175, as stated by Rosin et al., 2023, Geoderma 432:116413), with
    red and NIR the means of the EMIT channels inside the Landsat 8 OLI band
    limits the thresholds were set with (Barsi et al., 2014);

    CAI <= 0, the cellulose absorption index of Nagler et al. (2000, Remote
    Sensing of Environment 71:207-215) and Daughtry (2001, Agronomy Journal
    93:125-131), 0.5 (R2.03 + R2.21) - R2.10, each the mean of the EMIT
    channels within 10 nm of the centre. It is positive where cellulose and
    lignin absorb at 2.1 um, that is where dry residue lies on the ground.

WHY NOT THE REST OF GEOS3. Its test also asks for NBR2 between -0.15 and 0.15
and for reflectance rising from blue to SWIR1. Both were chosen to keep a soil
composite free of other surfaces, and both reject exposed minerals for the
absorptions this map exists to find. Measured on the reference spectra the
rules ship (data/tetracorder_emit_spectra.npz): the Al-OH absorption lowers the
SWIR2 band, so kaolinite references have a median NBR2 of 0.24 (n = 15), above
the 0.15 limit and above dry grass at 0.17; and the rising-reflectance rule is
failed by every chlorite (n = 12), gypsum (n = 5), jarosite (n = 5) and talc or
serpentine (n = 8) reference. CAI moves the other way under a 2.2 um
absorption.

WHAT THE TEST PASSES, on the same references: every kaolinite (15), smectite
(14), hematite (12), goethite (8), calcite (12), gypsum (5), dolomite (4) and
gibbsite (1) reference, and 18 of 21 alunite references; no vegetation
reference (7), dry grass having a CAI of 0.030 to 0.032 (n = 3). Minerals with
an absorption of their own near 2.1 um fail it as residue does -- talc and
serpentine (7 of 8), biotite (3 of 3), coquimbite, szomolnokite, ammonium
minerals -- and so does jarosite, whose Fe3+ bands put its NDVI below -0.15
(4 of 5). A cell of those takes its least green pass by the rule below.

THE CHOICE among passes: an exposed observation is preferred to one that is
not, and among equals the one with the lower NDVI; remaining ties go to the
pass ranked first (more of the area covered, then less cloud). A cell no pass
shows exposed still takes its least green pass, so every observed cell has an
answer, and whether it was exposed travels with it. GEOS3 takes the median of
every bare observation; one pass per cell is kept here instead, so that each
answer is a spectrum that was measured, on a date that can be named.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass

import numpy as np

# Landsat 8 OLI band-pass limits, nm (Barsi et al., 2014).
OLI_BANDS: dict[str, tuple[float, float]] = {
    'red': (636.0, 673.0),
    'nir': (851.0, 879.0),
}
# CAI's channels: centre, nm; the EMIT channels within CAI_HALF_WIDTH of each.
CAI_CENTRES: dict[str, float] = {'r2030': 2031.0, 'r2100': 2101.0, 'r2210': 2211.0}
CAI_HALF_WIDTH = 10.0

NDVI_RANGE = (-0.15, 0.25)
CAI_MAX = 0.0


def band_channels(wavelengths_nm: np.ndarray, usable: np.ndarray) -> dict[str, np.ndarray]:
    """The usable EMIT channels behind each quantity the test reads."""
    out = {}
    for name, (lo, hi) in OLI_BANDS.items():
        out[name] = np.where((wavelengths_nm >= lo) & (wavelengths_nm <= hi) & usable)[0]
    for name, centre in CAI_CENTRES.items():
        out[name] = np.where((np.abs(wavelengths_nm - centre) <= CAI_HALF_WIDTH) & usable)[0]
    for name, idx in out.items():
        if len(idx) == 0:
            raise ValueError(f'no usable EMIT channel for {name}')
    return out


def band_means(spectra: np.ndarray, channels: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Per spectrum, the mean of each channel set; NaN where every channel is missing."""
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', RuntimeWarning)
        return {name: np.nanmean(spectra[:, idx], axis=1) for name, idx in channels.items()}


@dataclass
class Exposure:
    """What one pass shows of each cell or pixel."""

    ndvi: np.ndarray        # NaN where not usable
    cai: np.ndarray
    exposed: np.ndarray     # the test passed
    usable: np.ndarray      # observed, unmasked, and every quantity finite


def exposure(bands: dict[str, np.ndarray], masked: np.ndarray) -> Exposure:
    """NDVI, CAI and the test, from band means."""
    r, n = bands['red'], bands['nir']
    with np.errstate(invalid='ignore', divide='ignore'):
        ndvi = (n - r) / (n + r)
        cai = 0.5 * (bands['r2030'] + bands['r2210']) - bands['r2100']
    usable = ~masked & np.isfinite(ndvi) & np.isfinite(cai)
    exposed = usable & (ndvi >= NDVI_RANGE[0]) & (ndvi <= NDVI_RANGE[1]) & (cai <= CAI_MAX)
    return Exposure(np.where(usable, ndvi, np.nan), np.where(usable, cai, np.nan), exposed, usable)


def better(new: Exposure, held: np.ndarray, held_exposed: np.ndarray,
           held_ndvi: np.ndarray) -> np.ndarray:
    """
    Where `new` replaces the observation held: nothing held yet, exposed
    against not exposed, or the same on that and a lower NDVI. An equal one
    does not replace, which keeps the pass ranked first.
    """
    return new.usable & (
        ~held
        | (new.exposed & ~held_exposed)
        | ((new.exposed == held_exposed) & (new.ndvi < held_ndvi))
    )


@dataclass
class Choice:
    """The pass each cell takes its answer from."""

    pass_index: np.ndarray  # index into the candidate list, -1 where none observed it
    exposed: np.ndarray
    ndvi: np.ndarray        # NaN where none


def choose(candidates: list[Exposure]) -> Choice:
    """Per cell, the candidate it is least covered in. `candidates` are in rank order."""
    if not candidates:
        raise ValueError('no candidate pass to choose from')
    shape = candidates[0].ndvi.shape
    best = np.full(shape, -1, dtype=np.int32)
    best_exposed = np.zeros(shape, dtype=bool)
    best_ndvi = np.full(shape, np.nan)
    for i, c in enumerate(candidates):
        take = better(c, best >= 0, best_exposed, best_ndvi)
        best = np.where(take, i, best)
        best_exposed = np.where(take, c.exposed, best_exposed)
        best_ndvi = np.where(take, c.ndvi, best_ndvi)
    return Choice(best, best_exposed, best_ndvi)
