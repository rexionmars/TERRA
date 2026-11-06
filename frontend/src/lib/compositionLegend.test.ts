import { describe, expect, it } from "vitest"

import { compositionLegendOf, layerLegendOfComposition } from "./compositionLegend"
import { paletteGradient } from "./palettes"

describe("compositionLegendOf", () => {
  it("returns undefined for a response that carries no legend", () => {
    expect(compositionLegendOf(undefined)).toBeUndefined()
    expect(compositionLegendOf({ kind: "rgb" })).toBeUndefined()
    expect(
      compositionLegendOf({ legend: { kind: "ramp", subject: "x" } })
    ).toBeUndefined()
  })

  it("keeps the rows and entries that have every field, and drops the rest", () => {
    const legend = compositionLegendOf({
      legend: {
        kind: "classes",
        subject: "2 clusters",
        entries: [
          { name: "Cluster 1", color: "#e69f00", pct: 60, area_ha: 12 },
          { name: "Cluster 2" },
        ],
        rows: [{ label: "Mean", value: "3" }, { label: 4 }],
      },
    })
    expect(legend?.entries).toEqual([
      { name: "Cluster 1", color: "#e69f00", pct: 60, area_ha: 12 },
    ])
    expect(legend?.rows).toEqual([{ label: "Mean", value: "3" }])
  })
})

describe("layerLegendOfComposition", () => {
  it("draws the ramp the sidecar named, with its ends and figures", () => {
    const legend = layerLegendOfComposition({
      kind: "stats",
      subject: "Above-ground biomass, 2022 (Mg/ha)",
      palette: "viridis",
      low: "0",
      high: "150 Mg/ha",
      rows: [{ label: "Mean", value: "41 Mg/ha" }],
      note: "Made for forest.",
    })
    expect(legend).toEqual({
      kind: "stats",
      subject: "Above-ground biomass, 2022 (Mg/ha)",
      rows: [{ label: "Mean", value: "41 Mg/ha" }],
      ramp: { gradient: paletteGradient("viridis"), low: "0", high: "150 Mg/ha" },
      note: "Made for forest.",
    })
  })

  it("keeps the figures and drops the ramp for a palette it does not have", () => {
    // Borrowing another ramp would describe colours the raster was not drawn in.
    const legend = layerLegendOfComposition({
      kind: "stats",
      subject: "x",
      palette: "turbo",
      low: "0",
      high: "1",
      rows: [{ label: "Mean", value: "0.5" }],
    })
    expect(legend.kind === "stats" && legend.ramp).toBeUndefined()
  })

  it("turns cluster entries into classes with their areas", () => {
    const legend = layerLegendOfComposition({
      kind: "classes",
      subject: "2 clusters",
      entries: [{ name: "Cluster 1", color: "#e69f00", pct: 60, area_ha: 12 }],
    })
    expect(legend.kind === "classes" && legend.entries[0].areaHa).toBe(12)
  })
})
