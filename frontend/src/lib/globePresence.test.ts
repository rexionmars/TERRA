/**
 * One raster, one presence on the globe: a plane sent from the outliner and
 * the same raster sent unchanged by a compositor Globe node are one thing.
 */
import { describe, expect, it } from "vitest"

import { drawnByCompositor, layersBySource, planesOnGlobe, toggleOnGlobe } from "./globePresence"

const PLANE = "area\u0000mineral:2"
const bySource = layersBySource([
  { key: "compositor:globe-1:layer-1", sourceKey: PLANE },
  { key: "compositor:globe-1:layer-2", sourceKey: null },
])

describe("planesOnGlobe", () => {
  it("counts a plane the compositor draws unchanged as on the globe", () => {
    expect(planesOnGlobe(new Set(), bySource, new Set()).has(PLANE)).toBe(true)
  })

  it("does not count it while that layer is hidden", () => {
    const hidden = new Set(["compositor:globe-1:layer-1"])
    expect(planesOnGlobe(new Set(), bySource, hidden).has(PLANE)).toBe(false)
  })

  it("ignores compositor layers that changed their raster", () => {
    expect([...layersBySource([{ key: "k", sourceKey: null }]).keys()]).toEqual([])
  })
})

describe("toggleOnGlobe", () => {
  it("takes off a plane the compositor draws by hiding that layer", () => {
    const on = planesOnGlobe(new Set(), bySource, new Set())
    expect(toggleOnGlobe(PLANE, on, bySource)).toEqual({
      sent: "remove",
      hide: ["compositor:globe-1:layer-1"],
      show: [],
    })
  })

  it("shows the compositor's layer again rather than sending the plane", () => {
    const hidden = new Set(["compositor:globe-1:layer-1"])
    const on = planesOnGlobe(new Set(), bySource, hidden)
    expect(toggleOnGlobe(PLANE, on, bySource)).toEqual({
      sent: "keep",
      hide: [],
      show: ["compositor:globe-1:layer-1"],
    })
  })

  it("sends the plane itself where nothing draws it", () => {
    expect(toggleOnGlobe("other\u0000prediction", new Set(), bySource)).toEqual({
      sent: "add",
      hide: [],
      show: [],
    })
  })
})

describe("drawnByCompositor", () => {
  it("draws a plane sent both ways once, as the compositor's layer", () => {
    expect(drawnByCompositor(PLANE, bySource, new Set())).toBe(true)
    expect(drawnByCompositor(PLANE, bySource, new Set(["compositor:globe-1:layer-1"]))).toBe(false)
  })
})
