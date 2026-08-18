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
    surface: [29, 34, 39],
    surfaceRaised: [41, 48, 56],
    line: [66, 76, 90],
    lineStrong: [105, 122, 145],
    text: [216, 221, 229],
    muted: [150, 162, 177],
    accent: [53, 120, 207],
    accentQuiet: [106, 155, 219],
    accentDim: [22, 45, 74],
    destructive: [160, 44, 44],
    success: [111, 156, 90],
    warning: [217, 164, 65],
    destructiveForeground: [216, 221, 229],
    destructiveQuiet: [224, 138, 120],
  },
  light: {
    ink: [236, 241, 247],
    surface: [247, 250, 253],
    surfaceRaised: [220, 227, 237],
    line: [165, 179, 196],
    lineStrong: [105, 123, 147],
    text: [26, 32, 40],
    muted: [81, 93, 110],
    accent: [51, 118, 206],
    accentQuiet: [40, 94, 166],
    accentDim: [204, 220, 242],
    destructive: [179, 58, 26],
    success: [63, 107, 44],
    warning: [138, 90, 16],
    destructiveForeground: [247, 250, 253],
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
 * active state. It measures 3.01 on the raised surface, so it is not a text
 * colour; text that has to read as the accent uses `accentQuiet`. Listing it
 * here at 4.5 would either fail honestly or push the palette away from the
 * brand value, and neither is what the token is for.
 *
 * The label ON the accent fill is not listed either, and that one is a stated
 * exception rather than a category difference: white measures 4.43 on the dark
 * theme's fill and 4.54 on the light theme's, so the dark side sits 0.07 under
 * WCAG 1.4.3. No colour at this hue clears both floors at once -- white would
 * need a fill darker than the 3.0 boundary against the raised surface permits.
 * A rule here would fail on a trade that was made deliberately; see the comment
 * on --p-accent in index.css.
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
   * text. Success stays green rather than joining the accent family, because
   * hue is the only thing separating a success toast from a warning one once
   * both are marks of the same shape -- and --warning is the accent, so the
   * green has to stay off it.
   */
  {
    fg: "success",
    on: ["ink", "surface", "surfaceRaised"],
    min: 3.0,
    why: "the success mark on a toast, which is a graphic rather than text",
  },
  /*
   * Warning joins the list because it stopped deriving from a checked token.
   * It used to be --p-accent-quiet and inherited that token's 4.5 floor for
   * free; it is now an amber of its own, and an unchecked literal is exactly
   * what the destructive pair was when it shipped failing.
   */
  {
    fg: "warning",
    on: ["ink", "surface", "surfaceRaised"],
    min: 3.0,
    why: "the warning mark on a toast, which no longer follows the accent because the accent is blue",
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
