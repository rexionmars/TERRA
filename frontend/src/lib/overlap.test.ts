import { describe, expect, it } from "vitest"

import { fieldRow, fieldTableCsv } from "@/lib/fieldTable"
import { carGapHa, formatHa, overlapFigures, periodHa, registerHa, registers } from "@/lib/overlap"
import { runRowLine } from "@/lib/runSummary"
import type { OverlapAnalysis, OverlapLayer } from "@/lib/types"

function layer(id: string, over: Partial<OverlapLayer> = {}): OverlapLayer {
  return {
    id,
    title: id,
    publisher: "",
    layers: [],
    colour: "#000000",
    status: "read",
    note: "",
    overlap_ha: 0,
    n_features: 0,
    features: [],
    ...over,
  }
}

const report: OverlapAnalysis = {
  area_ha: 100,
  read_at: "2026-09-26T20:55:00Z",
  extent: { lon_min: -53.37, lat_min: -24.885, lon_max: -53.33, lat_max: -24.855 },
  biomes: ["Mata Atlântica"],
  states: ["PR"],
  forest_code_cutoff: "2008-07-22",
  eudr_cutoff: "2020-12-31",
  layers: [
    layer("car", { overlap_ha: 96, n_features: 3 }),
    layer("prodes", { overlap_ha: 12 }),
    layer("deter", { status: "not_covered", note: "DETER monitors the Amazon and the Cerrado" }),
    layer("indigenous", { status: "failed", title: "Indigenous lands", note: "not read: HTTP 503" }),
    layer("embargo_ibama", { overlap_ha: 4 }),
    layer("embargo_icmbio"),
    layer("conservation"),
  ],
  periods: [
    { id: "before_forest_code", label: "", ha: 8 },
    { id: "forest_code_to_eudr", label: "", ha: 3 },
    { id: "straddles_eudr", label: "", ha: 0 },
    { id: "after_eudr", label: "", ha: 1 },
  ],
  map_uri: "",
}

describe("an overlap run's figures", () => {
  it("keeps a register that was not read apart from one that meets nothing", () => {
    expect(registerHa(report, "conservation")).toBe(0)
    expect(registerHa(report, "indigenous")).toBeNull()
    expect(registerHa(report, "deter")).toBeNull()
    expect(registerHa(null, "car")).toBeNull()
  })

  it("reads the part of the area outside every CAR registration", () => {
    expect(carGapHa(report)).toBe(4)
    const unreadCar = { ...report, layers: report.layers.map((l) => (l.id === "car" ? { ...l, status: "failed" as const } : l)) }
    expect(carGapHa(unreadCar)).toBeNull()
  })

  it("places PRODES by period, and none where PRODES was not read", () => {
    expect(periodHa(report, "after_eudr")).toBe(1)
    const unread = { ...report, layers: report.layers.filter((l) => l.id !== "prodes") }
    expect(periodHa(unread, "after_eudr")).toBeNull()
  })

  it("orders the registers as the card reads them", () => {
    expect(registers(report).map((l) => l.id)).toEqual([
      "prodes",
      "deter",
      "embargo_ibama",
      "embargo_icmbio",
      "indigenous",
      "conservation",
      "car",
    ])
  })

  it("names the registers that were not read", () => {
    expect(overlapFigures(report)?.unread).toEqual(["Indigenous lands"])
  })

  it("formats hectares by size", () => {
    expect(formatHa(0.4321)).toBe("0.43 ha")
    expect(formatHa(42.26)).toBe("42.3 ha")
    expect(formatHa(1286.6)).toBe("1 287 ha")
  })
})

describe("the Field table with an overlap run", () => {
  it("writes the hectares of each register, and leaves a register not read empty", () => {
    const csv = fieldTableCsv([fieldRow("field 3", null, null, null, report)])
    const [head, row] = csv.trim().split("\n").map((l) => l.split(","))
    const col = (name: string) => row[head.indexOf(name)]
    expect(col("registers_read_at")).toBe("2026-09-26T20:55:00Z")
    expect(col("prodes_2009_2020_ha")).toBe("3")
    expect(col("prodes_2022_on_ha")).toBe("1")
    expect(col("embargo_ibama_ha")).toBe("4")
    expect(col("conservation_unit_ha")).toBe("0")
    expect(col("indigenous_land_ha")).toBe("")
    expect(col("deter_ha")).toBe("")
    expect(col("outside_car_ha")).toBe("4")
    expect(col("registers_not_read")).toBe("Indigenous lands")
  })
})

describe("an overlap run in a run list", () => {
  it("counts the registers it meets, CAR aside, and says when they were read", () => {
    const summary = JSON.stringify({
      overlap_read_at: "2026-09-26T20:55:00Z",
      overlap_ha: { car: 96, prodes: 12, embargo_ibama: 4, conservation: 0 },
      overlap_status: { car: "read", prodes: "read", embargo_ibama: "read", indigenous: "failed" },
    })
    expect(runRowLine({ kind: "overlap", model_kind: "public-registers", period_start: "", period_end: "", summary })).toBe(
      "Socio-environmental overlap · meets 2 registers · 1 not read · read 2026-09-26"
    )
  })
})
