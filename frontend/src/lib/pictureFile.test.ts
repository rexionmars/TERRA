import { describe, expect, it } from "vitest"

import { BADGE_FIT, COVER_FIT, fitWithin } from "@/lib/pictureFile"

describe("fitWithin", () => {
  it("shrinks a camera's photograph to the cover's box, keeping its shape", () => {
    expect(fitWithin(6000, 4000, COVER_FIT.box)).toEqual({ width: 2400, height: 1600 })
  })

  it("is bound by whichever side reaches the box first", () => {
    expect(fitWithin(8000, 1000, COVER_FIT.box)).toEqual({ width: 3200, height: 400 })
  })

  it("never enlarges a picture already inside the box", () => {
    expect(fitWithin(640, 120, BADGE_FIT.box)).toEqual({ width: 640, height: 120 })
  })

  it("keeps at least one pixel on a side of an extreme strip", () => {
    expect(fitWithin(1_000_000, 10, BADGE_FIT.box)).toEqual({ width: 1200, height: 1 })
  })
})

describe("the fits", () => {
  it("send a picture unfitted only under the store's cap for it", () => {
    expect(COVER_FIT.keepBytes).toBeLessThan(4_000_000)
    expect(BADGE_FIT.keepBytes).toBeLessThan(2_000_000)
  })

  it("accept an SVG for the badge and not for the cover", () => {
    expect(BADGE_FIT.accept).toContain("image/svg+xml")
    expect(COVER_FIT.accept).not.toContain("image/svg+xml")
  })
})
