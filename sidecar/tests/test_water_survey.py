"""
The water survey over synthetic scenes.

This is what the split of the action bought. Before it, every line below the
STAC query was reachable only through a JSON envelope on stdin and a
subprocess; the whole of it went untested, including the two branches that
decide a date is unusable.

The scenes are dictionaries with the two keys the survey reads, and the band
loading is stood in for. Nothing here touches the network or a GeoTIFF.
"""

from __future__ import annotations

from datetime import datetime

import numpy as np
import pytest

from terra.imagery import sentinel2
from terra.water import survey


def scene(day, scene_id='S2A_TEST', cloud=1.0):
    return {'date': datetime(2024, 1, day), 'id': scene_id, 'cloud_cover': cloud}


SHAPE = (8, 8)


def bands_of(wet_fraction, shape=SHAPE):
    """Reflectances that make `wet_fraction` of the cells read as water."""
    green = np.full(shape, 0.05, dtype=np.float32)
    swir1 = np.full(shape, 0.30, dtype=np.float32)
    wet = int(round(wet_fraction * shape[0] * shape[1]))
    flat_g, flat_s = green.ravel(), swir1.ravel()
    flat_g[:wet] = 0.30
    flat_s[:wet] = 0.02
    return {
        'B03': flat_g.reshape(shape),
        'B8A': np.full(shape, 0.20, dtype=np.float32),
        'B11': flat_s.reshape(shape),
        'B12': np.full(shape, 0.15, dtype=np.float32),
    }


@pytest.fixture
def readable(monkeypatch):
    """Band loading that answers from a table the test writes, keyed by date."""
    table = {}

    def load_and_clip_band(product, band, polygon, resolution='10m'):
        # The reference grid is read before any date is, so its shape cannot
        # come from a table entry: one of those may be the failure under test.
        profile = {'transform': None, 'crs': None,
                   'height': SHAPE[0], 'width': SHAPE[1]}
        return np.ones(SHAPE, dtype=np.float32), profile

    def load_band_to_reference_grid(product, band, polygon, profile, resolution='10m'):
        entry = table[product['date']]
        if isinstance(entry, Exception):
            raise entry
        return entry[band]

    monkeypatch.setattr(sentinel2, 'load_and_clip_band', load_and_clip_band)
    monkeypatch.setattr(sentinel2, 'load_band_to_reference_grid',
                        load_band_to_reference_grid)
    monkeypatch.setattr(sentinel2, 'to_reflectance', lambda dn, product: dn)
    monkeypatch.setattr(survey.ref_grid, 'get_map_extent',
                        lambda profile: (-53.5, -53.4, -25.1, -25.0))
    return table


def test_every_readable_date_becomes_one_row_of_the_series(readable):
    products = [scene(1), scene(6), scene(11)]
    for p, fraction in zip(products, (0.25, 0.50, 0.125), strict=True):
        readable[p['date']] = bands_of(fraction)

    out = survey.run(products, polygon=None, index_name='MNDWI')

    assert [row['date'] for row in out.series] == ['2024-01-01', '2024-01-06', '2024-01-11']
    assert out.index == 'MNDWI'
    assert out.aoi_pixels == 64


def test_a_date_that_cannot_be_read_is_reported_and_skipped(readable):
    products = [scene(1), scene(6)]
    readable[products[0]['date']] = bands_of(0.25)
    readable[products[1]['date']] = RuntimeError('COG read failed')
    said = []

    out = survey.run(products, polygon=None, index_name='MNDWI',
                     skipped=said.append)

    assert len(out.series) == 1
    assert any('2024-01-06' in msg for msg in said), said


def test_no_usable_date_raises_rather_than_returning_an_empty_survey(readable):
    """
    An empty series reported as a result reads as "no water over this area",
    which is a different answer from "no date could be read".
    """
    products = [scene(1)]
    readable[products[0]['date']] = RuntimeError('COG read failed')

    with pytest.raises(survey.NoUsableScene):
        survey.run(products, polygon=None, index_name='MNDWI', skipped=lambda m: None)


def test_the_payload_names_the_peak_date_and_the_area_it_covered(readable, tmp_path):
    products = [scene(1), scene(6)]
    readable[products[0]['date']] = bands_of(0.25)
    readable[products[1]['date']] = bands_of(0.50)

    payload = survey.run(products, polygon=None, index_name='MNDWI').to_payload(tmp_path)

    assert payload['peak_date'] == '2024-01-06'
    assert payload['n_dates'] == 2
    assert payload['aoi_area_ha'] == pytest.approx(64 * 0.01, abs=1e-9)
    assert payload['occurrence_png'].endswith('water_occurrence.png')
    assert (tmp_path / 'water_occurrence.png').exists()


def test_progress_is_the_callers_and_the_survey_writes_to_no_stream(readable, capsys):
    products = [scene(1)]
    readable[products[0]['date']] = bands_of(0.25)
    seen = []

    survey.run(products, polygon=None, index_name='MNDWI',
               progress=lambda pct, msg: seen.append((pct, msg)))

    assert seen and seen[-1][0] == 88
    captured = capsys.readouterr()
    assert captured.out == '' and captured.err == ''
