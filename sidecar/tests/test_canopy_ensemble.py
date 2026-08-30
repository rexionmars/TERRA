"""
Lighting the same canopy more than once.

The loop was inside canopy_from_aoi, three levels of indentation down, and
nothing could reach it: not the median that carries the headline, not the
spread that is the whole reason the loop exists, not the seed count clamp, and
not the module geometry that decides what LAI the march integrates.

Growing and marching are stood in for. Nothing here grows a plant.
"""

from __future__ import annotations

import numpy as np
import pytest

from terra.canopy import ensemble


class Field:
    """A stand-in for terra.canopy.field: faPAR chosen per seed."""

    def __init__(self, fapar_by_seed):
        self.fapar_by_seed = fapar_by_seed
        self.spacings = []

    def leaf_cloud_field(self, positions, leaf_area, spacing, cell):
        self.spacings.append((spacing, cell))
        grid = np.zeros((4, 4, 2))
        grid[:2, :, 0] = 1.0          # half the ground under leaf
        return grid, {'seed': int(leaf_area[0])}

    def canopy_of(self, grid, meta):
        return meta

    def light_under_sun(self, canopy, energy, el_edges, dhi_share,
                        row_azimuth_deg):
        return {'fapar': self.fapar_by_seed[canopy['seed']]}


def grown_for(seed):
    return {'seed': seed}


def run(fapar_by_seed, **over):
    field = Field(fapar_by_seed)
    args = dict(inter_row=0.5, inter_plant=0.2, energy=None, el_edges=None,
                dhi_share=0.3, base_seed=7, n_seeds=len(fapar_by_seed),
                grow=lambda species, days, seed: grown_for(seed),
                leaf_cloud=lambda grown: (np.zeros((3, 3)),
                                          np.full(3, grown['seed']), {}),
                field=field)
    args.update(over)
    return ensemble.light('soybean', 55, **args), field


def test_the_median_run_carries_the_headline():
    """
    A mean faPAR beside a mean cover describes no canopy that was marched. The
    reported figures stay a self-consistent single canopy.
    """
    lit, _ = run({7: 0.70, 8: 0.75, 9: 0.80})

    assert lit['fapar'] == 0.75
    assert lit['seed'] == 8


def test_the_spread_is_reported_because_it_is_why_the_loop_exists():
    """
    Five seeds spanned faPAR 0.703 to 0.799 on soybean at 55 days. That 0.096
    is larger than the seasonal term the sun window exists to capture.
    """
    lit, _ = run({7: 0.703, 8: 0.751, 9: 0.799})

    band = lit['ensemble']
    assert band['fapar_min'] == 0.703
    assert band['fapar_max'] == 0.799
    assert band['fapar_spread'] == pytest.approx(0.096, abs=1e-9)
    assert band['seeds'] == [7, 8, 9]


def test_the_cover_is_the_share_of_ground_under_leaf():
    """
    The one geometric number that tracks the answer: sweeping the canopy's
    horizontal extent moves faPAR 0.19 to 0.88, while sweeping its height over
    a factor of 2.4 moves it 0.020.
    """
    lit, _ = run({7: 0.5})

    assert lit['cover'] == pytest.approx(0.5)


def test_the_seed_count_is_clamped_at_both_ends():
    """Cost is why the default is three: the march is about 11 s and dominates."""
    lit, _ = run({7: 0.5}, n_seeds=0)
    assert lit['ensemble']['n'] == ensemble.MIN_SEEDS

    many = {7 + i: 0.5 for i in range(ensemble.MAX_SEEDS + 5)}
    lit, _ = run(many, n_seeds=99)
    assert lit['ensemble']['n'] == ensemble.MAX_SEEDS


def test_the_module_is_the_square_of_the_sowing_area():
    """
    A plant grown at one spacing and marched at another reports a canopy nobody
    planted.
    """
    module, cell = ensemble.module_geometry(0.5, 0.2)

    assert module == pytest.approx(np.sqrt(0.1))
    assert cell == pytest.approx(module / round(module / ensemble.TARGET_CELL_M))


def test_a_tiny_sowing_still_gets_enough_cells_to_march():
    _, cell = ensemble.module_geometry(0.02, 0.02)

    assert cell == pytest.approx(0.02 / ensemble.MIN_CELLS_PER_MODULE)


def test_every_draw_is_marched_on_the_same_module():
    _, field = run({7: 0.70, 8: 0.75, 9: 0.80})

    assert len(set(field.spacings)) == 1


def test_progress_is_the_callers_and_the_ensemble_writes_to_no_stream(capsys):
    seen = []
    run({7: 0.70, 8: 0.75}, progress=lambda pct, msg: seen.append(pct))

    assert seen == [80, 87]
    captured = capsys.readouterr()
    assert captured.out == '' and captured.err == ''
