"""The frontend legend must be drawn with the stops that drew the raster.

Three of the seven RdYlGn stops in the hand-written frontend copy had drifted
from the sidecar by up to 40 of 255, so the NDVI legend described a ramp its
pixels were not drawn on. Nothing failed, because nothing compared them.
"""

from __future__ import annotations

import re
from pathlib import Path

import composite as comp

PALETTES_TS = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "palettes.ts"
)


def _to_hex(stops):
    """Truncate, matching the renderer's astype(uint8)."""
    return ["#%02x%02x%02x" % tuple(int(c * 255) for c in s) for s in stops]


def _parse_ts() -> dict[str, list[str]]:
    text = PALETTES_TS.read_text(encoding="utf-8")
    out: dict[str, list[str]] = {}
    for name, body in re.findall(r"^  (\w+): \[\n(.*?)^  \],$", text, re.M | re.S):
        out[name] = re.findall(r'"(#[0-9a-f]{6})"', body)
    return out


def test_palettes_ts_exists():
    assert PALETTES_TS.exists(), (
        f"{PALETTES_TS} missing; run python sidecar/tools/gen_palettes.py"
    )


def test_every_sidecar_palette_reaches_the_frontend():
    ts = _parse_ts()
    assert set(ts) == set(comp.CONTINUOUS_STOPS), (
        "a palette the sidecar can render is not available to the legend"
    )


def test_no_stop_has_drifted():
    ts = _parse_ts()
    for name, stops in comp.CONTINUOUS_STOPS.items():
        assert ts[name] == _to_hex(stops), (
            f"{name} drifted; run python sidecar/tools/gen_palettes.py"
        )
