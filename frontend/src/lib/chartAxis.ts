/**
 * Time on a time axis.
 *
 * The series charts keyed their X axis on the date STRING, which recharts reads
 * as a category: every acquisition was drawn at the same horizontal spacing
 * regardless of how many days separated it from the next. Sentinel-2 revisits
 * every five days at best, and cloud masking makes the usable series irregular,
 * so gaps of a month are ordinary -- and a month drawn the same width as five
 * days falsifies every slope on the chart.
 *
 * That mattered beyond appearance: the phenology metrics printed beside the
 * chart are computed in sidecar/phenology.py on real ordinals, resampled to a
 * daily grid with a linear interpolation. So the figure and the number next to
 * it were describing the same data and disagreeing about it -- a reader
 * estimating green-up off the chart got a different answer from the one printed.
 */

const DAY_MS = 86_400_000

/** YYYY-MM-DD to a UTC timestamp. NaN for anything unparseable. */
export function dateToMs(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  if (!m) return Number.NaN
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/**
 * The axis props that make a numeric time axis behave.
 *
 * Spread onto an XAxis rather than repeated at each chart, because the four
 * charts that need it are in three files and had already drifted apart in tick
 * density and formatting.
 */
export const timeAxisProps = {
  dataKey: "t",
  type: "number" as const,
  scale: "time" as const,
  domain: ["dataMin", "dataMax"] as [string, string],
}

/**
 * A tick label whose precision follows the span.
 *
 * A three-month series wants a day; a three-year series wants a year, and
 * repeating the month across thirty ticks says nothing.
 */
export function timeTickFormatter(spanMs: number): (t: number) => string {
  const days = spanMs / DAY_MS
  const opts: Intl.DateTimeFormatOptions =
    days > 1460
      ? { year: "numeric", timeZone: "UTC" }
      : days > 240
        ? { month: "short", year: "2-digit", timeZone: "UTC" }
        : { day: "numeric", month: "short", timeZone: "UTC" }
  return (t: number) => new Date(t).toLocaleDateString(undefined, opts)
}

/** The full date, for a tooltip, where precision is never unwelcome. */
export function timeLabelFormatter(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * Days after which a break is drawn instead of a segment.
 *
 * Sentinel-2's revisit is five days with both satellites, so three missed
 * passes is the point where a straight line stops being a plausible reading of
 * the interval and starts being an assertion about weeks nobody observed.
 */
export const VI_GAP_DAYS = 16

/**
 * Opens a hole in a series wherever consecutive samples are too far apart.
 *
 * Recharts joins consecutive points, and a null value breaks the path when
 * `connectNulls` is false. So the break is a real row at the midpoint rather
 * than a styling flag: it survives the tooltip, the dot rendering and any
 * downstream domain calculation, none of which would know about a flag.
 */
export function insertTimeGaps<T extends { t: number }>(
  rows: T[],
  gapDays: number
): (T | { t: number })[] {
  const limit = gapDays * DAY_MS
  const out: (T | { t: number })[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (i > 0) {
      const prev = rows[i - 1]
      if (Number.isFinite(prev.t) && Number.isFinite(row.t) && row.t - prev.t > limit) {
        out.push({ t: prev.t + (row.t - prev.t) / 2 })
      }
    }
    out.push(row)
  }
  return out
}
