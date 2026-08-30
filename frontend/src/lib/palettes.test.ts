import { describe, expect, it } from "vitest"

import { PALETTE_STOPS, paletteColor } from "@/lib/palettes"

/*
  The renderer's own arithmetic, transcribed from sidecar/composite.py's
  _lerp_cmap, so the test states the contract rather than the implementation:
  segment index min(floor(t*n), n-1), then a linear blend to the next stop.
*/
function reference(stops: string[], t: number): [number, number, number] {
  const n = stops.length - 1
  const clamped = Math.min(1, Math.max(0, t))
  const idx = Math.min(Math.floor(clamped * n), n - 1)
  const f = clamped * n - idx
  const rgb = (hex: string): [number, number, number] => {
    const v = parseInt(hex.slice(1), 16)
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  }
  const a = rgb(stops[idx])
  const b = rgb(stops[idx + 1])
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * f)) as [
    number,
    number,
    number,
  ]
}

function parse(css: string): [number, number, number] {
  const m = css.match(/rgb\((\d+), (\d+), (\d+)\)/)
  if (!m) throw new Error(`not an rgb() string: ${css}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

describe("paletteColor", () => {
  it("returns the stop itself at each stop's own position", () => {
    for (const name of Object.keys(PALETTE_STOPS) as Array<
      keyof typeof PALETTE_STOPS
    >) {
      const stops = PALETTE_STOPS[name]
      stops.forEach((hex, i) => {
        const t = i / (stops.length - 1)
        expect(parse(paletteColor(name, t))).toEqual(reference(stops, t))
        // And the endpoints are the endpoints, not a blend near them.
        if (i === 0 || i === stops.length - 1) {
          const v = parseInt(hex.slice(1), 16)
          expect(parse(paletteColor(name, t))).toEqual([
            (v >> 16) & 255,
            (v >> 8) & 255,
            v & 255,
          ])
        }
      })
    }
  })

  it("blends between stops as the renderer does", () => {
    for (const name of Object.keys(PALETTE_STOPS) as Array<
      keyof typeof PALETTE_STOPS
    >) {
      for (let k = 0; k <= 40; k++) {
        const t = k / 40
        expect(parse(paletteColor(name, t))).toEqual(
          reference(PALETTE_STOPS[name], t)
        )
      }
    }
  })

  it("clamps outside [0,1] rather than extrapolating the ramp", () => {
    for (const name of Object.keys(PALETTE_STOPS) as Array<
      keyof typeof PALETTE_STOPS
    >) {
      expect(paletteColor(name, -3)).toBe(paletteColor(name, 0))
      expect(paletteColor(name, 7)).toBe(paletteColor(name, 1))
    }
  })
})
