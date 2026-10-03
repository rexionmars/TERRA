/**
 * What a legal link is -- one per input, never into a node's own ancestry,
 * never an image into an input that needs classes -- and a saved graph read
 * back under the same rules.
 */
import { describe, expect, it } from "vitest"

import {
  addNode,
  connect,
  createNode,
  defaultGraph,
  disconnect,
  EMPTY_GRAPH,
  inputsOf,
  linkInto,
  nodeOf,
  outputType,
  parseGraph,
  PDF_REPORT_MAX_MAPS,
  pdfReportMaps,
  removeNode,
  SIEVE_MIN,
  type CompositorGraph,
  type GraphLink,
  type NodeKind,
} from "./compositorGraph"

const AT = { x: 0, y: 0 }

/** A run that produced one class map and one image. */
const runOutputs = (runId: string | null) =>
  runId
    ? [
        { id: "prediction", label: "Classification", type: "classes" as const },
        { id: "ndvi", label: "NDVI mean", type: "image" as const },
      ]
    : []

function graphOf(...kinds: NodeKind[]): CompositorGraph {
  let g = EMPTY_GRAPH
  for (const k of kinds) {
    const node = createNode(k, `${k}-1`)
    g = addNode(g, node.kind === "run" ? { ...node, runId: "r" } : node, AT)
  }
  return g
}

const link = (from: string, fromSocket: string, to: string, toSocket: string): GraphLink => ({
  from,
  fromSocket,
  to,
  toSocket,
})

describe("connect", () => {
  it("links an output to an input and replaces what fed that input", () => {
    let g = graphOf("run", "majority", "sieve")
    const a = connect(g, link("run-1", "prediction", "sieve-1", "classes"), runOutputs)
    expect(a.ok).toBe(true)
    if (!a.ok) return
    g = a.graph
    const b = connect(g, link("majority-1", "classes", "sieve-1", "classes"), runOutputs)
    expect(b.ok).toBe(true)
    if (!b.ok) return
    expect(linkInto(b.graph, "sieve-1", "classes")?.from).toBe("majority-1")
    expect(b.graph.links.filter((l) => l.to === "sieve-1")).toHaveLength(1)
  })

  it("refuses an image into an input that needs classes, and takes it where any raster goes", () => {
    const g = graphOf("run", "majority", "viewer")
    const bad = connect(g, link("run-1", "ndvi", "majority-1", "classes"), runOutputs)
    expect(bad.ok).toBe(false)
    expect(connect(g, link("run-1", "ndvi", "viewer-1", "image"), runOutputs).ok).toBe(true)
  })

  it("refuses a link that would close a loop", () => {
    let g = graphOf("run", "majority", "sieve")
    for (const l of [
      link("run-1", "prediction", "majority-1", "classes"),
      link("majority-1", "classes", "sieve-1", "classes"),
    ]) {
      const r = connect(g, l, runOutputs)
      if (r.ok) g = r.graph
    }
    expect(connect(g, link("sieve-1", "classes", "majority-1", "classes"), runOutputs).ok).toBe(false)
  })

  it("lets a Viewer's output feed a Globe, and a class input when a class map reaches it", () => {
    let g = graphOf("run", "viewer", "globe", "majority")
    const r = connect(g, link("run-1", "prediction", "viewer-1", "image"), runOutputs)
    if (r.ok) g = r.graph
    expect(connect(g, link("viewer-1", "image", "globe-1", "layer-1"), runOutputs).ok).toBe(true)
    expect(outputType(g, "viewer-1", "image", runOutputs)).toBe("classes")
    expect(connect(g, link("viewer-1", "image", "majority-1", "classes"), runOutputs).ok).toBe(true)
  })

  it("gives a Globe one more layer than it has links, and keeps them in order", () => {
    let g = graphOf("run", "globe")
    const layers = () => inputsOf(g, nodeOf(g, "globe-1")!).map((i) => `${i.id}=${i.label}`)
    expect(layers()).toEqual(["layer-1=Layer 1"])
    for (const [out, socket] of [
      ["prediction", "layer-1"],
      ["ndvi", "layer-2"],
    ] as const) {
      const r = connect(g, link("run-1", out, "globe-1", socket), runOutputs)
      if (r.ok) g = r.graph
    }
    expect(layers()).toEqual(["layer-1=Layer 1", "layer-2=Layer 2", "layer-3=Layer 3"])
    // Unlinking the first keeps the second's id and relabels it by position.
    g = disconnect(g, "globe-1", "layer-1")
    expect(layers()).toEqual(["layer-2=Layer 1", "layer-3=Layer 2"])
    expect(connect(g, link("run-1", "ndvi", "globe-1", "image"), runOutputs).ok).toBe(false)
  })

  it("gives a PDF report one more map than it has links, up to its limit", () => {
    let g = graphOf("run", "pdfReport")
    const report = () => nodeOf(g, "pdfReport-1")!
    const maps = () => inputsOf(g, report()).filter((i) => i.id.startsWith("map-")).map((i) => `${i.id}=${i.label}`)
    expect(maps()).toEqual(["map-1=Map 1"])
    // The product inputs stay where they are declared, ahead of the maps.
    expect(inputsOf(g, report())[0].id).toBe("classes")
    for (let n = 1; n <= PDF_REPORT_MAX_MAPS; n++) {
      const r = connect(g, link("run-1", n % 2 ? "prediction" : "ndvi", "pdfReport-1", `map-${n}`), runOutputs)
      expect(r.ok).toBe(true)
      if (r.ok) g = r.graph
    }
    expect(pdfReportMaps(g, report())).toHaveLength(PDF_REPORT_MAX_MAPS)
    // Full: no empty map is offered, and one past the limit is refused with its reason.
    expect(maps()).toHaveLength(PDF_REPORT_MAX_MAPS)
    const over = connect(g, link("run-1", "ndvi", "pdfReport-1", `map-${PDF_REPORT_MAX_MAPS + 1}`), runOutputs)
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.reason).toContain(`at most ${PDF_REPORT_MAX_MAPS} maps`)
    g = disconnect(g, "pdfReport-1", "map-1")
    expect(maps()[0]).toBe("map-2=Map 1")
    expect(maps()).toHaveLength(PDF_REPORT_MAX_MAPS)
  })

  it("reads a stored PDF report's two fixed maps as the first two numbered ones", () => {
    const stored = {
      nodes: [
        { id: "run-1", kind: "run", runId: "r1" },
        { id: "pdfReport-1", kind: "pdfReport", settings: { title: "T" } },
      ],
      links: [
        { from: "run-1", fromSocket: "prediction", to: "pdfReport-1", toSocket: "map1" },
        { from: "run-1", fromSocket: "ndvi", to: "pdfReport-1", toSocket: "map2" },
      ],
      places: {},
      viewer: null,
    }
    const g = parseGraph(stored)!
    expect(g.links.map((l) => l.toSocket)).toEqual(["map-1", "map-2"])
    const node = nodeOf(g, "pdfReport-1")!
    expect(node.kind === "pdfReport" && node.settings.title).toBe("T")
    expect(node.kind === "pdfReport" && node.settings.revision).toBe("A")
  })

  it("gives a Mask the type of what reaches its raster input", () => {
    let g = graphOf("run", "mask", "majority")
    expect(outputType(g, "mask-1", "raster", runOutputs)).toBeNull()
    const r = connect(g, link("run-1", "ndvi", "mask-1", "raster"), runOutputs)
    if (r.ok) g = r.graph
    expect(outputType(g, "mask-1", "raster", runOutputs)).toBe("image")
    expect(connect(g, link("mask-1", "raster", "majority-1", "classes"), runOutputs).ok).toBe(false)
  })
})

describe("editing", () => {
  it("drops the links on both sides of a removed node, and hands Ctrl+Shift+click to another Viewer", () => {
    let g = defaultGraph("r", "prediction")
    g = addNode(g, createNode("viewer", "viewer-2"), AT)
    expect(g.viewer).toBe("viewer-1")
    g = removeNode(g, "viewer-1")
    expect(g.viewer).toBe("viewer-2")
    g = removeNode(g, "majority-1")
    expect(g.links.some((l) => l.from === "majority-1" || l.to === "majority-1")).toBe(false)
  })

  it("disconnects one input and leaves the others", () => {
    const g = disconnect(defaultGraph("r", "prediction"), "change-1", "after")
    expect(linkInto(g, "change-1", "after")).toBeUndefined()
    expect(linkInto(g, "change-1", "before")).toBeDefined()
  })
})

describe("parseGraph", () => {
  it("reads back what the default graph writes", () => {
    const g = defaultGraph("run-9", "prediction")
    expect(parseGraph(JSON.parse(JSON.stringify(g)))).toEqual(g)
  })

  it("drops what it cannot read and keeps one link per input", () => {
    const g = parseGraph({
      nodes: [
        { id: "run-1", kind: "run", runId: "r" },
        { id: "sieve-1", kind: "sieve", minPixels: -5, connectivity: 6 },
        { id: "x", kind: "unknown" },
        { id: "mix-1", kind: "mix", opacity: 4 },
        { id: "globe-1", kind: "globe", opacity: "x" },
      ],
      links: [
        { from: "run-1", fromSocket: "anything", to: "sieve-1", toSocket: "classes" },
        { from: "mix-1", fromSocket: "image", to: "sieve-1", toSocket: "classes" },
        { from: "x", fromSocket: "classes", to: "mix-1", toSocket: "base" },
        { from: "sieve-1", fromSocket: "classes", to: "mix-1", toSocket: "nowhere" },
      ],
      places: { "run-1": { x: 3, y: "4" }, "sieve-1": { x: 1, y: 2 } },
      viewer: "sieve-1",
    })
    expect(g?.nodes.map((n) => n.id)).toEqual(["run-1", "sieve-1", "mix-1", "globe-1"])
    expect(g?.nodes[3]).toEqual({ id: "globe-1", kind: "globe", opacity: 0.85 })
    expect(g?.nodes[1]).toEqual({ id: "sieve-1", kind: "sieve", minPixels: SIEVE_MIN, connectivity: 8 })
    expect(g?.nodes[2]).toEqual({ id: "mix-1", kind: "mix", opacity: 1 })
    expect(g?.links).toEqual([link("run-1", "anything", "sieve-1", "classes")])
    expect(g?.places).toEqual({ "sieve-1": { x: 1, y: 2 } })
    expect(g?.viewer).toBeNull()
  })

  it("reads a Globe's single image input as its first layer", () => {
    const g = parseGraph({
      nodes: [
        { id: "run-1", kind: "run", runId: "r" },
        { id: "globe-1", kind: "globe", opacity: 0.5 },
      ],
      links: [{ from: "run-1", fromSocket: "prediction", to: "globe-1", toSocket: "image" }],
    })
    expect(g?.links).toEqual([link("run-1", "prediction", "globe-1", "layer-1")])
  })

  it("answers null for a board saved before the compositor existed", () => {
    expect(parseGraph(undefined)).toBeNull()
    expect(parseGraph("text")).toBeNull()
  })
})
