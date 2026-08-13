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
    accent: [237, 135, 68],
    accentQuiet: [255, 138, 92],
    accentDim: [74, 38, 22],
    destructive: [160, 44, 44],
    success: [111, 156, 90],
    destructiveForeground: [226, 220, 212],
    destructiveQuiet: [224, 138, 120],
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
    accentDim: [240, 214, 198],
    destructive: [179, 58, 26],
    success: [63, 107, 44],
    destructiveForeground: [252, 249, 243],
    destructiveQuiet: [158, 43, 37],
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
    on: ["ink", "surface", "surfaceRaised", "accentDim"],
    min: 4.5,
    why: "the accent where it is read rather than filled; accentDim is the plate the whiteboard band lights a chosen value on, and the label sits on it",
  },
  {
    fg: "accent",
    on: ["ink", "surface", "surfaceRaised", "accentDim"],
    min: 3.0,
    why: "fill, focus ring and active state; never small text. On accentDim it is the underline that carries the chosen state where hue does not reach",
  },
  {
    /*
     * `ink` joins the surfaces here because the whiteboard's run band paints
     * itself in ink and draws every editable control as a boxed field on it.
     * A boundary that was only ever checked against the two panel surfaces was
     * the fill's own 1.33 against ink -- which is the reason the band read as
     * plain text.
     */
    fg: "lineStrong",
    on: ["ink", "surface", "surfaceRaised", "accentDim"],
    min: 3.0,
    why: "component boundary, WCAG 1.4.11; the surfaces are 1.11 and 1.20 apart, so the border is what separates them",
  },
  /*
   * Destructive splits the same way the accent does, and was checked neither
   * way until now. The single value it used to be failed both of its jobs at
   * once: 3.12 as a label on its own fill, 4.22 as text on the background.
   */
  {
    fg: "destructiveForeground",
    on: ["destructive"],
    min: 4.5,
    why: "the label on a destructive fill, which is the confirmation a delete is read from",
  },
  {
    fg: "destructiveQuiet",
    on: ["ink", "surface", "surfaceRaised"],
    min: 4.5,
    why: "destructive where it is read rather than filled: error text, a delete row, a hover state",
  },
  /*
   * The toast marks, which were the one status surface no rule covered -- and
   * the gap showed: the error mark asked for --destructive, the fill token,
   * and drew at 2.47 on the toast plate. Splitting destructive is what made it
   * fail, and nothing caught it, because nothing was looking.
   *
   * 3.0 rather than 4.5: these are meaningful graphics under WCAG 1.4.11, not
   * text. Success stays green rather than joining the sand family, because
   * green and orange are the only thing separating a success toast from a
   * warning one once both are marks of the same shape.
   */
  {
    fg: "success",
    on: ["ink", "surface", "surfaceRaised"],
    min: 3.0,
    why: "the success mark on a toast, which is a graphic rather than text",
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
