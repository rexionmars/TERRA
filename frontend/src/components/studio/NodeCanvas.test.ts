/**
 * That every wire meeting a card is met somewhere of its own.
 *
 * THE DEFECT THIS FOLLOWS was one port per card. Both ends of every wire were
 * placed at PORT_Y, so the four wires arriving at the run node arrived at the
 * same point: the fan pinched shut exactly where it had the most to say, and
 * which wire ended where could not be read off the picture at all.
 *
 * THE SECOND DEFECT was the repair's own. The spacing was the card's height
 * divided by the wires landing on it, so a short card narrowed its ribbons and
 * a tall one threw them apart -- the width of a wire came to depend on the
 * contents of the card at its head, which is a quantity nobody meant to
 * encode. The spacing is fixed now and the card is given a floor tall enough
 * to hold its landings, which is what `fanFloor` is for and what is asserted
 * below beside the slots themselves.
 */
import { describe, expect, it } from "vitest"

import { assignSlots, fanFloor, slotKey } from "./NodeCanvas"
import type { CanvasEdge, CanvasNode } from "./NodeCanvas"
import { PORT_Y, defaultPlaces, runGraph } from "./runGraph"

const card = (id: string, x: number, y: number, h: number): CanvasNode => ({
  id,
  place: { x, y },
  h,
  header: null,
  children: null,
})

const fanInto = (target: string, sources: readonly string[]): CanvasEdge[] =>
  sources.map((from) => ({ from, to: target }))

describe("assignSlots", () => {
  it("meets a card with one wire on its header row", () => {
    const nodes = [card("a", 0, 0, 74), card("b", 300, 40, 96)]
    const edges: CanvasEdge[] = [{ from: "a", to: "b" }]
    const slots = assignSlots(nodes, edges)

    expect(slots.get(slotKey("a", "b", "from"))).toBe(PORT_Y)
    expect(slots.get(slotKey("a", "b", "to"))).toBe(40 + PORT_Y)
  })

  it("gives each wire landing on one card a slot of its own", () => {
    const sources = ["one", "two", "three", "four"]
    const nodes = [
      ...sources.map((id, i) => card(id, 0, i * 100, 74)),
      card("run", 300, 0, 110),
    ]
    const edges = fanInto("run", sources)
    const slots = assignSlots(nodes, edges)

    const ys = edges.map((e) => slots.get(slotKey(e.from, e.to, "to"))!)
    expect(new Set(ys).size).toBe(ys.length)
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(PORT_Y)
  })

  it("spaces a fan the same way whatever the card it lands on draws at", () => {
    // The defect: a short card narrowed its ribbons and a tall one spread
    // them, so the same request drew two different pictures of itself.
    const sources = ["one", "two", "three"]
    const at = (h: number) => {
      const nodes = [
        ...sources.map((id, i) => card(id, 0, i * 100, 74)),
        card("run", 300, 0, h),
      ]
      const slots = assignSlots(nodes, fanInto("run", sources))
      return sources.map((s) => slots.get(slotKey(s, "run", "to"))!)
    }

    expect(at(74)).toEqual(at(240))
  })

  it("orders a fan by where its wires came from, not by how the graph lists them", () => {
    const nodes = [
      card("low", 0, 400, 74),
      card("high", 0, 0, 74),
      card("run", 300, 0, 110),
    ]
    // Listed low first, which is the order a reversed graph would hand over.
    const edges: CanvasEdge[] = [
      { from: "low", to: "run" },
      { from: "high", to: "run" },
    ]
    const slots = assignSlots(nodes, edges)

    expect(slots.get(slotKey("high", "run", "to"))!).toBeLessThan(
      slots.get(slotKey("low", "run", "to"))!
    )
  })

  it("counts the two sides of a card apart", () => {
    // `mode` takes a gate from `model` and feeds the run: one wire a side, and
    // neither should be moved down the card by the other.
    const graph = runGraph("classify", null)!
    const measured: Record<string, number> = {
      area: 96,
      period: 168,
      model: 74,
      mode: 74,
      run: 110,
    }
    const places = defaultPlaces(graph, measured)
    const nodes = graph.nodes.map((n) =>
      card(n.id, places[n.id].x, places[n.id].y, measured[n.id] ?? n.h)
    )
    const edges: CanvasEdge[] = graph.edges.map(([from, to]) => ({ from, to }))
    const slots = assignSlots(nodes, edges)

    const mode = nodes.find((n) => n.id === "mode")!
    expect(slots.get(slotKey("model", "mode", "to"))).toBe(mode.place.y + PORT_Y)
    expect(slots.get(slotKey("mode", "run", "from"))).toBe(mode.place.y + PORT_Y)
  })
})

describe("fanFloor", () => {
  it("leaves a card met by one wire to its own contents", () => {
    expect(fanFloor("run", fanInto("run", ["one"]))).toBe(0)
  })

  it("holds every landing of a fan inside the card", () => {
    const sources = ["one", "two", "three", "four", "five"]
    const edges = fanInto("run", sources)
    const floor = fanFloor("run", edges)
    const nodes = [
      ...sources.map((id, i) => card(id, 0, i * 100, 74)),
      card("run", 300, 0, floor),
    ]
    const slots = assignSlots(nodes, edges)

    for (const e of edges) {
      expect(slots.get(slotKey(e.from, e.to, "to"))!).toBeLessThan(floor)
    }
  })

  it("is set by the busier side, not by the total", () => {
    const edges: CanvasEdge[] = [
      ...fanInto("mid", ["one", "two", "three"]),
      { from: "mid", to: "run" },
    ]
    expect(fanFloor("mid", edges)).toBe(fanFloor("mid", fanInto("mid", ["one", "two", "three"])))
  })
})
