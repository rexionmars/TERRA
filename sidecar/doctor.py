#!/usr/bin/env python3
"""
Reports whether this interpreter can actually run the sidecar.

Run in the CANDIDATE interpreter, not in the one that ships with the app, and
prints one JSON object on stdout. The application uses it to decide whether an
environment is usable and, when it is not, to say precisely what is missing.

WHY THIS EXISTS. The boot probe ran `python -c "import sys; print(sys.version)"`
and, if that answered, wrote "sidecar ready". It measured the INTERPRETER; it
never measured the ENVIRONMENT. A bare Python 3.12 with nothing installed passed
it, and the user found out only after drawing an area, choosing a period and
waiting for a run to die on an import.

The same blindness shipped a real defect: the POWER cache writes parquet, which
needs an engine that nothing declared, so on any install following
requirements.txt the cache silently never worked and every run repaid a fetch of
about 23 seconds. Nothing surfaced it, because nothing was looking.

The list lives here rather than in Go because this file is next to the code that
does the importing. A module that starts importing something new is one edit
away from being reported, instead of being reported by a list in another
language that nobody remembers to update.
"""
from __future__ import annotations

import importlib
import importlib.metadata as md
import json
import sys


class Need:
    """One import the sidecar makes, and what stops working without it."""

    def __init__(self, module: str, distribution: str, blocks: str,
                 optional: bool = False, floor: tuple | None = None,
                 ceiling: tuple | None = None, why: str = ""):
        # What `import` asks for, which is not always what pip installs:
        # scikit-learn imports as sklearn, pystac-client as pystac_client.
        self.module = module
        self.distribution = distribution
        # Stated in the user's terms -- a product, not a traceback.
        self.blocks = blocks
        # Optional needs degrade a feature; required needs stop everything.
        self.optional = optional
        # A version window, where one is load-bearing. Presence is not
        # correctness: scikit-learn imports fine at any version and then fails,
        # or silently misreads, a forest pickled by a different one.
        self.floor = floor
        self.ceiling = ceiling
        self.why = why


NEEDS = [
    Need("numpy", "numpy", "every product"),
    Need("scipy", "scipy", "phenology smoothing and the solar statistics"),
    Need("rasterio", "rasterio", "reading and writing any raster"),
    Need("shapely", "shapely", "area geometry"),
    Need("pyproj", "pyproj", "projection and area in hectares"),
    Need("joblib", "joblib", "loading the trained classifier"),
    # The window is the pin in requirements.txt, and it is load-bearing rather
    # than tidy: the forests in model/ were pickled by 1.8.x, and joblib
    # deserialisation across a scikit-learn minor is documented to warn or fail.
    # A run that loads under the wrong version is worse than one that refuses,
    # because it produces a classification nobody can trust.
    Need("sklearn", "scikit-learn", "the Random Forest classification",
         floor=(1, 8), ceiling=(1, 9),
         why="model/ was pickled by scikit-learn 1.8.x"),
    Need("pystac_client", "pystac-client", "finding Sentinel-2 scenes"),
    Need("planetary_computer", "planetary-computer", "reading Sentinel-2 scenes"),
    Need("pandas", "pandas", "the solar, wind and energy series"),
    Need("pvlib", "pvlib", "the photovoltaic model"),
    # Not imported by name anywhere: pandas reaches for it to read and write
    # the POWER cache. Absent, pandas raises inside the try that keeps a cache
    # failure from failing a run, so the only symptom is every run being slow.
    Need("pyarrow", "pyarrow", "the POWER cache, so every run refetches",
         optional=True),
    # The heavy models. Deliberately absent from the bundled environment: torch
    # alone outweighs everything else the application ships.
    Need("torch", "torch", "Temporal Transformer and Prithvi", optional=True),
    # Optional for the same reason as torch, and absent for one more: the wheel
    # carries a compiled C++ core, so the sidecar's own modules deliberately do
    # not import it -- helios_bridge takes the scene as a duck-typed object, and
    # the canopy engines are numpy. Nothing degrades until someone asks to grow
    # a plant, which is why this reports missing without making the environment
    # unusable.
    Need("pyhelios3d", "pyhelios3d", "growing a 3D crop", optional=True,
         floor=(0, 1, 27),
         why="plantarchitecture growth and the organ labels the bridge reads"),
]

# The interpreter the trained artifacts and the wheels were built against.
MIN_PYTHON = (3, 12)


def _version(distribution: str) -> str | None:
    try:
        return md.version(distribution)
    except Exception:
        return None


def _parts(version: str) -> tuple:
    """Leading numeric components, so 1.8.2.post1 compares as (1, 8, 2)."""
    out = []
    for chunk in version.split("."):
        digits = ""
        for ch in chunk:
            if not ch.isdigit():
                break
            digits += ch
        if not digits:
            break
        out.append(int(digits))
    return tuple(out)


def _window(need: Need, version: str | None) -> str | None:
    """The reason this version is wrong, or None when it is acceptable."""
    if version is None or (need.floor is None and need.ceiling is None):
        return None
    got = _parts(version)
    if not got:
        return None
    if need.floor and got < need.floor:
        return f"{version} is older than {'.'.join(map(str, need.floor))}"
    if need.ceiling and got >= need.ceiling:
        return f"{version} is {'.'.join(map(str, need.ceiling))} or newer"
    return None


def _wanted(need: Need) -> str | None:
    if need.floor is None and need.ceiling is None:
        return None
    lo = ".".join(map(str, need.floor)) if need.floor else None
    hi = ".".join(map(str, need.ceiling)) if need.ceiling else None
    if lo and hi:
        return f">={lo},<{hi}"
    return f">={lo}" if lo else f"<{hi}"


def inspect() -> dict:
    packages = []
    for need in NEEDS:
        try:
            importlib.import_module(need.module)
            present = True
            detail = None
        except Exception as exc:
            present = False
            # The message, not just the type: an ImportError raised by a broken
            # native library reads very differently from a missing package, and
            # the difference is what the user needs to act on.
            detail = f"{type(exc).__name__}: {exc}"[:300]
        version = _version(need.distribution) if present else None
        packages.append({
            "module": need.module,
            "distribution": need.distribution,
            "blocks": need.blocks,
            "optional": need.optional,
            "present": present,
            "version": version,
            "wanted": _wanted(need),
            # Present but out of window. Reported apart from `present` because
            # the two need different actions: one is an install, the other is a
            # downgrade or an upgrade of something already there.
            "version_problem": _window(need, version),
            "why": need.why or None,
            "error": detail,
        })

    missing_required = [p for p in packages if not p["present"] and not p["optional"]]
    wrong_version = [p for p in packages if p["version_problem"] and not p["optional"]]
    version_ok = sys.version_info[:2] >= MIN_PYTHON

    return {
        "executable": sys.executable,
        "python_version": ".".join(str(v) for v in sys.version_info[:3]),
        "python_ok": version_ok,
        "min_python": ".".join(str(v) for v in MIN_PYTHON),
        "packages": packages,
        # Usable means every required package imported, at a version inside any
        # window that matters, and the interpreter is new enough. An optional
        # gap is reported and does not block.
        "usable": version_ok and not missing_required and not wrong_version,
    }


if __name__ == "__main__":
    json.dump(inspect(), sys.stdout)
    sys.stdout.write("\n")
