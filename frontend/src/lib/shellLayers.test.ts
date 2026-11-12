import { describe, expect, it } from "vitest"

import type { RasterLayer } from "@/lib/mapLayers"
import type { RunAsset } from "@/lib/runAssets"
import { jobReadingOf, withAssetLayers } from "@/lib/shellLayers"

const EXTENT = { lon_min: -54, lat_min: -25, lon_max: -53, lat_max: -24 }

const asset = (id: string, over: Partial<RunAsset> = {}): RunAsset => ({
  id,
  sceneId: id,
  title: id,
  params: "",
  previewUri: `data:${id}`,
  extent: EXTENT,
  pixelated: true,
  onBoard: false,
  selectId: null,
  removeId: null,
  exportPng: { src: `data:${id}`, filename: `${id}.png` },
  exportTif: null,
  ...over,
})

const layer = (id: string, order: number): RasterLayer => ({
  id,
  title: id,
  uri: `data:${id}`,
  extent: EXTENT,
  opacity: 1,
  order,
  pixelated: true,
  smooth: false,
  visible: true,
})

describe("withAssetLayers", () => {
  it("does not list twice a raster the layer table already holds", () => {
    const out = withAssetLayers(
      [layer("prediction", 400)],
      [asset("prediction"), asset("confidence")]
    )
    expect(out.filter((l) => l.id === "prediction")).toHaveLength(1)
    expect(out.map((l) => l.id)).toContain("confidence")
  })

  it("compares by the layer's id, which is not always the asset's", () => {
    // The water raster is the asset water-occurrence and the layer water.
    const out = withAssetLayers(
      [layer("water", 360)],
      [asset("water-occurrence", { sceneId: "water" })]
    )
    expect(out.map((l) => l.id)).toEqual(["water"])
  })

  it("leaves a gallery composition to the Compositions panel", () => {
    const out = withAssetLayers([], [asset("c1", { selectId: "c1" })])
    expect(out).toEqual([])
  })

  it("skips what cannot be placed", () => {
    expect(withAssetLayers([], [asset("nowhere", { extent: null })])).toEqual([])
  })

  it("turns on the product's answer and leaves what qualifies it off", () => {
    const out = withAssetLayers([], [asset("health-anomaly"), asset("health-ndvi")])
    expect(out.find((l) => l.id === "health-anomaly")?.visible).toBe(true)
    expect(out.find((l) => l.id === "health-ndvi")?.visible).toBe(false)
  })

  it("turns on only the first partition of the zones, which runAssets puts suggested first", () => {
    const out = withAssetLayers(
      [],
      [asset("zones-4"), asset("zones-3"), asset("zones-5")]
    )
    expect(out.filter((l) => l.visible).map((l) => l.id)).toEqual(["zones-4"])
  })

  it("lets the reader's switch and opacity override the opening state", () => {
    const out = withAssetLayers([], [asset("health-anomaly")], {
      "health-anomaly": { visible: false, opacity: 0.4 },
    })
    expect(out[0]).toMatchObject({ visible: false, opacity: 0.4 })
  })

  it("draws imagery under measurements", () => {
    const out = withAssetLayers(
      [layer("prediction", 400)],
      [asset("health-anomaly"), asset("true-color")]
    )
    expect(out.map((l) => l.id)).toEqual(["true-color", "health-anomaly", "prediction"])
  })
})

describe("jobReadingOf", () => {
  it("carries what the run measured, named by the area it was over", () => {
    const radar = { extent: EXTENT } as never
    expect(jobReadingOf("r", "North field", { radar })).toMatchObject({
      runId: "r",
      label: "North field",
      radar,
    })
  })

  it("is null for a run that holds no queued product", () => {
    expect(jobReadingOf("r", "x", {})).toBeNull()
    expect(jobReadingOf("r", "x", null)).toBeNull()
  })
})
