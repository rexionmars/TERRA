import { describe, expect, it } from "vitest"

import {
  CARD_RADIUS,
  FRAME_EDGE,
  FRAME_REACH,
  LIGHTS_END,
  hangingNotch,
  leftCorner,
  rightCorner,
} from "./frameCorners"

describe("leftCorner", () => {
  it("holds the traffic lights beside the closed rail", () => {
    const d = leftCorner(52)
    expect(d).not.toBeNull()
    // The convex corner at the piece's foot, past the end of the lights.
    const foot = Number(d!.match(/Q([\d.]+) 32 /)?.[1])
    expect(foot).toBeGreaterThan(LIGHTS_END)
  })

  it("is not drawn when the open rail holds the lights itself", () => {
    expect(leftCorner(208)).toBeNull()
  })

  it("turns the card's corner where its foot meets the card's side", () => {
    expect(leftCorner(52)).toContain(
      `A${CARD_RADIUS} ${CARD_RADIUS} 0 0 0 52 ${FRAME_REACH + CARD_RADIUS}`
    )
  })
})

describe("rightCorner", () => {
  it("rises at 60 degrees from its foot to the frame's edge", () => {
    const d = rightCorner(1200, 1432)
    // The side runs from the end of the top fillet to the start of the foot's
    // corner; its slope is the rise over the run between those two points.
    const side = d.match(/Q[\d.]+ \d+ ([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)/)
    expect(side).not.toBeNull()
    const [x1, y1, x2, y2] = side!.slice(1).map(Number)
    const angle = (Math.atan2(y2 - y1, Math.abs(x2 - x1)) * 180) / Math.PI
    expect(angle).toBeCloseTo(60, 0)
  })

  it("runs from the window's top edge down to the piece's depth", () => {
    const d = rightCorner(1200, 1432)
    expect(d.startsWith("M1432 0 ")).toBe(true)
    expect(d).toContain(`V${FRAME_EDGE}`)
    expect(d).toContain(
      `A${CARD_RADIUS} ${CARD_RADIUS} 0 0 1 1432 ${FRAME_REACH + CARD_RADIUS}`
    )
  })

  it("keeps its foot clear of what it holds", () => {
    const foot = Number(rightCorner(1200, 1432).match(/Q([\d.]+) 32 /)?.[1])
    expect(foot).toBeLessThan(1200)
  })
})

describe("hangingNotch", () => {
  it("hangs from the edge it meets, with its foot as wide as what it holds", () => {
    const { d, total } = hangingNotch(360, 44)
    expect(d.startsWith("M0 0 ")).toBe(true)
    expect(d.endsWith(`${total} 0 Z`)).toBe(true)
    // The foot: from the end of one corner to the start of the other, 360 wide
    // less the two corners.
    const foot = d.match(/Q([\d.]+) 44 ([\d.]+) 44 H([\d.]+)/)
    expect(foot).not.toBeNull()
    expect(Number(foot![1]) + 360).toBeCloseTo(Number(foot![3]) + 0.28 * 44, 1)
  })

  it("falls at 60 degrees on either side", () => {
    const { d } = hangingNotch(360, 44)
    const side = d.match(/Q[\d.]+ 0 ([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)/)
    expect(side).not.toBeNull()
    const [x1, y1, x2, y2] = side!.slice(1).map(Number)
    expect((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI).toBeCloseTo(60, 0)
  })
})
