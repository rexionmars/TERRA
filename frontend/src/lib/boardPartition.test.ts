// @vitest-environment node
/**
 * The studio's partition, checked against the rules its own comments state.
 *
 * The module exists because the same widths used to be written in ten places
 * and drifted apart four times. Its clamps are now the only guard between a
 * dragged edge and a column that has swallowed the board, so the numbers below
 * are worked out from the stated rules -- floor 11rem, ceiling three tenths of
 * the window, detail band 3.5 to 22rem, folded to 1.25rem -- and from the
 * arithmetic those rules imply. None was read off the module's output; a test
 * that recorded what the code prints would keep passing through the drift it
 * is here to catch.
 *
 * The environment is pinned to node in the line above rather than inherited
 * from vite.config.ts, because two branches under test are the ones taken when
 * there is no window and no document: `columnMaxRem` assumes a 1000px viewport
 * and `remToPx` a 16px root. Under jsdom those branches are never entered, so
 * the file would go on passing while testing something else.
 */
import { describe, expect, it } from "vitest"
import {
  BOARD_COL_MIN_REM,
  BOARD_DETAIL_COLLAPSED_REM,
  BOARD_DETAIL_MAX_REM,
  BOARD_DETAIL_MIN_REM,
  BOARD_DETAIL_REM,
  BOARD_LEFT_REM,
  BOARD_RIGHT_REM,
  BOARD_RUN_BAND_REM,
  MAP_FOOT_REM,
  boardPartition,
  clampColumn,
  clampDetail,
  columnMaxRem,
  partitionVars,
  remToPx,
  type BoardPartition,
} from "./boardPartition"

/**
 * The ceiling at the viewport the headless branch assumes.
 *
 * 1000 * 0.3 / 16. Written out rather than computed from the constants so that
 * a changed share fails here and names itself, instead of being carried into
 * every expectation below.
 */
const CEILING_AT_1000 = 18.75

describe("columnMaxRem", () => {
  it("returns three tenths of the viewport, in rem, when that clears the floor", () => {
    // 1920 * 0.3 = 576 device pixels, which is 36rem at a 16px root and 18rem
    // at 32. The root is a divisor, not a fixed 16: a ceiling that ignored it
    // would let one column take 60 per cent of a large-text window.
    expect(columnMaxRem(1920, 16)).toBe(36)
    expect(columnMaxRem(1920, 32)).toBe(18)
    expect(columnMaxRem(1000, 16)).toBe(CEILING_AT_1000)
  })

  it("returns the floor when three tenths of the viewport falls below it", () => {
    // 586 * 0.3 / 16 = 10.9875rem, under the 11rem floor. The floor wins, so
    // the ceiling is never below it and the two bounds cannot cross -- which
    // is what stops a clamp from having an empty range on a narrow window.
    expect(columnMaxRem(586, 16)).toBe(BOARD_COL_MIN_REM)
    expect(columnMaxRem(320, 16)).toBe(BOARD_COL_MIN_REM)
  })

  it("returns the floor where the share equals it, and the share just above", () => {
    // The crossing point: 1100 * 0.3 / 30 is exactly 11, so both branches
    // agree there. One pixel of window either side of the equivalent 16px-root
    // crossing (586.6px) separates them: 10.9875 clamps up, 11.00625 does not.
    expect(columnMaxRem(1100, 30)).toBe(BOARD_COL_MIN_REM)
    expect(columnMaxRem(587, 16)).toBe(11.00625)
  })

  it("assumes a 1000px window when none is given and no window object exists", () => {
    // The headless default, which is what every server-side or test call gets.
    // Asserted through typeof rather than assumed, so that moving the runner
    // to jsdom fails here rather than quietly measuring against innerWidth.
    expect(typeof window).toBe("undefined")
    expect(columnMaxRem()).toBe(CEILING_AT_1000)
  })
})

describe("clampColumn", () => {
  it("returns a width between the bounds unchanged", () => {
    expect(clampColumn(13, 1000)).toBe(13)
    expect(clampColumn(BOARD_RIGHT_REM, 1000)).toBe(BOARD_RIGHT_REM)
  })

  it("returns the floor for a width at or below it", () => {
    // 11 exactly is admissible, not clamped: the floor is where a class name
    // still fits beside its swatch, so the column is usable there.
    expect(clampColumn(BOARD_COL_MIN_REM, 1000)).toBe(BOARD_COL_MIN_REM)
    expect(clampColumn(10.999, 1000)).toBe(BOARD_COL_MIN_REM)
    expect(clampColumn(0, 1000)).toBe(BOARD_COL_MIN_REM)
    expect(clampColumn(-40, 1000)).toBe(BOARD_COL_MIN_REM)
  })

  it("returns the ceiling for a width at or above it", () => {
    expect(clampColumn(CEILING_AT_1000, 1000)).toBe(CEILING_AT_1000)
    expect(clampColumn(CEILING_AT_1000 + 0.01, 1000)).toBe(CEILING_AT_1000)
    expect(clampColumn(400, 1000)).toBe(CEILING_AT_1000)
  })

  it("admits a width on a wide window that the same drag exceeds on a narrow one", () => {
    // 30rem is under the 36rem ceiling at 1920 and over the 18.75rem ceiling
    // at 1000. A fixed ceiling chosen for the large window is the case the
    // module's comment describes as a partition that swallows its surface.
    expect(clampColumn(30, 1920)).toBe(30)
    expect(clampColumn(30, 1000)).toBe(CEILING_AT_1000)
  })

  it("returns the default left width for a non-finite width", () => {
    // NaN is not a width, so there is nothing to clamp towards; the seed is
    // returned instead. This is the value a drag reaching through an unparsed
    // custom property produces, and returning NaN would propagate into the
    // published lengths.
    expect(clampColumn(Number.NaN, 1000)).toBe(BOARD_LEFT_REM)
    expect(clampColumn(Number.POSITIVE_INFINITY, 1000)).toBe(BOARD_LEFT_REM)
  })

  it("keeps even that fallback under the ceiling on a narrow window", () => {
    // At 400px the ceiling is the 11rem floor, below the 15rem seed. The
    // fallback is bounded too, or recovering from a bad width would be a way
    // to obtain a column wider than the window allows.
    expect(clampColumn(Number.NaN, 400)).toBe(BOARD_COL_MIN_REM)
  })
})

describe("clampDetail", () => {
  it("returns a height between the bounds unchanged", () => {
    expect(clampDetail(5)).toBe(5)
    expect(clampDetail(BOARD_DETAIL_REM)).toBe(BOARD_DETAIL_REM)
  })

  it("returns the floor for a height at or below it", () => {
    expect(clampDetail(BOARD_DETAIL_MIN_REM)).toBe(BOARD_DETAIL_MIN_REM)
    expect(clampDetail(3.4999)).toBe(BOARD_DETAIL_MIN_REM)
    expect(clampDetail(0)).toBe(BOARD_DETAIL_MIN_REM)
    expect(clampDetail(-10)).toBe(BOARD_DETAIL_MIN_REM)
  })

  it("returns the ceiling for a height at or above it", () => {
    expect(clampDetail(BOARD_DETAIL_MAX_REM)).toBe(BOARD_DETAIL_MAX_REM)
    expect(clampDetail(22.0001)).toBe(BOARD_DETAIL_MAX_REM)
    expect(clampDetail(1000)).toBe(BOARD_DETAIL_MAX_REM)
  })

  it("returns the seed height for a non-finite height", () => {
    expect(clampDetail(Number.NaN)).toBe(BOARD_DETAIL_REM)
    expect(clampDetail(Number.POSITIVE_INFINITY)).toBe(BOARD_DETAIL_REM)
    expect(clampDetail(Number.NEGATIVE_INFINITY)).toBe(BOARD_DETAIL_REM)
  })

  it("leaves the seed height inside its own bounds", () => {
    // The seed is derived (run band twice, plus 1.25) while the bounds are
    // literals, so nothing but this ties them together. A seed outside them
    // would mean the band opens at one height and jumps on first drag.
    expect(BOARD_DETAIL_REM).toBeGreaterThan(BOARD_DETAIL_MIN_REM)
    expect(BOARD_DETAIL_REM).toBeLessThan(BOARD_DETAIL_MAX_REM)
  })

  it("does not admit the folded height, which is below the drag floor", () => {
    // Folded is 1.25rem and the floor is 3.5, so no drag can reach the folded
    // height. That gap is what makes the two states distinguishable in the
    // value alone, without a second flag travelling beside it.
    expect(BOARD_DETAIL_COLLAPSED_REM).toBeLessThan(BOARD_DETAIL_MIN_REM)
    expect(clampDetail(BOARD_DETAIL_COLLAPSED_REM)).toBe(BOARD_DETAIL_MIN_REM)
    // Above zero, though: the band is fixed furniture across all three
    // analyses, and folding gives back its body, not the strip that unfolds
    // it. At zero there is nothing left to click and the fold is one-way.
    expect(BOARD_DETAIL_COLLAPSED_REM).toBeGreaterThan(0)
  })
})

describe("boardPartition", () => {
  it("returns the seed geometry when given no state", () => {
    // Both seeds sit under the 18.75rem ceiling of the assumed window, so they
    // survive their own clamp. If either stopped doing so, the studio would
    // open at a width no one chose.
    expect(boardPartition()).toEqual({
      leftRem: BOARD_LEFT_REM,
      rightRem: BOARD_RIGHT_REM,
      runBandRem: BOARD_RUN_BAND_REM,
      detailRem: BOARD_DETAIL_REM,
    })
  })

  it("seeds both columns inside their own bounds", () => {
    // The test above compares the result against the constants it is seeded
    // from, so it would pass just as well with a seed the clamp then moved.
    // This is what makes it more than a restatement: a seed outside the bounds
    // opens the studio at a width no drag could have produced.
    const max = columnMaxRem(1000)
    for (const seed of [BOARD_LEFT_REM, BOARD_RIGHT_REM]) {
      expect(seed).toBeGreaterThanOrEqual(BOARD_COL_MIN_REM)
      expect(seed).toBeLessThanOrEqual(max)
    }
  })

  it("returns the same geometry for an empty state as for no state", () => {
    expect(boardPartition({})).toEqual(boardPartition())
  })

  it("clamps both columns and the band height it is given", () => {
    // 40rem is over the ceiling, 4rem under the floor, 100rem over the band's
    // ceiling. Clamping here rather than at the control is what stops a stored
    // width from an older, wider window reopening out of bounds.
    expect(boardPartition({ leftRem: 40, rightRem: 4, detailRem: 100 })).toEqual({
      leftRem: CEILING_AT_1000,
      rightRem: BOARD_COL_MIN_REM,
      runBandRem: BOARD_RUN_BAND_REM,
      detailRem: BOARD_DETAIL_MAX_REM,
    })
  })

  it("returns the folded height when collapsed, whatever height was dragged", () => {
    expect(boardPartition({ detailRem: 20, detailCollapsed: true }).detailRem).toBe(
      BOARD_DETAIL_COLLAPSED_REM
    )
    expect(boardPartition({ detailCollapsed: true }).detailRem).toBe(
      BOARD_DETAIL_COLLAPSED_REM
    )
  })

  it("returns the dragged height when not collapsed", () => {
    // The dragged height has to survive the fold, or unfolding would lose it.
    expect(boardPartition({ detailRem: 12, detailCollapsed: false }).detailRem).toBe(12)
    expect(boardPartition({ detailRem: 12 }).detailRem).toBe(12)
  })

  it("leaves the run band fixed, since no state moves it", () => {
    expect(boardPartition({ leftRem: 12, detailRem: 20 }).runBandRem).toBe(
      BOARD_RUN_BAND_REM
    )
  })

  it("clamps a zero width rather than treating it as absent", () => {
    // Zero is a width, and a falsy one. Read with `||` instead of `??` these
    // would return the seeds, so a column dragged shut would reopen at 15rem
    // instead of stopping at its floor.
    const p = boardPartition({ leftRem: 0, rightRem: 0, detailRem: 0 })
    expect(p.leftRem).toBe(BOARD_COL_MIN_REM)
    expect(p.rightRem).toBe(BOARD_COL_MIN_REM)
    expect(p.detailRem).toBe(BOARD_DETAIL_MIN_REM)
  })

  it("treats a null field as absent and returns the seed for it", () => {
    // Persisted state arrives as JSON, where an absent field can come back as
    // null. `??` catches it; Math.max would have read it as zero and clamped
    // to the floor, so the column would narrow itself on every reload.
    const stored = { leftRem: null, detailRem: null } as unknown as {
      leftRem?: number
      detailRem?: number
    }
    const p = boardPartition(stored)
    expect(p.leftRem).toBe(BOARD_LEFT_REM)
    expect(p.detailRem).toBe(BOARD_DETAIL_REM)
  })
})

describe("partitionVars", () => {
  const dragged: BoardPartition = {
    leftRem: 12.5,
    rightRem: BOARD_RIGHT_REM,
    runBandRem: BOARD_RUN_BAND_REM,
    detailRem: BOARD_DETAIL_REM,
  }

  it("publishes every region of the partition as a rem length", () => {
    expect(partitionVars(dragged, false)).toEqual({
      "--board-left": "12.5rem",
      "--board-right": "15.9375rem",
      "--map-band": "4rem",
      "--map-stats": "9.25rem",
      "--map-foot": "3.0625rem",
    })
  })

  it("reserves no foot while the studio is open", () => {
    // The bands are areas inside the studio then, not docked chrome, so a
    // reservation would be space held for surfaces that have moved.
    const open = partitionVars(dragged, true)
    expect(open["--map-foot"]).toBe("0rem")
    expect(open["--board-left"]).toBe("12.5rem")
    expect(open["--map-stats"]).toBe("9.25rem")
  })

  it("reserves the workspace bar's height while the studio is closed", () => {
    expect(partitionVars(dragged, false)["--map-foot"]).toBe(`${MAP_FOOT_REM}rem`)
  })

  it("emits plain lengths that parseFloat can read, never calc()", () => {
    // The failure this prevents is named in the module: a calc() expression
    // reads back as NaN, NaN is treated as zero clearance, and the scene's
    // overlay lands underneath the bands it was measured to clear.
    for (const state of [true, false]) {
      for (const value of Object.values(partitionVars(dragged, state))) {
        expect(value).toMatch(/^-?\d+(\.\d+)?rem$/)
        expect(Number.isFinite(parseFloat(value))).toBe(true)
      }
    }
  })
})

describe("remToPx", () => {
  it("multiplies a rem length by the root", () => {
    expect(remToPx("12rem", 16)).toBe(192)
    expect(remToPx("1.5rem", 10)).toBe(15)
    expect(remToPx("-2rem", 16)).toBe(-32)
    expect(remToPx("0rem", 16)).toBe(0)
  })

  it("returns a px length as it stands, whatever the root", () => {
    expect(remToPx("12px", 16)).toBe(12)
    expect(remToPx("12px", 32)).toBe(12)
  })

  it("reads a bare number as rem and converts it", () => {
    // The partition is authored in rem, so an unlabelled number is one.
    expect(remToPx(12, 16)).toBe(192)
    expect(remToPx(0, 16)).toBe(0)
    expect(remToPx(-1.5, 16)).toBe(-24)
  })

  it("ignores whitespace around the length", () => {
    // Values read back off a stylesheet carry it.
    expect(remToPx(" 12rem ", 16)).toBe(192)
    expect(remToPx("\n4rem\t", 16)).toBe(64)
  })

  it("returns 0 for a string carrying no unit it knows", () => {
    // Zero, not the bare figure: "12" in a place expecting a length is a
    // measurement that has lost its unit, and treating it as 12 pixels would
    // silently be a sixteenth of what was meant.
    expect(remToPx("12", 16)).toBe(0)
    expect(remToPx("12em", 16)).toBe(0)
    expect(remToPx("50%", 16)).toBe(0)
  })

  it("returns 0 for a string with no number in it", () => {
    expect(remToPx("", 16)).toBe(0)
    expect(remToPx("auto", 16)).toBe(0)
    expect(remToPx("rem", 16)).toBe(0)
  })

  it("returns 0 for a calc() expression, which is why none is published", () => {
    // parseFloat("calc(...)") is NaN. This is the reading that once buried the
    // axis gizmo, kept here beside partitionVars' guarantee that it never
    // emits one, so the two halves of that argument fail together.
    expect(remToPx("calc(2rem + 1px)", 16)).toBe(0)
  })

  it("assumes a 16px root when there is no document to measure", () => {
    // The headless branch, the one every call outside a browser takes.
    expect(typeof document).toBe("undefined")
    expect(remToPx("12rem")).toBe(192)
    expect(remToPx(2)).toBe(32)
  })
})
