"""
The action names the shell can ask for, and where each one lives.

The table holds dotted paths as strings, never imported functions, and the
module is imported only when its action is the one requested. That is what
keeps a classification run from importing pvlib and a wind screening from
importing torch: both are third-party packages weighing more than the rest of
the sidecar together, and one of them is optional in installations that still
have to answer every other action.

Before this table existed the same property was carried by 55 deferred imports
written by hand inside function bodies. It now has one place to be correct.
"""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Callable

from terra.protocol import Request

Action = Callable[[Request, Path], None]

ACTIONS: dict[str, str] = {
    'ping': 'terra.actions:action_ping',
    'lulc': 'terra.actions:action_lulc',
    'domain_shift': 'terra.actions:action_domain_shift',
    'domain_shift_cohort': 'terra.actions:action_domain_shift_cohort',
    'canopy_field': 'terra.actions:action_canopy_field',
    'canopy_mesh': 'terra.actions:action_canopy_mesh',
    'canopy_from_aoi': 'terra.actions:action_canopy_from_aoi',
    'list_datacube': 'terra.actions:action_list_datacube',
    'solar_resource': 'terra.actions:action_solar_resource',
    'solar_terrain': 'terra.actions:action_solar_terrain',
    'solar_siting': 'terra.actions:action_solar_siting',
    'energy_model': 'terra.actions:action_energy_model',
    'wind_resource': 'terra.actions:action_wind_resource',
    'flood_envelope': 'terra.actions:action_flood_envelope',
    'water': 'terra.actions:action_water',
    'render_composite': 'terra.actions:action_render_composite',
    'predict': 'terra.actions:action_predict',
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
