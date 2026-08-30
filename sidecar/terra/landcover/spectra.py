"""
What each predicted class actually reflects, and how far that is from a leaf.

Two readings over one classified area. class_spectra is the mean surface
reflectance per band per class, which is the measurement. library_limit puts
each class against a leaf-level library spectrum by spectral angle, which is a
bound rather than a validation: a canopy is not a leaf, and the distance
between them is the thing being reported.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from terra.imagery import sentinel2
from terra.mapbiomas import (
    CLASSIFIER_COLORS as MAPBIOMAS_COLORS,
    CLASSIFIER_LEGEND as MAPBIOMAS_LEGEND,
)

# The seven bands the application reads, and their central wavelengths.
# Values from the Sentinel-2A spectral response functions (ESA, S2-SRF v3.1);
# the two SWIR bands and B8A are 20 m products resampled onto the 10 m grid.
TERRA_BANDS = (('B02', '10m'), ('B03', '10m'), ('B04', '10m'), ('B08', '10m'),
               ('B8A', '20m'), ('B11', '20m'), ('B12', '20m'))


BAND_WAVELENGTH_NM = {
    'B02': 492.4, 'B03': 559.8, 'B04': 664.6, 'B08': 832.8,
    'B8A': 864.7, 'B11': 1613.7, 'B12': 2202.4,
}


# Below this a class mean is a handful of pixels rather than a spectrum. The
# class is dropped from the figure instead of drawn at an unstated precision.
SPECTRUM_MIN_PIXELS = 30


def class_spectra(products, polygon, ref_profile, classification_map,
                  min_pixels=SPECTRUM_MIN_PIXELS):
    """
    Mean surface reflectance per band, per predicted class, on one acquisition.

    What the domain-shift diagnostics beside it cannot say. MMD, KL and the
    change-vector magnitude report THAT a distribution moved; a per-class
    spectrum reports which band moved and in which direction.

    ONE acquisition, not the series. The classification is temporal -- 80
    features over up to 22 dates -- but reflectance is not, and averaging seven
    bands across a season would mix phenological stages into a single curve
    that describes no date. The scene at the middle of the period is used, the
    same one the reference implementation in experiments/ measures, and it is
    named in the payload so the figure is not read as a seasonal mean.

    sentinel2.to_reflectance, not sentinel2.as_trained: this is REPORTED as a physical quantity, so
    it carries the baseline 04.00 offset. The classifier that produced
    classification_map consumed the uncorrected convention it was fitted under,
    which is the seam documented on sentinel2.as_trained -- the labels come from one
    space, the reflectance reported for them from the other.

    Returns None when nothing can be measured, rather than an empty shell.
    """
    if not products or classification_map is None:
        return None
    valid = classification_map >= 0
    if not valid.any():
        return None

    scene = products[len(products) // 2]
    bands = {}
    for name, resolution in TERRA_BANDS:
        try:
            bands[name] = sentinel2.load_reflectance_to_reference_grid(
                scene, name, polygon, ref_profile, resolution=resolution)
        except Exception as e:
            sys.stderr.write(json.dumps({
                'progress': -1, 'msg': f'spectrum band {name} skipped: {e}'
            }) + '\n')
            sys.stderr.flush()
    if not bands:
        return None

    points = []
    for cls_id in sorted({int(c) for c in np.unique(classification_map[valid])}):
        selected = valid & (classification_map == cls_id)
        for name, _ in TERRA_BANDS:
            band = bands.get(name)
            if band is None:
                continue
            pixels = band[selected & np.isfinite(band)]
            if pixels.size < min_pixels:
                continue
            points.append({
                'class_id': cls_id,
                'name': MAPBIOMAS_LEGEND.get(cls_id, f'Class {cls_id}'),
                'color': MAPBIOMAS_COLORS.get(cls_id, '#cccccc'),
                'band': name,
                'wavelength_nm': BAND_WAVELENGTH_NM[name],
                'n_pixels': int(pixels.size),
                'mean': float(round(float(np.mean(pixels)), 6)),
                'sd': float(round(float(np.std(pixels)), 6)),
                'p05': float(round(float(np.percentile(pixels, 5)), 6)),
                'p95': float(round(float(np.percentile(pixels, 95)), 6)),
            })
    if not points:
        return None
    return {
        'scene_date': scene['date'].strftime('%Y-%m-%d'),
        'scene_id': str(scene.get('id', '')),
        'n_scenes': len(products),
        # Named rather than assumed. The indices reported elsewhere in this run
        # come from the model's own convention; these do not.
        'convention': 'BOA reflectance, baseline 04.00 offset applied',
        'bands': [name for name, _ in TERRA_BANDS if name in bands],
        'points': points,
    }


REFERENCE_DIR = Path(__file__).resolve().parent / 'reference'


SOYBEAN_REFERENCE = REFERENCE_DIR / 'soybean_leaf_reference.json'


def spectral_angle(a, b):
    """
    The angle between two spectra, in radians. Spectral Angle Mapper.

    Scale-invariant, which is the whole reason it is the standard comparison: a
    material in shade differs from the same material in sun by a multiplier,
    and the angle ignores exactly that. What it cannot ignore is a change of
    SHAPE, which is what the leaf-to-canopy difference turns out to be.
    """
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na <= 0 or nb <= 0:
        return float('nan')

    # The half-angle form, not arccos of the cosine.
    #
    # arccos has an infinite derivative at 1, which is exactly where the
    # scale-invariance this function promises puts every shaded-material
    # comparison. A rounding error of eps in the cosine emerges as sqrt(2*eps)
    # in the angle, so the 2.2e-16 that dot() leaves on one platform and not on
    # another became 2.1e-8 radians -- a spectrum reported as not quite
    # identical to itself, on Linux but not on macOS.
    #
    # 2*atan2(|u - v|, |u + v|) over the unit vectors is conditioned evenly
    # across the whole range: it returns 0 for parallel and pi for antiparallel
    # without the clip that was hiding the loss. Checked against the previous
    # form on non-degenerate pairs, the two agree to 3.3e-16.
    u = a / na
    v = b / nb
    return float(2.0 * np.arctan2(
        float(np.linalg.norm(u - v)), float(np.linalg.norm(u + v))))


def library_limit(spectra):
    """
    Each predicted class against a leaf-level library spectrum, and the limit
    that comparison runs into.

    WHAT THIS IS FOR. A reader looking at a class called Soybean wants to know
    whether the pixels under it reflect like soybean. This computes the angle
    to a reference built from 1131 soybean leaf spectra, and reports the answer
    the measurement actually gives -- which is that Soybean is NOT the closest
    class to the soybean reference.

    That is not a classification error. A library spectrum is leaf level and a
    Sentinel-2 pixel is canopy: soil through the gaps and shadow between rows.
    The ratio between the two is reported per band because it is the mechanism:
    it is not constant, so the difference is not brightness. If it were, the
    angle would be zero, since the angle is scale-invariant. Soil raises the
    red while gaps and shadow lower the NIR, in opposite directions, and the
    shape itself is distorted.

    So a small angle here means CONSISTENCY, not identification, and nothing
    downstream may label it otherwise.

    The reference is vendored rather than fetched: it is 7 numbers derived from
    a 28 MB package by experiments/spectral_response_and_offset.py, convolved
    onto the ESA response functions. Fetching 28 MB at classify time to arrive
    at 7 numbers would be a network dependency for a constant.
    """
    if not spectra or not spectra.get('points'):
        return None
    try:
        reference = json.loads(SOYBEAN_REFERENCE.read_text())['reference']
    except Exception as e:
        sys.stderr.write(json.dumps({
            'progress': -1, 'msg': f'library reference unavailable: {e}'
        }) + '\n')
        sys.stderr.flush()
        return None

    leaf = {b['band']: float(b['reflectance']) for b in reference['bands']}
    bands = [b for b, _ in TERRA_BANDS if b in leaf]

    by_class = {}
    for p in spectra['points']:
        by_class.setdefault(p['class_id'], {})[p['band']] = p

    out = []
    for class_id in sorted(by_class):
        points = by_class[class_id]
        # A class the scene could not measure in every band has no vector to
        # compare; a partial one would be an angle in a different space.
        if any(b not in points for b in bands):
            continue
        canopy = np.array([points[b]['mean'] for b in bands], dtype=float)
        reference_vector = np.array([leaf[b] for b in bands], dtype=float)
        canopy_norm = float(np.linalg.norm(canopy))
        reference_norm = float(np.linalg.norm(reference_vector))
        first = points[bands[0]]
        out.append({
            'class_id': class_id,
            'name': first['name'],
            'color': first['color'],
            'angle_rad': round(spectral_angle(canopy, reference_vector), 6),
            'bands': [
                {
                    'band': b,
                    'wavelength_nm': points[b]['wavelength_nm'],
                    'canopy': round(float(canopy[i]), 6),
                    'leaf': round(float(reference_vector[i]), 6),
                    # Canopy over leaf. Constant would mean brightness alone.
                    'ratio': (
                        round(float(canopy[i] / reference_vector[i]), 4)
                        if reference_vector[i] > 0 else None
                    ),
                    # The unit vectors are what the angle actually compares,
                    # so a reader can see the difference the angle sees.
                    'unit_canopy': (
                        round(float(canopy[i] / canopy_norm), 6)
                        if canopy_norm > 0 else None
                    ),
                    'unit_leaf': (
                        round(float(reference_vector[i] / reference_norm), 6)
                        if reference_norm > 0 else None
                    ),
                }
                for i, b in enumerate(bands)
            ],
        })
    if not out:
        return None
    out.sort(key=lambda c: c['angle_rad'])
    return {
        'reference': {
            'material': reference['material'],
            'source': reference['source'],
            'package_id': reference['package_id'],
            'n_spectra': reference['n_spectra'],
            'level': reference['level'],
            'note': reference['note'],
            'bands': reference['bands'],
        },
        'scene_date': spectra.get('scene_date', ''),
        'classes': out,
    }
