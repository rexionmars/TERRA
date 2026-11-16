/**
 * An NDVI trajectory as the result panel reads it: the figures in words, and
 * the scales and paths its chart is drawn with.
 *
 * NOTHING HERE IS RECOMPUTED. The trajectory, its bounds and which dates were
 * set aside come from the sidecar (terra/trajectory), and this module only
 * places them on a page; a figure the panel prints is one the run returned.
 */
import type { TrajectoryAnalysis } from "@/lib/types"

/** The regions a gp_series model is calibrated on, by the code the sidecar returns. */
const REGION_NAMES: Record<string, string> = {
  BA: "Bahia",
  MT: "Mato Grosso",
  PR: "Paraná",
}

export function regionName(code: string): string {
  return REGION_NAMES[code] ?? code
}

/**
 * Which scale the interval took, in words. The global scale is the one fitted
 * on every calibrated region together, and an area takes it outside them or
 * within 2 km of a border, where an outline cannot place it on either side.
 */
export function scaleWords(r: Pick<TrajectoryAnalysis, "scale" | "region">): string {
  if (r.scale !== "global") return regionName(r.scale)
  if (r.region) return `global, since ${regionName(r.region)} has no scale of its own`
  return "global, outside the calibrated regions or near a border"
}

export interface TrajectoryFigures {
  /** Dates the model used, one acquisition each. */
  used: number
  kept: number
  setAside: number
  from: string
  to: string
  /** The last day of the trajectory, with its bounds. */
  last: { date: string; ndvi: number; lower: number; upper: number } | null
  /** The widest the interval gets, and on which day. */
  widest: { date: string; width: number } | null
}

export function trajectoryFigures(r: TrajectoryAnalysis): TrajectoryFigures {
  const kept = r.observations.filter((o) => o.kept).length
  const n = r.dates.length
  let widest: TrajectoryFigures["widest"] = null
  for (let i = 0; i < n; i++) {
    const width = r.upper[i] - r.lower[i]
    if (!widest || width > widest.width) widest = { date: r.dates[i], width }
  }
  return {
    used: r.observations.length,
    kept,
    setAside: r.observations.length - kept,
    from: n ? r.dates[0] : "",
    to: n ? r.dates[n - 1] : "",
    last: n
      ? {
          date: r.dates[n - 1],
          ndvi: r.ndvi[n - 1],
          lower: r.lower[n - 1],
          upper: r.upper[n - 1],
        }
      : null,
    widest,
  }
}

/** An NDVI to two decimals, with a typographic minus. */
export function ndviText(v: number): string {
  // A value that rounds to zero is zero: "−0.00" is a sign nothing measured.
  const text = v.toFixed(2)
  return Number(text) === 0 ? "0.00" : text.replace("-", "\u2212")
}

const DAY_MS = 86_400_000
const at = (d: string) => Date.parse(`${d}T00:00:00Z`)

/**
 * The NDVI range the chart spans: 0 to 1, widened in steps of 0.2 to hold every
 * bound and every observation, so a band that leaves the usual range is drawn
 * whole rather than clipped.
 */
export function ndviRange(r: TrajectoryAnalysis): [number, number] {
  const values = [...r.lower, ...r.upper, ...r.observations.map((o) => o.ndvi)].filter(
    Number.isFinite
  )
  const step = 0.2
  const lo = Math.min(0, Math.floor(Math.min(...values, 0) / step) * step)
  const hi = Math.max(1, Math.ceil(Math.max(...values, 1) / step) * step)
  return [Number(lo.toFixed(1)), Number(hi.toFixed(1))]
}

/** The NDVI ticks: every 0.2 when the range is 0 to 1, every 0.5 beyond it. */
export function ndviTicks([lo, hi]: [number, number]): number[] {
  // 1 - (-0.2) is 1.2000000000000002 in floating point.
  const step = hi - lo > 1.2 + 1e-9 ? 0.5 : 0.2
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    out.push(Number(v.toFixed(1)))
  }
  return out
}

/**
 * The first days of months between two dates, every k-th, with k the smallest
 * that leaves at most `most` of them: a season reads by its months.
 */
export function monthTicks(from: string, to: string, most = 6): string[] {
  const a = new Date(at(from))
  const b = at(to)
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b)) return []
  const months: string[] = []
  let y = a.getUTCFullYear()
  let m = a.getUTCMonth() + (a.getUTCDate() === 1 ? 0 : 1)
  for (;;) {
    y += Math.floor(m / 12)
    m %= 12
    const t = Date.UTC(y, m, 1)
    if (t > b) break
    months.push(new Date(t).toISOString().slice(0, 10))
    m += 1
  }
  const k = Math.max(1, Math.ceil(months.length / most))
  return months.filter((_, i) => i % k === 0)
}

/**
 * A month tick's label: the month, and its year on the first tick and on the
 * first tick of each later year, which need not be January when ticks skip
 * months.
 */
export function monthLabel(iso: string, previous: string | null): string {
  const d = new Date(at(iso))
  const month = d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })
  const newYear = !previous || previous.slice(0, 4) !== iso.slice(0, 4)
  return newYear ? `${month} ${d.getUTCFullYear()}` : month
}

export interface ChartFrame {
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
}

/** Where a date and an NDVI fall in the frame. */
export function chartScales(
  r: TrajectoryAnalysis,
  f: ChartFrame,
  range: [number, number]
) {
  const t0 = r.dates.length ? at(r.dates[0]) : 0
  const t1 = r.dates.length ? at(r.dates[r.dates.length - 1]) : DAY_MS
  const span = Math.max(DAY_MS, t1 - t0)
  const [lo, hi] = range
  return {
    x: (d: string) => f.left + ((at(d) - t0) / span) * (f.width - f.left - f.right),
    y: (v: number) =>
      f.top + (1 - (v - lo) / (hi - lo)) * (f.height - f.top - f.bottom),
  }
}

const p = (v: number) => v.toFixed(1)

/** The trajectory's line, as SVG path data. */
export function linePath(
  r: TrajectoryAnalysis,
  x: (d: string) => number,
  y: (v: number) => number
): string {
  return r.dates.map((d, i) => `${i ? "L" : "M"}${p(x(d))},${p(y(r.ndvi[i]))}`).join("")
}

/** The interval as one closed shape: along the upper bound, back along the lower. */
export function bandPath(
  r: TrajectoryAnalysis,
  x: (d: string) => number,
  y: (v: number) => number
): string {
  if (!r.dates.length) return ""
  const upper = r.dates.map((d, i) => `${i ? "L" : "M"}${p(x(d))},${p(y(r.upper[i]))}`)
  const lower = r.dates.map((d, i) => `L${p(x(d))},${p(y(r.lower[i]))}`).reverse()
  return `${upper.join("")}${lower.join("")}Z`
}
