/**
 * The studio's partition, said once.
 *
 * WHAT THIS REPLACES. The studio's geometry lived as literals repeated across
 * files: the left column's width was written in six places -- BoardSidebar's
 * own class, boardScene's `sideColPx`, the two bands' `leftOffset`, and the
 * title bar's brand box -- and the right column's in four. Each pair was a
 * promise that two numbers written apart would stay equal, and the promise
 * broke four times in recent work: the run band ran on underneath the right
 * column, the axis gizmo cleared the left column's width on the right side,
 * the detail band left a gap the column had grown into, and the compare modal
 * measured against a column it did not know had moved.
 *
 * Blender does not solve this with care. An area there holds four corner
 * vertices SHARED with its neighbours, so moving an edge moves both sides by
 * construction and overlap is not merely discouraged -- it cannot be
 * expressed. This module is the same idea at the scale this application needs:
 * one description of the rectangles, from which every surface derives its own.
 * A seam cannot drift because there is only one number to drift from.
 *
 * NO REACT AND NO THREE, deliberately. boardScene states that it must not pull
 * React chrome, and that constraint is why it carried its own copy of the
 * column width in the first place. A module of numbers and pure functions is
 * importable from both sides, which removes the reason the copy existed.
 *
 * REM, NOT PIXELS, as the unit. The application is authored in rem and the
 * bands are laid out in CSS; a pixel model would convert at every boundary and
 * would not survive a change of root font size. Pixels are produced at the one
 * place that needs them -- the WebGL scene, which positions an overlay in
 * device pixels -- through `remToPx` here rather than a second copy there.
 *
 * This step changes no geometry. Every default below is the value that was in
 * force before it, so the acceptance test is that nothing moves.
 */

/** Left column: the outliner (scene, data, areas). */
export const BOARD_LEFT_REM = 15

/**
 * The floor a column may be dragged to.
 *
 * Where it stops being able to show a row: a class name beside its swatch, or
 * a tree row beside its glyph. Below this the column is present and useless,
 * which is worse than absent.
 */
export const BOARD_COL_MIN_REM = 11

/**
 * The share of the window one column may take.
 *
 * A FRACTION, NOT A CONSTANT. A fixed ceiling has to be chosen for one window
 * size and is wrong for the others: 30rem leaves a usable board at 1920px and
 * leaves forty pixels of it at the application's 1000px minimum, which is a
 * partition that has swallowed the surface it divides. At 30 per cent each,
 * the two columns never take more than three fifths of the window whatever
 * its size.
 */
export const BOARD_COL_MAX_SHARE = 0.3

/** The ceiling in rem for a given viewport, never below the floor. */
export function columnMaxRem(viewportPx?: number, rootPx = 16): number {
  const w =
    viewportPx ?? (typeof window === "undefined" ? 1000 : window.innerWidth)
  return Math.max(BOARD_COL_MIN_REM, (w * BOARD_COL_MAX_SHARE) / rootPx)
}

/**
 * Right column: the selection readout.
 *
 * 15.9375rem rather than 15: the column carries class names beside their
 * hectares and percentages, and the extra 15px was asked for to stop them
 * truncating. The band's recess and both right-hand columns derive from this
 * one number, which is what stops the seam reopening when it changes.
 */
export const BOARD_RIGHT_REM = 15.9375

/** The run band at the very foot: tools and run parameters. */
export const BOARD_RUN_BAND_REM = 4

/**
 * The detail band resting on the run band.
 *
 * Its height is the one part of the partition the user already moves, by
 * dragging the band's top edge, so it travels as state rather than as a
 * constant. These bound and seed that state.
 */
export const BOARD_DETAIL_REM = BOARD_RUN_BAND_REM * 2 + 1.25
export const BOARD_DETAIL_MIN_REM = 3.5
export const BOARD_DETAIL_MAX_REM = 22

/**
 * What the band folds down to: its grip, and nothing else.
 *
 * Not zero. The studio holds land cover, solar and wind, and the band is fixed
 * furniture across all three -- collapsing gives back its body, not the edge
 * that unfolds it. 1.25rem rather than the grip's own 10px because the strip
 * carries a chevron that has to be clicked.
 */
export const BOARD_DETAIL_COLLAPSED_REM = 1.25

/**
 * What the map screen's own foot reserves when the studio is closed.
 *
 * The workspace bar's height. `--map-foot` is a contract with seven surfaces
 * outside the studio -- the result, water, composition and energy panels, the
 * overlay tools, PanelShell and the workspace bar itself -- which lift
 * themselves off the foot by reading it. It therefore has a meaning on the
 * plain map screen too, and the partition emits it in both states rather than
 * only while the studio is open.
 */
export const MAP_FOOT_REM = 3.0625

/**
 * The studio's rectangles, in rem.
 *
 * Held as one value so that a caller cannot update half of it. Every field is
 * a width or a height of one region; positions are derived, since a partition
 * of a rectangle has no free positions once its divisions are known.
 */
export interface BoardPartition {
  leftRem: number
  rightRem: number
  runBandRem: number
  /** The detail band's effective height: folded or as dragged. */
  detailRem: number
}

/**
 * The partition for a given studio state.
 *
 * `detailRem` is clamped here rather than at the call site: the reservation
 * `--map-foot` is derived from it, and a bound that lived with the control
 * rather than with the value would let a caller reserve a foot the window
 * cannot give.
 */
export function boardPartition(state?: {
  leftRem?: number
  rightRem?: number
  detailRem?: number
  detailCollapsed?: boolean
}): BoardPartition {
  const dragged = clampDetail(state?.detailRem ?? BOARD_DETAIL_REM)
  return {
    leftRem: clampColumn(state?.leftRem ?? BOARD_LEFT_REM),
    rightRem: clampColumn(state?.rightRem ?? BOARD_RIGHT_REM),
    runBandRem: BOARD_RUN_BAND_REM,
    detailRem: state?.detailCollapsed ? BOARD_DETAIL_COLLAPSED_REM : dragged,
  }
}

/**
 * A dragged column width, kept inside its bounds.
 *
 * The ceiling is a share of the viewport, so the bound moves with the window
 * rather than being right for one size. Pass the width explicitly where it is
 * known; the default reads it, which makes this the one impure function here.
 */
export function clampColumn(rem: number, viewportPx?: number): number {
  const max = columnMaxRem(viewportPx)
  if (!Number.isFinite(rem)) return Math.min(max, BOARD_LEFT_REM)
  return Math.min(max, Math.max(BOARD_COL_MIN_REM, rem))
}

/** The dragged height, kept inside its bounds. */
export function clampDetail(rem: number): number {
  if (!Number.isFinite(rem)) return BOARD_DETAIL_REM
  return Math.min(BOARD_DETAIL_MAX_REM, Math.max(BOARD_DETAIL_MIN_REM, rem))
}

/**
 * The custom properties the partition publishes.
 *
 * Plain lengths, never `calc()`. boardScene reads `--map-foot` back with
 * parseFloat to place an overlay in pixels, and parseFloat of a calc()
 * expression is NaN -- which reads as zero clearance and puts the overlay
 * underneath the bands it was measured to clear.
 *
 * The column widths are published as well, so the scene can read them at
 * runtime instead of holding a copy. That is what lets them become draggable
 * without a second edit in a file that must not import React.
 */
export function partitionVars(
  p: BoardPartition,
  studioOpen: boolean
): Record<string, string> {
  return {
    "--board-left": `${p.leftRem}rem`,
    "--board-right": `${p.rightRem}rem`,
    "--map-band": `${p.runBandRem}rem`,
    "--map-stats": `${p.detailRem}rem`,
    /*
      Nothing stands in the map's foot while the studio is open.

      This reserved the run band plus the detail band -- 13.25rem -- on the
      premise that both were docked foot chrome. They are areas now, inside
      the studio's own partition, so the reservation was space held for
      surfaces that had moved. Zero, and the map's own foot when it is closed.
    */
    "--map-foot": studioOpen ? "0rem" : `${MAP_FOOT_REM}rem`,
  }
}

/**
 * A CSS length in rem or px, as pixels.
 *
 * A custom property that is not registered with `@property` computes to its
 * token stream, so reading one back gives the literal "12rem" -- and
 * parseFloat of that is 12, not 192. Every consumer that wants pixels goes
 * through this, so the unit error that once buried the axis gizmo under two
 * bands has one place to be wrong rather than several.
 */
export function remToPx(value: string | number, rootPx?: number): number {
  const root =
    rootPx ??
    (typeof document === "undefined"
      ? 16
      : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
  if (typeof value === "number") return value * root
  const raw = value.trim()
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return 0
  if (raw.endsWith("rem")) return n * root
  return raw.endsWith("px") ? n : 0
}
