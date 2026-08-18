/**
 * Making a map palette legible as a line on a panel.
 *
 * MapBiomas colours are made to fill polygons, where an area of a hundred
 * pixels carries the hue and the neighbours disambiguate it. A 1.8 px line has
 * neither, and which colours fail flips with the theme. Measured against the
 * panel each is drawn on:
 *
 *   dark   Forest Formation #006400   2.16   the only one that fails
 *   light  Agriculture-Pasture Mosaic 1.07   Soybean 1.44, Other Crops 2.14
 *
 * The pale end of the legend is unusable on the light theme and comfortable on
 * the dark one; the dark green is the reverse. A single adjustment direction
 * would fix one theme and break the other.
 *
 * So each class colour is walked until it clears 3.0 against the ground it is
 * actually drawn on -- WCAG 1.4.11, the floor for a meaningful graphic rather
 * than for text -- and the direction comes from the ground rather than from a
 * constant. Everything already clearing the floor is returned untouched, which
 * is four of five classes on the dark theme.
 *
 * Colour is never the only channel regardless. The chart that consumes this
 * pairs it with a dash pattern, because a reader with deuteranopia and a
 * reader looking at a greyscale print are the same problem.
 */
import { TOKENS, contrast, type Channels, type ThemeName } from "./contrast"

const HEX = /^#?([0-9a-f]{6})$/i

export function parseHex(hex: string): Channels | null {
  const m = HEX.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function toHex([r, g, b]: Channels): string {
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")
  return `#${h(r)}${h(g)}${h(b)}`
}

/** `fg` painted at `alpha` over `bg`, which is what a translucent panel is. */
export function compositeOver(fg: Channels, bg: Channels, alpha: number): Channels {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)) as unknown as Channels
}

/**
 * The colour a chart inside a `bg-secondary/50` panel is actually drawn on.
 *
 * --secondary is the raised surface at 0.85, and Tailwind's /50 multiplies that
 * alpha rather than replacing it, so the panel is the raised surface at 0.425
 * over the page ink. Computing it beats guessing: the difference between the
 * raised surface and this composite is a whole step of the palette.
 */
export function chartGround(theme: ThemeName): Channels {
  const t = TOKENS[theme]
  return compositeOver(t.surfaceRaised, t.ink, 0.85 * 0.5)
}

/**
 * The same hue, moved until it clears `target` against `ground`.
 *
 * Returns the input unchanged when it already clears, which is the common case
 * for the saturated classes -- Forest Formation is #006400 and needs nothing on
 * the light theme.
 */
export function legibleOn(hex: string, ground: Channels, target = 3.0): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  // Which way to walk. On a dark ground the only direction with room is up.
  const towards: Channels =
    contrast(ground, [255, 255, 255]) > contrast(ground, [0, 0, 0])
      ? [255, 255, 255]
      : [0, 0, 0]
  let current = rgb
  // 40 steps of 2.5 percent covers the full distance to the endpoint; the loop
  // exits at the floor rather than at the endpoint in every real case.
  for (let i = 0; i < 40 && contrast(current, ground) < target; i++) {
    current = compositeOver(towards, current, 0.025)
  }
  return toHex(current)
}

/**
 * A dash per series, so hue is never the only channel separating two lines.
 *
 * Five patterns, because the classifier emits five classes. A sixth series
 * wraps and shares a pattern with the first, which is visible rather than
 * silent -- the alternative is inventing a pattern too close to one in use.
 */
export const SERIES_DASHES: (string | undefined)[] = [
  undefined,
  "6 3",
  "2 3",
  "8 2 2 2",
  "1 3",
]

export function seriesDash(index: number): string | undefined {
  return SERIES_DASHES[index % SERIES_DASHES.length]
}
