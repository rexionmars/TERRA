import { describe, expect, it } from "vitest"

import {
  agreementColor,
  agreementLevelLabel,
  agreementLevels,
} from "@/components/flood/agreementLevels"
import { PALETTE_STOPS } from "@/lib/palettes"
import type { FloodAgreement, FloodCellSize } from "@/lib/types"

/** The counts and cell size of internal/research/testdata/flood_b.json. */
const COUNTS = [38958, 2272, 1190, 863, 565]
const CELL: FloodCellSize = { x: 27.853935364831365, y: 30.705555555555556 }

const agreement = (counts: number[]): FloodAgreement => ({
  counts,
  unanimous_wet_km2: 0,
  contested_km2: 0,
  unanimous_dry_km2: 0,
  contested_frac_of_wet: null,
})

describe("agreementLevels", () => {
  it("names one level per agreement count, dry level first", () => {
    const levels = agreementLevels(agreement(COUNTS), CELL)
    expect(levels).toHaveLength(5)
    expect(levels.map((l) => l.count)).toEqual([0, 1, 2, 3, 4])
    expect(levels.map((l) => l.of)).toEqual([4, 4, 4, 4, 4])
    expect(levels.map((l) => l.standing)).toEqual([
      "dry",
      "contested",
      "contested",
      "contested",
      "unanimous",
    ])
    expect(agreementLevelLabel(levels[3])).toBe("3 of 4")
  })

  it("takes the area of a level as its cells times the cell size", () => {
    const levels = agreementLevels(agreement(COUNTS), CELL)
    const cellKm2 = (CELL.x * CELL.y) / 1e6
    expect(levels[4].areaKm2).toBeCloseTo(565 * cellKm2, 10)
    // The payload reports 0.4832 km2 unanimous wet over this window.
    expect(levels[4].areaKm2).toBeCloseTo(0.4832, 3)
  })

  it("takes each level's share against the whole window", () => {
    const levels = agreementLevels(agreement(COUNTS), CELL)
    const total = COUNTS.reduce((s, n) => s + n, 0)
    expect(levels[1].frac).toBeCloseTo(2272 / total, 12)
    expect(levels.reduce((s, l) => s + l.frac, 0)).toBeCloseTo(1, 12)
  })

  it("leaves the dry level without a swatch, since it is not drawn", () => {
    expect(agreementColor(0, 4)).toBeNull()
    expect(agreementLevels(agreement(COUNTS), CELL)[0].color).toBeNull()
  })

  /*
    With four products every level lands exactly on a stop of the blues ramp,
    so the legend and the raster are the same byte rather than nearly it. This
    is what would break first if either the palette or agreement_rgba changed.
  */
  it("colours a four-product level on a palette stop, with no interpolation", () => {
    const blues = PALETTE_STOPS.blues
    expect(agreementColor(1, 4)).toBe(blues[1])
    expect(agreementColor(2, 4)).toBe(blues[2])
    expect(agreementColor(3, 4)).toBe(blues[3])
    expect(agreementColor(4, 4)).toBe(blues[4])
  })

  it("interpolates between stops for a product count the ramp does not divide", () => {
    const blues = PALETTE_STOPS.blues
    // t = 1/3 falls a third of the way along the second segment.
    const c = agreementColor(1, 3)
    expect(c).toMatch(/^#[0-9a-f]{6}$/)
    expect(c).not.toBe(blues[1])
    expect(c).not.toBe(blues[2])
    // Still the darkest stop at full agreement.
    expect(agreementColor(3, 3)).toBe(blues[4])
  })

  it("reports a window nobody calls flooded without dividing by zero", () => {
    const levels = agreementLevels(agreement([0, 0, 0]), CELL)
    expect(levels.map((l) => l.frac)).toEqual([0, 0, 0])
    expect(levels.map((l) => l.areaKm2)).toEqual([0, 0, 0])
  })
})
