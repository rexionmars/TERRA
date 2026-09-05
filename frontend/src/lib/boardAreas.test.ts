/**
 * That a dragged division is never offered one of its own children to line up
 * with.
 *
 * THE DEFECT THIS GUARDS is a target that runs away. Snapping compares the
 * dragged line against where the other divisions are, and a division nested
 * inside the dragged split moves WITH it -- so a descendant offered as a
 * target recedes at exactly the rate the pointer approaches, and the snap
 * either never engages or engages and then drags the arrangement with it.
 *
 * It is the kind of thing that reads as correct in the code and is only
 * visible as a division that will not settle, which is why it is asserted on
 * the query rather than left to the pointer.
 */
import { describe, expect, it } from "vitest"

import { AREA_GUTTER_PX, areaRects, splitsWithin, type AreaNode } from "./boardAreas"

const leaf = (id: string): AreaNode => ({ kind: "leaf", id, editor: "viewport" })

const split = (
  id: string,
  dir: "row" | "col",
  a: AreaNode,
  b: AreaNode
): AreaNode => ({ kind: "split", id, dir, at: 0.5, a, b })

/*
      root
     /    \
   left   right
          /   \
       inner   leaf-d
       /   \
    leaf-b  leaf-c
*/
const tree = split(
  "root",
  "row",
  leaf("leaf-a"),
  split("right", "col", split("inner", "row", leaf("leaf-b"), leaf("leaf-c")), leaf("leaf-d"))
)

describe("splitsWithin", () => {
  it("returns the split itself and every split under it", () => {
    expect(splitsWithin(tree, "right")).toEqual(new Set(["right", "inner"]))
  })

  it("returns only itself for a split with no split beneath it", () => {
    expect(splitsWithin(tree, "inner")).toEqual(new Set(["inner"]))
  })

  it("returns the whole tree for the root", () => {
    expect(splitsWithin(tree, "root")).toEqual(
      new Set(["root", "right", "inner"])
    )
  })

  it("excludes a sibling, which is a division that does NOT move with it", () => {
    // The point of the query: `inner` is not inside `left`, so dragging one is
    // free to line up with the other. A version that walked the whole tree
    // instead of the named subtree would have caught `inner` here and refused
    // the one alignment a reader most often wants.
    const withSibling = split("top", "col", split("left", "row", leaf("l1"), leaf("l2")), tree)
    expect(splitsWithin(withSibling, "left")).toEqual(new Set(["left"]))
  })

  it("is empty for an id no split carries", () => {
    // A leaf's id, and an id from a tree that has been replaced. Both mean the
    // same thing to a caller: nothing is inside it, so nothing is excluded.
    expect(splitsWithin(tree, "leaf-a")).toEqual(new Set())
    expect(splitsWithin(tree, "gone")).toEqual(new Set())
  })
})

describe("areaRects, with a gap", () => {
  const viewport = { x: 0, y: 0, w: 100, h: 100 }
  const two: AreaNode = split("s", "row", leaf("l"), leaf("r"))

  it("leaves the same gap at the window's edge as between two areas", () => {
    const { leaves } = areaRects(two, viewport, 10)
    const [l, r] = leaves
    // The window's edge, on both sides, and the gap the two share.
    expect(l.x).toBe(10)
    expect(viewport.w - (r.x + r.w)).toBe(10)
    expect(r.x - (l.x + l.w)).toBe(10)
    // And the same on the axis nothing is divided along.
    expect(l.y).toBe(10)
    expect(viewport.h - (l.y + l.h)).toBe(10)
  })

  it("puts the division down the middle of the gap it opened", () => {
    // The seam is what a drag moves, so it has to sit in the space between the
    // two areas rather than on either one's edge -- otherwise grabbing the gap
    // and grabbing the division are two different gestures.
    const { leaves, seams } = areaRects(two, viewport, 10)
    const [l, r] = leaves
    const line = seams[0].bounds.x + seams[0].bounds.w * seams[0].at
    expect(line).toBe((l.x + l.w + r.x) / 2)
  })

  it("is the old geometry when no gap is asked for", () => {
    // The default, which is what a caller wanting the OWNED rectangles gets.
    const { leaves } = areaRects(two, viewport)
    expect(leaves.map((a) => [a.x, a.y, a.w, a.h])).toEqual([
      [0, 0, 50, 100],
      [50, 0, 50, 100],
    ])
  })

  it("never returns a negative extent for an area thinner than the gap", () => {
    // A window dragged down to nothing, which is a real state during a resize.
    const { leaves } = areaRects(two, { x: 0, y: 0, w: 4, h: 4 }, AREA_GUTTER_PX)
    for (const l of leaves) {
      expect(l.w).toBeGreaterThanOrEqual(0)
      expect(l.h).toBeGreaterThanOrEqual(0)
    }
  })
})
