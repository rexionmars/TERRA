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
 * Days after which a break is drawn instead of a segment, when the series is
 * too short to speak for itself.
 *
 * Sentinel-2's revisit is five days with both satellites, so three missed
 * passes is the point where a straight line stops being a plausible reading of
 * the interval and starts being an assertion about weeks nobody observed.
 *
 * A FALLBACK, NOT THE RULE. Applied to every series it broke almost all of
 * them: monthly-best selection returns one scene per month by construction, so
 * a real run has a median interval near 30 days and a fixed 16-day threshold
 * severed every segment. Measured on a 13-acquisition run, 10 of 12 intervals
 * exceeded it and the chart drew 2 line segments among 13 isolated dots. What
 * counts as a gap depends on the cadence, so gapLimitMs derives it.
 */
export const VI_GAP_DAYS = 16

/**
 * The interval beyond which a break is a break, derived from the sampling.
 *
 * A gap is a gap relative to how often this series is sampled: 30 days is
 * routine under monthly-best selection and a long absence under a dense
 * five-day cadence. The median interval is what the run itself says its
 * cadence is, and the multiple below is the point past which an interval stops
 * being ordinary spacing.
 *
 * The median rather than the mean, because the outlier this has to survive is
 * exactly the gap it is trying to detect: one four-month hole pulls a mean far
 * enough to stop the hole being detected.
 */
export function gapLimitMs(times: number[], fallbackDays = VI_GAP_DAYS): number {
  const ts = times.filter((t) => Number.isFinite(t)).sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1])
  // Under three intervals there is no cadence to speak of, only points.
  if (gaps.length < 3) return fallbackDays * DAY_MS
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]
  if (!Number.isFinite(median) || median <= 0) return fallbackDays * DAY_MS
  // 2.5x: a missed acquisition still connects, two consecutive absences do not.
  return Math.max(median * 2.5, fallbackDays * DAY_MS)
}

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
  // Milliseconds, not days: the threshold is derived from the series' own
  // cadence by gapLimitMs, and passing days invited the fixed value that broke
  // every monthly series.
  limit: number
): (T | { t: number })[] {
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
