import { describe, expect, it } from "vitest"

import { daysBetween, placeDayOfYear, seasonOf } from "@/lib/season"

const point = (date: string, ndvi: number) => ({
  date,
  ndvi_mean: ndvi,
  ndvi_std: 0,
  evi_mean: 0,
  evi_std: 0,
  savi_mean: 0,
  savi_std: 0,
})

describe("placing a day of the year", () => {
  it("finds the day inside the range, across a new year", () => {
    // Day 288 of 2025 is 15 Oct; day 45 of 2026 is 14 Feb.
    expect(placeDayOfYear(288, "2025-09-01", "2026-03-31")).toBe("2025-10-15")
    expect(placeDayOfYear(45, "2025-09-01", "2026-03-31")).toBe("2026-02-14")
    expect(placeDayOfYear(200, "2025-09-01", "2026-03-31")).toBeNull()
  })
})

describe("a run's season", () => {
  const series = [
    point("2025-09-20", 0.2),
    point("2025-10-10", 0.25),
    point("2025-10-25", 0.0), // cloud: no value, not an observation
    point("2025-11-04", 0.6),
    point("2025-12-20", 0.85),
    point("2026-02-10", 0.7),
    point("2026-03-05", 0.3),
  ]
  // Rise day 300 (27 Oct 2025), peak day 354 (20 Dec 2025), fall day 50 (19 Feb 2026).
  const phenology = { sos_doy: 300, pos_doy: 354, eos_doy: 50, los_days: 115, peak: 0.85, base: 0.2, amplitude: 0.65 }

  it("places each mark in order and brackets it by the clear observations around it", () => {
    const s = seasonOf({ vi_series: series, phenology })!
    expect(s.rise).toEqual({ date: "2025-10-27", from: "2025-10-10", to: "2025-11-04" })
    expect(s.peak).toEqual({ date: "2025-12-20", from: "2025-11-04", to: "2026-02-10" })
    expect(s.fall).toEqual({ date: "2026-02-19", from: "2026-02-10", to: "2026-03-05" })
    expect(s.observations).toHaveLength(6)
    expect(daysBetween(s.rise!.from, s.rise!.to)).toBe(25)
  })

  it("is nothing without a series or a peak", () => {
    expect(seasonOf({ vi_series: [], phenology })).toBeNull()
    expect(seasonOf({ vi_series: series, phenology: { ...phenology, pos_doy: null } })).toBeNull()
  })
})
