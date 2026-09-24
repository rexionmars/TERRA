/**
 * What reaches each socket: the filters through a graph, the type rule on an
 * input, the mask and the mix placed by extent, and the two readings.
 */
import { describe, expect, it } from "vitest"

import { NO_CLASS } from "./classMask"
import {
  addNode,
  connect,
  createNode,
  EMPTY_GRAPH,
  type CompositorGraph,
  type GraphLink,
  type GraphNode,
} from "./compositorGraph"
import {
  classAreas,
  classChange,
  evaluate,
  over,
  resampleMap,
  socketKey,
  type ClassValue,
  type ImageValue,
  type RasterValue,
  type Result,
} from "./compositorEval"

const EXTENT = { lon_min: 0, lat_min: 0, lon_max: 4, lat_max: 2 }

function classes(rows: string[], extent = EXTENT): ClassValue {
  const height = rows.length
  const width = rows[0].length
  const index = new Uint8Array(width * height)
  rows.forEach((r, y) => {
    for (let x = 0; x < width; x++) index[y * width + x] = r[x] === "." ? NO_CLASS : r.charCodeAt(x) - 97
  })
  return {
    type: "classes",
    key: `c:${rows.join("/")}`,
    grid: { width, height, index },
    info: {
      legend: [
        { id: 10, name: "Pasture", color: "#ff0000" },
        { id: 20, name: "Soybean", color: "#00ff00" },
        { id: 30, name: "Forest", color: "#0000ff" },
      ],
      excluded: [],
      pixelAreaHa: 0.01,
      areaIsMean: false,
    },
    extent,
  }
}

function image(width: number, height: number, rgba: number[], extent = EXTENT): ImageValue {
  return { type: "image", key: `i:${rgba.join(",")}`, width, height, rgba: Uint8ClampedArray.from(rgba), extent }
}

/** A graph built node by node, with each link checked as the editor checks it. */
function build(nodes: GraphNode[], links: GraphLink[], sources: Record<string, RasterValue>) {
  let g: CompositorGraph = EMPTY_GRAPH
  for (const n of nodes) g = addNode(g, n, { x: 0, y: 0 })
  const runOutputs = () =>
    Object.entries(sources).map(([id, v]) => ({ id, label: id, type: v.type }))
  for (const l of links) {
    const r = connect(g, l, runOutputs)
    if (!r.ok) throw new Error(r.reason)
    g = r.graph
  }
  const cache = new Map<string, RasterValue>()
  const source = (_run: string, asset: string): Result =>
    sources[asset] ? { status: "ready", value: sources[asset] } : { status: "none", note: "gone" }
  return { g, cache, run: () => evaluate(g, { source, cache }) }
}

const L = (from: string, fromSocket: string, to: string, toSocket: string): GraphLink => ({
  from,
  fromSocket,
  to,
  toSocket,
})

function ready(r: Result | undefined): RasterValue {
  if (r?.status !== "ready") throw new Error(`not ready: ${JSON.stringify(r)}`)
  if (r.value.type === "fields") throw new Error("a raster was expected, not fields")
  return r.value
}

describe("evaluate", () => {
  it("runs a class map through filters and reuses what it already computed", () => {
    const { run, cache } = build(
      [{ id: "run-1", kind: "run", runId: "r" }, { ...createNode("majority", "majority-1") }],
      [L("run-1", "cls", "majority-1", "classes")],
      { cls: classes(["aaaaa", "aaaaa", "aabaa", "aaaaa", "aaaaa"]) }
    )
    const first = ready(run().outputs.get(socketKey("majority-1", "classes"))) as ClassValue
    expect([...first.grid.index].every((v) => v === 0)).toBe(true)
    const second = ready(run().outputs.get(socketKey("majority-1", "classes")))
    expect(second).toBe(first)
    expect(cache.size).toBe(1)
  })

  it("reports an image reaching an input that needs classes, even when the link predates the rule", () => {
    const { g, cache } = build([{ id: "run-1", kind: "run", runId: "r" }, createNode("sieve", "sieve-1")], [], {})
    const linked: CompositorGraph = { ...g, links: [L("run-1", "img", "sieve-1", "classes")] }
    const e = evaluate(linked, {
      source: () => ({ status: "ready", value: image(1, 1, [0, 0, 0, 255]) }),
      cache,
    })
    expect(e.inputs.get(socketKey("sieve-1", "classes"))?.status).toBe("failed")
  })

  it("keeps only the chosen classes", () => {
    const { run } = build(
      [{ id: "run-1", kind: "run", runId: "r" }, { id: "select-1", kind: "select", keep: [20] }],
      [L("run-1", "cls", "select-1", "classes")],
      { cls: classes(["abca"]) }
    )
    const v = ready(run().outputs.get(socketKey("select-1", "classes"))) as ClassValue
    expect([...v.grid.index]).toEqual([NO_CLASS, 1, NO_CLASS, NO_CLASS])
  })

  it("masks an image by a class map on a different grid, placed by extent", () => {
    // The mask covers the image's west half only: its extent is half as wide.
    const mask = classes(["a"], { lon_min: 0, lat_min: 0, lon_max: 2, lat_max: 2 })
    const img = image(4, 1, Array(16).fill(200))
    const { run } = build(
      [{ id: "run-1", kind: "run", runId: "r" }, createNode("mask", "mask-1")],
      [L("run-1", "img", "mask-1", "raster"), L("run-1", "mask", "mask-1", "mask")],
      { img, mask }
    )
    const v = ready(run().outputs.get(socketKey("mask-1", "raster"))) as ImageValue
    expect([v.rgba[3], v.rgba[7], v.rgba[11], v.rgba[15]]).toEqual([200, 200, 0, 0])
  })

  it("lays an overlay over a base with the given opacity", () => {
    const base = image(1, 1, [0, 0, 0, 255])
    const top = image(1, 1, [200, 100, 0, 255])
    const { run } = build(
      [{ id: "run-1", kind: "run", runId: "r" }, { id: "mix-1", kind: "mix", opacity: 0.5 }],
      [L("run-1", "base", "mix-1", "base"), L("run-1", "top", "mix-1", "overlay")],
      { base, top }
    )
    const v = ready(run().outputs.get(socketKey("mix-1", "image"))) as ImageValue
    expect([...v.rgba]).toEqual([100, 50, 0, 255])
  })

  it("passes a Viewer's input through its output, unchanged, to a Globe", () => {
    const cls = classes(["ab"])
    const { run } = build(
      [{ id: "run-1", kind: "run", runId: "r" }, createNode("viewer", "viewer-1"), createNode("globe", "globe-1")],
      [L("run-1", "cls", "viewer-1", "image"), L("viewer-1", "image", "globe-1", "layer-1")],
      { cls }
    )
    const e = run()
    expect(ready(e.outputs.get(socketKey("viewer-1", "image")))).toBe(cls)
    expect(ready(e.inputs.get(socketKey("globe-1", "layer-1")))).toBe(cls)
  })

  it("evaluates a node's own output even where nothing reads it", () => {
    const { run } = build(
      [{ id: "run-1", kind: "run", runId: "r" }, createNode("sieve", "sieve-1")],
      [L("run-1", "cls", "sieve-1", "classes")],
      { cls: classes(["ab"]) }
    )
    expect(run().outputs.get(socketKey("sieve-1", "classes"))?.status).toBe("ready")
  })
})

describe("resampleMap and over", () => {
  it("is the identity for one grid, and places a smaller extent inside a larger", () => {
    expect(resampleMap({ width: 2, height: 2, extent: EXTENT }, { width: 2, height: 2, extent: EXTENT })).toBeNull()
    const m = resampleMap(
      { width: 1, height: 1, extent: { lon_min: 2, lat_min: 0, lon_max: 4, lat_max: 2 } },
      { width: 4, height: 1, extent: EXTENT }
    )
    expect(m && typeof m !== "string" ? [...m] : m).toEqual([-1, -1, 0, 0])
  })

  it("leaves the base where the overlay is transparent", () => {
    const out = over(Uint8ClampedArray.from([10, 20, 30, 255]), Uint8ClampedArray.from([255, 255, 255, 0]), 1)
    expect([...out]).toEqual([10, 20, 30, 255])
  })
})

describe("readings", () => {
  it("counts each class present, largest first", () => {
    const { rows, total } = classAreas(classes(["aab.", "bbc."]))
    expect(rows.map((r) => [r.entry.name, r.px])).toEqual([
      ["Soybean", 3],
      ["Pasture", 2],
      ["Forest", 1],
    ])
    expect(total).toBe(6)
  })

  it("compares two maps class by class, by legend id", () => {
    const before = classes(["aab.", "bbc."])
    const after = classes(["abb.", "bbb."])
    const c = classChange(before, after)
    if (!c.comparable) throw new Error(c.note)
    expect(c.shared).toBe(6)
    expect(c.changed).toBe(2)
    expect(c.rows.find((r) => r.name === "Soybean")).toMatchObject({ before: 3, after: 5 })
    expect(c.moves.map((m) => [m.from.name, m.to.name, m.px])).toEqual([
      ["Pasture", "Soybean", 1],
      ["Forest", "Soybean", 1],
    ])
  })

  it("refuses two maps of different grids", () => {
    expect(classChange(classes(["ab"]), classes(["a"])).comparable).toBe(false)
  })
})
