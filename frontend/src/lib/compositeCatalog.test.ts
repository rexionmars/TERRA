import { describe, expect, it } from "vitest"

import { kindDef, resolveCompositionMeta, sceneNote } from "./compositeCatalog"

describe("sceneNote", () => {
  it("names a Sentinel-2 scene by its cloud and a CBERS-4A scene by the area it holds", () => {
    expect(
      sceneNote({
        id: "a",
        date: "2026-03-01",
        cloud_cover: 12.4,
        tile: "T22JBT",
        satellite: "S2",
      })
    ).toBe("2026-03-01 · 12 % cloud · T22JBT")
    expect(
      sceneNote({
        id: "CBERS4A_WPM_PCA_RGB321_20240419_210_145",
        date: "2024-04-19",
        cloud_cover: null,
        tile: "210/145",
        satellite: "CBERS-4A",
        coverage: 0.437,
      })
    ).toBe("2024-04-19 · 44 % of the area · 210/145")
  })
})

describe("the CBERS-4A view", () => {
  it("is read from one scene, stretched, and named for its source", () => {
    const def = kindDef("cbers")
    expect(def.median).toBe(false)
    expect(def.stretch).toBe(true)
    const meta = resolveCompositionMeta({
      kind: "cbers",
      bands: ["B04", "B03", "B02"],
      index: "ndvi",
    })
    expect(meta.kind).toBe("cbers")
    expect(meta.title).toBe("CBERS-4A true colour")
  })
})
