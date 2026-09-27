/**
 * A zones run as the compositor reads it: the partition a node has chosen, the
 * file it exports, and the figures a field's row carries.
 *
 * Every partition the sidecar computed travels with the run (terra/zones), so
 * the number of zones is a choice made here, over the same data, rather than a
 * run made again.
 */
import type { ZonesAnalysis, ZonesPartition } from "@/lib/types"

/** The partition into `k` zones, or the suggested one where `k` is null or absent. */
export function chosenPartition(report: ZonesAnalysis | null, k: number | null): ZonesPartition | null {
  if (!report) return null
  return (
    (k != null ? report.partitions.find((p) => p.k === k) : undefined) ??
    report.partitions.find((p) => p.k === report.suggested_k) ??
    report.partitions[0] ??
    null
  )
}

interface Feature {
  type: "Feature"
  properties: Record<string, unknown>
  geometry: unknown
}

function featuresOf(p: ZonesPartition): Feature[] {
  try {
    const fc = JSON.parse(p.zones_geojson) as { features?: Feature[] }
    return Array.isArray(fc.features) ? fc.features : []
  } catch {
    return []
  }
}

/**
 * One GeoJSON FeatureCollection for the fields given, each feature carrying
 * its field's name beside its zone: the file a variable-rate prescription is
 * built from, where each field's zones are its own.
 */
export function zonesGeoJSON(fields: readonly { name: string; partition: ZonesPartition | null }[]): string {
  const features: Feature[] = []
  for (const f of fields) {
    if (!f.partition) continue
    for (const feat of featuresOf(f.partition)) {
      features.push({ ...feat, properties: { field: f.name, ...feat.properties } })
    }
  }
  return JSON.stringify({ type: "FeatureCollection", features })
}

/** What a field's row in the Field table carries of its zones run. */
export interface ZonesFigures {
  suggestedK: number
  fpi: number | null
  nce: number | null
  seasonsUsed: number
}

export function zonesFigures(report: ZonesAnalysis | null): ZonesFigures | null {
  if (!report) return null
  const p = chosenPartition(report, null)
  return {
    suggestedK: report.suggested_k,
    fpi: p?.fpi ?? null,
    nce: p?.nce ?? null,
    seasonsUsed: report.seasons.filter((s) => s.used).length,
  }
}
