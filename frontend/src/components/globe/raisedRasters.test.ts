/**
 * The unit each projection term is fed, pinned as text.
 *
 * A shader cannot be run here -- there is no GL context in this suite and
 * standing one up would test the driver rather than the decision. What is
 * worth pinning is not the arithmetic anyway: it is which of the two elevation
 * uniforms reaches which matrix, because the defect this guards was exactly
 * one identifier in one branch and it cost the overlay every pass through the
 * crossfade.
 *
 * So the assertions read the generated source. They are deliberately about the
 * pairing and nothing else: rewrite the projection however you like, and these
 * still fail the moment metres are handed to the matrix that wants mercator
 * units.
 */
import { MercatorCoordinate } from "maplibre-gl"
import { describe, expect, it } from "vitest"

import {
  cellsFor,
  gridIndices,
  gridVertices,
  rastersAt,
  vertexSource,
} from "./raisedRasters"

/** Enough of the prelude's shape for the branches to be readable. */
const PRELUDE = "uniform mat4 u_projection_matrix;"

function branches(define: string) {
  const src = vertexSource(PRELUDE, define)
  const globe = src.slice(src.indexOf("#ifdef GLOBE"), src.indexOf("#else"))
  const mercator = src.slice(src.indexOf("#else"), src.indexOf("#endif"))
  return { src, globe, mercator }
}

describe("the raised raster's vertex source", () => {
  const { globe, mercator } = branches("#define GLOBE")

  it("raises the sphere by the metres, which is the unit a globe radius is in", () => {
    expect(globe).toContain("metres / GLOBE_RADIUS")
  })

  it("gives the fallback matrix mercator units, because its z is world-scaled", () => {
    expect(globe).toMatch(
      /u_projection_fallback_matrix \* vec4\(a_pos, mercator, 1\.0\)/
    )
  })

  it("never spends the metres on the fallback matrix", () => {
    /*
      The whole failure, stated as the thing that must not happen: MapLibre
      hands the mercator custom-layer matrix over as the globe's fallback, so a
      metre passed there is read as a mercator unit -- forty thousand
      kilometres, and the corner leaves the frame.
    */
    const fallback = globe.slice(globe.indexOf("u_projection_fallback_matrix"))
    expect(fallback).not.toMatch(/\bmetres\b/)
  })

  it("mixes towards the sphere by the transition MapLibre reports", () => {
    expect(globe).toContain("mix(onPlane, onSphere, u_projection_transition)")
  })

  it("takes the sphere alone once the transition has finished", () => {
    expect(globe).toContain("u_projection_transition > 0.999")
  })

  it("feeds the flat projection mercator units and never metres", () => {
    expect(mercator).toContain("projectTileFor3D(a_pos, mercator)")
    expect(mercator).not.toMatch(/\bmetres\b/)
  })

  it("lifts from the ground under each vertex, not from sea level", () => {
    const { src } = branches("#define GLOBE")
    expect(src).toContain("float metres = a_ground_m + u_lift_m;")
    expect(src).toContain("float mercator = metres * u_mercator_per_m;")
  })

  it("carries the prelude and the define it was compiled beside", () => {
    const { src } = branches("#define GLOBE")
    expect(src).toContain(PRELUDE)
    expect(src).toContain("#define GLOBE")
    expect(src.startsWith("#version 300 es")).toBe(true)
  })
})

describe("rastersAt", () => {
  const box = (lon: number, lat: number) => ({
    lon_min: lon,
    lat_min: lat,
    lon_max: lon + 1,
    lat_max: lat + 1,
  })
  const stack = [
    { key: "low", bounds: box(-56, -13), elevationM: 1 },
    { key: "high", bounds: box(-56, -13), elevationM: 81 },
    { key: "elsewhere", bounds: box(-50, -10), elevationM: 41 },
  ]

  it("returns every raster over the point, the top of the stack first", () => {
    expect(rastersAt(stack, -55.5, -12.5).map((r) => r.key)).toEqual(["high", "low"])
  })

  it("counts the edge as inside, and returns nothing off every raster", () => {
    expect(rastersAt(stack, -56, -13).map((r) => r.key)).toEqual(["high", "low"])
    expect(rastersAt(stack, 0, 0)).toEqual([])
  })
})

describe("the raster's mesh", () => {
  // A tenth of a degree each way at 25 degrees south, about 10 km by 11 km.
  const field = { lon_min: -49, lat_min: -25.3, lon_max: -48.9, lat_max: -25.2 }
  const vertex = (v: Float32Array, i: number) => Array.from(v.slice(i * 5, i * 5 + 5))

  it("is one cell with no relief, whatever the extent", () => {
    expect(cellsFor(field, null)).toBe(1)
  })

  it("has about as many cells as the terrain's own mesh over the extent", () => {
    // 11.1 km tall over terrain cells of 277 m: 40.3, rounded up.
    expect(cellsFor(field, 10)).toBe(41)
  })

  it("never has fewer than one cell or more than the ceiling", () => {
    expect(cellsFor(field, 2)).toBe(1)
    expect(cellsFor(field, 15)).toBe(64)
  })

  it("is the quad its corners make when it has one cell", () => {
    const at = (lng: number, lat: number) => {
      const m = MercatorCoordinate.fromLngLat({ lng, lat })
      return [Math.fround(m.x), Math.fround(m.y)]
    }
    const v = gridVertices(field, 1, () => 0)
    // Rows from the top: top left, top right, bottom left, bottom right.
    expect(vertex(v, 0)).toEqual([...at(-49, -25.2), 0, 0, 0])
    expect(vertex(v, 1)).toEqual([...at(-48.9, -25.2), 1, 0, 0])
    expect(vertex(v, 2)).toEqual([...at(-49, -25.3), 0, 1, 0])
    expect(vertex(v, 3)).toEqual([...at(-48.9, -25.3), 1, 1, 0])
  })

  it("raises each vertex by the ground under it", () => {
    // Ground rising a metre per thousandth of a degree north: a height says
    // which latitude it was sampled at.
    const v = gridVertices(field, 2, (_lng, lat) => (lat + 25.3) * 1000)
    const heights = Array.from({ length: 9 }, (_, i) => Math.round(v[i * 5 + 4]))
    expect(heights).toEqual([100, 100, 100, 50, 50, 50, 0, 0, 0])
  })

  it("winds two triangles per cell as the quad was, and reaches every vertex", () => {
    expect(Array.from(gridIndices(1))).toEqual([0, 1, 3, 0, 3, 2])
    const many = gridIndices(64)
    expect(many.length).toBe(64 * 64 * 6)
    expect(Math.max(...many)).toBe(65 * 65 - 1)
  })
})
