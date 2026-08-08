/**
 * Contrast between the design tokens, derived from the tokens themselves.
 *
 * The palette was chosen against measured ratios rather than by eye, and those
 * ratios are load-bearing: the interface is dense by decision, so a token that
 * drifts below the floor is not a cosmetic problem. This module reads the
 * channels out of index.css and re-derives every pair the interface actually
 * paints, so an edit that breaks one fails a check instead of shipping.
 *
 * Thresholds are WCAG 2.x: 4.5 for text (1.4.3) and 3.0 for a component
 * boundary or a focus indicator (1.4.11).
 *
 * The scientific ramps are deliberately absent. inferno, viridis, rdbu_r,
 * blues and rdylgn are perceptually uniform sequences painted by the Python
 * renderer, guarded byte for byte by sidecar/tests/test_palette_sync.py, and
 * they answer to the data rather than to the chassis.
 */

export type Channels = readonly [number, number, number]

/** Relative luminance, WCAG 2.x definition. */
export function luminance([r, g, b]: Channels): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrast(a: Channels, b: Channels): number {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** The channel values in index.css, per theme. Edited together with it. */
export const TOKENS = {
  dark: {
    ink: [23, 23, 23],
    surface: [38, 32, 28],
    surfaceRaised: [54, 45, 39],
    line: [86, 73, 63],
    lineStrong: [138, 117, 100],
    text: [226, 220, 212],
    muted: [172, 159, 144],
    accent: [242, 86, 35],
    accentQuiet: [255, 138, 92],
  },
  light: {
    ink: [245, 240, 233],
    surface: [252, 249, 243],
    surfaceRaised: [234, 226, 214],
    line: [190, 175, 156],
    lineStrong: [138, 118, 98],
    text: [38, 30, 24],
    muted: [104, 90, 76],
    accent: [186, 58, 18],
    accentQuiet: [158, 48, 14],
  },
} as const satisfies Record<string, Record<string, Channels>>

export type ThemeName = keyof typeof TOKENS
export type TokenName = keyof (typeof TOKENS)["dark"]

export interface ContrastRule {
  /** The token painted on top. */
  fg: TokenName
  /** The surfaces it lands on. */
  on: readonly TokenName[]
  /** 4.5 for text, 3.0 for a boundary or a focus indicator. */
  min: number
  why: string
}

/**
 * Every pair the interface paints, and the floor each has to clear.
 *
 * `accent` is checked at 3.0, not 4.5, and only as a fill, a focus ring and an
 * active state. It measures 3.93 on the raised surface, so it is not a text
 * colour; text that has to read as the accent uses `accentQuiet`. Listing it
 * here at 4.5 would either fail honestly or push the palette away from the
 * brand orange, and neither is what the token is for.
 */
export const RULES: readonly ContrastRule[] = [
  {
    fg: "text",
    on: ["ink", "surface", "surfaceRaised"],
    min: 4.5,
    why: "body text, on every surface it lands on",
  },
  {
    fg: "muted",
    on: ["ink", "surface", "surfaceRaised"],
    min: 4.5,
    why: "secondary text, which carries the assumptions beside every figure",
  },
  {
    fg: "accentQuiet",
    on: ["ink", "surface", "surfaceRaised"],
    min: 4.5,
    why: "the accent where it is read rather than filled",
  },
  {
    fg: "accent",
    on: ["ink", "surface", "surfaceRaised"],
    min: 3.0,
    why: "fill, focus ring and active state; never small text",
  },
  {
    fg: "lineStrong",
    on: ["surface", "surfaceRaised"],
    min: 3.0,
    why: "component boundary, WCAG 1.4.11; the surfaces are 1.11 and 1.20 apart, so the border is what separates them",
  },
]

export interface ContrastResult {
  theme: ThemeName
  fg: TokenName
  bg: TokenName
  ratio: number
  min: number
  passes: boolean
  why: string
}

export function checkContrast(): ContrastResult[] {
  const out: ContrastResult[] = []
  for (const theme of Object.keys(TOKENS) as ThemeName[]) {
    const t = TOKENS[theme]
    for (const rule of RULES) {
      for (const bg of rule.on) {
        const ratio = contrast(t[rule.fg], t[bg])
        out.push({
          theme,
          fg: rule.fg,
          bg,
          ratio: Math.round(ratio * 100) / 100,
          min: rule.min,
          passes: ratio >= rule.min,
          why: rule.why,
        })
      }
    }
  }
  return out
}
