import { describe, expect, it } from "vitest"

import {
  agreementColor,
  agreementDry,
  agreementLevelLabel,
  agreementLevels,
  agreementStandingLabel,
} from "@/components/flood/agreementLevels"
import { PALETTE_STOPS } from "@/lib/palettes"
import type { FloodAgreement, FloodCellSize } from "@/lib/types"

/**
 * The counts and cell size of internal/research/testdata/flood_b.json, which
 * are over the AOI polygon: they sum to aoi.cells (5256) and not to
 * grid.width * grid.height (43848).
 */
const COUNTS = [4818, 169, 104, 95, 70]
const CELL: FloodCellSize = { x: 27.853935364831365, y: 30.705555555555556 }

const agreement = (counts: number[]): FloodAgreement => ({
  counts,
  unanimous_wet_km2: 0,
  contested_km2: 0,
  unanimous_dry_km2: 0,
  contested_frac_of_wet: null,
})

describe("agreementLevels", () => {
  it("names one level per agreement count and leaves the dry cells out", () => {
    const levels = agreementLevels(agreement(COUNTS), CELL)
    expect(levels).toHaveLength(4)
    expect(levels.map((l) => l.count)).toEqual([1, 2, 3, 4])
    expect(levels.map((l) => l.of)).toEqual([4, 4, 4, 4])
    expect(levels.map((l) => l.standing)).toEqual([
      "contested",
      "contested",
      "contested",
      "unanimous",
    ])
    expect(agreementLevelLabel(levels[2])).toBe("3 of 4")
    expect(agreementLevelLabel(levels[3])).toBe("All 4 products")
  })

  /*
    The class list measures agreement between products, and 0 of 4 states
    nothing about that. It is also 91.7% of this AOI, so listed as a class it
    would be the largest row in a list whose subject is disagreement.
  */
  it("keeps the dry remainder out of the classes and reports it apart", () => {
    const levels = agreementLevels(agreement(COUNTS), CELL)
    expect(levels.some((l) => l.count === 0)).toBe(false)
    const dry = agreementDry(agreement(COUNTS), CELL)
    expect(dry.cells).toBe(4818)
    // The payload reports 4.1207 km2 unanimous dry over this AOI.
    expect(dry.areaKm2).toBeCloseTo(4.1207, 3)
    expect(dry.frac).toBeCloseTo(4818 / 5256, 12)
  })

  it("takes the area of a level as its cells times the cell size", () => {
    const levels = agreementLevels(agreement(COUNTS), CELL)
    const cellKm2 = (CELL.x * CELL.y) / 1e6
    expect(levels[3].areaKm2).toBeCloseTo(70 * cellKm2, 10)
    // The payload reports 0.0599 km2 unanimous wet over this AOI.
    expect(levels[3].areaKm2).toBeCloseTo(0.0599, 4)
  })

  it("takes each level's share against the whole AOI", () => {
    const levels = agreementLevels(agreement(COUNTS), CELL)
    const total = COUNTS.reduce((s, n) => s + n, 0)
    expect(total).toBe(5256)
    expect(levels[0].frac).toBeCloseTo(169 / total, 12)
    const dry = agreementDry(agreement(COUNTS), CELL)
    expect(levels.reduce((s, l) => s + l.frac, dry.frac)).toBeCloseTo(1, 12)
  })

  /*
    The ramp orders the classes and does not rank them by confidence. The
    lowest class is the widest split the products can produce, and the label
    has to say so where the colour suggests the opposite.
  */
  it("names a contested class by how many products call the cell dry", () => {
    const levels = agreementLevels(agreement(COUNTS), CELL)
    expect(agreementStandingLabel(levels[0])).toBe(
      "3 of 4 call it dry, the widest disagreement this product set can reach"
    )
    expect(agreementStandingLabel(levels[1])).toBe("2 of 4 call it dry")
    expect(agreementStandingLabel(levels[3])).toBe(
      "every product agrees, the terrain decides the extent"
    )
  })

  it("leaves the dry cells without a swatch, since the raster draws none", () => {
    expect(agreementColor(0, 4)).toBeNull()
  })

  /*
    With four products every level lands exactly on a stop of the blues ramp,
    so the legend and the raster carry the same byte. This is what would break
    first if either the palette or agreement_rgba changed.
  */
  it("colours a four-product level on a palette stop, with no interpolation", () => {
    const blues = PALETTE_STOPS.blues
    const levels = agreementLevels(agreement(COUNTS), CELL)
    expect(levels.map((l) => l.color)).toEqual([
      blues[1],
      blues[2],
      blues[3],
      blues[4],
    ])
    expect(agreementColor(3, 4)).toBe(blues[3])
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

  it("reports an AOI nobody calls flooded without dividing by zero", () => {
    const levels = agreementLevels(agreement([0, 0, 0]), CELL)
    expect(levels.map((l) => l.frac)).toEqual([0, 0])
    expect(levels.map((l) => l.areaKm2)).toEqual([0, 0])
    expect(agreementDry(agreement([0, 0, 0]), CELL)).toEqual({
      cells: 0,
      areaKm2: 0,
      frac: 0,
    })
  })
})
