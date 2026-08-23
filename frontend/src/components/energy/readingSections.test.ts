/**
 * What a reading is allowed to contain, checked against real sidecar payloads.
 *
 * The defect these assertions exist for: every block of the energy model and
 * every block of the wind screening opened with the same heading -- the
 * product's name -- so twelve of the fifteen blocks a full run can produce were
 * titled identically and the block's own subject was drawn nowhere. A reader
 * four blocks into the model could see which product they were in and never
 * which block.
 *
 * The payloads are the ones internal/research/testdata holds for the Go tests,
 * read rather than restated: a fixture written by hand here would be a second
 * description of the sidecar's contract, free to agree with the types and
 * disagree with the process that fills them.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import {
  readingIndex,
  solarReadingGroups,
  windReadingGroups,
  type ReadingGroup,
} from "@/components/energy/readingSections"
import type { SolarResults } from "@/lib/energyState"
import type { EnergyModelAnalysis, WindAnalysis } from "@/lib/types"

const testdata = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../../../internal/research/testdata/${name}`, import.meta.url)
      ),
      "utf8"
    )
  )

const wind = testdata("wind_b.json").wind as WindAnalysis
const energy = testdata("energy_model_b.json")
  .energy_model as EnergyModelAnalysis

const titles = (groups: ReadingGroup[]) =>
  groups.flatMap((g) => g.sections.map((s) => s.title))

describe("wind reading", () => {
  const groups = windReadingGroups(wind)

  it("is one group of six named blocks", () => {
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe("Wind screening")
    expect(groups[0].sections).toHaveLength(6)
  })

  it("names every block differently", () => {
    const names = titles(groups)
    expect(new Set(names).size).toBe(names.length)
  })

  it("never repeats the product's name as a block name", () => {
    expect(titles(groups)).not.toContain(groups[0].label)
  })

  it("carries the qualifiers that keep it out of a solar comparison", () => {
    expect(groups[0].chips).toEqual([
      "separate product",
      "gross",
      "unvalidated",
    ])
  })

  it("states the record window once, on the group", () => {
    expect(groups[0].meta).toContain(wind.record_window)
  })
})

describe("solar reading", () => {
  const groups = solarReadingGroups({ energy } as SolarResults)

  it("gives the energy model six named blocks under one heading", () => {
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe("Photovoltaic energy model")
    expect(groups[0].sections).toHaveLength(6)
    const names = titles(groups)
    expect(new Set(names).size).toBe(names.length)
    expect(names).not.toContain(groups[0].label)
  })

  it("holds an empty result to an empty reading", () => {
    expect(solarReadingGroups({} as SolarResults)).toEqual([])
    expect(windReadingGroups(null)).toEqual([])
  })

  it("gives the index a label short enough for a 19rem band", () => {
    const shorts = readingIndex(groups).map((e) => e.short)
    expect(new Set(shorts).size).toBe(shorts.length)
    for (const label of shorts) expect(label.length).toBeLessThanOrEqual(12)
  })

  it("addresses every block from the index, and each one once", () => {
    const index = readingIndex(groups)
    expect(index.map((e) => e.id)).toEqual(groups[0].sections.map((s) => s.id))
    expect(new Set(index.map((e) => e.id)).size).toBe(index.length)
  })

  it("namespaces the anchors by product, so a partial run cannot collide", () => {
    for (const id of readingIndex(groups).map((e) => e.id)) {
      expect(id.startsWith("energy-")).toBe(true)
    }
  })
})

describe("headline figures", () => {
  it("states each product's four figures once, on the group", () => {
    const g = solarReadingGroups({ energy } as SolarResults)[0]
    const labels = g.headline?.figures.map((f) => f.label) ?? []
    expect(labels).toEqual([
      "Applied ratio",
      "Derived ratio",
      "Suitable capacity",
      "Energy P50",
    ])
    expect(new Set(labels).size).toBe(labels.length)
  })

  it("carries the uncertainty statement the blocks do not print", () => {
    const g = solarReadingGroups({ energy } as SolarResults)[0]
    expect(g.headline?.note).toBe(energy.plant.uncertainty.statement)
  })
})
