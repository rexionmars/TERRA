"""
The one module that imports Helios.

WHY IT IS ALONE. `helios_bridge.py` takes the scene as a duck-typed object and
says in its own docstring that it never imports pyhelios, which is what keeps
the GPL-2/GPL-3 boundary at the process edge and what lets its tests run without
a 3D toolkit. Something still has to construct the scene, and that something is
here, in a module that is allowed to be unimportable.

WHAT HELIOS IS AND IS NOT USED FOR. Architecture only: plantarchitecture grows a
plant and labels every primitive by organ, and the bridge reads those labels.
The radiation plug-in is deliberately not touched. That is a decision, not an
accident of packaging -- the light is computed by canopy.py and canopy_voxel.py,
which are numpy and run everywhere. Three things follow. There is no GPU
requirement anywhere in this path. The Metal kernel fault that stops Helios's
radiation on Apple Silicon is not on it either, because that code never loads.
And a build of Helios carrying only plantarchitecture is sufficient, which is
most of its installed weight removed.

DEGRADING VISIBLY. pyhelios3d is not in requirements.txt and the managed
environment never contains it, so absence is the common case rather than an edge
one. The import below is at module top level on purpose: it fails loudly at
import, and the caller in infer.py turns that into a sentence naming the package
instead of a traceback. What it must NOT do is the pattern in phenology.py,
where a missing scipy rebinds the symbol to None and the run continues
unsmoothed -- that produces a plausible answer that is quietly worse, which is
the failure class this whole path is built to avoid. Without Helios the canopy
falls back to analytic ellipsoid crowns, and the field says so in its metadata,
because the two are not interchangeable: an ellipsoid preserving leaf area and
envelope intercepts markedly more light than the architecture it stands in for.
"""

from __future__ import annotations

import numpy as np

import pyhelios3d as ph


# The species plantarchitecture ships. Recorded here rather than queried lazily
# so a caller can offer a list without instantiating the toolkit, and so a name
# that disappears upstream fails against this list rather than deep inside a
# build call.
LIBRARY = (
    "almond", "almond_aldrich", "almond_wood_colony", "apple",
    "apple_fruitingwall", "asparagus", "bean", "bindweed", "bougainvillea",
    "butterlettuce", "capsicum", "cheeseweed", "cherrytomato", "cowpea",
    "easternredbud", "grapevine_VSP", "grapevine_Wye", "groundcherryweed",
    "maize", "olive", "pistachio", "puncturevine", "rice", "sorghum",
    "soybean", "strawberry", "sugarbeet", "tomato", "walnut", "wheat",
)


class Grown:
    """A grown plant and the two handles the bridge needs from it.

    `ctx` satisfies the five methods helios_bridge documents; `pa` answers
    `getPlantLeafArea`, which is what the bridge's self_check measures itself
    against. Held together because they are only meaningful as a pair -- a
    context without its architecture object cannot be checked.
    """

    def __init__(self, ctx, pa, plant_id, species, days):
        self.ctx = ctx
        self.pa = pa
        self.plant_id = plant_id
        self.species = species
        self.days = days


def grow(species="almond", days=120, seed=None):
    """
    Advance one plant of `species` by `days` and return it with its context.

    Time is advanced in a single call because plantarchitecture integrates
    internally; stepping it in pieces produces a different plant, not the same
    plant observed more often.
    """
    if species not in LIBRARY:
        raise ValueError(
            f"unknown species {species!r}. plantarchitecture ships: "
            + ", ".join(LIBRARY)
        )
    if days <= 0:
        raise ValueError("days must be positive")

    ctx = ph.Context()
    if seed is not None:
        ctx.seedRandomGenerator(int(seed))
    pa = ph.PlantArchitecture(ctx)
    plant_id = pa.buildPlantCanopyFromLibrary(species)
    pa.advanceTime(int(days))
    return Grown(ctx, pa, plant_id, species, int(days))


def leaf_cloud(grown, organs=("leaf",)):
    """
    Leaf centroids and areas, checked against the area Helios reports.

    The check is not optional here. `helios_bridge.self_check` exists because an
    extraction that loses or duplicates primitives yields a canopy that is wrong
    everywhere and looks entirely normal, and this is the only place in the
    pipeline where the two numbers can still be compared -- downstream there is
    only the voxel grid, which has no memory of how much leaf went into it.
    """
    import helios_bridge as hb

    scene = hb.extract(grown.ctx)
    pos, area = hb.leaf_cloud(scene, organs=organs)

    reported = float(grown.pa.getPlantLeafArea(grown.plant_id))
    extracted = float(np.sum(area))
    relative = abs(extracted - reported) / max(reported, 1e-12)
    if relative > 1e-3:
        raise RuntimeError(
            f"extracted leaf area {extracted:.6f} m2 disagrees with the "
            f"{reported:.6f} m2 Helios reports for plant {grown.plant_id} "
            f"(relative {relative:.2e}). The scene did not come across intact, "
            f"so nothing computed from it would be trustworthy."
        )
    return pos, area, {"leaf_area": extracted, "reported": reported,
                       "relative_error": relative, "organs": list(organs)}
