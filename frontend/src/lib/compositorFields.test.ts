/**
 * Fields in the compositor: a type of their own that no raster input takes, a
 * filter whose thresholds compose, and a delineation's nodes placed once and
 * pointed at the next delineation rather than added again.
 */
import { describe, expect, it } from "vitest"

import {
  addNode,
  connect,
  createNode,
  EMPTY_GRAPH,
  FIELDS_SOCKET,
  parseGraph,
  withFieldNodes,
  type CompositorGraph,
  type GraphLink,
} from "./compositorGraph"
import { evaluate, filterFields, socketKey, type FieldsValue } from "./compositorEval"
import type { Field } from "./fields"

const square = { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] }
const field = (n: number, ha: number, share?: number | null): Field => ({
  properties: { field: n, area_ha: ha, perimeter_m: 100, mean_interior_prob: 0.9, cropland_share: share },
  geometry: square,
})
const FIELDS: Field[] = [field(1, 80, 0.1), field(2, 12, 0.9), field(3, 0.4, 0.95), field(4, 3, null)]

const runOutputs = (runId: string | null) =>
  runId
    ? [
        { id: "fields-classes", label: "Field boundaries", type: "image" as const },
        { id: FIELDS_SOCKET, label: "Fields", type: "fields" as const },
      ]
    : []

const link = (from: string, fromSocket: string, to: string, toSocket: string): GraphLink => ({
  from,
  fromSocket,
  to,
  toSocket,
})

function graph(): CompositorGraph {
  let g = EMPTY_GRAPH
  g = addNode(g, { id: "run-1", kind: "run", runId: "r" }, { x: 0, y: 0 })
  for (const k of ["fieldFilter", "adoptFields", "viewer", "majority"] as const) {
    g = addNode(g, createNode(k, `${k}-1`), { x: 0, y: 0 })
  }
  return g
}

const source = (runId: string, assetId: string) =>
  assetId === FIELDS_SOCKET
    ? {
        status: "ready" as const,
        value: {
          type: "fields" as const,
          key: `fields:${runId}`,
          runId,
          fields: FIELDS,
          total: FIELDS.length,
          minHa: 0,
          minCropland: 0,
        },
      }
    : { status: "busy" as const }

describe("fields in the graph", () => {
  it("go only where fields are read", () => {
    const g = graph()
    expect(connect(g, link("run-1", FIELDS_SOCKET, "fieldFilter-1", "fields"), runOutputs).ok).toBe(true)
    const intoViewer = connect(g, link("run-1", FIELDS_SOCKET, "viewer-1", "image"), runOutputs)
    expect(intoViewer.ok).toBe(false)
    if (!intoViewer.ok) expect(intoViewer.reason).toMatch(/field polygons/)
    const rasterIntoFilter = connect(g, link("run-1", "fields-classes", "fieldFilter-1", "fields"), runOutputs)
    expect(rasterIntoFilter.ok).toBe(false)
    if (!rasterIntoFilter.ok) expect(rasterIntoFilter.reason).toMatch(/fields a delineation drew/)
  })

  it("are filtered by area and cropland, and a field with no share is kept", () => {
    let g = graph()
    const r = connect(g, link("run-1", FIELDS_SOCKET, "fieldFilter-1", "fields"), runOutputs)
    if (!r.ok) throw new Error(r.reason)
    g = r.graph
    const e = evaluate(g, { source, cache: new Map() })
    const out = e.outputs.get(socketKey("fieldFilter-1", "fields"))
    if (out?.status !== "ready" || out.value.type !== "fields") throw new Error("not ready")
    // Defaults: 0.5 ha, no cropland floor.
    expect(out.value.fields.map((f) => f.properties.field)).toEqual([1, 2, 4])
    expect(out.value.total).toBe(4)
  })

  it("compose filters by the larger threshold of each", () => {
    const v: FieldsValue = {
      type: "fields",
      key: "k",
      runId: "r",
      fields: FIELDS,
      total: 4,
      minHa: 0,
      minCropland: 0,
    }
    const once = filterFields(filterFields(v, 5, 0), 1, 0.5)
    expect(once.minHa).toBe(5)
    expect(once.minCropland).toBe(0.5)
    // Field 4 (3 ha) is under 5 ha; field 1 is 10% cropland.
    expect(once.fields.map((f) => f.properties.field)).toEqual([2])
  })
})

describe("withFieldNodes", () => {
  it("places a delineation's nodes, linked, under what is there", () => {
    const g = withFieldNodes(
      { ...EMPTY_GRAPH, nodes: [{ id: "viewer-1", kind: "viewer" }], places: { "viewer-1": { x: 0, y: 100 } } },
      "run-a",
      "fields-classes"
    )
    const kinds = g.nodes.map((n) => n.kind).sort()
    expect(kinds).toEqual(["adoptFields", "fieldFilter", "run", "saveFields", "viewer", "viewer"])
    const run = g.nodes.find((n) => n.kind === "run")!
    expect(g.links.some((l) => l.from === run.id && l.fromSocket === FIELDS_SOCKET)).toBe(true)
    expect(g.links.some((l) => l.from === run.id && l.fromSocket === "fields-classes")).toBe(true)
    expect(g.places[run.id].y).toBeGreaterThan(100)
  })

  it("points the last delineation's nodes at the next one instead of adding more", () => {
    const first = withFieldNodes(EMPTY_GRAPH, "run-a", "fields-classes")
    const second = withFieldNodes(first, "run-b", "fields-classes")
    expect(second.nodes.length).toBe(first.nodes.length)
    const run = second.nodes.find((n) => n.kind === "run")
    expect(run && run.kind === "run" ? run.runId : null).toBe("run-b")
    expect(withFieldNodes(second, "run-b", "fields-classes")).toBe(second)
  })

  it("survives a save and a reopen", () => {
    const g = withFieldNodes(EMPTY_GRAPH, "run-a", null)
    const back = parseGraph(JSON.parse(JSON.stringify(g)))
    expect(back?.nodes.map((n) => n.kind).sort()).toEqual(["adoptFields", "fieldFilter", "run", "saveFields"])
    expect(back?.links.length).toBe(g.links.length)
    const filter = back?.nodes.find((n) => n.kind === "fieldFilter")
    expect(filter && filter.kind === "fieldFilter" ? filter.minHa : null).toBe(0.5)
  })
})
