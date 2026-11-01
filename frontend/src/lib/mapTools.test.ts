/**
 * That the product table names each product once. A product listed twice would be
 * drawn twice in the run panel, with two labels free to disagree.
 */
import { describe, expect, it } from "vitest"

import { BOARD_TOOLS } from "./mapTools"

describe("BOARD_TOOLS", () => {
  it("names every product once", () => {
    const ids = BOARD_TOOLS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
