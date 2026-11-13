import { describe, expect, it } from "vitest"

import { runAreaName } from "@/lib/aoiLabel"
import { batchKey, groupRuns } from "@/lib/runBatches"

const run = (
  id: string,
  created_at: string,
  label: string,
  kind = "classification"
) => ({
  id,
  created_at,
  label,
  kind,
  model_kind: "temporal_transformer",
})

const day = (iso: string) => iso.slice(0, 10)

describe("batchKey", () => {
  it("ties a run to the stamp, product and model of the request that made it", () => {
    expect(batchKey(run("a", "", "run-field-23-20260927-101030"))).toBe(
      "classification|temporal_transformer|20260927-101030"
    )
  })

  it("is null for a label with no stamp", () => {
    expect(batchKey(run("a", "", "Soy, north block"))).toBeNull()
    expect(batchKey(run("a", "", ""))).toBeNull()
  })
})

describe("groupRuns", () => {
  it("gathers the runs of one request into a batch placed at its newest run", () => {
    const days = groupRuns(
      [
        run("f1", "2026-09-27T13:26:00Z", "run-field-1-20260927-101030"),
        run("z", "2026-09-27T14:06:00Z", "run-drawn-9-20260927-110353", "zones"),
        run("f2", "2026-09-27T13:43:00Z", "run-field-2-20260927-101030"),
        run("d", "2026-09-27T12:00:00Z", "run-drawn-5-20260927-085400"),
      ],
      day
    )
    expect(days).toHaveLength(1)
    expect(days[0].count).toBe(4)
    expect(
      days[0].blocks.map((b) => [b.batch, b.runs.map((r) => r.id).join(",")])
    ).toEqual([
      [false, "z"],
      [true, "f2,f1"],
      [false, "d"],
    ])
  })

  it("does not call one run with a stamp a batch", () => {
    const days = groupRuns(
      [
        run("a", "2026-09-27T10:00:00Z", "run-a-20260927-070000"),
        run("b", "2026-09-27T09:00:00Z", "run-b-20260927-060000"),
      ],
      day
    )
    expect(days[0].blocks).toEqual([{ batch: false, runs: expect.any(Array) }])
    expect(days[0].blocks[0].runs.map((r) => r.id)).toEqual(["a", "b"])
  })

  it("keeps a batch whole across midnight, under the day of its newest run", () => {
    const days = groupRuns(
      [
        run("late", "2026-09-28T00:10:00Z", "run-x-20260927-235000"),
        run("early", "2026-09-27T23:55:00Z", "run-y-20260927-235000"),
        run("other", "2026-09-27T20:00:00Z", "run-z-20260927-200000"),
      ],
      day
    )
    expect(days.map((d) => [d.day, d.count])).toEqual([
      ["2026-09-28", 2],
      ["2026-09-27", 1],
    ])
  })

  it("splits the loose runs where the day changes", () => {
    const days = groupRuns(
      [
        run("a", "2026-10-03T02:47:00Z", "run-drawn-10-20261002-234634", "radar"),
        run("b", "2026-09-27T14:01:00Z", "run-drawn-9-20260927-110051", "radar"),
      ],
      day
    )
    expect(days.map((d) => d.day)).toEqual(["2026-10-03", "2026-09-27"])
  })

  it("does not join two products that share a stamp", () => {
    const days = groupRuns(
      [
        run("c", "2026-09-27T10:00:00Z", "run-a-20260927-070000"),
        run("w", "2026-09-27T09:59:00Z", "run-a-20260927-070000", "water"),
      ],
      day
    )
    expect(days[0].blocks.every((b) => !b.batch)).toBe(true)
  })
})

describe("runAreaName", () => {
  it("takes the area's name frozen in the summary", () => {
    expect(
      runAreaName({
        label: "run-field-23-20260927-101030",
        summary: '{"aoi_label":"field 23"}',
      })
    ).toBe("field 23")
  })

  it("reads the area out of a run label when the summary has none", () => {
    expect(runAreaName({ label: "run-north-block-20260927-101030", summary: "" })).toBe(
      "north block"
    )
  })

  it("is null for a placeholder, in either place", () => {
    expect(
      runAreaName({
        label: "run-custom-aoi-20260927-101030",
        summary: '{"aoi_label":"Custom AOI"}',
      })
    ).toBeNull()
    expect(runAreaName({ label: "run-aoi-20260927-101030" })).toBeNull()
    expect(runAreaName({ label: "", summary: null })).toBeNull()
  })
})
