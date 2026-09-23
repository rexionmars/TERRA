/**
 * Which compositions an area lists, which is not the same as which the project
 * holds.
 *
 * The rule had one clause for a composition with no run: list it if it is the
 * one on the map. An area worked only by composition has no run, so every
 * composition made over it has none either, and the list showed exactly one --
 * each new composition replaced the last, though every one of them was saved.
 * The fix is the area each was made over. These cases pin both halves: an
 * area's own compositions are all listed, and another area's still are not.
 */
import { describe, expect, it } from "vitest"

import { runAssets, type RunAssetInput } from "./runAssets"
import type { CompositionOverlay } from "./types"

const EXTENT = { lon_min: -48.47, lat_min: -10.74, lon_max: -48.45, lat_max: -10.71 }

function comp(id: string, extra: Partial<CompositionOverlay> = {}): CompositionOverlay {
  return {
    id,
    overlay_uri: `data:image/png;base64,${id}`,
    extent: EXTENT,
    opacity: 0.85,
    title: id.toUpperCase(),
    kind: "index",
    index: id as CompositionOverlay["index"],
    ...extra,
  }
}

function listed(input: Partial<RunAssetInput>): string[] {
  return runAssets({
    result: null,
    composition: null,
    compositionGallery: [],
    water: null,
    showCompositionOverlay: true,
    showWaterOverlay: false,
    composeOpacity: 0.85,
    waterOpacity: 0.85,
    ...input,
  }).map((a) => a.id)
}

describe("compositions listed under an area", () => {
  it("lists every composition made over the area, not only the one on the map", () => {
    const ndvi = comp("ndvi", { areaId: "area-a" })
    const evi = comp("evi", { areaId: "area-a" })
    // The newest is on the map, as it is right after applying it.
    const ids = listed({
      areaId: "area-a",
      composition: evi,
      compositionGallery: [evi, ndvi],
    })
    expect(ids).toContain("evi")
    expect(ids).toContain("ndvi")
  })

  it("does not list another area's composition just because it covers this one", () => {
    const here = comp("evi", { areaId: "area-a" })
    const there = comp("ndvi", { areaId: "area-b" })
    const ids = listed({
      areaId: "area-a",
      composition: here,
      compositionGallery: [here, there],
    })
    expect(ids).toEqual(["evi"])
  })

  it("keeps a composition saved before the area was carried to the one on the map", () => {
    const legacy = comp("savi")
    const onMap = comp("evi", { areaId: "area-a" })
    expect(listed({ areaId: "area-a", composition: onMap, compositionGallery: [onMap, legacy] }))
      .toEqual(["evi"])
    expect(listed({ areaId: "area-a", composition: legacy, compositionGallery: [onMap, legacy] }))
      .toEqual(expect.arrayContaining(["evi", "savi"]))
  })

  it("lists a composition made under a run, which the scoping has already matched", () => {
    const underRun = comp("ndwi", { runId: "run-1" })
    expect(listed({ areaId: "area-a", compositionGallery: [underRun] })).toEqual(["ndwi"])
  })

  it("claims nothing when the caller names no area", () => {
    const a = comp("ndvi", { areaId: "area-a" })
    const b = comp("evi", { areaId: "area-a" })
    expect(listed({ composition: b, compositionGallery: [b, a] })).toEqual(["evi"])
  })
})
