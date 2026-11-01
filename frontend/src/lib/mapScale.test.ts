import { describe, expect, it } from "vitest"

import { tileLevel, zoomOfLevel } from "./mapScale"

describe("tileLevel", () => {
  /*
    Measured, not derived: at map zoom 13.49 the tiles observed on the wire in
    the running application were level 14.
  */
  it("is the level MapLibre asks a 256 px source for", () => {
    expect(tileLevel(13.49)).toBe(14)
    expect(tileLevel(12)).toBe(13)
    expect(tileLevel(0)).toBe(1)
  })

  it("never goes below zero", () => {
    expect(tileLevel(-3)).toBe(0)
  })
})

describe("zoomOfLevel", () => {
  it("puts a service's ceiling back in the readout's units", () => {
    // Jose de Freitas: the footprint ends at level 17, which is z16 on screen.
    expect(zoomOfLevel(17)).toBe(16)
    expect(tileLevel(zoomOfLevel(17))).toBe(17)
  })
})
