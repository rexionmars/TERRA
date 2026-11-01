/**
 * That every wire leaves from an output row and lands on an input row of its
 * own, at a place that can be computed without measuring anything.
 *
 * THE DEFECT THE SOCKETS FOLLOW was one port per card: every wire arriving at
 * the run node arrived at the same point, and which wire ended where could not
 * be read. The ribbons that repaired it spread the fan down the card; the rows
 * that replaced the ribbons give each wire a row with its name on it, as
 * Solara's and Blender's node editors do. What is asserted here is that the
 * rows are the edges, in the caller's order, and that a socket's height
 * follows from the rows above it.
 */
import { describe, expect, it } from "vitest"

import {
  BODY_PAD,
  HEAD_H,
  ROW_H,
  inputY,
  nodeRows,
  outputY,
  type CanvasEdge,
  type CanvasNode,
} from "./NodeCanvas"
import { defaultPlaces, runGraph } from "./runGraph"

const node = (id: string, extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id,
  place: { x: 0, y: 0 },
  h: 74,
  header: null,
  children: null,
  ...extra,
})

describe("nodeRows", () => {
  it("gives a source an output row and the target an input row per wire, in order", () => {
    const nodes = [node("area"), node("period"), node("run")]
    const edges: CanvasEdge[] = [
      { from: "area", to: "run", name: "Area", note: "not set", state: "missing" },
      { from: "period", to: "run", name: "Period", label: "366 d", note: "pending", state: "pending" },
    ]
    const rows = nodeRows(nodes, edges)

    expect(rows.get("period")!.output?.label).toBe("366 d")
    expect(rows.get("area")!.output?.label).toBe("")
    expect(rows.get("run")!.output).toBeUndefined()
    expect(rows.get("run")!.inputs.map((r) => [r.label, r.note, r.hollow])).toEqual([
      ["Area", "not set", true],
      ["Period", "pending", false],
    ])
  })

  it("writes the value any of a node's wires carries, when the first carries none", () => {
    // A gate first, then the wire into the run: the model's value is the run's.
    const nodes = [node("model"), node("mode"), node("run")]
    const edges: CanvasEdge[] = [
      { from: "model", to: "mode", name: "Model" },
      { from: "model", to: "run", name: "Model", label: "Random Forest" },
    ]
    expect(nodeRows(nodes, edges).get("model")!.output?.label).toBe("Random Forest")
  })

  it("draws no rows on a node no wire touches, and an output on one the reader can pull from", () => {
    const rows = nodeRows([node("lonely"), node("catalogue", { connectable: true })], [])
    expect(rows.get("lonely")).toEqual({ inputs: [] })
    expect(rows.get("catalogue")!.output).toBeDefined()
  })

  it("colours a wire's sockets by the node it leaves, unless the wire says otherwise", () => {
    const nodes = [
      node("area", { subject: { band: "var(--b-source-head)", ink: "x", head: "y" } }),
      node("run"),
    ]
    const plain = nodeRows(nodes, [{ from: "area", to: "run" }])
    expect(plain.get("run")!.inputs[0].colour).toBe("var(--b-source-head)")
    const painted = nodeRows(nodes, [{ from: "area", to: "run", paint: "red" }])
    expect(painted.get("run")!.inputs[0].colour).toBe("red")
  })
})

describe("socket heights", () => {
  const at = { x: 0, y: 100 }

  it("puts the output on the first row, under the header", () => {
    expect(outputY(at, false)).toBe(100 + HEAD_H + BODY_PAD + ROW_H / 2)
  })

  it("puts each input on its own row, under the output row when there is one", () => {
    expect(inputY(at, 0, false, false)).toBe(100 + HEAD_H + BODY_PAD + ROW_H / 2)
    expect(inputY(at, 1, true, false)).toBe(100 + HEAD_H + BODY_PAD + ROW_H * 2 + ROW_H / 2)
  })

  it("brings every socket of a folded node to the middle of its header", () => {
    expect(outputY(at, true)).toBe(100 + HEAD_H / 2)
    expect(inputY(at, 3, true, true)).toBe(100 + HEAD_H / 2)
  })
})

describe("the classification graph", () => {
  it("gives the run one input row per part, and the mode node a row on each side", () => {
    const graph = runGraph("classify", null)!
    const places = defaultPlaces(graph, {})
    const nodes = graph.nodes.map((n) => node(n.id, { place: places[n.id], h: n.h }))
    const edges: CanvasEdge[] = graph.edges.map(([from, to]) => ({ from, to, name: from }))
    const rows = nodeRows(nodes, edges)

    const intoRun = graph.edges.filter(([, to]) => to === "run").map(([from]) => from)
    expect(rows.get("run")!.inputs.map((r) => r.from)).toEqual(intoRun)
    expect(rows.get("mode")!.output).toBeDefined()
    expect(rows.get("mode")!.inputs.map((r) => r.from)).toEqual(["model"])
  })
})
