import { describe, expect, it } from "vitest"

import {
  analysisEntries,
  energyModelEntry,
  solarResourceEntry,
  windEntry,
} from "./analysisCallout"
import { solarFigures, windFigures } from "@/components/energy/headlineFigures"
import type { SolarResults } from "@/lib/energyState"
import type { WindAnalysis } from "@/lib/types"

/*
Payloads carrying the fields the headline reads and nothing else, cast from a
partial: each of these types declares a dozen blocks the entry does not touch
-- the monthly series, the shear sweep, the turbine -- and writing them out
would say the entry depends on them.
*/
function windPayload(over: Record<string, unknown> = {}): WindAnalysis {
  return {
    hub_height_m: 100,
    record_years: 10,
    record_window: "2015 .. 2024",
    qualifier: "Screening indication, not a resource assessment.",
    hub: {
      mean_speed_ms: 7.42,
      gross_capacity_factor_pct: 31.55,
      gross_annual_energy_mwh_per_turbine: 8123.4,
    },
    data_quality: { all_checks_passed: true, flags: [] },
    ...over,
  } as unknown as WindAnalysis
}

const solarPayload = {
  resource: {
    lat: -10.25,
    lon: -48.33,
    resource: { ghi_annual_kwh_m2: 1987, ghi_cv_pct: 3.1, n_years: 30 },
    geometry: { optimal_tilt_deg: 12, gain_over_horizontal_pct: 4.2 },
    pv: {
      specific_yield_kwh_kwp_year: 1620,
      performance_ratio: 0.8,
      performance_ratio_modelled: 0.8712,
      capacity_factor_pct: 18.5,
    },
    grid_note: "Radiation resolves on a 1 degree cell.",
  },
  energy: {
    performance_ratio: {
      applied: 0.8,
      applied_source: "reference",
      derived: 0.8712,
      modelled: 0.8712,
    },
    plant: {
      suitable: {
        capacity_dc_mw: 120.5,
        area_ha: 240,
        energy: {
          p50_exceedance_gwh_year: 211.4,
          p90_exceedance_gwh_year: 198.2,
        },
      },
      uncertainty: { statement: "P50 and P90 from the modelled spread." },
    },
  },
} as unknown as SolarResults

describe("readings that produce no raster", () => {
  /*
    The defect these exist for: a product with no raster appeared in neither
    tab. Data lists rasters and had nothing to list; Analyses lists readings
    and was fed two grid products alone, so a finished wind run reported
    nothing anywhere and the empty state went on saying no reading was made.
  */
  it("lists all three, which were listed nowhere", () => {
    const entries = analysisEntries({
      wind: windPayload(),
      solar: solarPayload,
    })
    expect(entries.map((e) => e.id)).toEqual([
      "wind:screening",
      "solar:resource",
      "solar:energy",
    ])
  })

  it("is absent where the product has not run", () => {
    expect(windEntry(null)).toBeNull()
    expect(solarResourceEntry(null)).toBeNull()
    expect(energyModelEntry(null)).toBeNull()
    expect(analysisEntries({})).toEqual([])
  })

  /*
    THE INVARIANT WORTH PINNING. The panel and the callout are two views of one
    reading, and the entry takes its rows from the panel's own headline rather
    than choosing them again -- the first draft did choose them again, down to
    calling the panel's "Mean speed" a "Hub speed". This fails the moment the
    two are allowed to say different things.
  */
  it.each([
    ["wind", () => windEntry(windPayload())!, () => windFigures(windPayload())],
    [
      "solar resource",
      () => solarResourceEntry(solarPayload)!,
      () => solarFigures("resource", solarPayload)!,
    ],
    [
      "energy model",
      () => energyModelEntry(solarPayload)!,
      () => solarFigures("energy", solarPayload)!,
    ],
  ])("%s carries the panel's own headline", (_name, entry, headline) => {
    const e = entry()
    const rows = e.legend.kind === "stats" ? e.legend.rows : []
    expect(rows).toEqual(
      headline().figures.map((f) => ({ label: f.label, value: f.value }))
    )
  })

  // The assumption the figures were read under travels with them, which is
  // the whole reason the headline carries a note.
  it("carries the reading's own qualifier", () => {
    const e = windEntry(windPayload())!
    const note = e.legend.kind === "stats" ? (e.legend.note ?? "") : ""
    expect(note).toContain("Screening indication")
  })

  // Whether the figures should be read at all comes before what they say.
  it("leads with the failed checks when the record has any", () => {
    const e = windEntry(
      windPayload({
        data_quality: { all_checks_passed: false, flags: ["a", "b"] },
      })
    )!
    const note = e.legend.kind === "stats" ? (e.legend.note ?? "") : ""
    expect(note.startsWith("The record did not pass every check (2 flags)")).toBe(
      true
    )
    expect(note).toContain("Screening indication")
  })

  it("counts one flag in the singular", () => {
    const e = windEntry(
      windPayload({ data_quality: { all_checks_passed: false, flags: ["a"] } })
    )!
    const note = e.legend.kind === "stats" ? (e.legend.note ?? "") : ""
    expect(note).toContain("(1 flag)")
  })
})
