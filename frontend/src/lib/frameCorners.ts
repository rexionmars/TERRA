/**
 * The window's frame, and the pieces of it that reach into the card's corners.
 *
 * The map is a card set in a frame of the window's own ground, the same width
 * at the top, the right and the foot. Two things need more room than that
 * edge: the traffic lights, at the top left, and the path that says where the
 * reader is, at the top right. The frame reaches down into the card's corners
 * to hold them, as the splash's base reaches up to hold the name, and in the
 * same construction (public/terra-name-tab.svg): a side falling at 60 degrees,
 * the angle of the triangular mark, a convex corner at its foot 0.28 of the
 * rise, and a concave fillet 0.32 of the rise where it leaves the frame's edge.
 * Where a piece's foot meets the card's side, the card turns its own corner
 * round it, at the container radius.
 *
 * Pure geometry, so it is computed from measured boxes and tested here; the
 * component that draws it is components/shell/ShellCorners.tsx.
 */

/** The frame's width at the top, the right and the foot of the card, in px. */
export const FRAME_EDGE = 8

/**
 * How far down a corner piece reaches, from the window's top, in px. Twice the
 * height at which macOS centres the traffic lights in a hidden title bar
 * (TitleBarHidden in main.go, 16pt), so they sit on the piece's centre line.
 */
export const FRAME_REACH = 32

/** The card's corner: the container radius, --radius-md. */
export const CARD_RADIUS = 9

/**
 * Where the traffic lights end, in px from the window's left edge, in a hidden
 * title bar on macOS 26, measured on captures of the window.
 */
export const LIGHTS_END = 69

/** How far a piece's foot keeps clear of what it holds, in px. */
const CLEARANCE = 8

const RISE = FRAME_REACH - FRAME_EDGE
const FILLET = 0.32 * RISE
const CORNER = 0.28 * RISE
/** The horizontal run of a side falling 60 degrees over the rise. */
const RUN = RISE / Math.tan(Math.PI / 3)
const COS = 0.5
const SIN = Math.sqrt(3) / 2

const n = (v: number) => String(Math.round(v * 100) / 100)

/**
 * The piece at the top left, holding the traffic lights: from the card's left
 * edge to a foot CLEARANCE past the lights. None when the card starts past
 * the lights, as it does beside the open rail, which holds them itself.
 */
export function leftCorner(cardLeft: number): string | null {
  const foot = LIGHTS_END + CLEARANCE
  if (cardLeft >= foot) return null
  const top = foot + RUN
  const r = CARD_RADIUS
  return [
    `M${n(cardLeft)} 0 H${n(top + FILLET)} V${FRAME_EDGE}`,
    `Q${n(top)} ${FRAME_EDGE} ${n(top - FILLET * COS)} ${n(FRAME_EDGE + FILLET * SIN)}`,
    `L${n(foot + CORNER * COS)} ${n(FRAME_REACH - CORNER * SIN)}`,
    `Q${n(foot)} ${FRAME_REACH} ${n(foot - CORNER)} ${FRAME_REACH}`,
    `H${n(cardLeft + r)} A${r} ${r} 0 0 0 ${n(cardLeft)} ${FRAME_REACH + r} Z`,
  ].join(" ")
}

/**
 * The piece at the top right, holding the path: from a foot CLEARANCE before
 * what it holds, which starts at `contentLeft`, to the card's right edge.
 */
export function rightCorner(contentLeft: number, cardRight: number): string {
  const foot = contentLeft - CLEARANCE
  const top = foot - RUN
  const r = CARD_RADIUS
  return [
    `M${n(cardRight)} 0 H${n(top - FILLET)} V${FRAME_EDGE}`,
    `Q${n(top)} ${FRAME_EDGE} ${n(top + FILLET * COS)} ${n(FRAME_EDGE + FILLET * SIN)}`,
    `L${n(foot - CORNER * COS)} ${n(FRAME_REACH - CORNER * SIN)}`,
    `Q${n(foot)} ${FRAME_REACH} ${n(foot + CORNER)} ${FRAME_REACH}`,
    `H${n(cardRight - r)} A${r} ${r} 0 0 1 ${n(cardRight)} ${FRAME_REACH + r} Z`,
  ].join(" ")
}

/**
 * A notch hanging from the card's top edge, in the corner pieces' construction
 * at the rise `depth`: the frame reaching down into the card's top to hold
 * something there for as long as it is open, as the location search is.
 *
 * In the notch's own box, which starts at the card's top edge: its foot is
 * `width` wide at y = `depth`, its sides rise at 60 degrees to the edge, and
 * the box is `total` wide to take the sides and their fillets. Drawn inside the
 * card, so the fillets meet the edge the frame ends at.
 */
export function hangingNotch(
  width: number,
  depth: number
): { d: string; total: number } {
  const fillet = 0.32 * depth
  const corner = 0.28 * depth
  const run = depth / Math.tan(Math.PI / 3)
  const a = fillet + run
  const b = a + width
  const total = b + run + fillet
  const d = [
    `M0 0 Q${n(a - run)} 0 ${n(a - run + fillet * COS)} ${n(fillet * SIN)}`,
    `L${n(a - corner * COS)} ${n(depth - corner * SIN)}`,
    `Q${n(a)} ${n(depth)} ${n(a + corner)} ${n(depth)} H${n(b - corner)}`,
    `Q${n(b)} ${n(depth)} ${n(b + corner * COS)} ${n(depth - corner * SIN)}`,
    `L${n(b + run - fillet * COS)} ${n(fillet * SIN)}`,
    `Q${n(b + run)} 0 ${n(total)} 0 Z`,
  ].join(" ")
  return { d, total: Number(n(total)) }
}

/**
 * A tab rising from a picture's foot at its left, in the corner pieces'
 * construction at the rise `rise`: the ground under the picture reaching up
 * into it to hold a title, as the splash's base reaches up to hold the name.
 *
 * In the tab's own box, whose left is the picture's left edge and whose
 * bottom is its foot: the tab's top is `width` wide at y = CARD_RADIUS, its
 * side falls at 60 degrees to the foot, and the box is `total` wide and
 * `height` high. Above the tab the picture turns its own corner round it, at
 * the container radius, as the card does round the corner pieces.
 */
export function risingTab(
  width: number,
  rise: number
): { d: string; total: number; height: number } {
  const r = CARD_RADIUS
  const fillet = 0.32 * rise
  const corner = 0.28 * rise
  const run = rise / Math.tan(Math.PI / 3)
  const foot = r + rise
  const root = width + run
  const total = root + fillet
  const d = [
    `M0 ${n(foot)} V0 A${r} ${r} 0 0 0 ${r} ${r} H${n(width - corner)}`,
    `Q${n(width)} ${r} ${n(width + corner * COS)} ${n(r + corner * SIN)}`,
    `L${n(root - fillet * COS)} ${n(foot - fillet * SIN)}`,
    `Q${n(root)} ${n(foot)} ${n(total)} ${n(foot)} Z`,
  ].join(" ")
  return { d, total: Number(n(total)), height: Number(n(foot)) }
}
