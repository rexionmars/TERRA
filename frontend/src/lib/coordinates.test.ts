import { describe, expect, it } from "vitest"

import { formatLatLon } from "./coordinates"

describe("formatLatLon", () => {
  it("writes latitude then longitude at six decimals", () => {
    expect(formatLatLon(-24.9326804, -53.45874)).toBe("-24.932680, -53.458740")
    expect(formatLatLon(0, 0)).toBe("0.000000, 0.000000")
  })
})
