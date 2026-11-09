import { describe, expect, it } from "vitest"

import { comparePairTables, formatGroundWidth, groundWidthM } from "@/lib/compareGrid"
import type { PredictResult } from "@/lib/types"

describe("groundWidthM", () => {
  it("measures a degree of longitude at the equator", () => {
    // 2 * pi * 6371008.8 / 360, the sphere's own figure.
    const box = { lon_min: 0, lat_min: 0, lon_max: 1, lat_max: 0 }
    expect(groundWidthM(box)).toBeCloseTo(111_195.08, 1)
  })

  it("shrinks with the cosine of the latitude", () => {
    const at60 = { lon_min: 0, lat_min: 60, lon_max: 1, lat_max: 60 }
    expect(groundWidthM(at60)).toBeCloseTo(111_195.08 * 0.5, -1)
  })

  it("follows the top edge of a turned raster", () => {
    const turned = {
      lon_min: -1,
      lat_min: -1,
      lon_max: 1,
      lat_max: 1,
      corners: [
        [0, 0],
        [1, 0],
        [1, -1],
        [0, -1],
      ],
    }
    expect(groundWidthM(turned)).toBeCloseTo(111_195.08, 1)
  })
})

describe("formatGroundWidth", () => {
  it("names a distance at the precision a caption can use", () => {
    expect(formatGroundWidth(950.4)).toBe("950 m")
    expect(formatGroundWidth(1234)).toBe("1.23 km")
    expect(formatGroundWidth(12_400)).toBe("12.4 km")
  })
})

describe("comparePairTables", () => {
  const run = (pct: number) => ({
    label: "r",
    result: {
      class_stats: [
        { class_id: 39, name: "Soybean", color: "#fff", pixels: 1, pct, area_ha: 1 },
      ],
    } as PredictResult,
  })

  it("carries the share delta even without a reference, which needs no agreement", () => {
    const tables = comparePairTables(run(10), run(25))
    expect(tables).toHaveLength(1)
    expect(tables[0].csvName).toMatch(/share/i)
  })
})
