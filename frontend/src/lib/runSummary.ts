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
 * How much of a saved mineral map's area was observed, as "observed X of Y ha".
 *
 * Empty when either figure is absent, which is a run written before the keys
 * existed; the row then carries one fewer part rather than a zero.
 */
export function mineralObservedLine(summary?: string | null): string {
  const j = runSummaryObject(summary)
  const observed = j.mineral_observed_area_ha
  const aoi = j.mineral_aoi_area_ha
  if (typeof observed !== "number" || typeof aoi !== "number") return ""
  if (!Number.isFinite(observed) || !Number.isFinite(aoi)) return ""
  return `observed ${observed.toFixed(0)} of ${aoi.toFixed(0)} ha`
}

export function modelDisplayName(kind: string): string {
  if (kind === "temporal_transformer") return "Temporal Transformer"
  if (kind === "prithvi") return "Prithvi-EO 2.0"
  if (kind === "spectral" || kind === "") return "Random Forest"
  // Anything else names itself. The old fallback returned Random Forest for
  // every unknown value, so a descriptive run, recorded under the index or the
  // source that produced it, was listed as a classification by a model that
  // never touched it.
  return kind
}

/**
 * What a saved run produced and over what period, as one line.
 *
 * Shared so that every list of runs describes a kind the same way. The profile
 * page had no branch at all and rendered an empty acquisition window as a bare
 * arrow, under a model name that never touched it.
 */
export function runRowLine(run: {
  kind?: string
  model_kind: string
  period_start: string
  period_end: string
  summary?: string | null
  n_dates?: number
}): string {
  switch (run.kind) {
    case "water":
      return [
        `Surface water · ${run.model_kind || "index"}`,
        parseRunSummary(run.summary).dateRange?.join(" → ") ?? "",
      ]
        .filter(Boolean)
        .join(" · ")
    case "fields": {
      /*
        How many fields, and the two scenes they were drawn from. The dates
        are the scenes' own, not the windows': a run over a season is read
        by which days the network saw.
      */
      const j = runSummaryObject(run.summary)
      const n = typeof j.fields_n === "number" ? `${j.fields_n} fields` : ""
      const a = typeof j.fields_window_a === "string" ? j.fields_window_a : ""
      const b = typeof j.fields_window_b === "string" ? j.fields_window_b : ""
      return [
        "Field boundaries",
        n,
        a && b ? `${a} and ${b}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    }
    case "health": {
      // The latest departure: what a run list can say of a field in one line.
      const j = runSummaryObject(run.summary)
      const z = typeof j.health_latest_ndvi_z === "number" ? j.health_latest_ndvi_z : null
      const d = typeof j.health_latest_date === "string" ? j.health_latest_date : ""
      return [
        "Vegetation health",
        z != null ? `NDVI ${z >= 0 ? "+" : "\u2212"}${Math.abs(z).toFixed(1)} sd` : "no earlier season to compare",
        d,
      ]
        .filter(Boolean)
        .join(" · ")
    }
    case "overlap": {
      /*
        How many registers the area meets, how many could not be read, and the
        day they were read: a check holds for that day and no other.
      */
      const j = runSummaryObject(run.summary)
      const ha = j.overlap_ha && typeof j.overlap_ha === "object" ? (j.overlap_ha as Record<string, unknown>) : {}
      const status =
        j.overlap_status && typeof j.overlap_status === "object" ? (j.overlap_status as Record<string, unknown>) : {}
      // CAR is left out of the count: a field inside a registration is the expected case.
      const met = Object.entries(ha).filter(([id, v]) => id !== "car" && typeof v === "number" && v > 0).length
      const failed = Object.values(status).filter((s) => s === "failed").length
      const read = typeof j.overlap_read_at === "string" ? j.overlap_read_at.slice(0, 10) : ""
      return [
        "Socio-environmental overlap",
        met ? `meets ${met} ${met === 1 ? "register" : "registers"}` : "meets none",
        failed ? `${failed} not read` : "",
        read ? `read ${read}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    }
    case "radar": {
      // Passes read, and the latest canopy loss: one line of a field's radar.
      const j = runSummaryObject(run.summary)
      const n = typeof j.radar_n_passes === "number" ? j.radar_n_passes : null
      const from = typeof j.radar_last_loss_from === "string" ? j.radar_last_loss_from : ""
      const to = typeof j.radar_last_loss_to === "string" ? j.radar_last_loss_to : ""
      return [
        "Sentinel-1 radar",
        n != null ? `${n} ${n === 1 ? "pass" : "passes"}` : "",
        from && to ? `canopy loss ${from} to ${to}` : "no canopy loss",
      ]
        .filter(Boolean)
        .join(" · ")
    }
    case "zones": {
      // The number of zones suggested, and over how many seasons.
      const j = runSummaryObject(run.summary)
      const k = typeof j.zones_suggested_k === "number" ? j.zones_suggested_k : null
      const s = typeof j.zones_seasons_used === "number" ? j.zones_seasons_used : null
      return [
        "Management zones",
        k != null ? `${k} zones suggested` : "",
        s != null ? `${s} ${s === 1 ? "season" : "seasons"}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    }
    case "mineral":
      /*
        The observed area beside the AOI, for the reason the summary carries
        both (persistMineralRun): over vegetated ground most of an area has no
        mineral answer, and a row that names only the product reads as though
        the whole area was mapped. The period is the one searched for passes.
      */
      return [
        `Mineral map · ${run.model_kind || "Tetracorder"}`,
        mineralObservedLine(run.summary),
        run.period_start && run.period_end
          ? `${run.period_start} → ${run.period_end}`
          : "",
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
  if (kind === "mineral") return "mineral"
  if (kind === "fields") return "fields"
  if (kind === "health") return "health"
  if (kind === "overlap") return "overlap"
  if (kind === "radar") return "radar"
  if (kind === "zones") return "zones"
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
