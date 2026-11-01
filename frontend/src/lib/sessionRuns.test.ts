import { describe, expect, it } from "vitest"

import { sessionRuns } from "@/lib/sessionRuns"
import type { InferenceRun, PredictResult } from "@/lib/types"

const result = (over: Partial<PredictResult> = {}) => ({ ...over }) as PredictResult
const record = (id: string, over: Partial<InferenceRun> = {}) =>
  ({
    id,
    model_kind: "spectral",
    period_start: "2026-01-01",
    period_end: "2026-02-01",
    ...over,
  }) as InferenceRun

const none = { live: null, retained: [], extra: [], saved: [], areas: [] }

describe("sessionRuns", () => {
  it("is empty with nothing in hand", () => {
    expect(sessionRuns(none)).toEqual([])
  })

  it("lists the map's run first, then those left behind, then those picked", () => {
    const out = sessionRuns({
      ...none,
      live: { id: "r1", label: "Here", result: result() },
      retained: [{ id: "r2", result: result({ run_id: "r2" }) }],
      extra: [{ run: record("r3"), result: result() }],
    })
    expect(out.map((r) => r.id)).toEqual(["r1", "r2", "r3"])
    expect(out.map((r) => r.live)).toEqual([true, false, false])
  })

  it("does not list twice a run that is also on the map", () => {
    const out = sessionRuns({
      ...none,
      live: { id: "r1", label: "Here", result: result() },
      extra: [{ run: record("r1"), result: result() }],
    })
    expect(out).toHaveLength(1)
  })

  it("prefers the picked copy of a retained run, which carries its record", () => {
    const out = sessionRuns({
      ...none,
      retained: [{ id: "ground", result: result({ run_id: "r2" }) }],
      extra: [{ run: record("r2", { label: "Picked" }), result: result() }],
    })
    expect(out.map((r) => r.label)).toEqual(["Picked"])
  })

  it("names a retained run by the run it holds, not the ground it was filed under", () => {
    const out = sessionRuns({
      ...none,
      retained: [{ id: "ground", result: result({ run_id: "r2" }) }],
      areas: [{ id: "ground", name: "North field" }],
    })
    expect(out[0]).toMatchObject({ id: "r2", label: "North field" })
  })

  it("takes the model from the run's record, not from the control", () => {
    const out = sessionRuns({
      ...none,
      live: { id: "r1", label: "Here", model: "prithvi", result: result() },
      saved: [record("r1", { model_kind: "spectral" })],
    })
    expect(out[0].model).toBe("Random Forest")
  })

  it("reads the period off the scenes used, and off the record where there are none", () => {
    const out = sessionRuns({
      ...none,
      extra: [
        {
          run: record("a"),
          result: result({ date_range: ["2026-03-01", "2026-04-01"] }),
        },
        { run: record("b"), result: result() },
      ],
    })
    expect(out.map((r) => r.period)).toEqual([
      "2026-03-01 to 2026-04-01",
      "2026-01-01 to 2026-02-01",
    ])
  })
})
