"""
The water survey: every usable date over an area, and what the set of them says.

Separated from the action because everything here is callable with a list of
scenes and a polygon, and nothing here reads a request or writes to a stream.
A test can hand it three synthetic scenes; through the action it could only be
reached with a JSON envelope and a subprocess.

It raises rather than exits. Deciding that a run cannot continue is the
action's, because the action is what owns the process.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from terra.imagery import composite as comp, grid as ref_grid, sentinel2
from terra.water import indices as water_indices

PIXEL_AREA_HA = 0.01

# The bands every index in the set needs, at the resolution each is served at.
INDEX_BANDS = ('B03', 'B8A', 'B11', 'B12')


class NoUsableScene(RuntimeError):
    """No date produced an observation over the area."""


@dataclass
class Survey:
    """One survey over one area and one period, ready to be reported."""

    index: str
    series: list[dict]
    occurrence: np.ndarray
    bands: dict
    anomaly: np.ndarray
    aoi_pixels: int
    extent: tuple[float, float, float, float]

    def to_payload(self, work_dir) -> dict:
        """The `water` object the shell reads, and the PNG it points at."""
        occurrence_png = Path(work_dir) / 'water_occurrence.png'
        comp.write_rgba_png(
            water_indices.occurrence_to_rgba(self.occurrence), occurrence_png
        )
        peak = max(self.series, key=lambda row: row['water_fraction_pct'])
        lon_min, lon_max, lat_min, lat_max = self.extent
        ephemeral = int(self.bands['ephemeral'].sum())
        persistent = int(self.bands['persistent'].sum())
        return {
            'index': self.index,
            'threshold_method': 'fixed',
            'threshold_fixed': water_indices.DEFAULT_THRESHOLD,
            'otsu_clip': [water_indices.OTSU_CLIP_LOW, water_indices.OTSU_CLIP_HIGH],
            'n_dates': len(self.series),
            'date_range': [self.series[0]['date'], self.series[-1]['date']],
            'aoi_pixels': self.aoi_pixels,
            'aoi_area_ha': round(float(self.aoi_pixels * PIXEL_AREA_HA), 4),
            'series': self.series,
            'peak_date': peak['date'],
            'peak_water_fraction_pct': peak['water_fraction_pct'],
            'ephemeral_pixels': ephemeral,
            'ephemeral_area_ha': round(float(ephemeral * PIXEL_AREA_HA), 4),
            'persistent_pixels': persistent,
            'persistent_area_ha': round(float(persistent * PIXEL_AREA_HA), 4),
            'mean_anomaly': (
                float(np.nanmean(self.anomaly))
                if np.isfinite(self.anomaly).any() else 0.0
            ),
            'occurrence_png': str(occurrence_png),
            'extent': {
                'lon_min': lon_min, 'lat_min': lat_min,
                'lon_max': lon_max, 'lat_max': lat_max,
            },
        }


def _date_row(product, date_valid, frame, index_name):
    """One row of the series: the thresholds this date resolved to, and its area."""
    threshold_otsu, clipped, degenerate = water_indices.otsu_threshold_for_date(
        frame[date_valid]
    )
    threshold_fixed = water_indices.DEFAULT_THRESHOLD
    mask_fixed = water_indices.water_mask_for_date(frame, date_valid, threshold_fixed)
    mask_otsu = water_indices.water_mask_for_date(frame, date_valid, threshold_otsu)
    row = {
        'date': product['date'].strftime('%Y-%m-%d'),
        'scene_id': product.get('id') or '',
        'cloud_cover': round(float(product.get('cloud_cover', 0.0)), 2),
        'observed_pixels': int(date_valid.sum()),
        'threshold_fixed': threshold_fixed,
        'threshold_otsu': threshold_otsu,
        'threshold_clipped': bool(clipped),
        'threshold_degenerate': bool(degenerate),
        'water_fraction_pct': round(
            water_indices.water_fraction_pct(mask_fixed, date_valid), 4
        ),
        'water_fraction_otsu_pct': round(
            water_indices.water_fraction_pct(mask_otsu, date_valid), 4
        ),
        'water_pixels': int(mask_fixed.sum()),
        'area_ha': round(float(int(mask_fixed.sum()) * PIXEL_AREA_HA), 4),
    }
    return row, mask_fixed


def run(products, polygon, index_name, progress=None, skipped=None) -> Survey:
    """
    Survey every scene in `products`, and summarise the set.

    `progress(percent, message)` is called per date if given, and `skipped(msg)`
    per date that could not be read. Both are the caller's, so this function
    reaches no stream of its own.

    Raises NoUsableScene when no date produced an observation over the area:
    an empty survey is not a survey with nothing in it, it is a run the caller
    has to report as having failed.
    """
    # The reference grid comes from B04 at 10 m, as in the predict path.
    ref_band, ref_profile = sentinel2.load_and_clip_band(products[0], 'B04', polygon)
    aoi_valid = ref_band > 0

    series, masks, observed, frames = [], [], [], []
    total = len(products)
    for index, product in enumerate(products):
        date_str = product['date'].strftime('%Y-%m-%d')
        if progress:
            progress(15 + int(70 * (index + 1) / total),
                     f'water index {index + 1}/{total} ({date_str})')
        try:
            bands = {}
            for name in INDEX_BANDS:
                resolution = comp.BAND_RESOLUTION.get(name, '10m')
                raw = sentinel2.load_band_to_reference_grid(
                    product, name, polygon, ref_profile, resolution=resolution
                )
                bands[name] = sentinel2.to_reflectance(raw, product)
        except Exception as e:
            if skipped:
                skipped(f'skipping {date_str}: {e}')
            continue

        date_valid = water_indices.per_date_valid_mask(aoi_valid, bands, index_name)
        if not date_valid.any():
            continue
        frame = water_indices.compute_water_indices(
            bands['B03'], bands['B8A'], bands['B11'], bands['B12']
        )[index_name]
        row, mask = _date_row(product, date_valid, frame, index_name)
        series.append(row)
        masks.append(mask)
        observed.append(date_valid)
        frames.append(frame)

    if not series:
        raise NoUsableScene('no scene produced a usable observation over the AOI')

    if progress:
        progress(88, 'building occurrence map')
    occurrence = water_indices.occurrence_map(masks, observed)
    observed_cube = np.stack(observed, axis=0)
    return Survey(
        index=index_name,
        series=series,
        occurrence=occurrence,
        bands=water_indices.classify_occurrence(occurrence),
        anomaly=water_indices.max_minus_median_index(
            np.stack(frames, axis=0), observed_cube
        ),
        aoi_pixels=int(aoi_valid.sum()),
        extent=ref_grid.get_map_extent(ref_profile),
    )
