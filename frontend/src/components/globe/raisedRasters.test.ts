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
import { describe, expect, it } from "vitest"

import { vertexSource } from "./raisedRasters"

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
    expect(globe).toContain("u_elevation_m / GLOBE_RADIUS")
  })

  it("gives the fallback matrix mercator units, because its z is world-scaled", () => {
    expect(globe).toMatch(
      /u_projection_fallback_matrix \* vec4\(a_pos, u_elevation_mercator, 1\.0\)/
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
    expect(fallback).not.toMatch(/u_elevation_m\b/)
  })

  it("mixes towards the sphere by the transition MapLibre reports", () => {
    expect(globe).toContain("mix(onPlane, onSphere, u_projection_transition)")
  })

  it("takes the sphere alone once the transition has finished", () => {
    expect(globe).toContain("u_projection_transition > 0.999")
  })

  it("feeds the flat projection mercator units and never metres", () => {
    expect(mercator).toContain("projectTileFor3D(a_pos, u_elevation_mercator)")
    expect(mercator).not.toMatch(/u_elevation_m\b/)
  })

  it("carries the prelude and the define it was compiled beside", () => {
    const { src } = branches("#define GLOBE")
    expect(src).toContain(PRELUDE)
    expect(src).toContain("#define GLOBE")
    expect(src.startsWith("#version 300 es")).toBe(true)
  })
})
