/**
 * Readers for the summary JSON stored with every saved run.
 *
 * app.go writes class_stats, date_range, n_dates and mean_confidence into
 * InferenceRun.summary, so a run list can state what a run produced without a
 * LoadAnalysis round trip per row. Every reader is defensive: summary is opaque
 * TEXT and rows written by older versions omit keys.
 */

export interface RunClassStat {
  class_id: number
  name: string
  color: string
  pct: number
  area_ha: number
}

export interface RunSummary {
  classStats: RunClassStat[]
  /** Observed acquisition extent [first, last], as opposed to the requested window. */
  dateRange: [string, string] | null
  nDates: number | null
}

function isClassStat(v: unknown): v is RunClassStat {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return typeof o.name === "string" && typeof o.color === "string"
}

export function parseRunSummary(summary?: string | null): RunSummary {
  const empty: RunSummary = { classStats: [], dateRange: null, nDates: null }
  if (!summary?.trim()) return empty
  try {
    const j = JSON.parse(summary) as Record<string, unknown>
    const rawStats = Array.isArray(j.class_stats) ? j.class_stats : []
    const classStats = rawStats.filter(isClassStat)
    const rawRange = Array.isArray(j.date_range) ? j.date_range : []
    const dateRange =
      typeof rawRange[0] === "string" &&
      typeof rawRange[1] === "string" &&
      rawRange[0] &&
      rawRange[1]
        ? ([rawRange[0], rawRange[1]] as [string, string])
        : null
    return {
      classStats,
      dateRange,
      nDates: typeof j.n_dates === "number" ? j.n_dates : null,
    }
  } catch {
    return empty
  }
}

/**
 * The class covering the most pixels. class_statistics emits class_stats
 * ordered by pixel count descending (sidecar/infer.py), so this is element 0
 * rather than a scan.
 */
export function dominantClass(stats: RunClassStat[]): RunClassStat | null {
  return stats[0] ?? null
}

/**
 * Area the model actually assigned a class to, which is not the AOI area: the
 * qualifying-pixel mask differs per model, so the same AOI classified twice can
 * report two figures. Label it as classified area, never as AOI area.
 */
export function classifiedAreaHa(stats: RunClassStat[]): number {
  return stats.reduce(
    (sum, s) => sum + (typeof s.area_ha === "number" ? s.area_ha : 0),
    0
  )
}

export function formatHectares(ha: number): string {
  if (!Number.isFinite(ha) || ha <= 0) return "—"
  if (ha < 10) return `${ha.toFixed(2)} ha`
  if (ha < 1000) return `${ha.toFixed(1)} ha`
  return `${Math.round(ha).toLocaleString()} ha`
}
