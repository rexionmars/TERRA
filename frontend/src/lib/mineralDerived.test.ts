/**
 * The mineral map's derived rasters -- the pass used, the exposure, a band
 * position, the fit margin, the agreement with EMIT L2B -- as layers, assets
 * and legends, against payloads built for each case.
 *
 * What is checked is what a reader would otherwise be misled by: a derived
 * plane drawn over the class maps before it was asked for, a class layer whose
 * legend ordinals do not follow its colours, an area in a legend that is not
 * the count the run reported times the cell size.
 */
import { describe, expect, it } from "vitest"

import { legendFor } from "./layerLegend"
import { mineralLayers } from "./mapLayers"
import {
  isMineralLayer,
  mineralCellAreaHa,
  mineralDerivedLayer,
  mineralDerivedLayerId,
  mineralGroupOfLayer,
  mineralLayerId,
  mineralPassesUsed,
  mineralRampGradient,
} from "./mineral"
import { runAssets } from "./runAssets"
import type { MineralAnalysis, MineralLayer } from "./types"

const EXTENT = { lon_min: -44.1, lat_min: -20.2, lon_max: -44.0, lat_max: -20.1 }

const AGREEMENT: MineralLayer = {
  id: "agreement2",
  title: "Agreement with EMIT L2B, group 2",
  kind: "classes",
  png: "",
  uri: "data:image/png;base64,a2",
  legend: [
    { label: "Same class as L2B", color: "#1a9850" },
    { label: "Different class from L2B", color: "#d73027" },
    { label: "Identified here, not by L2B", color: "#fdae61" },
    { label: "Identified by L2B only", color: "#4575b4" },
    { label: "Identified by neither", color: "#d9d9d9" },
  ],
  about: "The mineral class here against the EMIT L2B product's, same pixel.",
}

const EXPOSURE: MineralLayer = {
  id: "exposure",
  title: "Exposed ground",
  kind: "classes",
  png: "",
  uri: "data:image/png;base64,ex",
  legend: [
    { label: "Exposed in the pass used", color: "#c9a26b" },
    { label: "Covered in every pass compared", color: "#5b8c5a" },
    { label: "Masked", color: "#5a5a5a", excluded: true },
  ],
  about: "",
}

const FE3: MineralLayer = {
  id: "fe3",
  title: "Fe3+ crystal-field band position",
  kind: "ramp",
  png: "",
  uri: "data:image/png;base64,fe",
  ramp: {
    min: 870.7,
    max: 987.2,
    unit: "nm",
    colors: ["#c43c39", "#f28e2b", "#edc948"],
    low: "hematite references",
    high: "goethite references",
  },
  about: "Fitted wavelength of the Fe3+ band.",
}

function payload(extra: Partial<MineralAnalysis> = {}): MineralAnalysis {
  return {
    sensor: "EMIT L2A reflectance",
    expert_system: "t5.27e1",
    libraries: [],
    aoi_cells: 400,
    aoi_area_ha: 1000,
    observed_cells: 200,
    observed_area_ha: 500,
    masked_cells: 40,
    cell_size_deg: [0.0005, 0.0005],
    scenes: [
      { granule: "a", date: "2024-08-30", cloud_cover: 0, mask_granule: "", cells: 150, masked_cells: 10, wavelength_offset_nm: 0 },
      { granule: "b", date: "2024-09-03", cloud_cover: 5, mask_granule: "", cells: 50, masked_cells: 30, wavelength_offset_nm: 0 },
      { granule: "c", date: "2025-07-01", cloud_cover: 9, mask_granule: "", cells: 0, masked_cells: 0, wavelength_offset_nm: 0 },
    ],
    groups: [],
    legend: [],
    selection: { rule: "r", compared_passes: 3, contributing_passes: 2, exposed_cells: 80, exposed_area_ha: 200 },
    agreement: [
      {
        group: 2,
        granules: ["g"],
        compared_cells: 100,
        agree: 60,
        differ: 20,
        port_only: 10,
        l2b_only: 4,
        neither: 6,
        agree_fraction_of_both: 0.75,
        pairs: [],
      },
    ],
    positions: [
      {
        key: "fe3",
        title: "Fe3+ crystal-field band",
        unit: "nm",
        group: 1,
        classes: [{ class: "hematite", label: "Hematite", cells: 88, mean: 912, sd: 11, p10: 898, p50: 914, p90: 925 }],
        references: [{ class: "hematite", references: 12, min_nm: 866.4, max_nm: 933.6, median_nm: 895.7 }],
        ramp: FE3.ramp!,
      },
    ],
    layers: [EXPOSURE, FE3, AGREEMENT],
    geotiff: "/tmp/run/mineral_map.tif",
    extent: EXTENT,
    notes: [],
    ...extra,
  }
}

describe("derived layer ids", () => {
  it("share the mineral prefix without being read as a group", () => {
    const id = mineralDerivedLayerId("margin1")
    expect(isMineralLayer(id)).toBe(true)
    expect(isMineralLayer(mineralLayerId(2))).toBe(true)
    expect(isMineralLayer("water")).toBe(false)
    expect(mineralGroupOfLayer(id)).toBeNull()
  })

  it("find the layer they name, and nothing for a group map", () => {
    const m = payload()
    expect(mineralDerivedLayer(m, mineralDerivedLayerId("fe3"))?.title).toBe(FE3.title)
    expect(mineralDerivedLayer(m, mineralLayerId(2))).toBeNull()
    expect(mineralDerivedLayer(m, mineralDerivedLayerId("gone"))).toBeNull()
  })

  it("count the passes that answered, not every pass compared", () => {
    expect(mineralPassesUsed(payload())).toBe(2)
    // A run saved before the comparison listed only the passes it used.
    expect(mineralPassesUsed(payload({ selection: null }))).toBe(3)
  })

  it("draw a ramp from the stops it was painted with, evenly spaced", () => {
    expect(mineralRampGradient(["#000000", "#808080", "#ffffff"])).toBe(
      "linear-gradient(to right, #000000 0.0%, #808080 50.0%, #ffffff 100.0%)"
    )
  })
})

describe("derived layers on the board", () => {
  it("are listed after the group maps, hidden until switched on", () => {
    const layers = mineralLayers(payload())
    expect(layers.map((l) => l.id)).toEqual([
      "mineral:exposure",
      "mineral:fe3",
      "mineral:agreement2",
    ])
    expect(layers.every((l) => !l.visible && l.pixelated)).toBe(true)
    const on = mineralLayers(payload(), { "mineral:fe3": { visible: true, opacity: 0.5 } })
    expect(on.find((l) => l.id === "mineral:fe3")).toMatchObject({ visible: true, opacity: 0.5 })
  })

  it("leave out a layer whose raster did not survive a reopen", () => {
    const m = payload({ layers: [{ ...FE3, uri: undefined }] })
    expect(mineralLayers(m)).toEqual([])
  })

  it("give a class layer a legend whose ordinals follow its colours, masked set aside", () => {
    const assets = runAssets({
      result: null,
      composition: null,
      compositionGallery: [],
      water: null,
      showCompositionOverlay: false,
      showWaterOverlay: false,
      composeOpacity: 1,
      waterOpacity: 1,
      mineral: payload(),
      mineralLayers: {},
    })
    const exposure = assets.find((a) => a.id === "mineral-exposure")
    expect(exposure?.sceneId).toBe("mineral:exposure")
    expect(exposure?.classes?.legend.map((e) => [e.id, e.color])).toEqual([
      [0, "#c9a26b"],
      [1, "#5b8c5a"],
      [2, "#5a5a5a"],
    ])
    expect(exposure?.classes?.excluded).toEqual([2])
    // A ramp is an image, not classes.
    expect(assets.find((a) => a.id === "mineral-fe3")?.classes).toBeUndefined()
    expect(assets.find((a) => a.id === "mineral-fe3")?.exportTif?.src).toBe("/tmp/run/mineral_map.tif")
  })
})

describe("derived legends", () => {
  it("give the agreement classes the areas of the reported counts", () => {
    const m = payload()
    const cellHa = mineralCellAreaHa(m)!
    const legend = legendFor("mineral:agreement2", { mineral: m })
    if (legend?.kind !== "classes") throw new Error(`classes expected, got ${legend?.kind}`)
    expect(legend.entries.map((e) => e.areaHa)).toEqual(
      [60, 20, 10, 4, 6].map((n) => n * cellHa)
    )
    expect(legend.rows).toEqual([{ label: "Same class, of cells both identified", value: "75.0%" }])
  })

  it("split the observed area into exposed and covered", () => {
    const legend = legendFor("mineral:exposure", { mineral: payload() })
    if (legend?.kind !== "classes") throw new Error("classes expected")
    expect(legend.entries[0].areaHa).toBe(200)
    expect(legend.entries[1].areaHa).toBe(300)
  })

  it("carry a band position's figures and its references beside the ramp", () => {
    const legend = legendFor("mineral:fe3", { mineral: payload() })
    if (legend?.kind !== "stats") throw new Error("stats expected")
    expect(legend.ramp?.low).toBe("871 nm hematite references")
    expect(legend.rows).toEqual([
      { label: "Hematite", value: "median 914 nm, 10-90% 898 nm to 925 nm (n=88)" },
      { label: "hematite references", value: "median 896 nm, 866 to 934 (n=12)" },
    ])
  })
})
