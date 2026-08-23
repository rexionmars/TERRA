/**
 * Separability arithmetic, against values worked out from the definition.
 *
 * Every expected number below is derived by hand from the Bhattacharyya
 * expression in separability.ts and not read off the function's output. Several
 * are closed forms: for two Gaussians of equal variance the spread term
 * vanishes and B reduces to (dm)^2 / (8 v), and for two of equal mean the mean
 * term vanishes and e^-B reduces to a square root, so the expected JM can be
 * written exactly rather than as a decimal that came from running the code.
 *
 * That distinction matters more here than usual. A test carrying what the
 * function printed passes whether or not the function is right, and this module
 * has no observable consequence to catch it out: a separability figure that is
 * quietly wrong looks exactly like a separability figure that is right, and it
 * is drawn beside class names in a panel a reader uses to decide whether a band
 * carries a distinction.
 */
import { describe, expect, it } from "vitest"
import {
  bhattacharyyaGaussian,
  classDriftBetweenRuns,
  classPairSeparability,
  jeffriesMatusita,
  separabilityBand,
} from "./separability"
import type { ClassSpectra, ClassSpectrumPoint } from "./types"

const point = (fields: Partial<ClassSpectrumPoint>): ClassSpectrumPoint =>
  ({
    class_id: 1,
    name: "Class 1",
    color: "#111111",
    band: "B02",
    wavelength_nm: 492.4,
    n_pixels: 500,
    mean: 0.1,
    sd: 0.02,
    p05: 0.07,
    p95: 0.13,
    ...fields,
  }) as ClassSpectrumPoint

const spectra = (
  points: ClassSpectrumPoint[],
  bands = ["B02", "B08"]
): ClassSpectra =>
  ({
    scene_date: "2021-01-15",
    n_scenes: 12,
    convention: "BOA reflectance, baseline 04.00 offset applied",
    bands,
    points,
  }) as ClassSpectra

describe("bhattacharyyaGaussian", () => {
  it("is zero for two identical distributions", () => {
    // Both terms vanish: dm = 0, and ln((v+v)/(2 sqrt(v v))) = ln 1 = 0.
    expect(bhattacharyyaGaussian(0.1, 0.02, 0.1, 0.02)).toBe(0)
  })

  it("reduces to dm^2 / (8 v) when the two spreads are equal", () => {
    /*
      dm = 0.04, sd = 0.02, so v = 4e-4 and pooled = 8e-4.
      mean term  = 0.04^2 / (4 * 8e-4) = 1.6e-3 / 3.2e-3 = 0.5
      spread term = 0.5 * ln(8e-4 / (2 * 0.02 * 0.02)) = 0.5 * ln 1 = 0
    */
    const b = bhattacharyyaGaussian(0, 0.02, 0.04, 0.02)
    expect(b).toBeCloseTo(0.5, 12)
  })

  it("is non-zero for equal means with unequal spreads", () => {
    /*
      The spread term alone. v1 = 1e-4, v2 = 4e-4, pooled = 5e-4.
      0.5 * ln(5e-4 / (2 * 0.01 * 0.02)) = 0.5 * ln(5e-4 / 4e-4) = 0.5 * ln 1.25
    */
    const b = bhattacharyyaGaussian(0.1, 0.01, 0.1, 0.02)
    expect(b).toBeCloseTo(0.5 * Math.log(1.25), 12)
  })

  it("refuses a zero spread rather than reporting an infinite distance", () => {
    /*
      The variance term diverges as either sd goes to zero, so a class whose
      pixels are all bit-identical would come back perfectly separable from
      everything. That is quantisation reported as a finding, so it is refused.
    */
    expect(bhattacharyyaGaussian(0.1, 0, 0.3, 0.02)).toBeNull()
    expect(bhattacharyyaGaussian(0.1, 0.02, 0.3, 0)).toBeNull()
  })

  it("refuses a negative spread and any non-finite input", () => {
    expect(bhattacharyyaGaussian(0.1, -0.02, 0.3, 0.02)).toBeNull()
    expect(bhattacharyyaGaussian(Number.NaN, 0.02, 0.3, 0.02)).toBeNull()
    expect(bhattacharyyaGaussian(0.1, 0.02, Number.POSITIVE_INFINITY, 0.02)).toBeNull()
  })
})

describe("jeffriesMatusita", () => {
  it("is zero for two identical distributions", () => {
    expect(jeffriesMatusita(0.1, 0.02, 0.1, 0.02)).toBe(0)
  })

  it("is 2(1 - e^-1/2) when the means are two standard deviations apart", () => {
    // B = 0.5 from the case above, so JM = 2(1 - e^-0.5) = 0.786938680574733...
    const jm = jeffriesMatusita(0, 0.02, 0.04, 0.02)
    expect(jm).toBeCloseTo(2 * (1 - Math.exp(-0.5)), 12)
    expect(jm).toBeCloseTo(0.7869386805747332, 12)
  })

  it("is 2 - 2/sqrt(1.25) for equal means with spreads in a 1:2 ratio", () => {
    /*
      B = 0.5 ln 1.25, so e^-B = 1.25^-1/2 exactly, and
      JM = 2(1 - 1/sqrt(1.25)) = 0.2111456180001682.
    */
    const jm = jeffriesMatusita(0.1, 0.01, 0.1, 0.02)
    expect(jm).toBeCloseTo(2 - 2 / Math.sqrt(1.25), 12)
    expect(jm).toBeCloseTo(0.2111456180001682, 12)
  })

  it("saturates at 2 rather than passing it", () => {
    /*
      dm = 0.3 at sd = 0.01 gives B = 0.09 / 8e-4 = 112.5, and e^-112.5 is about
      1.6e-49 -- below the resolution of a double against 1, so the subtraction
      lands on exactly 2. The stated range is 0 to 2 and nothing may read above
      it, which is what the clamp is for.
    */
    const jm = jeffriesMatusita(0.05, 0.01, 0.35, 0.01)
    expect(jm).toBe(2)
  })

  it("is symmetric in its two distributions", () => {
    const forward = jeffriesMatusita(0.08, 0.013, 0.21, 0.031)
    const reverse = jeffriesMatusita(0.21, 0.031, 0.08, 0.013)
    expect(forward).not.toBeNull()
    expect(forward).toBe(reverse)
  })

  it("stays inside 0 to 2 across a sweep of separations and spread ratios", () => {
    for (let dm = 0; dm <= 0.5; dm += 0.05) {
      for (let ratio = 1; ratio <= 8; ratio += 1) {
        const jm = jeffriesMatusita(0.1, 0.01, 0.1 + dm, 0.01 * ratio)
        expect(jm).not.toBeNull()
        expect(jm!).toBeGreaterThanOrEqual(0)
        expect(jm!).toBeLessThanOrEqual(2)
      }
    }
  })
})

describe("separabilityBand", () => {
  it("names the conventional reading at each threshold", () => {
    expect(separabilityBand(0)).toBe("overlapping")
    expect(separabilityBand(0.999)).toBe("overlapping")
    expect(separabilityBand(1.0)).toBe("partial")
    expect(separabilityBand(1.899)).toBe("partial")
    expect(separabilityBand(1.9)).toBe("separable")
    expect(separabilityBand(2)).toBe("separable")
  })
})

describe("classPairSeparability", () => {
  it("returns nothing when there is nothing to read", () => {
    expect(classPairSeparability(null)).toEqual([])
    expect(classPairSeparability(undefined)).toEqual([])
    expect(classPairSeparability(spectra([]))).toEqual([])
  })

  it("emits each unordered pair once", () => {
    /*
      Three classes on one band is three pairs, not six. JM is symmetric, so
      both orders are the same number and the second is a row a reader has to
      read to discover it says nothing new.
    */
    const s = spectra(
      [3, 15, 21].map((id) =>
        point({ class_id: id, name: `Class ${id}`, mean: 0.1 * id, band: "B02" })
      ),
      ["B02"]
    )

    const pairs = classPairSeparability(s)

    expect(pairs).toHaveLength(3)
    // Sorted by an explicit comparator. A bare .sort() compares the pairs as
    // strings, which puts "15,21" before "3,15" and would make this assertion
    // about lexicographic order rather than about which pairs came back.
    const emitted = pairs
      .map((p) => [p.aId, p.bId])
      .sort((x, y) => x[0] - y[0] || x[1] - y[1])
    expect(emitted).toEqual([
      [3, 15],
      [3, 21],
      [15, 21],
    ])
  })

  it("takes the best band as the maximum, not the mean over bands", () => {
    /*
      One band separating and one not. The mean of the two would report this
      pair as marginal; the question the panel asks is whether ANY band
      distinguishes them, and B08 does.
    */
    const s = spectra([
      point({ class_id: 1, band: "B02", mean: 0.1, sd: 0.02 }),
      point({ class_id: 2, band: "B02", mean: 0.1, sd: 0.02 }),
      point({ class_id: 1, band: "B08", mean: 0.05, sd: 0.01, wavelength_nm: 832.8 }),
      point({ class_id: 2, band: "B08", mean: 0.35, sd: 0.01, wavelength_nm: 832.8 }),
    ])

    const [pair] = classPairSeparability(s)

    expect(pair.best?.band).toBe("B08")
    expect(pair.best?.jm).toBe(2)
    expect(pair.measured).toBe(2)
    expect(pair.bands.find((b) => b.band === "B02")?.jm).toBe(0)
  })

  it("reports a band absent for one class as absent rather than as zero distance", () => {
    /*
      The sidecar drops a class-band row below SPECTRUM_MIN_PIXELS rather than
      publish a mean over a handful of pixels. Zero would read as "identical
      here", which is the opposite of "this was not measured".
    */
    const s = spectra([
      point({ class_id: 1, band: "B02" }),
      point({ class_id: 2, band: "B02", mean: 0.3 }),
      point({ class_id: 1, band: "B08", wavelength_nm: 832.8 }),
    ])

    const [pair] = classPairSeparability(s)
    const b08 = pair.bands.find((b) => b.band === "B08")

    expect(b08?.jm).toBeNull()
    expect(b08?.missing).toBe("absent")
    expect(b08?.wavelength_nm).toBe(832.8)
    expect(pair.measured).toBe(1)
  })

  it("reports a degenerate spread as degenerate, distinct from absent", () => {
    const s = spectra(
      [
        point({ class_id: 1, band: "B02", sd: 0 }),
        point({ class_id: 2, band: "B02", mean: 0.3 }),
      ],
      ["B02"]
    )

    const [pair] = classPairSeparability(s)

    expect(pair.bands[0].jm).toBeNull()
    expect(pair.bands[0].missing).toBe("degenerate")
    expect(pair.best).toBeNull()
    expect(pair.measured).toBe(0)
  })

  it("sorts the least separable pair first and the unmeasurable ones last", () => {
    /*
      A reader opens this panel to find what is NOT separable, so the top of the
      list is the least separable pair. A pair that could not be measured is not
      "least separable" -- it is not known -- so it sorts to the bottom rather
      than into the position that would state that.
    */
    const s = spectra(
      [
        // 1 vs 2: identical, JM 0.
        point({ class_id: 1, band: "B02", mean: 0.1, sd: 0.02 }),
        point({ class_id: 2, band: "B02", mean: 0.1, sd: 0.02 }),
        // 3: far from both, JM 2 against each.
        point({ class_id: 3, band: "B02", mean: 0.9, sd: 0.01 }),
        // 4: degenerate, unmeasurable against everything.
        point({ class_id: 4, band: "B02", mean: 0.5, sd: 0 }),
      ],
      ["B02"]
    )

    const order = classPairSeparability(s).map((p) => `${p.aId}-${p.bId}`)

    expect(order[0]).toBe("1-2")
    expect(order.slice(-3)).toEqual(["1-4", "2-4", "3-4"])
  })
})

describe("classDriftBetweenRuns", () => {
  it("returns nothing when either side is missing", () => {
    const s = spectra([point({})])
    expect(classDriftBetweenRuns(null, s)).toEqual([])
    expect(classDriftBetweenRuns(s, null)).toEqual([])
    expect(classDriftBetweenRuns(undefined, undefined)).toEqual([])
  })

  it("compares only the classes both runs predicted", () => {
    /*
      A class present in one area and absent from the other has not drifted:
      there is nothing to compare it against, and listing it at any distance
      would invent the comparison.
    */
    const a = spectra(
      [
        point({ class_id: 1, band: "B02" }),
        point({ class_id: 2, band: "B02" }),
      ],
      ["B02"]
    )
    const b = spectra(
      [
        point({ class_id: 2, band: "B02" }),
        point({ class_id: 9, band: "B02" }),
      ],
      ["B02"]
    )

    expect(classDriftBetweenRuns(a, b).map((d) => d.classId)).toEqual([2])
  })

  it("is zero for a class whose distribution did not move", () => {
    const same = () => spectra([point({ class_id: 1, band: "B02" })], ["B02"])

    const [drift] = classDriftBetweenRuns(same(), same())

    expect(drift.best?.jm).toBe(0)
    expect(drift.shifts).toEqual([{ band: "B02", delta: 0 }])
  })

  it("carries the signed mean shift beside the unsigned distance", () => {
    /*
      JM says a band moved, not which way. "SWIR fell" and "SWIR rose" are
      different findings that produce the same distance, so the direction is
      reported separately rather than inferred from it.
    */
    const a = spectra([point({ class_id: 1, band: "B11", mean: 0.30 })], ["B11"])
    const b = spectra([point({ class_id: 1, band: "B11", mean: 0.18 })], ["B11"])

    const [drift] = classDriftBetweenRuns(a, b)

    expect(drift.shifts[0].delta).toBeCloseTo(-0.12, 12)
    expect(drift.best?.jm).toBeGreaterThan(0)
  })

  it("reports no shift for a band only one of the two runs measured", () => {
    const a = spectra(
      [
        point({ class_id: 1, band: "B02" }),
        point({ class_id: 1, band: "B11", mean: 0.3 }),
      ],
      ["B02", "B11"]
    )
    const b = spectra([point({ class_id: 1, band: "B02" })], ["B02"])

    const [drift] = classDriftBetweenRuns(a, b)
    const b11 = drift.shifts.find((s) => s.band === "B11")

    expect(b11?.delta).toBeNull()
    expect(drift.bands.find((x) => x.band === "B11")?.missing).toBe("absent")
  })

  it("takes the union of the two runs' band lists", () => {
    const a = spectra([point({ class_id: 1, band: "B02" })], ["B02"])
    const b = spectra(
      [point({ class_id: 1, band: "B12", wavelength_nm: 2202.4 })],
      ["B12"]
    )

    const [drift] = classDriftBetweenRuns(a, b)

    expect(drift.bands.map((x) => x.band).sort()).toEqual(["B02", "B12"])
    // Neither band was measured on both sides, so neither is a distance.
    expect(drift.measured).toBe(0)
  })
})
