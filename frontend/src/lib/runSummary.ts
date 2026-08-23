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

export function runSummaryObject(
  summary?: string | null
): Record<string, unknown> {
  if (!summary?.trim()) return {}
  try {
    const j = JSON.parse(summary) as unknown
    return j && typeof j === "object" ? (j as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Which solar product a saved run holds.
 *
 * One store kind covers the resource run, the two raster products and the
 * photovoltaic energy model, and app.go tells them apart by summary_json
 * solar_product, the same key LoadAnalysis discriminates on. Unread, an energy
 * model run and a resource run list under one label with one set of figures. A
 * run written before the key existed carries none and is a resource run, which
 * is what the fallback names.
 */
export function solarProductLabel(summary?: string | null): string {
  const product = runSummaryObject(summary).solar_product
  if (typeof product !== "string") return "Solar resource"
  if (product === "solar_terrain") return "Terrain and horizon shading"
  if (product === "solar_siting") return "Photovoltaic siting"
  // Matched by prefix, not by equality, so the label survives a rename of the
  // energy product tag without silently falling back to "Solar resource".
  if (product.startsWith("energy")) return "Photovoltaic energy model"
  return "Solar resource"
}

/**
 * The HAND threshold a saved flood envelope was built at.
 *
 * The agreement raster is one threshold's, and every figure in the row is read
 * at it, so a row that omits it states a contested share of an extent it does
 * not name. Absent on a run written before the key existed, in which case the
 * row simply carries one fewer part rather than inventing 1 m.
 */
export function floodReferenceThreshold(summary?: string | null): string {
  const v = runSummaryObject(summary).flood_reference_threshold_m
  return typeof v === "number" && Number.isFinite(v) ? `HAND <= ${v} m` : ""
}

export function modelDisplayName(kind: string): string {
  if (kind === "temporal_transformer") return "Temporal Transformer"
  if (kind === "prithvi") return "Prithvi-EO 2.0"
  if (kind === "spectral" || kind === "") return "Random Forest"
  // Anything else names itself. The old fallback returned Random Forest for
  // every unknown value, so a solar run recorded as NASA POWER was listed as a
  // classification by a model that never touched it.
  return kind
}

/**
 * What a saved run produced and over what period, as one line.
 *
 * Shared so that every list of runs describes a kind the same way. The profile
 * page had no branch at all and rendered a wind run's empty acquisition window
 * as a bare arrow, under a model name that never touched it.
 */
export function runRowLine(run: {
  kind?: string
  model_kind: string
  period_start: string
  period_end: string
  summary?: string | null
  n_dates?: number
}): string {
  const j = runSummaryObject(run.summary)
  const window = (key: string) =>
    typeof j[key] === "string" && (j[key] as string).trim()
      ? (j[key] as string)
      : ""
  switch (run.kind) {
    case "water":
      return [
        `Surface water · ${run.model_kind || "index"}`,
        parseRunSummary(run.summary).dateRange?.join(" → ") ?? "",
      ]
        .filter(Boolean)
        .join(" · ")
    case "solar":
      // A climatology has no observed acquisition window, so none is shown.
      // Emitting the separator regardless left the row ending in an arrow.
      return `${solarProductLabel(run.summary)} · ${run.model_kind || "NASA POWER"}`
    case "wind":
      return [
        `Wind screening · ${run.model_kind || "NASA POWER MERRA-2"}`,
        window("record_window"),
      ]
        .filter(Boolean)
        .join(" · ")
    case "flood":
      /*
        The threshold, not a period: the envelope reads terrain and has no
        acquisition window at all, and the reference threshold is what two
        flood runs of one area differ by. The model name defaults to the
        catalogue the DEM products come from, because it is the substitution
        of that catalogue for the study's that makes this envelope TERRA's own
        rather than the published one.
      */
      return [
        `Flood envelope · ${run.model_kind || "Planetary Computer DEM"}`,
        floodReferenceThreshold(run.summary),
      ]
        .filter(Boolean)
        .join(" · ")
    default: {
      const observed = parseRunSummary(run.summary).dateRange
      const period =
        observed?.join(" → ") ??
        (run.period_start && run.period_end
          ? `${run.period_start} → ${run.period_end}`
          : "")
      return [modelDisplayName(run.model_kind), period].filter(Boolean).join(" · ")
    }
  }
}

/**
 * The product a saved run came from, in one word.
 *
 * Rows written before the kind column carry an empty string, which the store
 * reads back as "classification" -- so the fallback here names that rather than
 * something like "unknown", which would label the oldest runs as a mystery
 * product that does not exist.
 */
export function runKindLabel(kind?: string): string {
  if (kind === "water") return "water"
  if (kind === "solar") return "solar"
  if (kind === "wind") return "wind"
  if (kind === "flood") return "flood"
  return "class"
}

/**
 * ISO dates cut to their month.
 *
 * A period spelled in full on both ends is 23 characters, which in a 15rem
 * column truncated an area called "Custom AOI" to "Cust..." and in a menu row
 * cut the second date mid-way to "202…". The day is not what separates two
 * runs of one area -- the month is -- and the full text stays on the element's
 * title for anyone who needs it.
 */
export function datesByMonth(text: string): string {
  return text.replace(/(\d{4}-\d{2})-\d{2}/g, "$1")
}
