import { describe, expect, it } from "vitest"

import type { ClassValue } from "@/lib/compositorEval"
import { dominant, fieldRow, fieldTableCsv } from "@/lib/fieldTable"
import type { Season } from "@/lib/season"
import type { HealthAnalysis } from "@/lib/types"

const soy = { id: 1, name: "Soybean", color: "#E974ED" }
const forest = { id: 3, name: "Forest, native", color: "#1f8d49" }

function classes(index: number[], pixelAreaHa: number | null = 0.01): ClassValue {
  return {
    type: "classes",
    key: `c:${index.join(",")}`,
    grid: { width: index.length, height: 1, index: Uint8Array.from(index) },
    info: { legend: [soy, forest], excluded: [], pixelAreaHa, areaIsMean: false },
    extent: null,
  }
}

const season: Season = {
  rise: { date: "2025-10-27", from: "2025-10-10", to: "2025-11-04" },
  peak: { date: "2025-12-20", from: "2025-11-04", to: "2026-02-10" },
  fall: { date: "2026-02-19", from: "2026-02-10", to: "2026-03-05" },
  lengthDays: 115,
  peakNdvi: 0.85,
  baseNdvi: 0.2,
  observations: [],
}

const health = {
  latest: { date: "2025-12-20", ndvi: 0.62, ndre: 0.3, baseline_n: 5, ndvi_mean: 0.8, ndvi_sd: 0.05, ndvi_z: -3.6, ndre_mean: 0.4, ndre_sd: 0.04, ndre_z: -2.5 },
} as unknown as HealthAnalysis

describe("a field's row", () => {
  it("takes the classes, the season and the departure from what reached the node", () => {
    const row = fieldRow("field 3", classes([0, 0, 0, 1]), { season, meanConfidence: 0.91 }, health)
    expect(row.classes?.map((c) => [c.name, Number(c.amount.toFixed(4))])).toEqual([
      ["Soybean", 0.03],
      ["Forest, native", 0.01],
    ])
    expect(dominant(row)).toEqual({ name: "Soybean", share: 0.75 })
    expect(row.health?.ndviZ).toBe(-3.6)
    expect(row.confidence).toBe(0.91)
  })

  it("leaves a column empty where its input was not given", () => {
    const row = fieldRow("field 4", null, null, null)
    expect(row.classes).toBeNull()
    expect(dominant(row)).toBeNull()
    expect(row.season).toBeNull()
  })
})

describe("the table as CSV", () => {
  it("writes one column per class across rows, quoting what needs it", () => {
    const csv = fieldTableCsv([
      fieldRow("field 3", classes([0, 0, 0, 1]), { season, meanConfidence: 0.91 }, health),
      fieldRow("field 4", classes([1, 1]), null, null),
    ])
    const [header, a, b] = csv.trim().split("\n")
    expect(header.split(",").slice(0, 4)).toEqual(["field", "classified_ha", "Soybean_ha", '"Forest'])
    expect(header).toContain('"Forest, native_ha"')
    expect(a).toContain("field 3,0.04,0.03,0.01,Soybean,0.75,2025-10-27,2025-10-10,2025-11-04")
    // The departures, then the eleven overlap, six radar and four zones columns, empty with none linked.
    expect(a.endsWith(",-3.6,-2.5" + ",".repeat(21))).toBe(true)
    expect(b.startsWith('field 4,0.02,0,0.02,"Forest, native",1,')).toBe(true)
  })
})
