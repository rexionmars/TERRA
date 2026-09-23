/**
 * The mineral map's layers, assets, legend and run row, against payloads
 * built for each case.
 *
 * Expected values are worked from the payload fields and the arithmetic the
 * functions state, not read off their output. The cases that matter most are
 * the ones the product is about: a group with no class map, a payload with no
 * extent, and a legend whose colours must come from the payload rather than
 * from a table written here.
 */
import { describe, expect, it } from "vitest"

import { legendFor } from "./layerLegend"
import { mineralLayers, rasterLayers } from "./mapLayers"
import {
  MINERAL_MASKED_COLOR,
  MINERAL_NO_ANSWER_COLOR,
  mineralCellAreaHa,
  mineralGroupOfLayer,
  mineralGroupTitle,
  mineralLayerDefaultVisible,
  mineralLayerId,
  mineralNoAnswerHa,
} from "./mineral"
import { runAssets } from "./runAssets"
import { mineralObservedLine, runKindLabel, runRowLine } from "./runSummary"
import type { MineralAnalysis, MineralGroup } from "./types"

const EXTENT = { lon_min: -44.1, lat_min: -20.2, lon_max: -44.0, lat_max: -20.1 }

function group(n: number, extra: Partial<MineralGroup> = {}): MineralGroup {
  return {
    group: n,
    label: n === 1 ? "Fe2+/Fe3+ electronic absorptions, 0.4-1.3 um" : "Vibrational absorptions, 2.0-2.5 um",
    detected_cells: 0,
    detected_area_ha: 0,
    classes: [],
    entries: [],
    class_png: "",
    class_uri: `data:image/png;base64,g${n}`,
    ...extra,
  }
}

function payload(extra: Partial<MineralAnalysis> = {}): MineralAnalysis {
  return {
    sensor: "EMIT L2A reflectance",
    expert_system: "tetracorder5.27e.cmds/cmd.lib.setup.t5.27e1",
    libraries: ["r06emitc", "s06emitc"],
    aoi_cells: 400,
    aoi_area_ha: 1000,
    observed_cells: 200,
    observed_area_ha: 500,
    masked_cells: 40,
    cell_size_deg: [0.0005, 0.0005],
    scenes: [],
    groups: [group(1), group(2)],
    legend: [],
    geotiff: "/tmp/run/mineral_map.tif",
    extent: EXTENT,
    notes: [],
    ...extra,
  }
}

describe("mineral layer ids", () => {
  it("round-trips a group through its layer id", () => {
    expect(mineralGroupOfLayer(mineralLayerId(1))).toBe(1)
    expect(mineralGroupOfLayer(mineralLayerId(2))).toBe(2)
  })

  it("does not claim another product's layer", () => {
    expect(mineralGroupOfLayer("water")).toBeNull()
    expect(mineralGroupOfLayer("composition")).toBeNull()
    expect(mineralGroupOfLayer("mineral:")).toBeNull()
    expect(mineralGroupOfLayer("mineral:x")).toBeNull()
  })

  it("names each group by its wavelength region", () => {
    expect(mineralGroupTitle(1)).toBe("Minerals 0.4-1.3 um (Fe)")
    expect(mineralGroupTitle(2)).toBe("Minerals 2.0-2.5 um")
    expect(mineralGroupTitle(3)).toBe("Minerals, group 3")
  })

  it("draws group 2 and withholds group 1 by default", () => {
    expect(mineralLayerDefaultVisible(2)).toBe(true)
    expect(mineralLayerDefaultVisible(1)).toBe(false)
  })
})

describe("mineralLayers", () => {
  it("returns one pixelated layer per group with a class map", () => {
    const layers = mineralLayers(payload())
    expect(layers.map((l) => l.id)).toEqual(["mineral:1", "mineral:2"])
    expect(layers.every((l) => l.pixelated && !l.smooth)).toBe(true)
    expect(layers.map((l) => l.visible)).toEqual([false, true])
    expect(layers.every((l) => l.extent === EXTENT)).toBe(true)
  })

  it("skips a group whose class map did not arrive", () => {
    const m = payload({ groups: [group(1, { class_uri: undefined }), group(2)] })
    expect(mineralLayers(m).map((l) => l.id)).toEqual(["mineral:2"])
  })

  it("draws nothing over a zero extent", () => {
    const zero = { lon_min: 0, lat_min: 0, lon_max: 0, lat_max: 0 }
    expect(mineralLayers(payload({ extent: zero }))).toEqual([])
    expect(mineralLayers(null)).toEqual([])
  })

  it("applies the reader's switch and opacity per layer", () => {
    const layers = mineralLayers(payload(), {
      "mineral:1": { visible: true, opacity: 0.4 },
      "mineral:2": { visible: false },
    })
    expect(layers.map((l) => [l.visible, l.opacity])).toEqual([
      [true, 0.4],
      [false, 1],
    ])
  })

  it("sits above surface water and below the classification in the stack", () => {
    const layers = rasterLayers({
      result: null,
      showPredictionOverlay: true,
      overlayOpacity: 1,
      showConfidence: false,
      confidenceOnTop: true,
      smoothOverlay: false,
      composition: null,
      showCompositionOverlay: true,
      composeOpacity: 1,
      water: null,
      showWaterOverlay: true,
      waterOpacity: 1,
      mineral: payload(),
    })
    for (const l of layers) {
      expect(l.order).toBeGreaterThan(360)
      expect(l.order).toBeLessThan(400)
    }
  })
})

describe("mineral arithmetic", () => {
  it("derives the cell area from the AOI", () => {
    expect(mineralCellAreaHa(payload())).toBe(2.5)
    expect(mineralCellAreaHa(payload({ aoi_cells: 0 }))).toBeNull()
  })

  it("takes the no-answer area as observed less identified, never negative", () => {
    expect(mineralNoAnswerHa(payload(), group(2, { detected_area_ha: 120 }))).toBe(380)
    expect(mineralNoAnswerHa(payload(), group(2, { detected_area_ha: 500.2 }))).toBe(0)
  })
})

describe("legendFor, mineral layers", () => {
  const m = payload({
    legend: [{ class: "kaolinite", label: "Kaolinite group", color: "#e0a060" }],
    groups: [
      group(1),
      group(2, {
        detected_area_ha: 100,
        classes: [
          {
            class: "kaolinite",
            label: "Kaolinite group",
            // Deliberately different from the legend: the legend is what the
            // PNG was drawn with and must win.
            color: "#000000",
            cells: 40,
            area_ha: 100,
            fraction_of_observed: 0.2,
            mean_depth: 0.08,
          },
        ],
      }),
    ],
  })

  it("lists the group's classes in the payload legend's colours, as shares of the observed area", () => {
    const legend = legendFor("mineral:2", { mineral: m })
    expect(legend?.kind).toBe("classes")
    if (legend?.kind !== "classes") return
    expect(legend.subject).toBe("Minerals 2.0-2.5 um")
    expect(legend.entries[0]).toEqual({
      name: "Kaolinite group",
      color: "#e0a060",
      pct: 20,
      areaHa: 100,
    })
  })

  it("closes with the two grey states and their areas", () => {
    const legend = legendFor("mineral:2", { mineral: m })
    if (legend?.kind !== "classes") throw new Error("expected classes")
    const [noAnswer, masked] = legend.entries.slice(-2)
    expect(noAnswer).toEqual({
      name: "Observed, no mineral answer",
      color: MINERAL_NO_ANSWER_COLOR,
      // 400 of 500 observed hectares.
      pct: 80,
      areaHa: 400,
    })
    // 40 masked cells at 2.5 ha each.
    expect(masked).toEqual({
      name: "Masked (cloud)",
      color: MINERAL_MASKED_COLOR,
      areaHa: 100,
    })
  })

  it("reports the observed area beside the identified one", () => {
    const legend = legendFor("mineral:2", { mineral: m })
    if (legend?.kind !== "classes") throw new Error("expected classes")
    expect(legend.rows).toEqual([
      { label: "Identified", value: "100.0 ha" },
      { label: "Observed", value: "500.0 ha" },
      { label: "AOI", value: "1000.0 ha" },
      { label: "Passes", value: "0" },
    ])
  })

  it("has no legend without a payload or for a group the payload lacks", () => {
    expect(legendFor("mineral:2", {})).toBeNull()
    expect(legendFor("mineral:3", { mineral: m })).toBeNull()
  })
})

describe("runAssets, mineral map", () => {
  const base = {
    result: null,
    composition: null,
    compositionGallery: [],
    water: null,
    showCompositionOverlay: false,
    showWaterOverlay: false,
    composeOpacity: 1,
    waterOpacity: 1,
  }

  it("lists one asset per group, on the layer id the board draws it under", () => {
    const assets = runAssets({ ...base, mineral: payload() })
    expect(assets.map((a) => [a.id, a.sceneId])).toEqual([
      ["mineral-group1", "mineral:1"],
      ["mineral-group2", "mineral:2"],
    ])
    for (const a of assets) {
      expect(a.exportTif).toEqual({
        via: "file",
        src: "/tmp/run/mineral_map.tif",
        filename: "terra_mineral_map.tif",
      })
    }
  })

  it("reports nothing drawn when the caller passes no switches", () => {
    const assets = runAssets({ ...base, mineral: payload() })
    expect(assets.map((a) => a.onBoard)).toEqual([false, false])
  })

  it("follows the default and the reader's switches when they are passed", () => {
    const assets = runAssets({
      ...base,
      mineral: payload(),
      mineralLayers: { "mineral:1": { visible: true } },
    })
    expect(assets.map((a) => a.onBoard)).toEqual([true, true])
  })

  it("offers no GeoTIFF where the run has none on disk", () => {
    const assets = runAssets({ ...base, mineral: payload({ geotiff: "" }) })
    expect(assets.every((a) => a.exportTif === null)).toBe(true)
  })
})

describe("run rows, mineral map", () => {
  const summary = JSON.stringify({
    mineral_observed_area_ha: 512.4,
    mineral_aoi_area_ha: 1003.6,
  })

  it("names the kind", () => {
    expect(runKindLabel("mineral")).toBe("mineral")
  })

  it("states the observed area beside the AOI", () => {
    expect(mineralObservedLine(summary)).toBe("observed 512 of 1004 ha")
    expect(mineralObservedLine("{}")).toBe("")
    expect(mineralObservedLine(null)).toBe("")
  })

  it("carries the product, the observed area and the period searched", () => {
    expect(
      runRowLine({
        kind: "mineral",
        model_kind: "tetracorder5.27e.cmds/cmd.lib.setup.t5.27e1",
        period_start: "2024-06-01",
        period_end: "2024-09-30",
        summary,
      })
    ).toBe(
      "Mineral map · tetracorder5.27e.cmds/cmd.lib.setup.t5.27e1 · observed 512 of 1004 ha · 2024-06-01 → 2024-09-30"
    )
  })
})
