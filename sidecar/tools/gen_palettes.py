#!/usr/bin/env python3
"""Regenerate frontend/src/lib/palettes.ts from the sidecar palette table.

The frontend needs the same colour stops the sidecar drew a raster with, and a
hand copy drifts: three of the seven RdYlGn stops had diverged by up to 40 of
255, so the NDVI legend described a ramp the pixels were not drawn on.
"""
from __future__ import annotations

import sys
from pathlib import Path

SIDECAR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR))

import composite as comp  # noqa: E402

ORDER = ["rdylgn", "blues", "inferno", "viridis", "rdbu_r"]
OUT = SIDECAR.parent / "frontend" / "src" / "lib" / "palettes.ts"


def to_hex(stops):
    """Truncate, matching the renderer's astype(uint8)."""
    return ["#%02x%02x%02x" % tuple(int(c * 255) for c in s) for s in stops]


def render() -> str:
    head = [
        "// Generated from sidecar/composite.py CONTINUOUS_STOPS.",
        "//",
        "// Hand-transcribing these is how the NDVI legend came to disagree with the",
        "// raster it described, by up to 40 of 255 on three stops. Regenerate with",
        "//",
        "//   python sidecar/tools/gen_palettes.py",
        "//",
        "// and sidecar/tests/test_palette_sync.py fails if this file drifts again.",
        "// Values are truncated the same way the renderer truncates, so a legend",
        "// swatch and its pixel are the same byte.",
        "",
        "export type PaletteName = " + " | ".join(f'"{n}"' for n in ORDER),
        "",
        "export const PALETTE_STOPS: Record<PaletteName, string[]> = {",
    ]
    body = []
    for n in ORDER:
        body.append(f"  {n}: [")
        body += [f'    "{h}",' for h in to_hex(comp.CONTINUOUS_STOPS[n])]
        body.append("  ],")
    tail = [
        "}",
        "",
        "/** CSS gradient for a legend swatch drawn with the named ramp. */",
        "export function paletteGradient(name: PaletteName): string {",
        "  const stops = PALETTE_STOPS[name]",
        "  const n = stops.length - 1",
        "  return `linear-gradient(to right, ${stops",
        "    .map((c, i) => `${c} ${((i / n) * 100).toFixed(2)}%`)",
        '    .join(", ")})`',
        "}",
        "",
    ]
    return "\n".join(head + body + tail)


if __name__ == "__main__":
    OUT.write_text(render(), encoding="utf-8")
    print(f"wrote {OUT}")
