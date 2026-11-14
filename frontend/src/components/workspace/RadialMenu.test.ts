import { describe, expect, it } from "vitest"

import { aimIndex } from "./RadialMenu"

describe("aimIndex", () => {
  it("aims at nothing inside the centre", () => {
    expect(aimIndex(0, 0, 6)).toBeNull()
    expect(aimIndex(10, -10, 6)).toBeNull()
  })

  it("aims at nothing in a ring of no options", () => {
    expect(aimIndex(0, -100, 0)).toBeNull()
  })

  it("starts at the top and goes clockwise", () => {
    // Six options: top, upper right, lower right, bottom, lower left, upper left.
    expect(aimIndex(0, -100, 6)).toBe(0)
    expect(aimIndex(87, -50, 6)).toBe(1)
    expect(aimIndex(87, 50, 6)).toBe(2)
    expect(aimIndex(0, 100, 6)).toBe(3)
    expect(aimIndex(-87, 50, 6)).toBe(4)
    expect(aimIndex(-87, -50, 6)).toBe(5)
  })

  it("sets two options left and right", () => {
    expect(aimIndex(-100, 0, 2)).toBe(0)
    expect(aimIndex(100, 0, 2)).toBe(1)
    expect(aimIndex(100, -60, 2)).toBe(1)
  })

  it("picks by direction however far out the pointer is", () => {
    expect(aimIndex(0, -40, 7)).toBe(0)
    expect(aimIndex(0, -900, 7)).toBe(0)
  })

  it("takes the nearest direction across the left, where the angle wraps", () => {
    // Seven options: the sixth stands at 167 degrees, just above the left.
    expect(aimIndex(-100, -10, 7)).toBe(5)
    expect(aimIndex(-100, 10, 7)).toBe(5)
  })
})
