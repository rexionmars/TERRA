import { describe, expect, it } from "vitest"

import { fieldRow, fieldTableCsv } from "@/lib/fieldTable"
import { runRowLine } from "@/lib/runSummary"
import type { ZonesAnalysis, ZonesPartition } from "@/lib/types"
import { chosenPartition, zonesFigures, zonesGeoJSON } from "@/lib/zones"

function partition(k: number, fpi: number): ZonesPartition {
  return {
    k,
    fpi,
    nce: fpi + 0.01,
    iterations: 30,
    zones: [],
    zones_geojson: JSON.stringify({
      type: "FeatureCollection",
      features: Array.from({ length: k }, (_, i) => ({
        type: "Feature",
        properties: { zone: i + 1, zones: k },
        geometry: { type: "Polygon", coordinates: [] },
      })),
    }),
    map_uri: "",
  }
}

const report: ZonesAnalysis = {
  extent: { lon_min: -53.345, lat_min: -24.875, lon_max: -53.335, lat_max: -24.866 },
  seasons: [
    { start: "2025-10-01", end: "2026-03-31", n_scenes: 25, n_clear: 22, cover: 1, used: true },
    { start: "2024-10-01", end: "2025-03-31", n_scenes: 26, n_clear: 24, cover: 1, used: true },
    { start: "2023-10-01", end: "2024-03-31", n_scenes: 19, n_clear: 2, cover: 0.1, used: false },
  ],
  n_cells: 10077,
  field_cells: 10077,
  fuzziness: 1.3,
  percentile: 90,
  min_zone_ha: 0.3,
  suggested_k: 4,
  partitions: [partition(3, 0.02), partition(4, 0.018), partition(5, 0.07)],
}

describe("a zones run", () => {
  it("reads the partition a node chose, or the suggested one", () => {
    expect(chosenPartition(report, null)?.k).toBe(4)
    expect(chosenPartition(report, 5)?.k).toBe(5)
    // A number the run did not compute falls back to the suggestion.
    expect(chosenPartition(report, 6)?.k).toBe(4)
    expect(chosenPartition(null, 3)).toBeNull()
  })

  it("exports every field's zones in one file, each feature naming its field", () => {
    const text = zonesGeoJSON([
      { name: "field 3", partition: chosenPartition(report, 3) },
      { name: "field 4", partition: null },
      { name: "field 5", partition: chosenPartition(report, 4) },
    ])
    const fc = JSON.parse(text) as { features: { properties: { field: string; zone: number } }[] }
    expect(fc.features).toHaveLength(7)
    expect(fc.features[0].properties).toMatchObject({ field: "field 3", zone: 1 })
    expect(fc.features[6].properties).toMatchObject({ field: "field 5", zone: 4 })
  })

  it("survives a partition whose GeoJSON cannot be read", () => {
    const broken = { ...partition(3, 0.02), zones_geojson: "not json" }
    expect(JSON.parse(zonesGeoJSON([{ name: "field 3", partition: broken }])).features).toEqual([])
  })

  it("fills the Field table's zones columns with the suggested partition", () => {
    const f = zonesFigures(report)
    expect(f).toMatchObject({ suggestedK: 4, fpi: 0.018, seasonsUsed: 2 })
    expect(f?.nce).toBeCloseTo(0.028, 6)
    const csv = fieldTableCsv([fieldRow("field 3", null, null, null, null, null, report)])
    const [head, row] = csv.trim().split("\n").map((l) => l.split(","))
    expect(row[head.indexOf("zones_suggested")]).toBe("4")
    expect(row[head.indexOf("zones_seasons")]).toBe("2")
  })

  it("says in a run list how many zones it suggests and over how many seasons", () => {
    const summary = JSON.stringify({ zones_suggested_k: 4, zones_seasons_used: 2 })
    expect(runRowLine({ kind: "zones", model_kind: "fuzzy-c-means", period_start: "", period_end: "", summary })).toBe(
      "Management zones · 4 zones suggested · 2 seasons"
    )
  })
})
