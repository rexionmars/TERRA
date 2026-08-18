/**
 * A figure with fixed proportions, in its own coordinate system.
 *
 * THE DEFECT THIS REMOVES. Every chart in the application draws into
 * `ResponsiveContainer`, which stretches the plot and leaves the type alone.
 * At 400 px an 11 px tick label is large against the panel; at 1200 px the same
 * label is small. The figure has no proportions of its own -- it has whatever
 * proportions the panel happens to impose, and they change while the reader
 * watches. Nothing in the web layer was holding that ratio, and it is the first
 * thing a publication figure fixes: `plot_spectral.R` draws into 183 by 120
 * millimetres and every size in it is relative to that page.
 *
 * The fix is the SVG coordinate system. Draw into a fixed `viewBox` and let CSS
 * scale the whole thing, and the ratio between a glyph and the plot is decided
 * once, by this file, rather than by the width of the area a reader dragged.
 *
 * NOT MILLIMETRES, AND NOT THE PAPER'S TYPE SIZES. The obvious move is to copy
 * the R figure exactly: 183 mm wide, 5.8 pt ticks. It does not survive contact
 * with a screen. 5.8 pt is 2.05 mm, and a 183 mm figure rendered at 692 px --
 * its own print size at 96 dpi -- draws that glyph at 7.7 px, under the 9 px
 * floor this interface sets for its own smallest label and holds to in 21
 * places. Print gets away with it because 600 dpi and a page at reading
 * distance are not a webview.
 *
 * So one unit is one CSS pixel AT THE REFERENCE WIDTH, and the type scale is
 * the interface's own. What is borrowed from the R figure is the discipline --
 * fixed proportions, a declared type scale, no auto-fitting -- and not the
 * measurements, which belong to a different medium. The paper figure stays the
 * R script's job, which is also why nothing here tries to reproduce it.
 *
 * BELOW THE REFERENCE WIDTH THE FIGURE DOES NOT SHRINK. It scrolls. Scaling to
 * fit is what puts a 5 px glyph on screen, and the studio already refuses that
 * trade in `StudioArea`: an area under its editor's floor says so rather than
 * drawing something that cannot be read.
 */

/**
 * The reference geometry. One unit is one CSS pixel when the figure is drawn at
 * REFERENCE_PX wide; above that it scales up and the proportions hold.
 */
export const FIGURE = {
  /** viewBox width. Also the minimum width the figure may be drawn at. */
  width: 700,
  height: 340,
  margin: { top: 10, right: 156, bottom: 46, left: 52 },
} as const

export const PLOT = {
  x0: FIGURE.margin.left,
  x1: FIGURE.width - FIGURE.margin.right,
  y0: FIGURE.margin.top,
  y1: FIGURE.height - FIGURE.margin.bottom,
} as const

/**
 * Type, in figure units, mirroring the interface's own scale in index.css.
 *
 * The figure and the text around it are read in one glance, so a figure with a
 * type scale of its own would be a second vocabulary for one page. `micro` is
 * the floor here for the same reason it is the floor there.
 */
export const TYPE = { micro: 9, meta: 10, body: 11 } as const

/**
 * Stroke widths, in figure units.
 *
 * `series` is deliberately heavier than a hairline: it is the only mark whose
 * colour carries meaning, and a 1 unit line at a dash pattern loses the hue
 * between dashes.
 */
export const STROKE = { axis: 1, rule: 0.75, series: 2 } as const

export interface Scale {
  (value: number): number
  domain: readonly [number, number]
  range: readonly [number, number]
}

/** A linear map from a data domain onto figure units. */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number]
): Scale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0
  const fn = ((v: number) =>
    span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0)) as Scale
  fn.domain = domain
  fn.range = range
  return fn
}

/**
 * Ticks at 1, 2 or 5 times a power of ten, which is what a reader can divide in
 * their head. `count` is a target rather than a promise: the step is chosen
 * first and the ticks fall where they fall.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return []
  const raw = (max - min) / Math.max(1, count)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalised = raw / magnitude
  /*
    Thresholds at 1.5, 3 and 7, not at 2 and 5.
    Rounding 9.06 down to 5 is what the naive form does, and it returned ten
    ticks for a target of five on the first real spectrum this drew: a step has
    to be able to round UP to the next magnitude or the count only ever
    overshoots.
  */
  const step =
    (normalised < 1.5 ? 1 : normalised < 3 ? 2 : normalised < 7 ? 5 : 10) *
    magnitude
  const first = Math.ceil(min / step) * step
  const out: number[] = []
  // Guarded against a step that rounds to zero, which would not terminate.
  for (let v = first; v <= max + step / 1000 && step > 0; v += step) {
    out.push(Math.abs(v) < step / 1000 ? 0 : v)
  }
  return out
}

/**
 * Which labels can be drawn on one row, and which have to drop to a second.
 *
 * Two of the seven Sentinel-2 bands this is first used for sit 32 nm apart --
 * B08 at 832.8 and B8A at 864.7 -- which is 8.3 units on this axis against a
 * label some 22 units wide. Recharts answered that by silently dropping one of
 * them, so the figure showed six ticks for seven measurements. Staggering keeps
 * every label and says where each one points.
 *
 * `labelWidth` is an estimate, not a measurement: measuring text means laying
 * it out, and the caller knows the glyph count and the type size. Estimating
 * high staggers a label that would have fitted, which costs a row; estimating
 * low overlaps two, which costs the reading.
 */
export function staggerRows(
  positions: readonly number[],
  labelWidth: number
): number[] {
  const lastRight = [-Infinity, -Infinity]
  return positions.map((x) => {
    const left = x - labelWidth / 2
    const row = left >= lastRight[0] ? 0 : 1
    lastRight[row] = x + labelWidth / 2
    return row
  })
}
