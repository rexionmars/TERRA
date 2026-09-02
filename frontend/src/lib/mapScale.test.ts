import { describe, expect, it } from "vitest"

import { metresPerPixel, tileLevel, zoomOfLevel } from "./mapScale"

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

describe("metresPerPixel", () => {
  it("matches Web Mercator at the equator", () => {
    // 40075016.686 / 512 at zoom 0.
    expect(metresPerPixel(0, 0)).toBeCloseTo(78271.5, 1)
  })

  it("narrows with the cosine of the latitude", () => {
    const equator = metresPerPixel(14, 0)
    const curitiba = metresPerPixel(14, -25.43)
    expect(curitiba / equator).toBeCloseTo(Math.cos((25.43 * Math.PI) / 180), 4)
  })

  /*
    Where 10 m Sentinel-2 stops being worth its bandwidth. At z13 a pixel is
    about 8.7 m over Curitiba and the mosaic is at its own scale; one zoom in
    it is 4.3 m and the same data is being magnified.
  */
  it("puts 10 m Sentinel-2 at its own scale around z13", () => {
    expect(metresPerPixel(13, -25.43)).toBeCloseTo(8.66, 1)
    expect(metresPerPixel(14, -25.43)).toBeCloseTo(4.33, 1)
  })
})
