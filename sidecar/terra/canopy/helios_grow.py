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

DEGRADING VISIBLY. pyhelios3d is an optional extra -- requirements-helios.txt,
not requirements.txt -- so the managed environment does not contain it unless
someone asks, and absence stays the common case rather than an edge one. Install
it with `pip install -r requirements-helios.txt`; the distribution is
`pyhelios3d` and the module it provides is `pyhelios`, which is the name
everything here must import and probe. Getting that backwards is not a
theoretical risk: this module, doctor.py and the Go refusal test all imported
the distribution name, so a correct install reported itself missing and this
whole path looked unavailable on machines that could run it.
The import is inside `grow` rather than at module top level, for one
reason: `LIBRARY` below is the species list a picker needs in order to offer
anything, and a top-level import made it unreadable on exactly the machines it
was written for. The refusal still happens on the only call that needs Helios,
and the caller in infer.py turns it into a sentence naming the package instead
of a traceback. What it must NOT do is the pattern in phenology.py,
where a missing scipy rebinds the symbol to None and the run continues
unsmoothed -- that produces a plausible answer that is quietly worse, which is
the failure class this whole path is built to avoid. Without Helios the canopy
falls back to analytic ellipsoid crowns, and the field says so in its metadata,
because the two are not interchangeable: an ellipsoid preserving leaf area and
envelope intercepts markedly more light than the architecture it stands in for.
"""

from __future__ import annotations

import numpy as np

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


def _silence(pa):
    """Stop plantarchitecture writing its progress bar to stdout.

    The sidecar protocol is one JSON document on stdout. Helios writes
    "Advancing time: [===>  ] 40%" there as it integrates, which arrives ahead
    of the reply and makes it unparseable -- the symptom is an
    `invalid character 'A'` from the Go decoder, naming a byte of the word
    "Advancing" rather than anything about the canopy. Guarded because the
    method is a convenience the build may not carry.
    """
    try:
        pa.disableMessages()
    except Exception:
        pass


def grow_canopy(species="sorghum", days=60, rows=4, per_row=5,
                inter_row=0.8, inter_plant=0.2, seed=None):
    """
    A stand of plants on a sowing grid, grown together and returned as one scene.

    WHY A SEPARATE ENTRY POINT. `grow` below is one plant, which is what the
    voxel path needed: a single architecture, voxelised, tiled periodically by
    the march. A stand is not that repeated -- plantarchitecture places the
    plants itself and lets neighbours develop against each other, and the
    spacing is the agronomy the reader sets rather than a wrap the shader does.
    It is also what someone means by wanting to see a field.

    `plant_spacing` is (x, y) in metres and `plant_count` is (nx, ny), so the
    stand is inter_plant apart along a row and inter_row between rows. Time is
    advanced once for the whole canopy, for the reason `grow` gives.
    """
    if species not in LIBRARY:
        raise ValueError(
            f"unknown species {species!r}. plantarchitecture ships: "
            + ", ".join(LIBRARY)
        )
    if days <= 0:
        raise ValueError("days must be positive")
    if rows < 1 or per_row < 1:
        raise ValueError("rows and per_row must be at least 1")

    import pyhelios as ph
    from pyhelios import DataTypes as dt

    ctx = ph.Context()
    if seed is not None:
        ctx.seedRandomGenerator(int(seed))
    pa = ph.PlantArchitecture(ctx)
    # plantarchitecture draws a progress bar on stdout as it integrates, and
    # stdout is where the sidecar's JSON goes. Left on, the bar is prepended to
    # the reply and the Go side fails to parse a document it never saw whole.
    _silence(pa)
    pa.loadPlantModelFromLibrary(species)
    plant_ids = pa.buildPlantCanopyFromLibrary(
        dt.vec3(0.0, 0.0, 0.0),
        dt.vec2(float(inter_plant), float(inter_row)),
        dt.int2(int(per_row), int(rows)),
        0.0,
    )
    pa.advanceTime(float(days))

    # Carried as a Grown so the bridge and organ_uuids need no second shape;
    # plant_id is the list here, and the two consumers that read it are written
    # below to accept either.
    return Grown(ctx, pa, list(plant_ids), species, int(days))


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

    # The distribution is `pyhelios3d` on PyPI but the importable module is
    # `pyhelios`. Importing the distribution name is the error this module
    # carried: pip reported success and the import still failed, so the path
    # looked unavailable on machines where it was in fact installed.
    import pyhelios as ph
    from pyhelios import DataTypes as dt

    ctx = ph.Context()
    if seed is not None:
        ctx.seedRandomGenerator(int(seed))
    pa = ph.PlantArchitecture(ctx)
    _silence(pa)

    # One plant, not a canopy. `buildPlantCanopyFromLibrary` now takes a centre,
    # a spacing and a count and returns a list; the single instance this module
    # promises is the `buildPlantInstanceFromLibrary` call, which returns the one
    # id `getPlantLeafArea` is asked for downstream. Building the canopy here and
    # taking element zero would grow plants nobody reads and charge for them.
    pa.loadPlantModelFromLibrary(species)
    plant_id = pa.buildPlantInstanceFromLibrary(dt.vec3(0.0, 0.0, 0.0), 0.0)

    # Age is carried by advanceTime, not by the build call, so that `days` means
    # the same thing it meant before: the whole of the plant's life, integrated
    # in one call because plantarchitecture is not resumable.
    pa.advanceTime(float(days))
    return Grown(ctx, pa, plant_id, species, int(days))


# The organ accessors PlantArchitecture exposes, mapped to the names the bridge
# and ORGAN_COLOR already use. `shoot` has no accessor of its own: what is left
# once the named organs are removed is stem, and the bridge files it as "other"
# rather than guessing.
_ORGAN_ACCESSOR = {
    "leaf": "getPlantLeafObjectIDs",
    "petiole": "getPlantPetioleObjectIDs",
    "peduncle": "getPlantPeduncleObjectIDs",
    "fruit": "getPlantFruitObjectIDs",
    "flower": "getPlantFlowerObjectIDs",
}


def organ_uuids(grown):
    """Primitive uuids per organ, for a scene whose primitives carry no labels.

    Helios stopped writing `object_label` onto primitives and now answers by
    organ at the object level, from PlantArchitecture rather than the context.
    This turns that back into the {organ: uuids} mapping the bridge wants, so the
    bridge itself keeps knowing nothing about Helios.

    An accessor that a build does not ship is skipped rather than raised on: the
    species library varies, and a plant with no fruit is not an error.
    """
    ctx, pa = grown.ctx, grown.pa
    # One plant or a whole stand: `plant_id` is an int from `grow` and a list
    # from `grow_canopy`, and every accessor below is per plant either way.
    pids = grown.plant_id if isinstance(grown.plant_id, list) else [grown.plant_id]
    out = {}
    for organ, accessor in _ORGAN_ACCESSOR.items():
        get = getattr(pa, accessor, None)
        if get is None:
            continue
        uuids = []
        for pid in pids:
            try:
                object_ids = list(get(pid))
            except Exception:
                continue
            for oid in object_ids:
                uuids.extend(ctx.getObjectPrimitiveUUIDs(oid))
        if uuids:
            out[organ] = uuids
    return out


def leaf_cloud(grown, organs=("leaf",)):
    """
    Leaf centroids and areas, checked against the area Helios reports.

    The check is not optional here. `helios_bridge.self_check` exists because an
    extraction that loses or duplicates primitives yields a canopy that is wrong
    everywhere and looks entirely normal, and this is the only place in the
    pipeline where the two numbers can still be compared -- downstream there is
    only the voxel grid, which has no memory of how much leaf went into it.
    """
    from terra.canopy import helios_bridge as hb

    scene = hb.extract(grown.ctx, organ_uuids=organ_uuids(grown))
    pos, area = hb.leaf_cloud(scene, organs=organs)

    pids = grown.plant_id if isinstance(grown.plant_id, list) else [grown.plant_id]
    reported = float(sum(grown.pa.getPlantLeafArea(p) for p in pids))
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
