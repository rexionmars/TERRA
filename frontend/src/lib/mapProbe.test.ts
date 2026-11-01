import { describe, expect, it } from "vitest"

import { cornersOf } from "@/lib/mapLayers"
import { lonLatToUv } from "@/lib/mapProbe"

const BOX = { lon_min: -54, lat_min: -26, lon_max: -52, lat_max: -24 }

describe("lonLatToUv", () => {
  it("is 0 at the south-west corner and 1 at the north-east", () => {
    const sw = lonLatToUv({ lon: -54, lat: -26 }, BOX)
    expect(sw?.u).toBeCloseTo(0, 12)
    expect(sw?.v).toBeCloseTo(0, 12)
    const ne = lonLatToUv({ lon: -52, lat: -24 }, BOX)
    expect(ne?.u).toBeCloseTo(1, 12)
    expect(ne?.v).toBeCloseTo(1, 12)
  })

  it("refuses a point off the raster rather than clamping it onto an edge", () => {
    expect(lonLatToUv({ lon: -54.01, lat: -25 }, BOX)).toBeNull()
    expect(lonLatToUv({ lon: -53, lat: -23.99 }, BOX)).toBeNull()
  })

  it("takes the northing in Web Mercator, where the raster is drawn", () => {
    // The middle latitude falls south of the middle of the image in Mercator,
    // because a degree is drawn longer the further it is from the equator. Worked
    // from ln(tan(pi/4 + lat/2)), with lat negative in the southern hemisphere.
    const y = (d: number) => Math.log(Math.tan(Math.PI / 4 + (d * Math.PI) / 360))
    const expected = (y(-25) - y(-26)) / (y(-24) - y(-26))
    expect(lonLatToUv({ lon: -53, lat: -25 }, BOX)?.v).toBeCloseTo(expected, 12)
    expect(expected).toBeGreaterThan(0.5)
  })

  it("reads a turned raster along its own axes", () => {
    // A square turned 45 degrees near the equator, where Mercator is nearly plain
    // degrees: its top-left corner is the northernmost point.
    const d = 0.001
    const turned = {
      lon_min: -d,
      lat_min: -d,
      lon_max: d,
      lat_max: d,
      corners: [
        [0, d],
        [d, 0],
        [0, -d],
        [-d, 0],
      ],
    }
    const centre = lonLatToUv({ lon: 0, lat: 0 }, turned)
    expect(centre?.u).toBeCloseTo(0.5, 6)
    expect(centre?.v).toBeCloseTo(0.5, 6)
    const top = lonLatToUv({ lon: 0, lat: d }, turned)
    expect(top?.u).toBeCloseTo(0, 6)
    expect(top?.v).toBeCloseTo(1, 6)
    // Inside the box and outside the square.
    expect(lonLatToUv({ lon: d * 0.9, lat: d * 0.9 }, turned)).toBeNull()
  })

  it("does not divide by a raster with no extent", () => {
    const zero = { lon_min: 0, lat_min: 0, lon_max: 0, lat_max: 0 }
    expect(lonLatToUv({ lon: 0, lat: 0 }, zero)).toBeNull()
  })
})

describe("cornersOf", () => {
  it("draws a raster in degrees by its box, clockwise from the top left", () => {
    expect(cornersOf(BOX)).toEqual([
      [-54, -24],
      [-52, -24],
      [-52, -26],
      [-54, -26],
    ])
  })

  it("prefers the corners the sidecar reported", () => {
    const corners = [
      [0, 2],
      [2, 3],
      [3, 1],
      [1, 0],
    ]
    expect(cornersOf({ ...BOX, corners })).toEqual(corners)
  })

  it("falls back on the box where a run reports anything but four", () => {
    expect(cornersOf({ ...BOX, corners: [] })).toEqual(cornersOf(BOX))
    expect(cornersOf({ ...BOX, corners: null })).toEqual(cornersOf(BOX))
  })
})
