import { describe, expect, it } from "vitest"

import type { MineralRunOptions } from "@/lib/mineral"
import type { GeoJSONGeometry } from "@/lib/types"

import {
  groundInHand,
  mineralRequest,
  overlapRequest,
  predictRequest,
  type RequestContext,
} from "./runRequests"

const polygon: GeoJSONGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
}
const context: RequestContext = {
  start: "2026-01-01",
  end: "2026-06-01",
  maxCloud: 40,
  monthlyBest: true,
  mode: "single",
  modelKind: "spectral",
  prithviMode: "pixel",
  projectId: "p1",
}
const ground = { polygon, areaId: "a1", label: "Field" }

describe("groundInHand", () => {
  it("is nothing without a shape, and names one that has no name", () => {
    expect(groundInHand(null, undefined, "Field")).toBeNull()
    expect(groundInHand(polygon, undefined, "  ")?.label).toBe("Custom AOI")
  })
})

describe("the requests", () => {
  it("file the run under its area and its project", () => {
    const r = predictRequest(ground, context)
    expect(r.area_id).toBe("a1")
    expect(r.project_id).toBe("p1")
    expect(predictRequest(ground, { ...context, projectId: null }).project_id).toBe(
      undefined
    )
  })

  it("do not hand the mineral map the period card's cloud limit", () => {
    const options: MineralRunOptions = { passes: 3, draws: 10 }
    const r = mineralRequest(ground, context, options)
    expect(r.max_cloud).toBe(0)
    expect(r.max_scenes).toBe(3)
    expect(r.uncertainty_draws).toBe(10)
  })

  it("read the registers with no period at all", () => {
    expect(overlapRequest(ground, context)).not.toHaveProperty("start")
  })
})
