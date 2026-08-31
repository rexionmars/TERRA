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
    ink: [33, 33, 33],
    surface: [47, 47, 47],
    surfaceRaised: [67, 67, 67],
    line: [75, 75, 75],
    lineStrong: [127, 127, 127],
    text: [221, 221, 221],
    muted: [161, 161, 161],
    accent: [237, 135, 68],
    accentQuiet: [240, 155, 99],
    accentDim: [83, 40, 12],
    destructive: [160, 44, 44],
    success: [111, 156, 90],
    warning: [217, 164, 65],
    destructiveForeground: [221, 221, 221],
    destructiveQuiet: [224, 138, 120],
  },
  light: {
    ink: [241, 241, 241],
    surface: [249, 249, 249],
    surfaceRaised: [227, 227, 227],
    line: [177, 177, 177],
    lineStrong: [121, 121, 121],
    text: [31, 31, 31],
    muted: [92, 92, 92],
    accent: [186, 58, 18],
    accentQuiet: [158, 48, 14],
    accentDim: [240, 214, 198],
    destructive: [179, 58, 26],
    success: [63, 107, 44],
    warning: [138, 90, 16],
    destructiveForeground: [249, 249, 249],
    destructiveQuiet: [158, 43, 37],
  },
} as const satisfies Record<string, Record<string, Channels>>

export type ThemeName = keyof typeof TOKENS

/**
 * Pairs the palette's owner has accepted below their floor.
 *
 * NOT a way to quiet the check. check-contrast prints each one on its own every
 * run, with its measured ratio and its floor, so the cost stays visible and
 * countable rather than becoming a red build everyone learns to scroll past.
 * What the list buys is that anything NOT on it still fails.
 *
 * All three came in together, from a chassis whose surfaces were lifted: ink 33,
 * surface 47, raised 67. Lifting a surface does not lift what has to be seen
 * against it, and these are the three tokens that did not follow. The values
 * that would clear were measured -- lineStrong 142, muted 175, destructiveQuiet
 * #E59E8F -- and were not taken.
 *
 * It lives here rather than in the script because it is part of the palette's
 * contract: the script and the test both read it, and two copies would let them
 * disagree about which failures are known.
 *
 * Removing an entry is how one gets fixed -- drop the line, and the check tells
 * you whether it still needed to be there. An entry that no longer describes a
 * failure is itself reported as a failure.
 */
export const ACCEPTED: Record<string, string> = {
  "dark.muted.surfaceRaised":
    "secondary text on a card; 175 would clear 4.5 and was not taken",
  "dark.lineStrong.surfaceRaised":
    "the border between a card and its panel; 142 would clear 3.0",
  "dark.destructiveQuiet.surfaceRaised":
    "error text on a card; #E59E8F would clear 4.5",
}
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
 * active state. The present accent happens to measure 3.84 on the raised
 * surface, which is a property of this accent being a light one and not a rule
 * the token holds -- the blue before it measured 3.01 there. The floor stays at
 * 3.0 because the next accent may be a mid tone again, and text that has to
 * READ as the accent uses `accentQuiet` either way. Listing it at 4.5 would
 * either fail honestly or push the palette away from the brand value, and
 * neither is what the token is for.
 *
 * The label ON the accent fill is not listed either, and it is worth saying why
 * the omission survived a change that removed its original reason. Under the
 * blue it was a stated exception: that accent was a mid tone, white measured
 * 4.43 on it and nothing at that hue cleared both floors. Under this one the
 * ink measures 6.25 and there is no exception left. The pair stays unlisted
 * because --accent-foreground resolves to --p-ink and the rule would restate
 * `text on ink`, not because the trade is still open.
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
    why: "the accent where it is read rather than filled; accentDim is the plate the studio band lights a chosen value on, and the label sits on it",
  },
  {
    fg: "accent",
    on: ["ink", "surface", "surfaceRaised", "accentDim"],
    min: 3.0,
    why: "fill, focus ring and active state; never small text. On accentDim it is the underline that carries the chosen state where hue does not reach",
  },
  {
    /*
     * `ink` joins the surfaces here because the studio's run band paints
     * itself in ink and draws every editable control as a boxed field on it.
     * A boundary that was only ever checked against the two panel surfaces was
     * the fill's own 1.33 against ink -- which is the reason the band read as
     * plain text.
     */
    fg: "lineStrong",
    on: ["ink", "surface", "surfaceRaised", "accentDim"],
    min: 3.0,
    why: "component boundary, WCAG 1.4.11; the surfaces are 1.20 and 1.35 apart, so the border is what separates them",
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
   * text. Success stays green because hue is the only thing separating a
   * success toast from a warning one once both are marks of the same shape.
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
   *
   * It stays independent now that the accent is orange again, which is when
   * the separation is hardest to see and most worth keeping: a warning that
   * follows the accent says nothing the accent does not already say.
   */
  {
    fg: "warning",
    on: ["ink", "surface", "surfaceRaised"],
    min: 3.0,
    why: "the warning mark on a toast, which is an amber of its own rather than whatever the accent happens to be",
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
