/**
 * Reading a vegetation health run: how far a field departs, and from what.
 *
 * Two references, the one the sidecar computed and one this module computes:
 *
 * - EARLIER SEASONS (the run's own): each date of this season against the
 *   earlier seasons' dates within `window_days` of the same day of the year,
 *   in standard deviations (sidecar/terra/health/series.py).
 * - OTHER FIELDS (here): each field's NDVI on a date the fields of a set share,
 *   against the median of the others, in robust standard deviations
 *   (1.4826 x the median absolute deviation, which the normal distribution's sd
 *   equals; Rousseeuw and Croux, 1993). Within one crop where the fields' crops
 *   are known, since a field of maize is not a stressed field of soybean.
 *
 * A DEPARTURE IS NOT A DIAGNOSIS. A later sowing, another crop or a fallow
 * field departs as a stressed one does.
 */
import type { HealthAnalysis } from "@/lib/types"

/** The spread below which a departure is not divided further; the sidecar's SD_FLOOR. */
export const SD_FLOOR = 0.02
/** Days apart that still count as one acquisition across fields. */
export const SAME_DATE_DAYS = 3
/** Fields a group needs before a median and a spread mean anything. */
export const MIN_GROUP = 3

export type Band = "well below" | "below" | "typical" | "above" | "well above"

/** A departure in standard deviations, in words: one and two sd are the cuts. */
export function band(z: number): Band {
  if (z <= -2) return "well below"
  if (z <= -1) return "below"
  if (z < 1) return "typical"
  if (z < 2) return "above"
  return "well above"
}

/** The latest departure a run reports against its earlier seasons, or null. */
export function latestDeparture(report: HealthAnalysis): { date: string; ndvi: number | null; ndre: number | null } | null {
  const l = report.latest
  if (!l) return null
  return { date: l.date, ndvi: l.ndvi_z, ndre: l.ndre_z }
}

export interface FieldReport {
  fieldId: string
  fieldName: string
  report: HealthAnalysis
  /** The crop to compare within, by the field's dominant class; null where unknown. */
  crop: string | null
}

export interface NeighbourScore {
  fieldId: string
  fieldName: string
  /** The acquisition read for this field, or null where it has none near the shared date. */
  date: string | null
  ndvi: number | null
  /** Against the other fields of its group; null where the group is too small or the field has no value. */
  z: number | null
  group: string
  groupSize: number
}

const DAY = 86_400_000
const at = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`)

/**
 * The most recent date that at least half the fields observed, within
 * SAME_DATE_DAYS: the fields of one area share the Sentinel-2 tiles, so their
 * clear dates coincide except where cloud took one field and left another.
 */
export function sharedDate(reports: readonly HealthAnalysis[]): string | null {
  const dates = [...new Set(reports.flatMap((r) => r.current.map((p) => p.date.slice(0, 10))))].sort().reverse()
  const need = Math.ceil(reports.length / 2)
  for (const d of dates) {
    const seen = reports.filter((r) =>
      r.current.some((p) => Math.abs(at(p.date) - at(d)) <= SAME_DATE_DAYS * DAY)
    ).length
    if (seen >= need) return d
  }
  return null
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Each field's NDVI on the shared date against the others of its crop. */
export function neighbourScores(fields: readonly FieldReport[]): { date: string | null; scores: NeighbourScore[] } {
  const date = sharedDate(fields.map((f) => f.report))
  const read = fields.map((f) => {
    if (!date) return { f, obs: null }
    let best: { date: string; ndvi: number } | null = null
    for (const p of f.report.current) {
      const gap = Math.abs(at(p.date) - at(date))
      if (gap > SAME_DATE_DAYS * DAY) continue
      if (!best || gap < Math.abs(at(best.date) - at(date))) best = { date: p.date.slice(0, 10), ndvi: p.ndvi }
    }
    return { f, obs: best }
  })
  const groups = new Map<string, number[]>()
  for (const { f, obs } of read) {
    if (!obs) continue
    const g = f.crop ?? "all"
    groups.set(g, [...(groups.get(g) ?? []), obs.ndvi])
  }
  const stats = new Map<string, { median: number; spread: number; n: number }>()
  for (const [g, xs] of groups) {
    const m = median(xs)
    const mad = median(xs.map((x) => Math.abs(x - m)))
    stats.set(g, { median: m, spread: Math.max(1.4826 * mad, SD_FLOOR), n: xs.length })
  }
  return {
    date,
    scores: read.map(({ f, obs }) => {
      const g = f.crop ?? "all"
      const s = stats.get(g)
      const n = s?.n ?? 0
      return {
        fieldId: f.fieldId,
        fieldName: f.fieldName,
        date: obs?.date ?? null,
        ndvi: obs?.ndvi ?? null,
        z: obs && s && n >= MIN_GROUP ? (obs.ndvi - s.median) / s.spread : null,
        group: g,
        groupSize: n,
      }
    }),
  }
}
