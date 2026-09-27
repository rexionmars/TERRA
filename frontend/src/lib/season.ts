/**
 * A run's season as dates: when the index rose, peaked and fell, and between
 * which two observations each of those can lie.
 *
 * The sidecar reports the three as days of the year (sidecar/terra/phenology.py:
 * the NDVI series interpolated to days, Savitzky-Golay smoothed, and crossed
 * at half its amplitude -- the rule TIMESAT applies, Jonsson and Eklundh,
 * 2004). A day of the year carries no year, and a summer season in the south
 * of Brazil runs from October into March, so each is placed on the calendar
 * inside the run's own observations, in order: the rise, then the peak after
 * it, then the fall after that.
 *
 * THE WINDOW IS THE GAP BETWEEN OBSERVATIONS. The crossing is placed by
 * interpolating between two clear acquisitions, so where it really happened is
 * known only to lie between them: with a 5-day revisit and cloud that gap is
 * days to weeks, and it is the honest width of the answer. It is computed here
 * from the series the run already carries, so runs recorded before this
 * existed have it too.
 *
 * WHAT THE DATES ARE NOT: sowing and harvest. NDVI rises at emergence, some
 * days after sowing, and falls at senescence, before harvest.
 */
import type { PhenologyMetrics, VISeriesPoint } from "@/lib/types"

export interface SeasonMark {
  /** The day the smoothed curve placed it on, YYYY-MM-DD. */
  date: string
  /** The last clear observation before it, and the first after: where it can lie. */
  from: string
  to: string
}

export interface Season {
  /** Emergence side: the rise through half the amplitude. */
  rise: SeasonMark | null
  peak: SeasonMark | null
  /** Senescence side: the fall through half the amplitude. */
  fall: SeasonMark | null
  /** Days from rise to fall, as the sidecar counted them. */
  lengthDays: number | null
  peakNdvi: number | null
  baseNdvi: number | null
  /** The clear observations the curve was drawn through, in date order. */
  observations: { date: string; ndvi: number }[]
}

const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const at = (d: string) => Date.parse(`${d}T00:00:00Z`)

function dayOfYear(t: number): number {
  const d = new Date(t)
  return Math.round((t - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY) + 1
}

/** The first day from `from` to `to` whose day of the year is `doy`, or null. */
export function placeDayOfYear(doy: number, from: string, to: string): string | null {
  const want = Math.round(doy)
  const end = at(to)
  for (let t = at(from); t <= end; t += DAY) if (dayOfYear(t) === want) return iso(t)
  return null
}

/** The clear observations either side of a date; the date itself where none is. */
function bracket(date: string, obs: readonly string[]): { from: string; to: string } {
  let from = date
  let to = date
  for (const d of obs) {
    if (d < date) from = d
    else if (d > date) {
      to = d
      break
    }
  }
  return { from, to }
}

/**
 * The season a run's series and phenology describe, or null where the run has
 * no series or the sidecar found no curve (fewer than four clear dates).
 */
export function seasonOf(result: {
  vi_series?: VISeriesPoint[] | null
  phenology?: PhenologyMetrics | null
}): Season | null {
  const observations = (result.vi_series ?? [])
    .filter((p) => Number.isFinite(p.ndvi_mean) && p.ndvi_mean !== 0)
    .map((p) => ({ date: p.date.slice(0, 10), ndvi: p.ndvi_mean }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const ph = result.phenology
  if (!observations.length || !ph || ph.pos_doy == null) return null
  const first = observations[0].date
  const last = observations[observations.length - 1].date
  const dates = observations.map((o) => o.date)
  const mark = (doy: number | null, after: string): SeasonMark | null => {
    if (doy == null) return null
    const date = placeDayOfYear(doy, after, last)
    return date ? { date, ...bracket(date, dates) } : null
  }
  const rise = mark(ph.sos_doy, first)
  const peak = mark(ph.pos_doy, rise?.date ?? first)
  const fall = mark(ph.eos_doy, peak?.date ?? rise?.date ?? first)
  return {
    rise,
    peak,
    fall,
    lengthDays: ph.los_days,
    peakNdvi: ph.peak,
    baseNdvi: ph.base,
    observations,
  }
}

/** "12 Oct", for a date on a chart axis or in a card. */
export function shortDate(d: string): string {
  const t = at(d)
  if (!Number.isFinite(t)) return d
  return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })
}

/** Days between two dates, the later minus the earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((at(b) - at(a)) / DAY)
}
