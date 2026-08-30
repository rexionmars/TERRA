"""
What the package imports, and what it must not.

Two properties that no other test in this suite can see, both of which a
refactoring breaks silently rather than loudly.

THE DEFERRED-IMPORT PROPERTY. Resolving an action must not import pvlib, torch,
scikit-learn, scipy, pystac_client or planetary_computer. Those are the heavy
dependencies, two of them optional in installations that still have to answer
every other action, and the property is what lets terra/registry.py hold dotted
paths as strings. A module-level `import pvlib` written where a deferred one
belonged costs start-up latency on every run and an ImportError on a machine
that was working, and nothing else here would fail.

It has to be measured in a CHILD PROCESS. sys.modules is process-wide, and by
the time pytest reaches this file another test module has already imported wind,
energy and solar; an in-process assertion would be reading the suite's own
imports and would pass no matter what the package does.

THE DEFERRED-ALIAS PROPERTY. A module imported inside a function body is
reached through a name that exists only in that body, and the attributes taken
off it are never checked by anything: no test in this suite calls the action
functions, so `solar_mod.prepare_hourl()` would ship. This walks the source and
resolves every such attribute against the real module.
"""

from __future__ import annotations

import ast
import importlib
import json
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

SIDECAR = Path(__file__).resolve().parents[1]

# The dependencies whose weight or optionality is the reason the registry
# resolves by string. scipy is here because linear_trend defers it and nothing
# else would notice if that stopped being true.
WATCHED = (
    'pvlib',
    'torch',
    'sklearn',
    'scipy',
    'pystac_client',
    'planetary_computer',
)


def test_resolving_every_action_imports_no_heavy_dependency():
    """
    Every action name resolved, every terra submodule imported, and none of the
    watched packages present afterwards.

    The submodule walk is the half that survives the migration. resolve() only
    imports the module an action names, so once the products move into slices a
    check that resolved actions alone would stop observing the modules the move
    creates.
    """
    script = textwrap.dedent(f"""
        import importlib, json, pkgutil, sys

        import terra
        from terra import registry

        for name in registry.ACTIONS:
            registry.resolve(name)

        for found in pkgutil.walk_packages(terra.__path__, 'terra.'):
            importlib.import_module(found.name)

        print(json.dumps(sorted(set({WATCHED!r}) & set(sys.modules))))
    """)
    run = subprocess.run(
        [sys.executable, '-c', script],
        cwd=SIDECAR, capture_output=True, text=True,
    )
    assert run.returncode == 0, run.stderr
    imported = json.loads(run.stdout.strip().splitlines()[-1])
    assert imported == [], (
        f'resolving an action imported {imported}, which the registry exists '
        f'to avoid; see the module docstring of terra/registry.py'
    )


def _module_aliases(node):
    """
    The module names an import inside this scope binds: alias -> module, plus
    the dotted modules that have to be imported for the attribute chain to
    exist.

    `import urllib.request` binds `urllib`, not `urllib.request`, so the alias
    is the top package and the submodule is imported separately or the
    attribute would be missing for a reason that is about this checker rather
    than about the code.
    """
    aliases, preimports = {}, set()
    for child in ast.walk(node):
        if isinstance(child, ast.Import):
            for name in child.names:
                if name.asname:
                    aliases[name.asname] = name.name
                else:
                    aliases[name.name.split('.')[0]] = name.name.split('.')[0]
                preimports.add(name.name)
        elif isinstance(child, ast.ImportFrom) and child.module and child.level == 0:
            for name in child.names:
                aliases[name.asname or name.name] = f'{child.module}.{name.name}'
    return aliases, preimports


def _shadowed(node):
    """
    Names this scope assigns, which therefore are not the import any more.

    `from rasterio import features` followed by `features = []` in the same
    body is a local list, and reading `.append` off it says nothing about the
    module. Shadowing an import is worth knowing about, but it is a different
    finding from a name that does not exist.
    """
    names = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Name) and isinstance(child.ctx, (ast.Store, ast.Del)):
            names.add(child.id)
        elif isinstance(child, ast.arg):
            names.add(child.arg)
    return names


def _attribute_uses(tree):
    """(module, attribute, line) for every alias.attr reachable in the source."""
    uses, preimports = [], set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Module)):
            continue
        aliases, wanted = _module_aliases(node)
        preimports |= wanted
        for shadow in _shadowed(node):
            aliases.pop(shadow, None)
        if not aliases:
            continue
        for child in ast.walk(node):
            if (isinstance(child, ast.Attribute)
                    and isinstance(child.value, ast.Name)
                    and child.value.id in aliases):
                uses.append((aliases[child.value.id], child.attr, child.lineno))
    for name in preimports:
        _importable(name)
    # A nested function is walked twice, once inside the module scope and once
    # as its own, so the same read arrives twice with the same line number.
    return sorted(set(uses))


def _importable(name):
    try:
        return importlib.import_module(name)
    except Exception:
        return None


SOURCES = sorted(
    p for p in SIDECAR.rglob('*.py')
    if 'tests' not in p.parts and 'tools' not in p.parts and '__pycache__' not in p.parts
)


@pytest.mark.parametrize('source', SOURCES, ids=lambda p: str(p.relative_to(SIDECAR)))
def test_every_module_attribute_taken_off_an_import_exists(source):
    """
    An attribute read off an imported module resolves on that module.

    This is the check that covers a rename: the call sites that reach across
    modules sit inside action bodies that nothing in this suite executes, so a
    name that moved out from under one of them fails here or it fails in front
    of a user.
    """
    sys.path.insert(0, str(SIDECAR))
    tree = ast.parse(source.read_text())
    missing, unavailable = [], set()
    for module_name, attribute, line in _attribute_uses(tree):
        module = _importable(module_name)
        if module is None:
            unavailable.add(module_name)
            continue
        if not hasattr(module, attribute):
            rel = source.relative_to(SIDECAR)
            missing.append(f'{rel}:{line} reads {module_name}.{attribute}')
    assert not missing, '\n'.join(missing)
