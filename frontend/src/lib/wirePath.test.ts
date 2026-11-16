import { describe, expect, it } from "vitest"

import {
  CORNER,
  DEFAULT_WIRE_SHAPE,
  STUB,
  WIRE_SHAPES,
  isWireShape,
  route,
  wirePath,
} from "@/lib/wirePath"

describe("route", () => {
  it("turns once, down the middle, when the input is ahead", () => {
    expect(route(0, 0, 200, 100)).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [200, 100],
    ])
  })

  it("is one level segment when the sockets are at one height", () => {
    expect(route(0, 50, 200, 50)).toEqual([
      [0, 50],
      [200, 50],
    ])
  })

  it("goes around an input behind its output, along the middle of the heights", () => {
    expect(route(300, 0, 100, 200)).toEqual([
      [300, 0],
      [300 + STUB, 0],
      [300 + STUB, 100],
      [100 - STUB, 100],
      [100 - STUB, 200],
      [100, 200],
    ])
  })

  it("runs below both sockets when they are too close in height to pass between", () => {
    const points = route(300, 0, 100, 10)
    expect(points[2][1]).toBeGreaterThan(10)
    expect(points[3][1]).toBe(points[2][1])
  })

  it("leaves the output and enters the input level", () => {
    for (const [x1, y1, x2, y2] of [
      [0, 0, 200, 100],
      [300, 0, 100, 200],
      [0, 0, 30, 80],
    ]) {
      const p = route(x1, y1, x2, y2)
      expect(p[1][1]).toBe(y1)
      expect(p[1][0]).toBeGreaterThan(x1)
      expect(p.at(-2)?.[1]).toBe(y2)
      expect(p.at(-2)?.[0]).toBeLessThan(x2)
    }
  })
})

describe("wirePath", () => {
  it("draws a straight wire as one segment", () => {
    expect(wirePath("straight", 0, 0, 200, 100)).toBe("M 0 0 L 200 100")
  })

  it("draws square corners as the route's polyline", () => {
    expect(wirePath("square", 0, 0, 200, 100)).toBe("M 0 0 L 100 0 L 100 100 L 200 100")
  })

  it("turns each rounded corner on a curve of the corner radius", () => {
    expect(wirePath("rounded", 0, 0, 200, 100)).toBe(
      `M 0 0 L ${100 - CORNER} 0 Q 100 0 100 ${CORNER} ` +
        `L 100 ${100 - CORNER} Q 100 100 ${100 + CORNER} 100 L 200 100`
    )
  })

  it("narrows a corner to half the shorter segment beside it", () => {
    // A jog of 8 between two corners leaves each a radius of 4.
    expect(wirePath("rounded", 0, 0, 200, 8)).toContain("Q 100 0 100 4")
  })

  it("keeps the curve the fields always drew", () => {
    expect(wirePath("curved", 0, 0, 200, 100)).toBe("M 0 0 C 100 0, 100 100, 200 100")
  })

  it("draws no NaN for any shape, however the sockets stand", () => {
    for (const { id } of WIRE_SHAPES) {
      for (const [x1, y1, x2, y2] of [
        [0, 0, 0, 0],
        [0, 0, 200, 0],
        [300, 0, 100, 0],
        [0, 0, 10, 300],
      ]) {
        expect(wirePath(id, x1, y1, x2, y2)).not.toContain("NaN")
      }
    }
  })
})

describe("isWireShape", () => {
  it("accepts the four shapes and nothing else", () => {
    expect(WIRE_SHAPES.map((s) => s.id).every(isWireShape)).toBe(true)
    expect(isWireShape("zigzag")).toBe(false)
    expect(isWireShape(undefined)).toBe(false)
    expect(isWireShape(DEFAULT_WIRE_SHAPE)).toBe(true)
  })
})
