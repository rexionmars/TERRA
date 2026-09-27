import { describe, expect, it } from "vitest"

import type { Area } from "@/lib/areas"
import { NO_CLASS } from "@/lib/classMask"
import { parseGraph, type CompositorGraph } from "@/lib/compositorGraph"
import { sumClassAreas, type ClassValue } from "@/lib/compositorEval"
import { fieldSets, perField, resolveEach } from "@/lib/fieldSets"

const square = {
  type: "Polygon",
  coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
} as Area["geometry"]

function area(id: string, name: string, parent = ""): Area {
  return { id, name, geometry: square, created_at: "", notes: "", run_count: 0, parent_id: parent, source_run_id: "" }
}

const areas = [
  area("aoi", "Oeste"),
  area("f10", "field 10", "aoi"),
  area("f2", "field 2", "aoi"),
  area("f3", "field 3", "aoi"),
  area("other", "Leste"),
]

const runs = [
  { id: "c2-old", created_at: "2026-09-24T10:00:00Z", area_id: "f2", kind: "classification" },
  { id: "c2", created_at: "2026-09-25T10:00:00Z", area_id: "f2", kind: "classification" },
  { id: "c10", created_at: "2026-09-25T10:00:00Z", area_id: "f10", kind: "" },
  { id: "w2", created_at: "2026-09-25T11:00:00Z", area_id: "f2", kind: "water" },
  // Over the area itself, not a field: in no set.
  { id: "aoi-run", created_at: "2026-09-25T09:00:00Z", area_id: "aoi", kind: "classification" },
]

describe("field sets", () => {
  it("takes the latest run of each product on each field, fields in name order", () => {
    const sets = fieldSets(areas, runs)
    expect(sets.map((s) => [s.areaName, s.runKind, s.members.map((m) => m.runId)])).toEqual([
      ["Oeste", "classification", ["c2", "c10"]],
      ["Oeste", "water", ["w2"]],
    ])
  })
})

function graphWith(each: { areaId: string; runKind: string; fieldId: string | null }, runId: string | null): CompositorGraph {
  return {
    nodes: [
      { id: "run", kind: "run", runId, each },
      { id: "globe", kind: "globe", opacity: 1 },
    ],
    links: [{ from: "run", fromSocket: "prediction", to: "globe", toSocket: "layer1" }],
    places: {},
    viewer: null,
  }
}

describe("a Run node over a field set", () => {
  const sets = fieldSets(areas, runs)

  it("points at the run of the field in focus, or the first field", () => {
    const run = (g: CompositorGraph) => g.nodes[0].kind === "run" && g.nodes[0].runId
    expect(run(resolveEach(graphWith({ areaId: "aoi", runKind: "classification", fieldId: "f10" }, null), sets))).toBe("c10")
    expect(run(resolveEach(graphWith({ areaId: "aoi", runKind: "classification", fieldId: "gone" }, null), sets))).toBe("c2")
    expect(run(resolveEach(graphWith({ areaId: "nowhere", runKind: "classification", fieldId: null }, "x"), sets))).toBe(null)
  })

  it("is evaluated once per field, a set of the same area following the same field", () => {
    const g = graphWith({ areaId: "aoi", runKind: "classification", fieldId: "f2" }, "c2")
    g.nodes.push({ id: "water", kind: "run", runId: "w2", each: { areaId: "aoi", runKind: "water", fieldId: "f2" } })
    const copies = perField(g, sets)!
    expect(copies.map((c) => c.member.fieldName)).toEqual(["field 2", "field 10"])
    const runIds = copies.map((c) => c.graph.nodes.flatMap((n) => (n.kind === "run" ? [n.runId] : [])))
    // field 10 has no water run: the water node reads nothing there.
    expect(runIds).toEqual([["c2", "w2"], ["c10", null]])
  })

  it("covers every field any set of the area has, whichever set comes first", () => {
    // The water set (field 2 only) first, the classification set (fields 2 and 10) second.
    const g = graphWith({ areaId: "aoi", runKind: "water", fieldId: "f2" }, "w2")
    g.nodes.push({ id: "class", kind: "run", runId: "c2", each: { areaId: "aoi", runKind: "classification", fieldId: "f2" } })
    const copies = perField(g, sets)!
    expect(copies.map((c) => c.member.fieldName)).toEqual(["field 2", "field 10"])
    const runIds = copies.map((c) => c.graph.nodes.flatMap((n) => (n.kind === "run" ? [n.runId] : [])))
    expect(runIds).toEqual([["w2", "c2"], [null, "c10"]])
  })

  it("is no set at all without a set node", () => {
    const g = graphWith({ areaId: "aoi", runKind: "classification", fieldId: null }, "c2")
    g.nodes[0] = { id: "run", kind: "run", runId: "c2" }
    expect(perField(g, sets)).toBeNull()
  })

  it("survives a save and a reopen", () => {
    const g = graphWith({ areaId: "aoi", runKind: "water", fieldId: "f2" }, "w2")
    const back = parseGraph(JSON.parse(JSON.stringify(g)))!
    expect(back.nodes[0]).toEqual(g.nodes[0])
    const plain = parseGraph(JSON.parse(JSON.stringify({ ...g, nodes: [{ id: "run", kind: "run", runId: "c2", each: { areaId: 3 } }] })))!
    expect(plain.nodes[0]).toEqual({ id: "run", kind: "run", runId: "c2" })
  })
})

function classes(index: number[], legend: { id: number; name: string; color: string }[], pixelAreaHa: number | null): ClassValue {
  return {
    type: "classes",
    key: `c:${index.join(",")}:${pixelAreaHa}`,
    grid: { width: index.length, height: 1, index: Uint8Array.from(index) },
    info: { legend, excluded: [], pixelAreaHa, areaIsMean: false },
    extent: null,
  }
}

describe("class areas summed over fields", () => {
  const soy = { id: 1, name: "Soybean", color: "#E974ED" }
  const forest = { id: 3, name: "Forest Formation", color: "#1f8d49" }

  it("meets classes by name and colour, whatever their place in each legend", () => {
    const a = classes([0, 0, 1], [soy, forest], 0.01)
    const b = classes([0, 1, 1, NO_CLASS], [forest, soy], 0.02)
    const { rows, total, unit } = sumClassAreas([a, b])
    expect(unit).toBe("ha")
    expect(rows.map((r) => [r.entry.name, Number(r.amount.toFixed(4))])).toEqual([
      ["Soybean", 0.06],
      ["Forest Formation", 0.03],
    ])
    expect(Number(total.toFixed(4))).toBe(0.09)
  })

  it("counts pixels where any map has no cell area", () => {
    const { unit, total } = sumClassAreas([classes([0], [soy], 0.01), classes([0, 0], [soy], null)])
    expect(unit).toBe("px")
    expect(total).toBe(3)
  })
})
