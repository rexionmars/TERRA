import { describe, expect, it, vi } from "vitest"
import {
  activeRuns,
  productOffered,
  productRun,
  type ProductRunProps,
} from "./productRun"

function props(over: Partial<ProductRunProps> = {}): ProductRunProps {
  return {
    hasArea: true,
    activeAreaId: "a1",
    areas: [{ id: "a1" }, { id: "f1", parent_id: "a1" }],
    start: "2025-01-01",
    end: "2025-12-31",
    running: false,
    progress: 0,
    progressMsg: "",
    onRun: () => {},
    waterRunning: false,
    waterProgress: 0,
    waterProgressMsg: "",
    onRunWater: () => {},
    onRunMinerals: () => {},
    onRunFields: () => {},
    onQueueJobs: () => {},
    ...over,
  }
}

describe("productRun", () => {
  it("asks for an area before anything else", () => {
    const p = props({ hasArea: false, activeAreaId: undefined, start: "", end: "" })
    for (const tool of [
      "classify",
      "water",
      "mineral",
      "fields",
      "health",
      "overlap",
    ] as const) {
      expect(productRun(tool, p).blocked).toMatch(/Draw an area/)
    }
  })

  it("asks a classification for both dates, and not the register overlap", () => {
    const p = props({ end: "" })
    expect(productRun("classify", p).blocked).toMatch(/both dates/)
    expect(productRun("overlap", p).blocked).toBeNull()
  })

  it("refuses a job over an area that was never saved", () => {
    const p = props({ activeAreaId: undefined })
    expect(productRun("health", p).blocked).toMatch(/saved area/)
    expect(productRun("classify", p).blocked).toBeNull()
  })

  it("refuses to delineate inside a field, or over a period too short to cut", () => {
    expect(productRun("fields", props({ activeAreaId: "f1" })).blocked).toMatch(
      /holds no fields/
    )
    expect(
      productRun("fields", props({ start: "2025-01-01", end: "2025-01-03" })).blocked
    ).toMatch(/at least \d+ days/)
    expect(productRun("fields", props()).blocked).toBeNull()
  })

  it("queues a selection in place of running over the area in hand", () => {
    const onQueueJobs = vi.fn()
    const run = productRun("water", props({ selectedAreaIds: ["a", "b"], onQueueJobs }))
    expect(run.label).toBe("Queue 2 runs")
    run.onRun()
    expect(onQueueJobs).toHaveBeenCalledWith("water")
  })

  it("does not queue the delineation, which makes what a queue is for", () => {
    const onRunFields = vi.fn()
    const run = productRun(
      "fields",
      props({ selectedAreaIds: ["a", "b"], onRunFields })
    )
    expect(run.label).toBe("Delineate fields")
    run.onRun()
    expect(onRunFields).toHaveBeenCalled()
  })

  it("withholds what this build cannot start", () => {
    expect(productOffered("mineral", props({ onRunMinerals: undefined }))).toBe(false)
    expect(productOffered("health", props({ onQueueJobs: undefined }))).toBe(false)
    expect(productOffered("classify", props({ onQueueJobs: undefined }))).toBe(true)
  })
})

describe("activeRuns", () => {
  it("lists only what is running, with its own progress", () => {
    const runs = activeRuns(
      props({ waterRunning: true, waterProgress: 40, waterProgressMsg: "scene 2" })
    )
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      label: "Mapping",
      progress: 40,
      progressMsg: "scene 2",
    })
  })

  it("is not fooled by a selection, which would turn a run into a queue", () => {
    expect(activeRuns(props({ running: true, selectedAreaIds: ["a"] }))).toHaveLength(1)
  })
})
