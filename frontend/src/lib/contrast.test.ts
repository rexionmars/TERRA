/**
 * The contrast arithmetic, measured against WCAG 2.x rather than against
 * itself.
 *
 * scripts/check-contrast.ts already walks every token pair and fails on one
 * that drops below its floor, but it takes its ratios FROM this module. If
 * luminance() had the sRGB branches the wrong way round, or the channel
 * weights transposed, the script would print wrong numbers with no sign of it
 * and every pair would go on "passing" -- the palette would be checked against
 * a mistake. So the expected values here are derived from the standard by
 * hand: the piecewise transfer function s/12.92 below the 0.03928 knee and
 * ((s + 0.055) / 1.055)^2.4 above it, the weights 0.2126 / 0.7152 / 0.0722,
 * and (L_lighter + 0.05) / (L_darker + 0.05). None of them was read off this
 * module's output.
 */
import { describe, expect, it } from "vitest"
import {
  ACCEPTED,
  checkContrast,
  contrast,
  luminance,
  RULES,
  TOKENS,
  type ThemeName,
} from "./contrast"

describe("luminance", () => {
  it("spans 0 to 1, the ends the formula is normalised to", () => {
    expect(luminance([0, 0, 0])).toBe(0)
    expect(luminance([255, 255, 255])).toBe(1)
  })

  it("weights the channels the way WCAG does, not equally", () => {
    // A full channel is linear-light 1 and an empty one is 0, so a primary
    // returns its own coefficient and nothing else. An implementation that
    // averaged the channels would return 1/3 for all three of these.
    expect(luminance([255, 0, 0])).toBeCloseTo(0.2126, 12)
    expect(luminance([0, 255, 0])).toBeCloseTo(0.7152, 12)
    expect(luminance([0, 0, 255])).toBeCloseTo(0.0722, 12)
  })

  it("takes the linear branch at a channel of 10 and the power branch at 11", () => {
    // The knee sits at s = 0.03928, which is channel 10.0164: 10 is the last
    // value on the linear side, 11 the first on the other. The two branches
    // very nearly meet there -- 7.5e-07 apart at 10 -- which is why a
    // misplaced comparison is invisible by eye and shows only in a test
    // carrying enough digits. It matters because the darkest tokens in the
    // palette are where a small absolute error moves a ratio most: the
    // denominator of the ratio is L + 0.05, and L for `ink` is under 0.02.
    expect(luminance([10, 10, 10])).toBeCloseTo(0.003035269835488375, 10)
    expect(luminance([11, 11, 11])).toBeCloseTo(0.0033465357638991604, 10)
  })
})

describe("contrast", () => {
  it("is 21 for white on black, the widest ratio the formula admits", () => {
    // (1 + 0.05) / (0 + 0.05). Exact, not approximate.
    expect(contrast([255, 255, 255], [0, 0, 0])).toBe(21)
  })

  it("is 1 for a colour against itself", () => {
    expect(contrast([0, 0, 0], [0, 0, 0])).toBe(1)
    expect(contrast([255, 255, 255], [255, 255, 255])).toBe(1)
    expect(contrast(TOKENS.dark.accent, TOKENS.dark.accent)).toBe(1)
  })

  it("does not depend on which colour is named first", () => {
    // The max/min are what make this hold. Written as (fg + 0.05) / (bg +
    // 0.05) it would return the reciprocal for a light token on a dark
    // surface, and every dark-theme rule would read below 1.
    const pairs = [
      [TOKENS.dark.text, TOKENS.dark.ink],
      [TOKENS.light.text, TOKENS.light.ink],
      [TOKENS.dark.accent, TOKENS.dark.accentDim],
    ] as const
    for (const [a, b] of pairs) {
      expect(contrast(a, b)).toBe(contrast(b, a))
      expect(contrast(a, b)).toBeGreaterThan(1)
    }
  })

  it("matches ratios worked out from the definition", () => {
    // Mid grey on white: L(128) = 0.21586050011389923, so the ratio is
    // 1.05 / 0.26586050011389923.
    expect(contrast([255, 255, 255], [128, 128, 128])).toBeCloseTo(
      3.9494396480491156,
      10
    )
    // Pure red on white, which exercises a single weighted channel:
    // 1.05 / 0.2626.
    expect(contrast([255, 0, 0], [255, 255, 255])).toBeCloseTo(
      3.9984767707539985,
      10
    )
    // Two tokens the interface actually paints, one per theme.
    expect(contrast(TOKENS.dark.text, TOKENS.dark.ink)).toBeCloseTo(
      11.85512560381741,
      10
    )
    expect(contrast(TOKENS.light.text, TOKENS.light.ink)).toBeCloseTo(
      14.59328097948885,
      10
    )
  })
})

describe("checkContrast", () => {
  const results = checkContrast()

  it("reports one result per rule, surface and theme", () => {
    // Derived from RULES rather than written as a count, so adding a rule does
    // not fail this for the wrong reason. What is being checked is that no
    // pair is dropped and none is walked twice -- the second is how the
    // check-contrast script once compared the dark channels against
    // themselves and reported the light theme as clean.
    const perTheme = RULES.reduce((n, rule) => n + rule.on.length, 0)
    const themes = Object.keys(TOKENS) as ThemeName[]
    expect(results).toHaveLength(perTheme * themes.length)

    const seen = new Set(results.map((r) => `${r.theme}.${r.fg}.${r.bg}`))
    expect(seen.size).toBe(results.length)
    for (const theme of themes) {
      expect(results.filter((r) => r.theme === theme)).toHaveLength(perTheme)
    }
  })

  it("carries each rule's floor and reason onto every pair it covers", () => {
    for (const r of results) {
      const rule = RULES.find((x) => x.fg === r.fg && x.on.includes(r.bg))
      expect(rule).toBeDefined()
      expect(r.min).toBe(rule?.min)
      expect(r.why).toBe(rule?.why)
    }
  })

  it("reports the ratio the formula gives, rounded to two decimals", () => {
    // Hand-derived, one per theme and spread across the rules, so a change to
    // a token's channels shows up here as a named number rather than only as a
    // pass/fail somewhere else.
    const expected: Record<string, number> = {
      "dark.text.surfaceRaised": 7.28,
      "dark.muted.surfaceRaised": 3.83,
      "dark.accentQuiet.accentDim": 5.71,
      "dark.lineStrong.surfaceRaised": 2.47,
      "dark.destructiveForeground.destructive": 5.35,
      "light.text.surface": 15.66,
      "light.accent.accentDim": 4.09,
      "light.warning.surfaceRaised": 4.61,
    }
    for (const [key, ratio] of Object.entries(expected)) {
      const r = results.find((x) => `${x.theme}.${x.fg}.${x.bg}` === key)
      expect(r, key).toBeDefined()
      expect(r?.ratio, key).toBe(ratio)
    }

    // And every reported ratio is rounded, not truncated or left raw: the
    // number is printed in a column by the script and read by a person.
    for (const r of results) {
      expect(Number(r.ratio.toFixed(2))).toBe(r.ratio)
    }
  })

  it("decides passes from the unrounded ratio, not the printed one", () => {
    // The distinction is not cosmetic. A pair measuring 2.9962 prints as 3.00
    // beside a floor of 3.0 and must still fail; deciding from the rounded
    // value would let it through and the row would look self-contradictory to
    // whoever read it.
    for (const r of results) {
      const exact = contrast(TOKENS[r.theme][r.fg], TOKENS[r.theme][r.bg])
      expect(r.passes, `${r.theme}.${r.fg}.${r.bg}`).toBe(exact >= r.min)
    }
  })

  it("finds no failing pair in the shipped palette that is not accepted", () => {
    /*
      Not "nothing fails". Three pairs do, by a decision recorded in ACCEPTED,
      and asserting an empty list here would have meant either deleting this
      test or editing the palette to suit it. Asserting the SET keeps the guard:
      a fourth failure breaks this, and so does an accepted pair that has since
      been fixed and left on the list.
    */
    const failing = results
      .filter((r) => !r.passes)
      .map((r) => `${r.theme}.${r.fg}.${r.bg}`)
    expect(failing.sort()).toEqual(Object.keys(ACCEPTED).sort())
  })
})
