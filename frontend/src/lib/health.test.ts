import { describe, expect, it } from "vitest"

import { band, neighbourScores, sharedDate, type FieldReport } from "@/lib/health"
import type { HealthAnalysis } from "@/lib/types"

function report(points: [string, number][]): HealthAnalysis {
  return {
    extent: { lon_min: 0, lat_min: 0, lon_max: 1, lat_max: 1 },
    window_days: 16,
    baseline_years: [],
    current: points.map(([date, ndvi]) => ({ date, ndvi, ndre: 0.3, clear_fraction: 1 })),
    baseline: [],
    anomaly: [],
    latest: null,
    map_date: points[points.length - 1][0],
    map_range: 0.3,
    anomaly_uri: "",
    ndvi_uri: "",
  }
}

const field = (id: string, points: [string, number][], crop: string | null = null): FieldReport => ({
  fieldId: id,
  fieldName: `field ${id}`,
  report: report(points),
  crop,
})

describe("reading a departure", () => {
  it("cuts at one and two standard deviations", () => {
    expect([-2.5, -1.5, 0, 1.2, 3].map(band)).toEqual(["well below", "below", "typical", "above", "well above"])
  })
})

describe("fields against each other", () => {
  it("compares on the latest date half the fields share, within three days", () => {
    const reports = [
      report([["2025-12-01", 0.8], ["2025-12-20", 0.8]]),
      report([["2025-12-01", 0.8], ["2025-12-21", 0.8]]),
      report([["2025-12-01", 0.8]]),
      report([["2025-12-02", 0.8]]),
    ]
    expect(sharedDate(reports)).toBe("2025-12-21")
    expect(sharedDate([report([["2025-12-01", 0.8]]), report([["2025-12-20", 0.8]]), report([["2025-12-25", 0.8]])])).toBeNull()
  })

  it("scores each field against the median of its group, in robust standard deviations", () => {
    const { date, scores } = neighbourScores([
      field("1", [["2025-12-20", 0.8]]),
      field("2", [["2025-12-20", 0.82]]),
      field("3", [["2025-12-20", 0.78]]),
      field("4", [["2025-12-20", 0.5]]),
    ])
    expect(date).toBe("2025-12-20")
    const z = Object.fromEntries(scores.map((s) => [s.fieldId, s.z]))
    // median 0.79, MAD 0.02, spread 1.4826 * 0.02 = 0.0297
    expect(z["4"]).toBeCloseTo((0.5 - 0.79) / (1.4826 * 0.02), 3)
    expect(Math.abs(z["1"]!)).toBeLessThan(1)
  })

  it("compares within a crop, and not in a group too small to have a spread", () => {
    const { scores } = neighbourScores([
      field("1", [["2025-12-20", 0.8]], "Soybean"),
      field("2", [["2025-12-20", 0.82]], "Soybean"),
      field("3", [["2025-12-20", 0.78]], "Soybean"),
      field("4", [["2025-12-20", 0.4]], "Maize"),
    ])
    const maize = scores.find((s) => s.fieldId === "4")!
    expect(maize.group).toBe("Maize")
    expect(maize.z).toBeNull()
    expect(scores.find((s) => s.fieldId === "1")!.groupSize).toBe(3)
  })
})
