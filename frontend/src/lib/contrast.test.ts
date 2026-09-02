/**
 * The APCA implementation, against values it must reproduce.
 *
 * Written because the first pass of this was checked against four numbers, one
 * of which was recalled rather than looked up -- and the recalled one was
 * wrong. Three exact matches and one miss is how an implementation looks when
 * it is correct and the test is not, which is indistinguishable at a glance
 * from the reverse.
 *
 * The values below are derived from the published algorithm rather than from
 * memory: black on white and white on black are the two poles APCA is
 * normalised against, and the #888 pair exercises the polarity branch in both
 * directions from one colour.
 */
import { describe, expect, it } from "vitest"

import { apca, contrast, TOKENS } from "@/lib/contrast"

const BLACK = [0, 0, 0] as const
const WHITE = [255, 255, 255] as const
const GREY = [136, 136, 136] as const

describe("apca", () => {
  it("reproduces the poles it is normalised against", () => {
    expect(apca(BLACK, WHITE)).toBeCloseTo(106.04, 1)
    expect(apca(WHITE, BLACK)).toBeCloseTo(-107.88, 1)
  })

  it("signs the polarity", () => {
    // Positive is dark on light, negative is light on dark. The magnitudes
    // differ on purpose: the same two colours are not equally readable both
    // ways round, which is the whole reason the ratio is not enough.
    expect(apca(GREY, WHITE)).toBeCloseTo(63.06, 1)
    expect(apca(WHITE, GREY)).toBeCloseTo(-68.54, 1)
  })

  it("returns zero where the pair is below the clip", () => {
    // Two colours a hair apart are not a contrast; APCA clips rather than
    // reporting a number that would round to something usable.
    expect(apca(GREY, GREY)).toBe(0)
    expect(apca([136, 136, 136], [140, 140, 140])).toBe(0)
  })

  it("disagrees with the ratio where the ratio is known to overstate", () => {
    /*
      The pair this whole addition is about. `line` on `ink` is two near-blacks:
      WCAG 2 reports a number, and APCA clips it to nothing because there is no
      readable contrast there at all. The token is a hairline, not text -- but
      the two rulers saying different things is the point.
    */
    const { line, ink } = TOKENS.dark
    expect(contrast(line, ink)).toBeGreaterThan(1.5)
    expect(Math.abs(apca(line, ink))).toBeLessThan(25)
  })
})
