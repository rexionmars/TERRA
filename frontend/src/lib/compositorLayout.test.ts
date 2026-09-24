/**
 * Arranging the compositor: every link runs left to right, no two cards
 * overlap, a column too tall is folded, pipelines that share no link stand
 * apart, and the same graph arranges the same way twice.
 */
import { describe, expect, it } from "vitest"

import {
  addNode,
  EMPTY_GRAPH,
  MINERAL_SOCKET,
  withMineralNodes,
  type CompositorGraph,
  type GraphLink,
  type GraphNode,
} from "./compositorGraph"
import { arrange, type Box } from "./compositorLayout"

const SIZE: Record<string, Box> = {
  run: { w: 224, h: 300 },
  viewer: { w: 320, h: 290 },
  globe: { w: 220, h: 130 },
  majority: { w: 208, h: 130 },
  areas: { w: 300, h: 220 },
  change: { w: 330, h: 300 },
}
const size = (n: GraphNode): Box => SIZE[n.kind] ?? { w: 320, h: 250 }

/** The graph of the reader's screenshot: a run through a majority filter to readings and a globe. */
function screenshot(): CompositorGraph {
  let g = withMineralNodes(EMPTY_GRAPH, "r", { cover: false, bands: ["fe3"], acid: true, agreement: [2] })
  // Keep three of the mineral cards, as the reader had.
  const keep = new Set(["run-1", "mineralAgreement-1", "mineralAcid-1", "mineralPositions-1"])
  g = { ...g, nodes: g.nodes.filter((n) => keep.has(n.id)), links: g.links.filter((l) => keep.has(l.to)) }
  for (const [n, at] of [
    [{ id: "majority-1", kind: "majority", size: 3 }, { x: 260, y: 500 }],
    [{ id: "viewer-1", kind: "viewer" }, { x: 100, y: 650 }],
    [{ id: "areas-1", kind: "areas" }, { x: 500, y: 650 }],
    [{ id: "change-1", kind: "change" }, { x: 820, y: 470 }],
    [{ id: "globe-1", kind: "globe", opacity: 0.85 }, { x: 570, y: 1000 }],
  ] as [GraphNode, { x: number; y: number }][]) {
    g = addNode(g, n, at)
  }
  const L = (from: string, fromSocket: string, to: string, toSocket: string): GraphLink => ({ from, fromSocket, to, toSocket })
  return {
    ...g,
    links: [
      ...g.links,
      L("run-1", "mineral-group1", "majority-1", "classes"),
      L("run-1", "mineral-group1", "change-1", "before"),
      L("majority-1", "classes", "change-1", "after"),
      L("majority-1", "classes", "areas-1", "classes"),
      L("majority-1", "classes", "viewer-1", "image"),
      L("viewer-1", "image", "globe-1", "layer-1"),
    ],
  }
}

function overlaps(g: CompositorGraph, places: Record<string, { x: number; y: number }>) {
  const nodes = g.nodes
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = places[nodes[i].id]
      const b = places[nodes[j].id]
      const sa = size(nodes[i])
      const sb = size(nodes[j])
      if (a.x < b.x + sb.w && b.x < a.x + sa.w && a.y < b.y + sb.h && b.y < a.y + sa.h) {
        return `${nodes[i].id} overlaps ${nodes[j].id}`
      }
    }
  }
  return null
}

describe("arrange", () => {
  it("runs every link left to right, with no card over another", () => {
    const g = screenshot()
    const p = arrange(g, size)
    expect(Object.keys(p).sort()).toEqual(g.nodes.map((n) => n.id).sort())
    for (const l of g.links) {
      const from = g.nodes.find((n) => n.id === l.from)!
      expect(p[l.from].x + size(from).w, `${l.from} -> ${l.to}`).toBeLessThan(p[l.to].x)
    }
    expect(overlaps(g, p)).toBeNull()
    // The Run node leads; the Globe, fed through the Viewer, closes.
    const xs = Object.values(p).map((q) => q.x)
    expect(p["run-1"].x).toBe(Math.min(...xs))
    expect(p["globe-1"].x).toBe(Math.max(...xs))
  })

  it("folds a column of a mineral map's cards rather than stacking a tower", () => {
    const g = withMineralNodes(EMPTY_GRAPH, "r", { cover: true, bands: ["fe3", "aloh"], acid: true, agreement: [1, 2] })
    const maxColumnHeight = 1100
    const p = arrange(g, size, { maxColumnHeight })
    expect(overlaps(g, p)).toBeNull()
    const cards = g.nodes.filter((n) => n.kind !== "run")
    const byX = new Map<number, GraphNode[]>()
    for (const n of cards) byX.set(p[n.id].x, [...(byX.get(p[n.id].x) ?? []), n])
    expect(byX.size).toBeGreaterThan(1)
    for (const col of byX.values()) {
      const top = Math.min(...col.map((n) => p[n.id].y))
      const bottom = Math.max(...col.map((n) => p[n.id].y + size(n).h))
      expect(bottom - top).toBeLessThanOrEqual(maxColumnHeight)
    }
  })

  it("stacks pipelines that share no link, the reader's highest first", () => {
    let g = screenshot()
    g = addNode(g, { id: "run-9", kind: "run", runId: "other" }, { x: 0, y: 5000 })
    g = addNode(g, { id: "mineralCoverage-9", kind: "mineralCoverage" }, { x: 400, y: 5000 })
    g = { ...g, links: [...g.links, { from: "run-9", fromSocket: MINERAL_SOCKET, to: "mineralCoverage-9", toSocket: "report" }] }
    const p = arrange(g, size)
    expect(overlaps(g, p)).toBeNull()
    const firstBottom = Math.max(
      ...g.nodes.filter((n) => !n.id.endsWith("-9")).map((n) => p[n.id].y + size(n).h)
    )
    expect(p["run-9"].y).toBeGreaterThan(firstBottom)
  })

  it("starts where the graph stood, and arranges the same graph the same way", () => {
    const g = screenshot()
    const p = arrange(g, size)
    const minX = Math.min(...g.nodes.map((n) => g.places[n.id].x))
    expect(Math.min(...Object.values(p).map((q) => q.x))).toBe(minX)
    expect(arrange({ ...g, places: { ...g.places, ...p } }, size)).toEqual(arrange({ ...g, places: { ...g.places, ...p } }, size))
  })

  it("places a graph with no links in one column", () => {
    let g = EMPTY_GRAPH
    g = addNode(g, { id: "a", kind: "viewer" }, { x: 0, y: 0 })
    g = addNode(g, { id: "b", kind: "viewer" }, { x: 900, y: 40 })
    const p = arrange(g, size)
    expect(overlaps(g, p)).toBeNull()
    expect(arrange(EMPTY_GRAPH, size)).toEqual({})
  })
})
