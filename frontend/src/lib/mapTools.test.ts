/**
 * That the two product tables still describe one set of products.
 *
 * THE RELATION CHANGED AND THAT IS WHY THIS EXISTS. BOARD_TOOLS used to spread
 * MAP_TOOLS, so the two agreed by construction and nothing had to check them.
 * The board's row now has to be ORDERED by subject, which a spread cannot do,
 * so BOARD_TOOLS became the one table that carries a label and MAP_TOOLS is
 * derived back out of it. Derivation is weaker than construction: it holds
 * only while the ids it filters on stay in the board's table, and an id
 * dropped or renamed there would empty MAP_TOOLS silently -- which reaches the
 * reader as a stored panel selection that no longer resolves, not as an error.
 *
 * This file's own header names the failure it is guarding against: a label
 * that exists twice is a label that can disagree with itself. What is asserted
 * here is that it still exists once.
 */
import { describe, expect, it } from "vitest"

import { STUDIO_GROUPS } from "./studioEditors"
import { BOARD_TOOLS, MAP_TOOLS, isMapTool, type BoardToolId } from "./mapTools"

describe("MAP_TOOLS", () => {
  it("is exactly the three a stored panel selection may name", () => {
    expect(MAP_TOOLS.map((t) => t.id)).toEqual(["compose", "classify", "water"])
  })

  it("takes its labels from the board's table rather than carrying its own", () => {
    for (const tool of MAP_TOOLS) {
      const onBoard = BOARD_TOOLS.find((t) => t.id === tool.id)
      expect(onBoard, tool.id).toBeDefined()
      expect(tool.label).toBe(onBoard?.label)
    }
  })

  it("agrees with isMapTool about every product the board offers", () => {
    // The predicate reads the id list and MAP_TOOLS is filtered by it, so this
    // is what says the two have not been changed apart.
    const byPredicate = BOARD_TOOLS.filter((t) => isMapTool(t.id)).map(
      (t) => t.id
    )
    expect(byPredicate).toEqual(MAP_TOOLS.map((t) => t.id))
  })

  it("does not admit a board-only product", () => {
    // Energy and Flood were ported from screens of their own and are not
    // panels; widening MapToolId would make a value the store has never
    // written suddenly representable, which is the distinction the table's own
    // note asks to be kept.
    expect(isMapTool("energy" as BoardToolId)).toBe(false)
    expect(isMapTool("flood" as BoardToolId)).toBe(false)
  })
})

describe("BOARD_TOOLS", () => {
  it("names every product once", () => {
    const ids = BOARD_TOOLS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("names a subject the studio has, for every product", () => {
    /*
      The band asks STUDIO_GROUPS for the subjects and filters the products
      into them, so a product carrying a group no longer in that table would
      not be drawn at all -- it would go missing from the bar rather than fail,
      which is the failure mode worth a test.

      The array's ORDER is no longer asserted. It was, while the band drew a
      rule wherever the group changed and an entry out of place would have put
      a product on the far side of a divider from its own subject. The band
      walks the groups now and collects each one's members, so order within the
      table decides only where a product sits inside its own menu.
    */
    const known = new Set(STUDIO_GROUPS.map((g) => g.id))
    for (const tool of BOARD_TOOLS) {
      expect(known.has(tool.group), tool.id).toBe(true)
    }
  })
})
