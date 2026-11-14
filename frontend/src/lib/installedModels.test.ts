import { describe, expect, it } from "vitest"

import { classifiers } from "@/lib/installedModels"
import type { ModelInfo } from "@/lib/types"

const installed = (id: string, version: string, task: string) =>
  ({ manifest: { id, version, task } }) as unknown as ModelInfo

describe("classifiers", () => {
  // ListModels gives the newest version of an id first.
  const models = [
    installed("spectral", "1.1.0", "land_cover"),
    installed("spectral", "1.0.0", "land_cover"),
    installed("gp-interval", "1.0.0", "time_series"),
    installed("clear-fraction", "1.0.0", "observation_quality"),
    installed("temporal_transformer", "1.0.0", "land_cover"),
  ]

  it("leaves out a model of another task, which emits no classes", () => {
    expect(classifiers(models).map((m) => m.manifest.id)).toEqual([
      "spectral",
      "temporal_transformer",
    ])
  })

  it("lists each model once, at its newest version", () => {
    expect(classifiers(models)[0].manifest.version).toBe("1.1.0")
  })

  it("lists nothing when only models of other tasks are installed", () => {
    expect(classifiers(models.slice(2, 4))).toEqual([])
  })
})
