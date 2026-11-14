import { describe, expect, it } from "vitest"

import { catalogEntry, compareVersions, inPreparation } from "@/lib/modelCatalog"
import type { CatalogEntry, ModelCatalog, ModelInfo, UpcomingEntry } from "@/lib/types"

const entry = (id: string, version: string) =>
  ({ manifest: { id, version } }) as unknown as CatalogEntry

describe("compareVersions", () => {
  it("orders numeric parts as numbers, so 1.10 is newer than 1.9", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1)
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1)
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0)
  })

  // internal/models compares the same way; a missing part sorts first.
  it("puts a shorter version before a longer one with the same start", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(-1)
  })

  it("orders a part that is not a number as text", () => {
    expect(compareVersions("1.0.0-b", "1.0.0-a")).toBe(1)
  })
})

describe("catalogEntry", () => {
  const catalog = {
    models: [entry("rf", "1.9.0"), entry("rf", "1.10.0"), entry("tt", "1.0.0")],
    origin: "online",
    problem: "",
    unsupported: 0,
  } as ModelCatalog

  it("gives the newest version the catalogue lists", () => {
    expect(catalogEntry(catalog, "rf")?.manifest.version).toBe("1.10.0")
  })

  it("gives nothing for a model the catalogue does not list, or without one", () => {
    expect(catalogEntry(catalog, "prithvi")).toBeUndefined()
    expect(catalogEntry(null, "rf")).toBeUndefined()
  })
})

describe("inPreparation", () => {
  const coming = (id: string) => ({ id }) as UpcomingEntry
  const installed = (id: string) => ({ manifest: { id } }) as unknown as ModelInfo
  const catalog = {
    models: [entry("rf", "1.0.0")],
    upcoming: [coming("gp-interval"), coming("cloud-score"), coming("phenology")],
    origin: "online",
    problem: "",
    unsupported: 0,
  } as ModelCatalog

  it("keeps the catalogue's order", () => {
    expect(inPreparation(catalog, []).map((u) => u.id)).toEqual([
      "gp-interval",
      "cloud-score",
      "phenology",
    ])
  })

  it("leaves out a model whose id is installed", () => {
    expect(
      inPreparation(catalog, [installed("cloud-score"), installed("rf")]).map(
        (u) => u.id
      )
    ).toEqual(["gp-interval", "phenology"])
  })

  it("gives none for a catalogue without the list, or without a catalogue", () => {
    expect(inPreparation({ ...catalog, upcoming: null }, [])).toEqual([])
    expect(inPreparation(null, [])).toEqual([])
  })
})
