/**
 * That the stack opens to hold whatever a card measures at.
 *
 * THE DEFECT THIS FOLLOWS was a height written by hand. `defaultPlaces`
 * stacked a column from `RunNodeSpec.h`, and nothing compared that number with
 * what the card drew. `product` declared 78, which was true of the four short
 * names it carries under solar; under energy the same card draws the nine
 * ENERGY_PRODUCTS labels, wraps to about six rows and stands near 200. The
 * card below it in the same column was placed 124px inside it, and the overlap
 * clipped two of the nine options out of reach.
 *
 * WHAT NO TEST HERE CAN CATCH, and it is worth saying rather than implying
 * otherwise: whether a declared height matches a drawn one. That comparison
 * needs a layout engine, and jsdom computes no layout -- every element in it is
 * zero by zero. A test asserting that cards laid out from a set of heights do
 * not overlap at those same heights cannot fail, because the arithmetic that
 * places them is the arithmetic being checked.
 *
 * So the repair is not a check, it is the removal of the number: measured
 * heights supersede declared ones, and what is asserted below is that they do.
 * The card's real height reaches this function at run time, from the
 * ResizeObserver in NodeCanvas, and a stale SPEC entry costs one frame of
 * settling instead of an overlap.
 */
import { describe, expect, it } from "vitest"

import { defaultPlaces, runGraph, ROW_GAP } from "./runGraph"
import type { RunGraph } from "./runGraph"

/** Every graph the product tables can produce, named by what asks for it. */
const GRAPHS: [string, RunGraph][] = (
  [
    ["classify", runGraph("classify", null)],
    ["water", runGraph("water", null)],
    ["flood", runGraph("flood", null)],
    ["compose rgb", runGraph("compose", null, "rgb")],
    ["compose index", runGraph("compose", null, "index")],
    ["solar resource", runGraph("energy", "resource", null, null, "solar:resource")],
    ["solar terrain", runGraph("energy", "terrain", null, null, "solar:terrain")],
    ["solar siting", runGraph("energy", "siting", null, null, "solar:siting")],
    ["solar energy", runGraph("energy", "energy", null, null, "solar:energy")],
    ["wind", runGraph("energy", null, null, null, "wind:resource")],
    ["grid curtailment", runGraph("energy", null, null, "curtailment", "grid:curtailment")],
    ["grid connection", runGraph("energy", null, null, "connection", "grid:connection")],
    ["grid figure", runGraph("energy", null, null, "figure", "grid:figure")],
    ["grid record", runGraph("energy", null, null, "record", "grid:record")],
  ] as [string, RunGraph | null][]
).filter((entry): entry is [string, RunGraph] => entry[1] !== null)

describe("defaultPlaces", () => {
  it("covers every graph the product tables can produce", () => {
    expect(GRAPHS.length).toBe(14)
  })

  /*
    The measured height is the one that stacks the column, for every card on
    every graph -- which is the whole of the repair, stated per card so a
    branch that quietly kept reading `n.h` names itself.
  */
  it.each(GRAPHS)("stacks %s from measured heights, not declared ones", (_, graph) => {
    const measured = Object.fromEntries(graph.nodes.map((n) => [n.id, n.h + 137]))
    const places = defaultPlaces(graph, measured)

    const byCol = new Map<number, typeof graph.nodes>()
    for (const n of graph.nodes) {
      byCol.set(n.col, [...(byCol.get(n.col) ?? []), n])
    }
    for (const list of byCol.values()) {
      for (let i = 1; i < list.length; i++) {
        const above = list[i - 1]
        const below = list[i]
        expect(
          places[below.id].y - places[above.id].y,
          `${above.id} to ${below.id}`
        ).toBe(measured[above.id] + ROW_GAP)
      }
    }
  })

  /*
    A card with no measurement yet keeps its declared height, so the first
    frame -- before any card has been drawn to measure -- still lays out.
  */
  it("falls back to the declared height for a card not yet measured", () => {
    const graph = runGraph("classify", null)!
    const area = graph.nodes.find((n) => n.id === "area")!
    const plain = defaultPlaces(graph)
    const partial = defaultPlaces(graph, { model: 400 })
    expect(partial.period.y - partial.area.y).toBe(area.h + ROW_GAP)
    expect(partial.area.x).toBe(plain.area.x)
  })

  /*
    Columns are centred against the tallest, and a growing card has to move the
    columns beside it. The run node opposite a column of three reads as the
    thing they arrive at only if it stays across from their middle.
  */
  it("recentres the shorter columns when a card grows", () => {
    const graph = runGraph("classify", null)!
    const plain = defaultPlaces(graph)
    const taller = defaultPlaces(graph, { area: 600 })
    expect(taller.period.y).toBeGreaterThan(plain.period.y)
    expect(taller.run.y).toBeGreaterThan(plain.run.y)
  })
})

/**
 * Which cards the request reaches, which is what the aside tone is drawn from.
 *
 * BoardRunGraph reads this off the edges rather than naming the card, so the
 * property belongs to the graph and is asserted here. What it guards is the
 * discrepancy that would otherwise be silent: a card added without an edge
 * draws as an aside whether or not that was meant, and a card that gains one
 * stops drawing as one.
 */
describe("cards no edge reaches", () => {
  const unwired = (graph: RunGraph) => {
    const wired = new Set(graph.edges.flat())
    return graph.nodes.map((n) => n.id).filter((id) => !wired.has(id))
  }

  const isEnergy = (name: string) => /^(solar|wind|grid)/.test(name)

  it("is the layers card, and only that, on every energy graph", () => {
    const energy = GRAPHS.filter(([name]) => isEnergy(name))
    expect(energy.length).toBe(9)
    for (const [name, graph] of energy) {
      expect(unwired(graph), name).toEqual(["layers"])
    }
  })

  /*
    The layers card is appended for the Energy entry alone -- it draws the
    register this slice can be asked about, and hanging it off a classification
    graph would offer a control over a layer that run has nothing to do with.
    So every other graph reaches all of its cards.
  */
  it("is nothing at all on the graphs that are not energy", () => {
    const rest = GRAPHS.filter(([name]) => !isEnergy(name))
    expect(rest.length).toBe(5)
    for (const [name, graph] of rest) {
      expect(unwired(graph), name).toEqual([])
    }
  })
})
