#!/usr/bin/env python3
"""Regenerate sidecar/data/lai_ladder.json -- leaf area by species and age.

WHAT IT IS FOR. The application observes LAI: a Sentinel-2 NDVI series over an
AOI, inverted by lai_ndvi.py. Helios grows architecture the other way round, by
species and age, on its own schedule -- there is no way to ask it for a plant of
a given LAI. This table is the inverse it does not offer: read leaf area, get
the age that produces it.

WHY LEAF AREA PER PLANT AND NOT LAI. LAI is leaf area over ground area, so it
depends on the sowing the reader chooses; a table of LAI would be a table about
one sowing. Area per plant is a property of the plant alone, and

    LAI = leaf_area_per_plant * plants_per_m2

turns it into whatever sowing is asked for. One table, every density.

WHY GENERATED AND STORED rather than computed on demand: growing costs about two
seconds per age, and the walk is deterministic in its seed, so a request that had
to build the ladder first would pay minutes to rediscover a fixed answer.

THE PLATEAU IS THE POINT OF THE `plateau_day` FIELD. Every species stops growing
at some age -- sorghum holds 0.75 m2 from day 40 on -- and past that point leaf
area no longer identifies an age. A consumer that ignores this will read a
mature canopy as a 40-day-old one. The field says where the inversion stops
being one-to-one so the caller can refuse, or disambiguate from phenology.

    python sidecar/tools/gen_lai_ladder.py                # every species
    python sidecar/tools/gen_lai_ladder.py sorghum maize  # just these
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

SIDECAR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR))

import numpy as np  # noqa: E402

import helios_grow as hg  # noqa: E402

OUT = SIDECAR / "data" / "lai_ladder.json"

# The ages walked. Dense where crops develop and sparse afterwards, because the
# ladder is only invertible before the plateau and the tail exists to locate it.
DAYS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 90, 120]

# Fixed so the table is reproducible; the same seed the studies use.
SEED = 7

# Two consecutive ages whose leaf area differs by less than this fraction are
# the same plant as far as an inversion is concerned. 1% is well inside the
# noise of any NDVI-derived LAI that would be matched against it.
PLATEAU_REL = 0.01


def walk(species: str) -> dict | None:
    """Grow `species` at every age and record what it became.

    Returns None when the species cannot be grown at all, which is not an error
    worth stopping for: the library ships models that a given build may not
    carry, and a table missing one species is more useful than no table.
    """
    steps = []
    for day in DAYS:
        try:
            grown = hg.grow(species=species, days=day, seed=SEED)
            pids = grown.plant_id if isinstance(grown.plant_id, list) else [grown.plant_id]
            leaf_area = float(sum(grown.pa.getPlantLeafArea(p) for p in pids))
            # Height from the leaf cloud rather than from a stem query: it is
            # the number the canopy field uses for z_top, so the ladder should
            # carry the same one.
            pos, _area, _meta = hg.leaf_cloud(grown)
            height = float(np.asarray(pos, float)[:, 2].max()) if len(pos) else 0.0
        except Exception as exc:  # noqa: BLE001
            print(f"  dia {day:>3}: {type(exc).__name__}: {exc}", file=sys.stderr)
            continue
        steps.append({"day": day, "leaf_area_m2": leaf_area, "height_m": height})
        print(f"  dia {day:>3}  area {leaf_area:7.4f} m2  altura {height:5.2f} m")

    if len(steps) < 2:
        return None

    # Where growth stops. Walked forward, so the first age whose area no longer
    # improves on its predecessor is the answer, and everything after it is the
    # same plant.
    plateau = None
    for prev, cur in zip(steps, steps[1:]):
        if prev["leaf_area_m2"] <= 0:
            continue
        rel = (cur["leaf_area_m2"] - prev["leaf_area_m2"]) / prev["leaf_area_m2"]
        if rel < PLATEAU_REL:
            plateau = prev["day"]
            break

    return {
        "steps": steps,
        "plateau_day": plateau,
        "max_leaf_area_m2": max(s["leaf_area_m2"] for s in steps),
        "max_height_m": max(s["height_m"] for s in steps),
    }


def main() -> int:
    wanted = sys.argv[1:] or list(hg.LIBRARY)
    unknown = [s for s in wanted if s not in hg.LIBRARY]
    if unknown:
        print(f"espécies desconhecidas: {', '.join(unknown)}", file=sys.stderr)
        print(f"disponíveis: {', '.join(hg.LIBRARY)}", file=sys.stderr)
        return 2

    try:
        hg.grow(species=wanted[0], days=5, seed=SEED)
    except ImportError as exc:
        print(f"pyhelios3d ausente neste interpretador: {exc}", file=sys.stderr)
        print("instale com: pip install -r requirements-helios.txt", file=sys.stderr)
        return 1

    table: dict[str, dict] = {}
    t0 = time.time()
    for species in wanted:
        print(f"\n{species}")
        got = walk(species)
        if got is None:
            print(f"  (nada cresceu; fora da tabela)")
            continue
        table[species] = got
        p = got["plateau_day"]
        print(f"  -> platô {'no dia ' + str(p) if p else 'não alcançado'}, "
              f"máx {got['max_leaf_area_m2']:.4f} m2")

    if not table:
        print("nenhuma espécie cresceu", file=sys.stderr)
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generator": "sidecar/tools/gen_lai_ladder.py",
        "units": {"leaf_area_m2": "m2 per plant", "height_m": "m"},
        "seed": SEED,
        "days": DAYS,
        "plateau_rel": PLATEAU_REL,
        "note": (
            "LAI = leaf_area_m2 * plants_per_m2. Past plateau_day leaf area no "
            "longer identifies an age; refuse or disambiguate from phenology."
        ),
        "species": table,
    }, indent=2, sort_keys=True) + "\n")

    print(f"\n{len(table)} espécies em {time.time() - t0:.0f} s -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
