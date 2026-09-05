/**
 * That every wire meeting a card is met somewhere of its own, inside it.
 *
 * THE DEFECT THIS FOLLOWS was one port per card. Both ends of every wire were
 * placed at PORT_Y, so the four wires arriving at the run node arrived at the
 * same point: the fan pinched shut exactly where it had the most to say, and
 * which wire ended where could not be read off the picture at all.
 *
 * THE SECOND DEFECT WAS THE REPAIR'S OWN, and it took two goes. Spacing the
 * fan by the card's height narrowed a short card's ribbons and threw a tall
 * one's apart; spacing it by a constant and growing the CARD to fit turned the
 * run node -- a button and a method link -- into three hundred pixels of empty
 * body on the graph that takes eight inputs. The fan is bounded by the card it
 * meets, the width follows from the crowding at that end, and the two ends of
 * one wire are counted apart. That last part is what is worth the test: it is
 * why a wire can be wide enough to be read where it leaves and still fit where
 * eight of them arrive.
 */
import { describe, expect, it } from "vitest"

import { RIBBON_W, assignSlots, slotKey } from "./NodeCanvas"
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
  it("meets a card with one wire on its header row, at full width", () => {
    const nodes = [card("a", 0, 0, 74), card("b", 300, 40, 96)]
    const edges: CanvasEdge[] = [{ from: "a", to: "b" }]
    const slots = assignSlots(nodes, edges)

    expect(slots.get(slotKey("a", "b", "from"))).toEqual({
      y: PORT_Y,
      w: RIBBON_W,
    })
    expect(slots.get(slotKey("a", "b", "to"))).toEqual({
      y: 40 + PORT_Y,
      w: RIBBON_W,
    })
  })

  it("keeps every landing of a fan inside the card it lands on", () => {
    // The card is no longer grown to fit the fan, so this is the property that
    // has to hold instead: eight wires into a short card share that card.
    const sources = ["a", "b", "c", "d", "e", "f", "g", "h"]
    const target = card("run", 300, 0, 110)
    const nodes = [
      ...sources.map((id, i) => card(id, 0, i * 90, 74)),
      target,
    ]
    const edges = fanInto("run", sources)
    const slots = assignSlots(nodes, edges)

    const ys = edges.map((e) => slots.get(slotKey(e.from, e.to, "to"))!.y)
    expect(new Set(ys).size).toBe(ys.length)
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(target.place.y + PORT_Y)
      expect(y).toBeLessThan(target.place.y + target.h)
    }
  })

  it("gives one wire two widths where its ends are crowded differently", () => {
    // The whole of what the taper is for: wide enough to be read where it
    // leaves a card that feeds only the run, narrow enough to fit where eight
    // arrive at one node.
    const sources = ["a", "b", "c", "d", "e", "f", "g", "h"]
    const nodes = [
      ...sources.map((id, i) => card(id, 0, i * 90, 74)),
      card("run", 300, 0, 110),
    ]
    const slots = assignSlots(nodes, fanInto("run", sources))

    const leaving = slots.get(slotKey("a", "run", "from"))!
    const arriving = slots.get(slotKey("a", "run", "to"))!
    expect(leaving.w).toBe(RIBBON_W)
    expect(arriving.w).toBeLessThan(RIBBON_W)
    expect(arriving.w).toBeGreaterThanOrEqual(5)
  })

  it("gives every wire landing on one card the same width", () => {
    const sources = ["a", "b", "c", "d"]
    const nodes = [
      ...sources.map((id, i) => card(id, 0, i * 90, 74)),
      card("run", 300, 0, 110),
    ]
    const edges = fanInto("run", sources)
    const slots = assignSlots(nodes, edges)

    const widths = edges.map((e) => slots.get(slotKey(e.from, e.to, "to"))!.w)
    expect(new Set(widths).size).toBe(1)
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

    expect(slots.get(slotKey("high", "run", "to"))!.y).toBeLessThan(
      slots.get(slotKey("low", "run", "to"))!.y
    )
  })

  it("counts the two sides of a card apart", () => {
    // `mode` takes a gate from `model` and feeds the run: one wire a side, and
    // neither should be moved down the card or narrowed by the other.
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
    expect(slots.get(slotKey("model", "mode", "to"))).toEqual({
      y: mode.place.y + PORT_Y,
      w: RIBBON_W,
    })
    expect(slots.get(slotKey("mode", "run", "from"))).toEqual({
      y: mode.place.y + PORT_Y,
      w: RIBBON_W,
    })
  })
})
