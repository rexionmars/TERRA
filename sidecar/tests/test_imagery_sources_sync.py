"""
The catalogues the shell offers, against the ones the sidecar can read.

The shell lists them in internal/analysis/imagery.go to offer the choice in
Settings and to pass it on as TERRA_SENTINEL2_SOURCE and TERRA_SENTINEL1_SOURCE.
The sidecar holds them in terra/stac.py, with the addresses. A key the shell
offers and the sidecar does not know is a choice that fails at the first run,
so every offered key is checked here, from source, with no Go toolchain needed.
The sidecar may read a source the shell does not offer yet; imagery.go says
which and why.
"""
from __future__ import annotations

import re
from pathlib import Path

from terra import stac

IMAGERY_GO = Path(__file__).resolve().parents[2] / "internal" / "analysis" / "imagery.go"


def go_collections() -> dict[str, tuple[str, set[str]]]:
    """Each collection's variable and catalogue keys, read from imagery.go."""
    src = IMAGERY_GO.read_text(encoding="utf-8")
    out: dict[str, tuple[str, set[str]]] = {}
    for block in re.findall(r"\{\s*Collection:.*?Choices: \[\]ImageryChoice\{.*?\n\t\t\},", src, re.S):
        collection = re.search(r'Collection:\s*"([^"]+)"', block)[1]
        env = re.search(r'Env:\s*"([^"]+)"', block)[1]
        keys = set(re.findall(r'\{Key:\s*"([^"]+)"', block))
        out[collection] = (env, keys)
    return out


def test_the_shell_offers_only_catalogues_the_sidecar_reads():
    offered = go_collections()

    assert set(offered) == set(stac.SOURCES)
    for collection, (env, keys) in offered.items():
        assert env == stac.SOURCE_ENV[collection]
        assert keys <= set(stac.SOURCES[collection]), collection
        assert stac.DEFAULT_SOURCE in keys, collection


def test_both_sides_fall_back_to_the_same_catalogue():
    src = IMAGERY_GO.read_text(encoding="utf-8")
    default = re.search(r'const DefaultImagerySource = "([^"]+)"', src)[1]

    assert default == stac.DEFAULT_SOURCE
