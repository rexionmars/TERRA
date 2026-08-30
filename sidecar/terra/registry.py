"""
The action names the shell can ask for, and where each one lives.

The table holds dotted paths as strings, never imported functions, and the
module is imported only when its action is the one requested. That is what
keeps a classification run from importing pvlib and a wind screening from
importing torch: both are third-party packages weighing more than the rest of
the sidecar together, and one of them is optional in installations that still
have to answer every other action.

Before this table existed the same property was carried by 55 deferred imports
written by hand inside function bodies. It now has one place to be correct, and
since the actions moved into their slices it carries more than laziness: an
action name maps to the product that answers it, and adding a product is one
directory and one line here.
"""

from __future__ import annotations

import importlib
from collections.abc import Callable
from pathlib import Path

from terra.protocol import Request

Action = Callable[[Request, Path], None]

ACTIONS: dict[str, str] = {
    'ping': 'terra.cli:ping',
    'predict': 'terra.landcover.actions:predict',
    'lulc': 'terra.landcover.actions:lulc',
    'domain_shift': 'terra.landcover.actions:domain_shift',
    'domain_shift_cohort': 'terra.landcover.actions:domain_shift_cohort',
    'water': 'terra.water.actions:water',
    'flood_envelope': 'terra.flood.actions:flood_envelope',
    'solar_resource': 'terra.energy.actions:solar_resource',
    'solar_terrain': 'terra.energy.actions:solar_terrain',
    'solar_siting': 'terra.energy.actions:solar_siting',
    'energy_model': 'terra.energy.actions:energy_model',
    'wind_resource': 'terra.energy.actions:wind_resource',
    'canopy_field': 'terra.canopy.actions:canopy_field',
    'canopy_mesh': 'terra.canopy.actions:canopy_mesh',
    'canopy_from_aoi': 'terra.canopy.actions:canopy_from_aoi',
    'list_datacube': 'terra.scenes.actions:list_datacube',
    'render_composite': 'terra.scenes.actions:render_composite',
    'surface_model': 'terra.surface.actions:surface_model',
}

DEFAULT_ACTION = 'predict'


def resolve(action: str) -> Action:
    """
    The function that answers `action`, imported at the moment it is needed.

    An unknown action resolves to the prediction path. That is what the branch
    chain this table replaced did by falling through to it, and what a request
    that names no action at all asks for.
    """
    target = ACTIONS.get(action, ACTIONS[DEFAULT_ACTION])
    module_path, _, name = target.partition(':')
    return getattr(importlib.import_module(module_path), name)
