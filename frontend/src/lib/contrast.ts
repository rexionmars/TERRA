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
 * boundary or a focus indicator (1.4.11). APCA's Lc is reported beside each
 * ratio and gates nothing -- see the note above `apca` for why both are here.
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

/*
  APCA, BESIDE THE RATIO AND NOT INSTEAD OF IT.

  WCAG 2.x is what an audit asks for and it stays the gate. It is also known to
  overstate contrast in the dark: its prediction degrades once the LIGHTER of a
  pair falls below about #a0a0a0, and this palette is dark-first -- ink 33,
  surface 47, raised 67, line 75. Two of the pairs listed as accepted failures
  below sit in exactly that range, so the number they failed on may be
  describing the ruler rather than the tone.

  Lc says what the ratio cannot: it is perceptual and signed, so Lc 60 means the
  same readability whether the text is dark on light or light on dark, and the
  sign says which. Reported, never enforced -- adopting it as the gate is a
  decision about what this project promises, not a thing to slip in beside a
  formula that is already load-bearing.

  Constants and order of operations are APCA-W3 0.1.9 (SA98G / 0.98G-4g), taken
  from the reference implementation rather than restated from a description.

  LICENCE: APCA's own terms prohibit some use-cases without written permission,
  naming medical, clinical evaluation, human-safety, aerospace, transportation
  and military applications. This is a research tool for Earth observation and
  the figure is advisory here, but the flood envelope borders on the third of
  those and this note is where that is on the record.
*/
const SA98G = {
  mainTRC: 2.4,
  sRco: 0.2126729,
  sGco: 0.7151522,
  sBco: 0.072175,
  normBG: 0.56,
  normTXT: 0.57,
  revTXT: 0.62,
  revBG: 0.65,
  blkThrs: 0.022,
  blkClmp: 1.414,
  scaleBoW: 1.14,
  scaleWoB: 1.14,
  loBoWoffset: 0.027,
  loWoBoffset: 0.027,
  loClip: 0.1,
  deltaYmin: 0.0005,
} as const

/** Screen luminance as APCA defines it: a simple power curve, not WCAG's. */
function apcaY([r, g, b]: Channels): number {
  const e = (c: number) => (c / 255) ** SA98G.mainTRC
  return SA98G.sRco * e(r) + SA98G.sGco * e(g) + SA98G.sBco * e(b)
}

/**
 * Lightness contrast, signed.
 *
 * Positive is dark text on a light background, negative is light on dark. The
 * magnitude is what compares: roughly Lc 45 is a floor for large text, 60 for
 * body, 75 for small or thin text.
 */
export function apca(text: Channels, background: Channels): number {
  const clamp = (y: number) =>
    y > SA98G.blkThrs ? y : y + (SA98G.blkThrs - y) ** SA98G.blkClmp
  const txt = clamp(apcaY(text))
  const bg = clamp(apcaY(background))
  if (Math.abs(bg - txt) < SA98G.deltaYmin) return 0

  let sapc: number
  let out: number
  if (bg > txt) {
    // Normal polarity: dark text on a light ground.
    sapc = (bg ** SA98G.normBG - txt ** SA98G.normTXT) * SA98G.scaleBoW
    out = sapc < SA98G.loClip ? 0 : sapc - SA98G.loBoWoffset
  } else {
    sapc = (bg ** SA98G.revBG - txt ** SA98G.revTXT) * SA98G.scaleWoB
    out = sapc > -SA98G.loClip ? 0 : sapc + SA98G.loWoBoffset
  }
  return out * 100
}

/** The channel values in index.css, per theme. Edited together with it. */
export const TOKENS = {
  dark: {
    sunk: [24, 24, 24],
    ink: [30, 30, 30],
    control: [40, 40, 40],
    surface: [48, 48, 48],
    head: [53, 53, 53],
    surfaceRaised: [67, 67, 67],
    line: [91, 91, 91],
    lineStrong: [145, 145, 145],
    text: [221, 221, 221],
    muted: [184, 184, 184],
    accent: [237, 135, 68],
    accentQuiet: [240, 155, 99],
    accentDim: [83, 40, 12],
    destructive: [159, 43, 58],
    success: [195, 236, 95],
    warning: [213, 190, 75],
    destructiveForeground: [221, 221, 221],
    destructiveQuiet: [248, 152, 158],
    aside: [112, 150, 190],
    partSource: [81, 180, 133],
    partWhen: [31, 176, 204],
    partMethod: [155, 146, 227],
    partValue: [205, 128, 184],
    wireFailed: [224, 132, 125],
  },
  light: {
    sunk: [215, 215, 215],
    ink: [231, 231, 231],
    control: [238, 238, 238],
    surface: [244, 244, 244],
    head: [248, 248, 248],
    surfaceRaised: [253, 253, 253],
    line: [177, 177, 177],
    lineStrong: [121, 121, 121],
    text: [31, 31, 31],
    muted: [92, 92, 92],
    accent: [186, 58, 18],
    accentQuiet: [158, 48, 14],
    accentDim: [240, 214, 198],
    destructive: [178, 54, 69],
    success: [68, 96, 24],
    warning: [135, 112, 0],
    destructiveForeground: [244, 244, 244],
    destructiveQuiet: [163, 43, 59],
    aside: [70, 106, 152],
    partSource: [55, 130, 94],
    partWhen: [15, 127, 147],
    partMethod: [111, 104, 165],
    partValue: [149, 91, 132],
    wireFailed: [156, 68, 63],
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
 * surface 47, raised 67. The ramp has since grown to six steps and every rule
 * below is measured against all of them rather than against three, which is
 * what caught the light theme: its darkest ground is no longer `ink`. Lifting a surface does not lift what has to be seen
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
/*
  EMPTY, AND THE THREE THAT WERE HERE WERE TAKEN.

  Each named the value that would have cleared its floor -- 175 for muted, 142
  for lineStrong, #E59E8F for destructiveQuiet -- and each said the value "was
  not taken". What changed is that APCA now reports beside the ratio, and it
  put every one of those pairs between Lc 41 and 49, under the floor for body
  text. A pair excused at 3.83 that also reads at Lc -41 is not a pair anyone
  is choosing to keep; it is one nobody had a second opinion on.
*/
export const ACCEPTED: Record<string, string> = {}
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
    on: ["sunk", "ink", "control", "surface", "head", "surfaceRaised"],
    min: 4.5,
    why: "body text, on every surface it lands on",
  },
  {
    fg: "muted",
    on: ["sunk", "ink", "control", "surface", "head", "surfaceRaised"],
    min: 4.5,
    why: "secondary text, which carries the assumptions beside every figure",
  },
  {
    fg: "accentQuiet",
    on: ["sunk", "ink", "control", "surface", "head", "surfaceRaised", "accentDim"],
    min: 4.5,
    why: "the accent where it is read rather than filled; accentDim is the plate the studio band lights a chosen value on, and the label sits on it",
  },
  {
    fg: "accent",
    on: ["sunk", "ink", "control", "surface", "head", "surfaceRaised", "accentDim"],
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
    on: ["sunk", "ink", "control", "surface", "head", "surfaceRaised", "accentDim"],
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
    on: ["sunk", "ink", "control", "surface", "head", "surfaceRaised"],
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
    on: ["sunk", "ink", "control", "surface", "head", "surfaceRaised"],
    min: 3.0,
    why: "the success mark on a toast, which is a graphic rather than text",
  },
  /*
   * The aside card's border and glyph on a run graph, which is the one place a
   * colour carries a claim about the graph's shape: this card is not in the
   * request. It is checked at the boundary floor rather than the text floor
   * because it is never text -- the card's own label stays on `text` and its
   * prose on `muted`, both of which are already listed above. A hue that only
   * ever draws a 1px border and a 12px glyph and is not measured is what the
   * toast marks were before anything looked at them.
   */
  {
    fg: "aside",
    on: ["sunk", "ink", "control", "surface", "head", "surfaceRaised"],
    min: 3.0,
    why: "the border and glyph of a card that is on the run graph but not in the request; a boundary under WCAG 1.4.11, never text",
  },
  /*
   * The two parts of a request that carry a hue, and the reason they are
   * listed where the product scale is not.
   *
   * --p-kind-* answers to the data: it labels what a run IS, on a plate of its
   * own tint, and index.css says why it is left to the eye. These are chassis.
   * They draw a rule under a card's header, on the raised surface the header
   * fills, which is a boundary like the aside card's border above -- and a hue
   * that only ever draws a 2px rule and is not measured is exactly what the
   * toast marks were before anything looked at them.
   *
   * The boundary floor rather than the text floor, and for the same reason:
   * neither is ever text. The card's own label stays on `text`.
   */
  {
    fg: "partSource",
    on: ["sunk", "ink", "control", "surface", "head", "surfaceRaised"],
    min: 3.0,
    why: "the header, border and glyph of a card that says WHERE a run reads: the area, a scene, a store",
  },
  {
    fg: "partWhen",
    on: ["sunk", "ink", "control", "surface", "head", "surfaceRaised"],
    min: 3.0,
    why: "the same, for a card that says OVER WHAT STRETCH: a period, a window, a depth of record",
  },
  {
    fg: "partMethod",
    on: ["sunk", "ink", "control", "surface", "head", "surfaceRaised"],
    min: 3.0,
    why: "the same, for a card that says BY WHICH METHOD: a model, an index, a product, a set of bands",
  },
  {
    fg: "partValue",
    on: ["sunk", "ink", "control", "surface", "head", "surfaceRaised"],
    min: 3.0,
    why: "the same, for a card that says AT WHAT VALUES: a threshold, a slope, a ratio, a loss",
  },
  /*
   * The two bands a wire draws once it has an outcome to report, checked as
   * GROUNDS rather than as marks -- which is why `ink` is the foreground here
   * and they are the background.
   *
   * Both are filled opaque and carry the wire's reading on them, set in
   * --p-ink: dark type in the dark theme, light type in the light one, because
   * the token flips and the bands do not. That makes each a text pair at the
   * 4.5 floor, not a graphic at 3.0 -- and it is the pairing the destructive
   * tokens got wrong before anything was looking, a fill measured for what it
   * is rather than for what is written on it.
   *
   * The waiting states are absent from this list on purpose: a pending wire is
   * a translucent pane over whatever it crosses, so its ground is not a token
   * and cannot be checked from one. Its floor is held in NodeCanvas instead,
   * by PANE_TINT_HEAD, which is measured against the worst case there.
   */
  {
    fg: "ink",
    on: ["success", "wireFailed"],
    min: 4.5,
    why: "the reading written on a wire that reported an outcome, dark on the taken route and on the failed one",
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
    on: ["sunk", "ink", "control", "surface", "head", "surfaceRaised"],
    min: 3.0,
    why: "the warning mark on a toast, which is an amber of its own rather than whatever the accent happens to be",
  },
]

export interface ContrastResult {
  theme: ThemeName
  fg: TokenName
  bg: TokenName
  ratio: number
  /** APCA lightness contrast, signed. Reported; nothing is gated on it. */
  lc: number
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
          lc: Math.round(apca(t[rule.fg], t[bg]) * 10) / 10,
          min: rule.min,
          passes: ratio >= rule.min,
          why: rule.why,
        })
      }
    }
  }
  return out
}
