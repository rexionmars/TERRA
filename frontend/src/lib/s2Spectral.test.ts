import { describe, expect, it } from "vitest"

import {
  jmErrorBound,
  measuredRuns,
  spectralChecks,
  spectralFeatures,
} from "@/lib/s2Spectral"

const at = (nm: number) => ({ wavelength_nm: nm })

describe("measuredRuns", () => {
  it("does not join B8A to B11 across the unmeasured stretch", () => {
    const runs = measuredRuns([
      at(2202.4),
      at(492.4),
      at(559.8),
      at(664.6),
      at(832.8),
      at(864.7),
      at(1613.7),
    ])
    expect(runs.map((r) => r.map((p) => p.wavelength_nm))).toEqual([
      [492.4, 559.8, 664.6, 832.8, 864.7],
      [1613.7],
      [2202.4],
    ])
  })
})

describe("spectralFeatures", () => {
  // A green canopy: low red, high NIR, SWIR below NIR.
  const canopy = {
    B02: 0.03,
    B03: 0.06,
    B04: 0.03,
    B08: 0.4,
    B8A: 0.41,
    B11: 0.2,
    B12: 0.09,
  }

  it("reads NDVI, the red absorption depth and NDMI off a canopy", () => {
    const f = spectralFeatures(canopy)
    expect(f.ndvi).toBeCloseTo((0.4 - 0.03) / 0.43, 6)
    // Continuum at 665 nm on the line from B03 (559.8) to B08 (832.8).
    const continuum = 0.06 + ((0.4 - 0.06) * (664.6 - 559.8)) / (832.8 - 559.8)
    expect(f.redDepth).toBeCloseTo(1 - 0.03 / continuum, 6)
    expect(f.ndmi).toBeCloseTo((0.41 - 0.2) / 0.61, 6)
  })

  it("leaves a feature out when a band it needs is missing or not positive", () => {
    const f = spectralFeatures({ ...canopy, B11: -0.03, B04: undefined })
    expect(f.ndvi).toBeNull()
    expect(f.redDepth).toBeNull()
    expect(f.ndmi).toBeNull()
  })
})

describe("spectralChecks", () => {
  it("passes a canopy", () => {
    expect(spectralChecks({ B04: 0.03, B08: 0.4, B8A: 0.41, B11: 0.2 })).toEqual([])
  })

  it("flags a negative mean and a NIR pair that disagrees", () => {
    const checks = spectralChecks({
      B04: 0.03,
      B08: 0.37,
      B8A: 0.025,
      B11: -0.03,
      B12: -0.05,
    })
    expect(checks.map((c) => c.bands)).toEqual([
      ["B11", "B12"],
      ["B08", "B8A"],
    ])
  })

  it("lets a dark pixel's offset pass", () => {
    expect(spectralChecks({ B02: -0.004, B08: 0.05, B8A: 0.04 })).toEqual([])
  })
})

describe("jmErrorBound", () => {
  it("runs from a coin toss at JM 0 to none at JM 2", () => {
    expect(jmErrorBound(0)).toBe(0.5)
    expect(jmErrorBound(2)).toBe(0)
    expect(jmErrorBound(0.917)).toBeCloseTo(0.5 * (1 - 0.4585), 6)
  })
})
