// Generated from sidecar/composite.py CONTINUOUS_STOPS.
//
// Hand-transcribing these is how the NDVI legend came to disagree with the
// raster it described, by up to 40 of 255 on three stops. Regenerate with
//
//   python sidecar/tools/gen_palettes.py
//
// and sidecar/tests/test_palette_sync.py fails if this file drifts again.
// Values are truncated the same way the renderer truncates, so a legend
// swatch and its pixel are the same byte.

export type PaletteName = "rdylgn" | "blues" | "inferno" | "viridis" | "rdbu_r"

export const PALETTE_STOPS: Record<PaletteName, string[]> = {
  rdylgn: [
    "#a50026",
    "#f46d42",
    "#fcbf63",
    "#ffffbf",
    "#aadd89",
    "#66bc63",
    "#197738",
  ],
  blues: [
    "#f7f9ff",
    "#c6dbef",
    "#6badd6",
    "#3072af",
    "#07306b",
  ],
  inferno: [
    "#000003",
    "#0a0723",
    "#200c4a",
    "#3c0965",
    "#570f6d",
    "#70196e",
    "#892269",
    "#a32b61",
    "#bb3754",
    "#d14643",
    "#e45a31",
    "#f1721d",
    "#f98e08",
    "#fbac10",
    "#f8cb34",
    "#f1e968",
    "#fcfea4",
  ],
  viridis: [
    "#440153",
    "#47186a",
    "#472c7b",
    "#424085",
    "#3a528b",
    "#32628d",
    "#2c728e",
    "#25818e",
    "#20908c",
    "#1e9f88",
    "#28ae7f",
    "#3ebc73",
    "#5ec961",
    "#83d34b",
    "#addc30",
    "#d7e219",
    "#fde724",
  ],
  rdbu_r: [
    "#042f61",
    "#165190",
    "#2971b1",
    "#3f8dc0",
    "#6bacd0",
    "#9ac9e0",
    "#c2ddeb",
    "#dfecf2",
    "#f7f6f6",
    "#fae4d7",
    "#faccb4",
    "#f4aa88",
    "#e48065",
    "#d05447",
    "#b92732",
    "#930e26",
    "#66001f",
  ],
}

/** CSS gradient for a legend swatch drawn with the named ramp. */
export function paletteGradient(name: PaletteName): string {
  const stops = PALETTE_STOPS[name]
  const n = stops.length - 1
  return `linear-gradient(to right, ${stops
    .map((c, i) => `${c} ${((i / n) * 100).toFixed(2)}%`)
    .join(", ")})`
}

/**
 * The colour a ramp gives to t in [0,1], as the renderer computes it.
 *
 * `sidecar/composite.py:_lerp_cmap` is the definition, and this is that
 * function: segment index `min(floor(t*n), n-1)`, then a linear blend to the
 * next stop. Written out rather than approximated with the nearest stop,
 * because a legend that disagrees with its raster is the fault this file's
 * header exists to record -- and a paint expression built from these is a
 * legend that IS the raster.
 */
export function paletteColor(name: PaletteName, t: number): string {
  const stops = PALETTE_STOPS[name]
  const n = stops.length - 1
  const clamped = Math.min(1, Math.max(0, t))
  const idx = Math.min(Math.floor(clamped * n), n - 1)
  const f = clamped * n - idx
  const a = hexToRgb(stops[idx])
  const b = hexToRgb(stops[idx + 1])
  const mix = (i: number) => Math.round(a[i] + (b[i] - a[i]) * f)
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
