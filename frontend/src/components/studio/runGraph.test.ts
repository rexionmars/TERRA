/**
 * That the stack opens to hold whatever a card measures at.
 *
 * THE DEFECT THIS FOLLOWS was a height written by hand. `defaultPlaces`
 * stacked a column from `RunNodeSpec.h`, and nothing compared that number with
 * what the card drew. One card declared 78 while the list it drew wrapped to
 * about six rows and stood near 200. The card below it in the same column was
 * placed 124px inside it, and the overlap clipped two of its options out of
 * reach.
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
    ["classify", runGraph("classify")],
    ["water", runGraph("water")],
    ["flood", runGraph("flood")],
    ["compose rgb", runGraph("compose", "rgb")],
    ["compose index", runGraph("compose", "index")],
  ] as [string, RunGraph | null][]
).filter((entry): entry is [string, RunGraph] => entry[1] !== null)

describe("defaultPlaces", () => {
  it("covers every graph the product tables can produce", () => {
    expect(GRAPHS.length).toBe(5)
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
    const graph = runGraph("classify")!
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
    const graph = runGraph("classify")!
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

  /*
    A product brings no card it does not read. The only unwired cards on a
    graph are the ones the reader adds, which the two tests below cover.
  */
  it("is nothing at all on any graph the product tables produce", () => {
    expect(GRAPHS.length).toBe(5)
    for (const [name, graph] of GRAPHS) {
      expect(unwired(graph), name).toEqual([])
    }
  })

  /*
    AN ADDED COMPONENT IS UNWIRED, AND THAT IS THE POINT OF IT.

    The catalogue produces an area, and the area card's own edge is what
    carries that to the run -- so a graph gains a card and the request it
    describes is unchanged. A line from here would say the run reads a second
    geometry. This asserts both halves: the card arrives, and no edge does.
  */
  it("adds what the reader asked for, and reaches none of it", () => {
    const plain = runGraph("classify")!
    const withCatalogue = runGraph("classify", null, ["catalogue"])!
    expect(unwired(plain)).toEqual([])
    expect(unwired(withCatalogue)).toEqual(["catalogue"])
    expect(withCatalogue.edges).toEqual(plain.edges)
    expect(withCatalogue.nodes.length).toBe(plain.nodes.length + 1)
  })
})
