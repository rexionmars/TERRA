import { describe, expect, it } from "vitest"

import { SERIES_FIGURES, seriesFigure } from "@/lib/gridFigures"

/**
 * The table here and the one in the sidecar name the same twelve analyses, and
 * a label spelled in two places can disagree with itself. The Python side is
 * authoritative about scope — it is what refuses a polygon — so these pin the
 * facts the graph depends on before the sidecar has answered.
 */
describe("the published series", () => {
  it("names twelve, numbered one to twelve without a gap", () => {
    expect(SERIES_FIGURES).toHaveLength(12)
    expect(SERIES_FIGURES.map((f) => f.number)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1)
    )
  })

  it("puts every figure in one of the two scopes", () => {
    for (const f of SERIES_FIGURES) {
      expect(["site", "system"]).toContain(f.scope)
    }
  })

  it("keeps the five case-study figures site-scoped", () => {
    // 03, 04, 05, 06 and 07 name Sol do Cerrado and Jaíba in the research and
    // generalise to the plants inside an area. The other seven are about the
    // SIN, its subsystems or the fleet, and answering one over a polygon would
    // be a different quantity under the same name.
    const site = SERIES_FIGURES.filter((f) => f.scope === "site").map(
      (f) => f.number
    )
    expect(site).toEqual([3, 4, 5, 6, 7])
  })

  it("marks exactly what this application computes today", () => {
    // Drawn and disabled rather than hidden: hiding the eleven would say the
    // series has one figure, where the truth is that one of twelve is ready.
    expect(SERIES_FIGURES.filter((f) => f.ready).map((f) => f.number)).toEqual([
      1,
    ])
  })

  it("resolves a number to its entry and nothing else", () => {
    expect(seriesFigure(1)?.scope).toBe("system")
    expect(seriesFigure(13)).toBeUndefined()
    expect(seriesFigure(0)).toBeUndefined()
  })
})
