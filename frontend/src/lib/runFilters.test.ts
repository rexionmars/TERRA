import { describe, expect, it } from "vitest"

import {
  NO_FILTER,
  areaKey,
  facetRuns,
  isFiltered,
  modelKey,
  savedLabel,
  sinceDay,
  type RunFilter,
} from "@/lib/runFilters"
import type { InferenceRun } from "@/lib/types"

/** Noon local time, so the local day is the day written whatever the zone. */
const at = (day: string) => new Date(`${day}T12:00:00`).toISOString()

const run = (
  id: string,
  day: string,
  label: string,
  kind = "classification",
  model_kind = "temporal_transformer"
): InferenceRun => ({
  id,
  user_id: "u",
  created_at: at(day),
  model_kind,
  period_start: "",
  period_end: "",
  polygon_geojson: "",
  status: "ok",
  summary: "{}",
  n_dates: 0,
  label,
  kind,
})

const TODAY = new Date(2026, 10, 16, 9, 0)

const RUNS = [
  run("tt1", "2026-11-15", "run-field-1-20261115-090000"),
  run("rf1", "2026-11-10", "run-field-2-20261110-090000", "classification", "spectral"),
  run("rf0", "2026-09-27", "run-field-10-20260927-090000", "classification", ""),
  run("min", "2026-11-05", "run-drawn-11-20261105-074134", "mineral", "tetracorder"),
  run("rad", "2026-10-03", "run-field-1-20261003-020000", "radar", "sentinel-1-rtc"),
]

const ids = (runs: readonly InferenceRun[]) => runs.map((r) => r.id).sort()
const facet = (f: Partial<RunFilter>, search?: (r: InferenceRun) => boolean) =>
  facetRuns(RUNS, { ...NO_FILTER, ...f }, TODAY, search)

describe("modelKey", () => {
  it("is the model of a classification, with an empty one read as Random Forest", () => {
    expect(
      modelKey({ kind: "classification", model_kind: "temporal_transformer" })
    ).toBe("temporal_transformer")
    expect(modelKey({ kind: "classification", model_kind: "" })).toBe("spectral")
    expect(modelKey({ kind: "", model_kind: "" })).toBe("spectral")
  })

  it("is null for a product made by a single method", () => {
    expect(modelKey({ kind: "radar", model_kind: "sentinel-1-rtc" })).toBeNull()
  })
})

describe("areaKey", () => {
  it("folds the area's name so its spellings are one choice", () => {
    expect(areaKey({ label: "run-field-1-20261115-090000", summary: "{}" })).toBe(
      "field 1"
    )
    expect(
      areaKey({ label: "x", summary: JSON.stringify({ aoi_label: "Field 1" }) })
    ).toBe("field 1")
  })

  it("is null for a run named by no area", () => {
    expect(areaKey({ label: "run-aoi-20261115-090000", summary: "{}" })).toBeNull()
  })
})

describe("sinceDay", () => {
  it("counts today among the days of the span", () => {
    expect(sinceDay("week", TODAY)).toBe("2026-11-10")
    expect(sinceDay("month", TODAY)).toBe("2026-10-18")
    expect(sinceDay("year", TODAY)).toBe("2025-11-17")
  })
})

describe("facetRuns", () => {
  it("shows every run in scope when nothing is chosen", () => {
    const f = facet({})
    expect(ids(f.shown)).toEqual(ids(RUNS))
    expect(isFiltered(f.filter)).toBe(false)
  })

  it("keeps a classification by its model, both spellings of Random Forest as one", () => {
    const f = facet({ model: "spectral" })
    expect(ids(f.shown)).toEqual(["rf0", "rf1"])
    expect(f.models).toEqual([
      { key: "spectral", label: "Random Forest", count: 2 },
      { key: "temporal_transformer", label: "Temporal Transformer", count: 1 },
    ])
  })

  it("counts each product under the other filters, so a model zeroes the others", () => {
    const f = facet({ model: "spectral" })
    expect(f.products.get("class")).toBe(2)
    expect(f.products.get("mineral")).toBe(0)
    expect(f.products.get("radar")).toBe(0)
  })

  it("counts each model under the product, which is not its own filter", () => {
    const f = facet({ product: "radar" })
    expect(ids(f.shown)).toEqual(["rad"])
    expect(f.models.map((m) => m.count)).toEqual([0, 0])
  })

  it("keeps the runs saved within a span counted back from today", () => {
    expect(ids(facet({ saved: { when: "since", since: "week" } }).shown)).toEqual([
      "rf1",
      "tt1",
    ])
    const f = facet({ saved: { when: "since", since: "month" } })
    expect(ids(f.shown)).toEqual(["min", "rf1", "tt1"])
    expect(f.since).toEqual({ week: 2, month: 3, year: 5 })
  })

  it("keeps a month and lists the months newest first", () => {
    const f = facet({ saved: { when: "month", month: "2026-10" } })
    expect(ids(f.shown)).toEqual(["rad"])
    expect(f.months.map((m) => [m.key, m.count])).toEqual([
      ["2026-11", 3],
      ["2026-10", 1],
      ["2026-09", 1],
    ])
    expect(f.months[0].label).toBe("November 2026")
  })

  it("keeps the days between two ends, both included, and an open end", () => {
    expect(
      ids(
        facet({ saved: { when: "between", from: "2026-11-05", to: "2026-11-10" } })
          .shown
      )
    ).toEqual(["min", "rf1"])
    expect(
      ids(facet({ saved: { when: "between", from: "", to: "2026-10-03" } }).shown)
    ).toEqual(["rad", "rf0"])
  })

  it("keeps an area by its name across products, and orders areas as numbers", () => {
    const f = facet({ area: "field 1" })
    expect(ids(f.shown)).toEqual(["rad", "tt1"])
    expect(f.areas.map((a) => a.label)).toEqual([
      "Drawn 11",
      "Field 1",
      "Field 2",
      "Field 10",
    ])
  })

  it("applies the search to every count", () => {
    const f = facet({}, (r) => r.id !== "tt1")
    expect(f.shown).toHaveLength(4)
    expect(f.products.get("class")).toBe(2)
    expect(f.since.week).toBe(1)
  })

  it("drops a choice the scope does not hold, rather than showing an empty page", () => {
    const f = facetRuns(
      RUNS.filter((r) => r.kind === "radar"),
      {
        product: "mineral",
        model: "spectral",
        area: "field 2",
        saved: { when: "month", month: "2026-11" },
      },
      TODAY
    )
    expect(f.filter).toEqual(NO_FILTER)
    expect(ids(f.shown)).toEqual(["rad"])
  })

  it("reads a span with neither end as no filter", () => {
    const f = facet({ saved: { when: "between", from: "", to: "" } })
    expect(f.filter.saved).toEqual({ when: "any" })
  })
})

describe("savedLabel", () => {
  it("names the span in a few words", () => {
    expect(savedLabel({ when: "since", since: "week" })).toBe("Last 7 days")
    expect(savedLabel({ when: "month", month: "2026-09" })).toBe("September 2026")
    expect(savedLabel({ when: "between", from: "2026-11-05", to: "2026-11-10" })).toBe(
      "5 Nov 2026 to 10 Nov 2026"
    )
    expect(savedLabel({ when: "between", from: "", to: "2026-11-10" })).toBe(
      "Until 10 Nov 2026"
    )
  })
})
