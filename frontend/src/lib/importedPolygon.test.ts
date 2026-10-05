import { describe, expect, it } from "vitest"

import { importedPolygon } from "./importedPolygon"

const SQUARE = [
  [-53.24, -25.34],
  [-53.18, -25.34],
  [-53.18, -25.28],
  [-53.24, -25.34],
]

describe("importedPolygon", () => {
  it("drops altitude and trims precision to what the draw store accepts", () => {
    const got = importedPolygon({
      type: "Polygon",
      coordinates: [
        [
          [-53.240123456789012, -25.34, 0],
          [-53.18, -25.34, 0],
          [-53.18, -25.28, 0],
          [-53.240123456789012, -25.34, 0],
        ],
      ],
    })
    expect(got?.coordinates[0][0]).toEqual([-53.240123457, -25.34])
    expect(got?.coordinates[0].every((p) => p.length === 2)).toBe(true)
  })

  it("closes a ring the file left open", () => {
    const got = importedPolygon({ type: "Polygon", coordinates: [SQUARE.slice(0, 3)] })
    expect(got?.coordinates[0]).toEqual(SQUARE)
  })

  it("finds a polygon inside a collection, a multi-part geometry or a feature", () => {
    const poly = { type: "Polygon", coordinates: [SQUARE] }
    const point = { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] } }
    expect(
      importedPolygon({
        type: "FeatureCollection",
        features: [
          point,
          { type: "Feature", geometry: { type: "GeometryCollection", geometries: [poly] } },
        ],
      })?.coordinates[0],
    ).toEqual(SQUARE)
    expect(
      importedPolygon({ type: "MultiPolygon", coordinates: [[SQUARE]] })?.coordinates[0],
    ).toEqual(SQUARE)
  })

  it("returns null where there is no polygon", () => {
    expect(importedPolygon({ type: "FeatureCollection", features: [] })).toBeNull()
    expect(importedPolygon({ type: "LineString", coordinates: SQUARE })).toBeNull()
    expect(importedPolygon(null)).toBeNull()
  })
})
