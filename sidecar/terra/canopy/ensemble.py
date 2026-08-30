"""
Lighting the same canopy more than once, because one draw is not an answer.

helios_grow draws a plant stochastically, and the draw is not a rounding
detail: measured on soybean at 55 days with everything else held -- same
species, same age, same sowing, leaf area rescaled to an identical LAI so only
the shape can differ -- five seeds spanned faPAR 0.703 to 0.799. That 0.096 is
larger than the seasonal term the sun window exists to capture, and three times
a 20 percent error in the LAI the series inversion works to get right.

Until this existed the action grew seed 7 and printed three decimals of a
number whose own spread lands in the second. The band is the honest form of the
same computation, and no new data buys it: it is the model's own variance, and
it can only be sampled.

COST IS WHY THE DEFAULT IS THREE AND NOT THIRTY. The march is about 11 s and
dominates; growing a plant is 0.24 s.
"""

from __future__ import annotations

import numpy as np

MIN_SEEDS = 1
MAX_SEEDS = 12
# The march is over a voxel grid, and a module has to hold enough of them for
# the geometry to mean anything.
MIN_CELLS_PER_MODULE = 4
TARGET_CELL_M = 0.05


def module_geometry(inter_row, inter_plant):
    """
    One periodic module carrying one plant, and the voxel size to march it at.

    The module is the square of the same area as the sowing's rectangle, so the
    LAI the march integrates is the sowing's and not the plant's: a plant grown
    at one spacing and marched at another reports a canopy nobody planted.
    """
    module = float(np.sqrt(inter_row * inter_plant))
    cell = module / max(int(round(module / TARGET_CELL_M)), MIN_CELLS_PER_MODULE)
    return module, cell


def light(species, day, *, inter_row, inter_plant, energy, el_edges, dhi_share,
          row_azimuth_deg=0.0, base_seed=7, n_seeds=3, progress=None,
          grow=None, leaf_cloud=None, field=None):
    """
    Grow `n_seeds` draws of the same canopy, light each, and report the median.

    The median run carries the headline, so the reported figures stay a
    self-consistent single canopy rather than a mean of quantities that do not
    average: a mean faPAR beside a mean cover describes no canopy that was
    marched.

    The four callables default to the real modules and are parameters so a test
    can reach this without growing a plant.
    """
    if grow is None or leaf_cloud is None or field is None:
        from terra.canopy import field as cfield, helios_grow as hgrow
        grow = grow or hgrow.grow
        leaf_cloud = leaf_cloud or hgrow.leaf_cloud
        field = field or cfield

    n_seeds = max(MIN_SEEDS, min(int(n_seeds), MAX_SEEDS))
    module, cell = module_geometry(inter_row, inter_plant)

    runs = []
    for index in range(n_seeds):
        if progress:
            progress(80 + int(15 * index / n_seeds),
                     f'lighting canopy {index + 1} of {n_seeds}')
        grown = grow(species=species, days=int(round(day)), seed=base_seed + index)
        positions, leaf_area, _meta = leaf_cloud(grown)
        positions = np.asarray(positions, float).copy()
        positions[:, 0] = np.mod(positions[:, 0] + module / 2, module)
        positions[:, 1] = np.mod(positions[:, 1] + module / 2, module)
        grid, field_meta = field.leaf_cloud_field(
            positions, leaf_area, spacing=module, cell=cell)
        run = field.light_under_sun(
            field.canopy_of(grid, field_meta), energy, el_edges,
            dhi_share=dhi_share, row_azimuth_deg=row_azimuth_deg)
        # THE FRACTION OF GROUND UNDER LEAF, which is the one geometric number
        # that tracks the answer. Measured at fixed LAI: sweeping the canopy's
        # horizontal extent moves faPAR 0.19 to 0.88 and faPAR follows cover
        # almost proportionally, while sweeping its HEIGHT over a factor of 2.4
        # moves it 0.020. Reported so a reader with an observed cover -- which a
        # nadir view gives cheaply -- can check the simulated canopy against the
        # field's.
        run['cover'] = float((grid.sum(axis=2) > 0).mean())
        run['seed'] = base_seed + index
        runs.append(run)

    runs.sort(key=lambda run: run.get('fapar', 0.0))
    lit = dict(runs[len(runs) // 2])
    fapars = [float(run['fapar']) for run in runs]
    covers = [float(run['cover']) for run in runs]
    lit['ensemble'] = {
        'n': len(runs),
        'fapar_min': min(fapars),
        'fapar_max': max(fapars),
        'fapar_spread': max(fapars) - min(fapars),
        'cover_min': min(covers),
        'cover_max': max(covers),
        'seeds': [int(run['seed']) for run in runs],
    }
    return lit
