"""
Reading the DEM products onto one window.

The alignment, the common-window search and the crop were inside a 329-line
action reachable only through a JSON envelope. What they decide is not a
detail: whether a product is resampled before or after its terrain chain moves
COP90's one-metre extent by IoU 0.47 on the window this was measured on, and a
window the products do not jointly cover has to be refused rather than filled.

The DEM read is stood in for. Nothing here touches the catalogue.
"""

from __future__ import annotations

import numpy as np
import pytest
from rasterio.transform import from_origin

from terra.flood import envelope
from terra.terrain import dem

ARCSEC = 1.0 / 3600.0


class Product:
    def __init__(self, pid, resolution):
        self.id = pid
        self.native_resolution_m = resolution


class Read:
    """A ProductRead as fetch_set returns it, with a field the test chose."""

    def __init__(self, pid, array, grid, reference, resampled=False, resolution=30.0):
        self.product = Product(pid, resolution)
        self.array = array
        self.grid = grid
        self.reference = reference
        self.resampled = resampled

    def describe(self):
        return {'id': self.product.id, 'collection': f'{self.product.id}-collection',
                'native_resolution_m': self.product.native_resolution_m,
                'resampled': self.resampled}


def grid_of(shape, res=ARCSEC):
    return dem.Grid(from_origin(-53.5, -25.0, res, res), shape[1], shape[0], 'EPSG:4326')


@pytest.fixture
def fetched(monkeypatch):
    """fetch_set answering with reads the test puts in a list."""
    state = {'reads': []}
    monkeypatch.setattr(dem, 'fetch_set',
                        lambda polygon, ids, buffer_m, progress=None: state['reads'])
    monkeypatch.setattr(dem, 'resample_onto',
                        lambda array, grid, reference: array)
    monkeypatch.setattr(dem, 'cell_size_m', lambda grid: (30.0, 30.0))
    return state


def field(shape, void=None):
    z = np.fromfunction(lambda r, c: 100.0 + r + c, shape, dtype=float)
    if void is not None:
        z[void] = np.nan
    return z


def test_products_that_cover_one_window_are_cropped_to_it(fetched):
    reference = grid_of((10, 10))
    fetched['reads'] = [
        Read('cop30', field((10, 10)), reference, reference),
        # a one-cell void at the border: the alignment sliver the trim covers
        Read('nasadem', field((10, 10), void=(0, slice(None))), reference, reference),
    ]

    out = envelope.read_aligned(None, [r.product for r in fetched['reads']],
                                buffer_m=0.0, reference_res_m=30.0)

    assert set(out.arrays) == {'cop30', 'nasadem'}
    assert all(np.isfinite(z).all() for z in out.arrays.values())
    assert out.grid.height < 10


def test_a_void_the_trim_cannot_reach_is_refused_with_the_counts(fetched):
    """
    A hole that far inside the window is a hole in the product, over water or
    in radar shadow. The terrain chain would still return a HAND field over it
    and nothing in the output would mark the region it is wrong over.
    """
    reference = grid_of((10, 10))
    fetched['reads'] = [
        Read('cop30', field((10, 10)), reference, reference),
        Read('nasadem', field((10, 10), void=(5, 5)), reference, reference),
    ]

    with pytest.raises(envelope.NoCommonWindow) as raised:
        envelope.read_aligned(None, [r.product for r in fetched['reads']],
                              buffer_m=0.0, reference_res_m=30.0)

    assert raised.value.missing == {'nasadem': 1}
    assert raised.value.max_trim >= 1


def test_the_sources_carry_the_resampled_flag_the_payload_reports(fetched):
    reference = grid_of((8, 8))
    fetched['reads'] = [
        Read('cop30', field((8, 8)), reference, reference),
        Read('cop90', field((8, 8)), reference, reference, resampled=True,
             resolution=90.0),
    ]

    sources = envelope.read_aligned(
        None, [r.product for r in fetched['reads']],
        buffer_m=0.0, reference_res_m=30.0).sources()

    assert sources['cop30'].resampled is False
    assert sources['cop90'].resampled is True
    assert sources['cop90'].native_resolution_m == 90.0


def test_the_grid_is_the_window_compared_on_not_the_one_requested(fetched):
    """
    The crop can leave the compared window up to one cell inside the read
    window on any side. The payload bounds have to be that one, or the map is
    drawn a cell off the ground it describes.
    """
    reference = grid_of((12, 12))
    fetched['reads'] = [
        Read('cop30', field((12, 12)), reference, reference),
        Read('nasadem', field((12, 12), void=(slice(None), 0)), reference, reference),
    ]

    out = envelope.read_aligned(None, [r.product for r in fetched['reads']],
                                buffer_m=0.0, reference_res_m=30.0)

    assert out.grid.width < reference.width
    assert out.grid.transform.c > reference.transform.c


def test_the_alignment_callback_fires_once_between_the_read_and_the_crop(fetched):
    reference = grid_of((6, 6))
    fetched['reads'] = [Read('cop30', field((6, 6)), reference, reference)]
    fired = []

    envelope.read_aligned(None, [fetched['reads'][0].product],
                          buffer_m=0.0, reference_res_m=30.0,
                          aligning=lambda: fired.append(1))

    assert fired == [1]
