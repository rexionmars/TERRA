/**
 * A mineral map in the compositor: its figures a type of their own that only
 * the Mineral nodes take, the cards a finished run is given, placed once and
 * pointed at the next run rather than added again, and a saved graph read
 * back with each card's setting.
 */
import { describe, expect, it } from "vitest"

import {
  addNode,
  connect,
  createNode,
  EMPTY_GRAPH,
  MINERAL_SOCKET,
  parseGraph,
  withMineralNodes,
  type CompositorGraph,
  type GraphLink,
  type MineralParts,
} from "./compositorGraph"
import { evaluate, socketKey } from "./compositorEval"
import { mineralNodeTitle } from "@/components/studio/mineralNodes"
import type { MineralAnalysis } from "./types"

const runOutputs = (runId: string | null) =>
  runId
    ? [
        { id: "mineral-group2", label: "Minerals 2.0-2.5 um", type: "classes" as const },
        { id: MINERAL_SOCKET, label: "Mineral report", type: "mineral" as const },
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
  for (const k of ["mineralClasses", "viewer", "majority"] as const) {
    g = addNode(g, createNode(k, `${k}-1`), { x: 0, y: 0 })
  }
  return g
}

const ANALYSIS = { observed_cells: 10, groups: [], scenes: [], legend: [], notes: [] } as unknown as MineralAnalysis

describe("a mineral map's figures in the graph", () => {
  it("go only into the Mineral nodes, and no raster goes there", () => {
    const g = graph()
    expect(connect(g, link("run-1", MINERAL_SOCKET, "mineralClasses-1", "report"), runOutputs).ok).toBe(true)
    const intoViewer = connect(g, link("run-1", MINERAL_SOCKET, "viewer-1", "image"), runOutputs)
    expect(intoViewer.ok).toBe(false)
    if (!intoViewer.ok) expect(intoViewer.reason).toMatch(/a mineral map's figures/)
    const rasterIn = connect(g, link("run-1", "mineral-group2", "mineralClasses-1", "report"), runOutputs)
    expect(rasterIn.ok).toBe(false)
    if (!rasterIn.ok) expect(rasterIn.reason).toMatch(/takes a mineral map's figures/)
  })

  it("reach a card as the run reported them", () => {
    const r = connect(graph(), link("run-1", MINERAL_SOCKET, "mineralClasses-1", "report"), runOutputs)
    if (!r.ok) throw new Error(r.reason)
    const e = evaluate(r.graph, {
      source: (runId, asset) =>
        asset === MINERAL_SOCKET
          ? { status: "ready", value: { type: "mineral", key: `mineral:${runId}`, runId, analysis: ANALYSIS } }
          : { status: "busy" },
      cache: new Map(),
    })
    const got = e.inputs.get(socketKey("mineralClasses-1", "report"))
    expect(got?.status).toBe("ready")
    if (got?.status === "ready") expect(got.value.type === "mineral" && got.value.analysis).toBe(ANALYSIS)
  })
})

describe("withMineralNodes", () => {
  const PARTS: MineralParts = { cover: false, bands: ["fe3"], acid: true, agreement: [1] }

  it("places the cards the run has figures for, each fed from one Run node's report", () => {
    const g = withMineralNodes(EMPTY_GRAPH, "r1", PARTS)
    const kinds = g.nodes.map((n) => n.kind)
    expect(kinds.filter((k) => k === "run")).toHaveLength(1)
    expect(kinds).toContain("mineralCoverage")
    expect(kinds).toContain("mineralPasses")
    expect(kinds).toContain("mineralConfidence")
    expect(kinds).toContain("mineralAcid")
    expect(kinds).toContain("mineralSave")
    expect(kinds).not.toContain("mineralCover")
    const classes = g.nodes.filter((n) => n.kind === "mineralClasses").map((n) => n.kind === "mineralClasses" && n.group)
    expect(classes.sort()).toEqual([1, 2])
    const agreement = g.nodes.filter((n) => n.kind === "mineralAgreement")
    expect(agreement).toHaveLength(1)
    expect(agreement[0].kind === "mineralAgreement" && agreement[0].group).toBe(1)
    const cards = g.nodes.filter((n) => n.kind !== "run")
    expect(g.links).toHaveLength(cards.length)
    expect(g.links.every((l) => l.fromSocket === MINERAL_SOCKET && l.toSocket === "report")).toBe(true)
    // No two cards stand on one place.
    const places = cards.map((n) => `${g.places[n.id].x},${g.places[n.id].y}`)
    expect(new Set(places).size).toBe(places.length)
  })

  it("points the same cards at the next run rather than adding a second set", () => {
    const first = withMineralNodes(EMPTY_GRAPH, "r1", PARTS)
    const second = withMineralNodes(first, "r2", PARTS)
    expect(second.nodes).toHaveLength(first.nodes.length)
    expect(second.nodes.find((n) => n.kind === "run")).toMatchObject({ runId: "r2" })
    expect(withMineralNodes(second, "r2", PARTS)).toBe(second)
  })

  it("reads back from a saved board with each card's setting", () => {
    const g = withMineralNodes(EMPTY_GRAPH, "r1", PARTS)
    expect(parseGraph(JSON.parse(JSON.stringify(g)))).toEqual(g)
    const odd = parseGraph({
      nodes: [
        { id: "a", kind: "mineralClasses", group: 7 },
        { id: "b", kind: "mineralPositions", band: "x" },
        { id: "c", kind: "mineralPositions", band: "aloh" },
      ],
    })
    expect(odd?.nodes).toEqual([
      { id: "a", kind: "mineralClasses", group: 2 },
      { id: "b", kind: "mineralPositions", band: "fe3" },
      { id: "c", kind: "mineralPositions", band: "aloh" },
    ])
  })

  it("names a card by its setting", () => {
    expect(mineralNodeTitle({ id: "a", kind: "mineralClasses", group: 1 })).toBe("Classes, 0.4-1.3 um")
    expect(mineralNodeTitle({ id: "b", kind: "mineralPositions", band: "aloh" })).toBe("Al-OH band position")
    expect(mineralNodeTitle({ id: "c", kind: "mineralCoverage" })).toBeNull()
  })
})
