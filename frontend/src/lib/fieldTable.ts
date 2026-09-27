/**
 * One row per field: what the compositor's Field table shows and exports.
 *
 * Each column comes from an input the node was given and is empty where it was
 * not: the area by class from a class map (after whatever filters the graph put
 * before it), the season dates and the mean confidence from a classification's
 * Season output, the departure from a vegetation health run's report, the
 * hectares on each public register from an overlap run's, the latest canopy
 * loss and open water from a radar run's, and the suggested number of zones
 * from a zones run's. A row is one field of a field set, or the one run a
 * plain Run node reads.
 */
import { classAreas, type ClassValue } from "@/lib/compositorEval"
import { overlapFigures, type OverlapFigures } from "@/lib/overlap"
import { radarFigures, type RadarFigures } from "@/lib/radar"
import { zonesFigures, type ZonesFigures } from "@/lib/zones"
import type { Season } from "@/lib/season"
import type { HealthAnalysis, OverlapAnalysis, RadarAnalysis, ZonesAnalysis } from "@/lib/types"

export interface FieldRow {
  field: string
  /** Area by class, largest first; null without a class map. */
  classes: { name: string; color: string; amount: number }[] | null
  /** Hectares where the map knows its cell area, pixels otherwise. */
  unit: "ha" | "px"
  season: Season | null
  /** Mean classifier confidence over the run, 0-1; null where none was reported. */
  confidence: number | null
  health: { date: string; ndviZ: number | null; ndreZ: number | null; ndvi: number } | null
  /** Hectares on each register; a register not read is null, not zero. */
  overlap: OverlapFigures | null
  radar: RadarFigures | null
  zones: ZonesFigures | null
}

export function fieldRow(
  field: string,
  classes: ClassValue | null,
  season: { season: Season | null; meanConfidence: number | null } | null,
  health: HealthAnalysis | null,
  overlap: OverlapAnalysis | null = null,
  radar: RadarAnalysis | null = null,
  zones: ZonesAnalysis | null = null
): FieldRow {
  let rows: FieldRow["classes"] = null
  let unit: FieldRow["unit"] = "ha"
  if (classes) {
    const scale = classes.info.pixelAreaHa
    unit = scale == null ? "px" : "ha"
    rows = classAreas(classes).rows.map(({ entry, px }) => ({
      name: entry.name,
      color: entry.color,
      amount: scale == null ? px : px * scale,
    }))
  }
  const l = health?.latest
  return {
    field,
    classes: rows,
    unit,
    season: season?.season ?? null,
    confidence: season?.meanConfidence ?? null,
    health: l ? { date: l.date, ndviZ: l.ndvi_z, ndreZ: l.ndre_z, ndvi: l.ndvi } : null,
    overlap: overlapFigures(overlap),
    radar: radarFigures(radar),
    zones: zonesFigures(zones),
  }
}

/** The class a row is mostly, and its share of what was classified. */
export function dominant(row: FieldRow): { name: string; share: number } | null {
  const c = row.classes
  if (!c?.length) return null
  const total = c.reduce((s, x) => s + x.amount, 0)
  return total > 0 ? { name: c[0].name, share: c[0].amount / total } : null
}

export function classifiedTotal(row: FieldRow): number | null {
  return row.classes ? row.classes.reduce((s, x) => s + x.amount, 0) : null
}

const cell = (v: string | number | null | undefined): string => {
  if (v == null) return ""
  const s = typeof v === "number" ? String(Number(v.toFixed(4))) : v
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * The rows as CSV: one column per class present in any row, in the order of
 * their total across rows, beside the dominant class, the season dates with
 * their windows, the confidence, the departures and the hectares on each
 * public register with the moment the registers were read.
 */
export function fieldTableCsv(rows: readonly FieldRow[]): string {
  const totals = new Map<string, number>()
  for (const r of rows) for (const c of r.classes ?? []) totals.set(c.name, (totals.get(c.name) ?? 0) + c.amount)
  const classNames = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)
  const unit = rows.some((r) => r.classes && r.unit === "px") ? "px" : "ha"
  const header = [
    "field",
    `classified_${unit}`,
    ...classNames.map((n) => `${n}_${unit}`),
    "dominant_class",
    "dominant_share",
    "rise",
    "rise_from",
    "rise_to",
    "peak",
    "peak_from",
    "peak_to",
    "fall",
    "fall_from",
    "fall_to",
    "season_days",
    "mean_confidence",
    "health_date",
    "ndvi",
    "ndvi_z",
    "ndre_z",
    "registers_read_at",
    "prodes_2009_2020_ha",
    "prodes_2021_ha",
    "prodes_2022_on_ha",
    "deter_ha",
    "embargo_ibama_ha",
    "embargo_icmbio_ha",
    "indigenous_land_ha",
    "conservation_unit_ha",
    "outside_car_ha",
    "registers_not_read",
    "radar_passes",
    "radar_canopy_losses",
    "radar_last_loss_from",
    "radar_last_loss_to",
    "radar_latest_date",
    "radar_latest_water_share",
    "zones_suggested",
    "zones_fpi",
    "zones_nce",
    "zones_seasons",
  ]
  const lines = rows.map((r) => {
    const byName = new Map((r.classes ?? []).map((c) => [c.name, c.amount]))
    const d = dominant(r)
    const s = r.season
    return [
      r.field,
      classifiedTotal(r),
      ...classNames.map((n) => (r.classes ? (byName.get(n) ?? 0) : null)),
      d?.name ?? null,
      d?.share ?? null,
      s?.rise?.date,
      s?.rise?.from,
      s?.rise?.to,
      s?.peak?.date,
      s?.peak?.from,
      s?.peak?.to,
      s?.fall?.date,
      s?.fall?.from,
      s?.fall?.to,
      s?.lengthDays ?? null,
      r.confidence,
      r.health?.date,
      r.health?.ndvi ?? null,
      r.health?.ndviZ ?? null,
      r.health?.ndreZ ?? null,
      r.overlap?.readAt,
      r.overlap?.prodes2009to2020 ?? null,
      r.overlap?.prodes2021 ?? null,
      r.overlap?.prodesFrom2022 ?? null,
      r.overlap?.deter ?? null,
      r.overlap?.embargoIbama ?? null,
      r.overlap?.embargoIcmbio ?? null,
      r.overlap?.indigenous ?? null,
      r.overlap?.conservation ?? null,
      r.overlap?.carGap ?? null,
      r.overlap ? r.overlap.unread.join("; ") : null,
      r.radar?.passes ?? null,
      r.radar?.losses ?? null,
      r.radar?.lastLossFrom,
      r.radar?.lastLossTo,
      r.radar?.latestDate,
      r.radar?.latestWater ?? null,
      r.zones?.suggestedK ?? null,
      r.zones?.fpi ?? null,
      r.zones?.nce ?? null,
      r.zones?.seasonsUsed ?? null,
    ]
      .map(cell)
      .join(",")
  })
  return [header.map(cell).join(","), ...lines].join("\n") + "\n"
}
