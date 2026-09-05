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

import { splitsWithin, type AreaNode } from "./boardAreas"

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
