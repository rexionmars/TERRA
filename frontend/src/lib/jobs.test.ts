import { describe, expect, it } from "vitest"

import { extendSelection, type Area } from "@/lib/areas"
import {
  countJobs,
  isJobKind,
  jobDuration,
  jobsInReadingOrder,
  latestRuns,
  takeFinished,
  withJob,
  type Job,
} from "@/lib/jobs"

function job(id: string, patch: Partial<Job> = {}): Job {
  return {
    id,
    kind: "classify",
    area_id: `area-${id}`,
    area_name: `field ${id}`,
    state: "queued",
    progress: 0,
    message: "",
    run_id: "",
    error: "",
    queued_at: "2026-01-01T10:00:00Z",
    started_at: "",
    finished_at: "",
    ...patch,
  }
}

describe("the job list", () => {
  it("replaces a job by id and leaves the list as it was for an unknown one", () => {
    const list = [job("1"), job("2")]
    const next = withJob(list, job("2", { state: "running", progress: 40 }))
    expect(next.map((j) => j.progress)).toEqual([0, 40])
    expect(list[1].progress).toBe(0)
    expect(withJob(list, job("9"))).toBe(list)
  })

  it("counts each state", () => {
    const counts = countJobs([
      job("1", { state: "done" }),
      job("2", { state: "done" }),
      job("3", { state: "running" }),
      job("4", { state: "failed" }),
    ])
    expect(counts).toEqual({ queued: 0, running: 1, done: 2, failed: 1, cancelled: 0 })
  })

  it("reads running first, then waiting in queue order, then the latest finished", () => {
    const list = [
      job("1", { state: "done", finished_at: "2026-01-01T10:01:00Z" }),
      job("2", { state: "failed", finished_at: "2026-01-01T10:03:00Z" }),
      job("3", { state: "running" }),
      job("4"),
      job("5"),
    ]
    expect(jobsInReadingOrder(list).map((j) => j.id)).toEqual(["3", "4", "5", "2", "1"])
  })

  it("says how long a job ran, or has been running", () => {
    const started = job("1", { started_at: "2026-01-01T10:00:00Z" })
    expect(jobDuration(job("1"))).toBeNull()
    expect(jobDuration(started, Date.parse("2026-01-01T10:00:42Z"))).toBe("42 s")
    expect(jobDuration({ ...started, finished_at: "2026-01-01T10:02:05Z" })).toBe("2 m 5 s")
    expect(jobDuration(started, Date.parse("2026-01-01T11:30:00Z"))).toBe("1 h 30 m")
  })

  it("queues the products that run over an area, and not the delineation", () => {
    expect(isJobKind("classify")).toBe(true)
    expect(isJobKind("water")).toBe(true)
    expect(isJobKind("mineral")).toBe(true)
    expect(isJobKind("fields")).toBe(false)
    expect(isJobKind("compose")).toBe(false)
    expect(isJobKind(null)).toBe(false)
  })
})

describe("finding the results again", () => {
  const runs = [
    { id: "r1", created_at: "2026-09-24T10:00:00Z", area_id: "f1", kind: "classification" },
    { id: "r2", created_at: "2026-09-25T10:00:00Z", area_id: "f1", kind: "classification" },
    { id: "r3", created_at: "2026-09-25T11:00:00Z", area_id: "f1", kind: "water" },
    // Written before the kind column: a classification.
    { id: "r4", created_at: "2026-09-20T10:00:00Z", area_id: "f2", kind: "" },
  ]

  it("takes the latest run of the product over each area, and counts the areas with none", () => {
    expect(latestRuns(runs, ["f1", "f2", "f3"], "classify")).toEqual({ ids: ["r2", "r4"], missing: 1 })
    expect(latestRuns(runs, ["f1", "f2"], "water")).toEqual({ ids: ["r3"], missing: 1 })
  })

  it("hands each finished job over once", () => {
    const list = [
      job("t1", { state: "done", run_id: "run-1" }),
      job("t2", { state: "running" }),
      job("t3", { state: "failed" }),
    ]
    expect(takeFinished(list).map((j) => j.id)).toEqual(["t1"])
    expect(takeFinished(list)).toEqual([])
    const later = [list[0], job("t2", { state: "done", run_id: "run-2" })]
    expect(takeFinished(later).map((j) => j.id)).toEqual(["t2"])
  })
})

const square = {
  type: "Polygon",
  coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
} as Area["geometry"]

function area(id: string, parent = ""): Area {
  return {
    id,
    name: id,
    geometry: square,
    created_at: "",
    notes: "",
    run_count: 0,
    parent_id: parent,
    source_run_id: parent ? "run" : "",
  }
}

describe("the selection a job is queued over", () => {
  const areas = [area("aoi"), area("f1", "aoi"), area("f2", "aoi"), area("f3", "aoi"), area("other")]

  it("starts from the field in use when a second field is shift-pressed", () => {
    expect(extendSelection([], ["f2"], areas, "f1", "toggle")).toEqual(["f1", "f2"])
  })

  it("does not start from the area when one of its fields is shift-pressed", () => {
    expect(extendSelection([], ["f2"], areas, "aoi", "toggle")).toEqual(["f2"])
    expect(extendSelection([], ["other"], areas, "f1", "toggle")).toEqual(["other"])
  })

  it("takes a selected field out when it is pressed again", () => {
    expect(extendSelection(["f1", "f2"], ["f2"], areas, "f1", "toggle")).toEqual(["f1"])
  })

  it("selects all of an area's fields, and clears them when all are selected", () => {
    const all = extendSelection(["f1"], ["f1", "f2", "f3"], areas, null, "toggle")
    expect(all).toEqual(["f1", "f2", "f3"])
    expect(extendSelection(all, ["f1", "f2", "f3"], areas, null, "toggle")).toEqual([])
  })

  it("only adds for a box, once each", () => {
    expect(extendSelection(["f1"], ["f1", "f2", "f2"], areas, null, "add")).toEqual(["f1", "f2"])
  })

  it("drops what is no longer an area", () => {
    expect(extendSelection(["gone", "f1"], ["f2", "missing"], areas, null, "add")).toEqual(["f1", "f2"])
    expect(extendSelection(["gone"], ["missing"], areas, null, "toggle")).toEqual([])
  })
})
