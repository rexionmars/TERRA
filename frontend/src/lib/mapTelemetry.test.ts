import { describe, expect, it } from "vitest"

import { formatGround } from "./mapTelemetry"

describe("formatGround", () => {
  it("keeps every scale short enough for the strip", () => {
    expect(formatGround(78271)).toBe("78km")
    expect(formatGround(4890)).toBe("4.9km")
    expect(formatGround(152)).toBe("152m")
    expect(formatGround(8.66)).toBe("8.7m")
    expect(formatGround(1.19)).toBe("1.2m")
    expect(formatGround(0.6)).toBe("60cm")
  })
})
