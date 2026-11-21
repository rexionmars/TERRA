import { describe, expect, it } from "vitest"

import { drawableOutline, withHolesInside } from "./geometry"

const square = (x0: number, y0: number, side: number) => [
  [x0, y0],
  [x0 + side, y0],
  [x0 + side, y0 + side],
  [x0, y0 + side],
  [x0, y0],
]

describe("drawableOutline", () => {
  it("keeps the outline at nine decimals and leaves the holes out", () => {
    const field = {
      type: "Polygon",
      coordinates: [
        square(-53.770123456789012, -24.74, 0.01),
        square(-53.765, -24.735, 0.001),
      ],
    }
    const got = drawableOutline(field)
    expect(got?.coordinates).toHaveLength(1)
    expect(got?.coordinates[0][0]).toEqual([-53.770123457, -24.74])
  })

  it("has nothing to offer for a geometry that is not a Polygon", () => {
    expect(drawableOutline({ type: "MultiPolygon", coordinates: [] })).toBeNull()
  })
})

describe("withHolesInside", () => {
  const original = {
    type: "Polygon",
    coordinates: [square(0, 0, 10), square(2, 2, 1), square(8, 8, 1)],
  }

  it("gives an edited outline back the holes that still lie inside it", () => {
    const got = withHolesInside(
      { type: "Polygon", coordinates: [square(0, 0, 10)] },
      original
    )
    expect(got.coordinates).toHaveLength(3)
  })

  it("drops a hole the edit left outside the outline", () => {
    const got = withHolesInside(
      { type: "Polygon", coordinates: [square(0, 0, 6)] },
      original
    )
    expect(got.coordinates).toEqual([square(0, 0, 6), square(2, 2, 1)])
  })
})
