/**
 * A figure laid out from the panel it is in and the text it will draw.
 *
 * THE DEFECT THIS STARTED FROM. Every chart drew into `ResponsiveContainer`,
 * which stretches the plot and leaves the type alone: at 400 px an 11 px tick
 * was large against the panel, at 1200 px it was small. The figure had no
 * proportions of its own -- it had whatever the panel imposed, and they changed
 * while the reader watched.
 *
 * THE FIRST ANSWER, AND WHY IT WAS HALF OF ONE. A fixed viewBox scaled as a
 * unit fixes the proportions, and that much was right. What it left behind was
 * every margin as a constant written by hand -- 52 for the y labels, 46 for
 * the axis title, a legend well of 156 -- so each change of content meant
 * finding those numbers and tuning them again, and a figure in a wide panel
 * was simply drawn larger than the same figure in a narrow one.
 *
 * WHAT A PLOTTING LIBRARY ACTUALLY DOES. ggplot measures its tick labels and
 * derives the gutter from them; matplotlib's tight_layout is the same idea. The
 * margin is a CONSEQUENCE of the text, and writing it down is writing down an
 * answer the text can change out from under.
 *
 * SO, THE MODEL HERE:
 *
 *   one unit is one CSS pixel, always. The figure is drawn AT the panel's size
 *   rather than scaled into it, which is what keeps a 10 px label 10 px in a
 *   400 px panel and in a 1400 px one.
 *
 *   every margin is computed. `layoutFigure` is given the strings that will
 *   occupy each edge and returns where the plot goes. Nothing in a caller is a
 *   position that a longer class name or an extra tick can falsify.
 *
 *   the type scale is the interface's own, from index.css. A figure with a
 *   scale of its own would be a second vocabulary on one page.
 *
 * What is deliberately NOT here is a paper figure. `plot_spectral.R` draws into
 * 183 by 120 millimetres at 5.8 pt, and that does not survive a screen: 5.8 pt
 * is 7.7 px at the figure's own print size, under the 9 px floor this interface
 * holds to in 21 places. Print gets away with it because 600 dpi at reading
 * distance is not a webview. The discipline is borrowed; the measurements are
 * not.
 */

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
 *
 * ABOVE IT THE FIGURE DOES NOT GROW EITHER, which is the half this file was
 * missing. Proportions were fixed and absolute size was not, so a figure in a
 * wide area was drawn at whatever multiple of its reference size that area
 * happened to be -- and two figures side by side in areas of different widths
 * were two different sizes, which is the drift the fixed viewBox exists to
 * remove. Past the reference width a figure gains no legibility, only scale.
 * `figureStyle` caps it there.
 */
import { ticks } from "d3-array"
import { scaleLinear, type ScaleLinear } from "d3-scale"

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

/**
 * A linear map from a data domain onto figure units.
 *
 * d3-scale rather than the twenty lines this used to be, and the twenty lines
 * are the argument for it. The tick generator written here returned ten ticks
 * for a target of five on the first real spectrum it drew, because it rounded
 * 9.06 down to a step of 5 -- a naive 1-2-5 selection with the thresholds at
 * the wrong places.
 *
 * d3 puts them at the GEOMETRIC means, sqrt(2), sqrt(10) and sqrt(50), which is
 * where the relative error between two candidate steps is equal; the round
 * numbers a person reaches for are not those points. Its tickSpec also does the
 * negative-exponent case in integer arithmetic, so a step of 0.1 does not
 * accumulate float error the way an accumulating loop does.
 *
 * Eight and a half kilobytes gzipped, measured, against a reimplementation that
 * shipped a defect on its first use.
 */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number]
): ScaleLinear<number, number> {
  return scaleLinear().domain([...domain]).range([...range])
}

/**
 * Ticks over a domain, at a target count.
 *
 * The domain is NOT extended to round numbers -- no `.nice()`. A spectrum whose
 * 5th percentile reaches -0.048 should show an axis that reaches -0.048, and
 * rounding it out to -0.1 would draw empty space as though it were measured.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return []
  return ticks(min, max, count)
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

let measuringContext: CanvasRenderingContext2D | null = null

/**
 * The width a string will occupy, measured rather than estimated.
 *
 * Canvas measureText uses the same font machinery the SVG text will, so this
 * is the width that will be drawn, not a guess from the glyph count. Earlier
 * versions of this file guessed at 5.2 px a glyph, which is wrong by a third
 * either way between an "i" and a "W" -- and a legend row breaks on exactly
 * that difference.
 */
export function measureText(text: string, fontPx: number, family?: string): number {
  /*
    Falls back to a glyph count where there is no DOM, rather than throwing.

    The estimate is poor -- it is the 5.2 px a glyph this file used to use, and
    wrong by a third either way between an "i" and a "W" -- but a figure laid
    out badly is a figure, and a layout function that throws takes the whole
    editor down. Anything rendering outside a browser gets the estimate.
  */
  if (typeof document === "undefined") return text.length * fontPx * 0.55
  if (!measuringContext) {
    measuringContext = document.createElement("canvas").getContext("2d")
  }
  if (!measuringContext) return text.length * fontPx * 0.55
  const resolved =
    family ??
    (typeof getComputedStyle === "function"
      ? getComputedStyle(document.body).getPropertyValue("--font-sans") ||
        "sans-serif"
      : "sans-serif")
  measuringContext.font = `${fontPx}px ${resolved}`
  return measuringContext.measureText(text).width
}

export interface FigureRequest {
  /** The panel's inner width, in CSS pixels. */
  width: number
  /**
   * How tall the PLOT should be. The figure's total height is this plus the
   * margins, which is why it is the plot and not the figure. Use
   * `plotHeightFor` to turn a measured box height into this.
   *
   * A FIGURE MUST NOT BE GIVEN THE HEIGHT OF THE BOX IT SITS IN. The first
   * version took both dimensions from a ResizeObserver on the element the
   * figure fills, so the height it produced became the height that was next
   * measured -- a loop with nothing damping it, and the spectral figure grew
   * without bound. Height is derived from width here, so the same width always
   * gives the same figure and there is no path back from the output to the
   * input.
   */
  plotHeight?: number
  /** Every y tick label that will be drawn, so the gutter can hold the widest. */
  yLabels: string[]
  /** Rows of x tick labels, after any staggering. */
  xLabelRows?: number
  /** Rows the legend wraps onto, if the figure carries one. */
  legendRows?: number
  /** Whether each axis carries a title under or beside its labels. */
  xTitle?: boolean
  yTitle?: boolean
  /** The widest x tick label, so the last one does not clip the right edge. */
  lastXLabel?: string
}

export interface FigureLayout {
  width: number
  height: number
  plot: { x0: number; x1: number; y0: number; y1: number }
  /** Where the legend's first row sits, below everything else. */
  legendTop: number
}

/** Vertical rhythm, in pixels: one row of labels, and the gaps around them. */
const ROW = { label: 14, title: 16, tick: 4, gap: 4 }

/**
 * Where the plot goes inside a panel of this size, given this text.
 *
 * The caller passes what it will draw; nothing here is a constant that a
 * change of content can falsify.
 */
export function layoutFigure(request: FigureRequest): FigureLayout {
  const {
    width,
    yLabels,
    xLabelRows = 1,
    legendRows = 0,
    xTitle = true,
    yTitle = true,
    lastXLabel = "",
    /*
      Given by a caller that has a box of its own, derived from the width by a
      caller that does not.

      The fallback ratio is what a plot of a spectrum wants -- wide enough for
      seven samples over 1900 nm, tall enough to separate five curves -- with
      clamps so a very wide panel does not produce a figure taller than the
      panel. A caller passing this in has measured a box the figure cannot
      itself resize; see useFigureBox for why that distinction is the whole
      difference between responsive and runaway.
    */
    plotHeight = Math.max(150, Math.min(340, Math.round(width * 0.44))),
  } = request

  const widestY = yLabels.reduce(
    (w, label) => Math.max(w, measureText(label, TYPE.meta)),
    0
  )
  const left =
    (yTitle ? ROW.title : 0) + widestY + ROW.tick + ROW.gap
  // Half the last label overhangs its tick, so the gutter holds that half.
  const right = Math.max(8, measureText(lastXLabel, TYPE.meta) / 2 + 4)
  const top = ROW.gap + TYPE.meta / 2
  const bottom =
    ROW.tick +
    xLabelRows * ROW.label +
    (xTitle ? ROW.title : 0) +
    (legendRows > 0 ? ROW.gap + legendRows * ROW.label : 0)

  const height = top + plotHeight + bottom
  return {
    width,
    height,
    plot: {
      x0: left,
      x1: Math.max(left + 1, width - right),
      y0: top,
      y1: top + plotHeight,
    },
    legendTop: height - legendRows * ROW.label,
  }
}

/** The row height a legend and an axis label occupy, for callers placing them. */
export const ROW_PX = ROW

/**
 * The plot height that fills a box of this height, given what the margins will
 * take.
 *
 * Floored rather than allowed to collapse: below about 150 px five curves and
 * five tick labels stop being separable, and a figure drawn in 40 px is worse
 * than one that overflows a short panel and scrolls -- which is the trade the
 * studio already makes for an area under its editor's floor.
 */
export function plotHeightFor(
  boxHeight: number,
  { xLabelRows = 1, legendRows = 0, xTitle = true } = {}
): number {
  const chrome =
    ROW.gap +
    TYPE.meta / 2 +
    ROW.tick +
    xLabelRows * ROW.label +
    (xTitle ? ROW.title : 0) +
    (legendRows > 0 ? ROW.gap + legendRows * ROW.label : 0)
  return Math.max(150, Math.round(boxHeight - chrome))
}
