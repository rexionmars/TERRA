/**
 * The three products a stored panel selection can name.
 *
 * They were a vertical tab rail floating over the map, then children of the
 * navigation column; both are gone and the run band names them now. The table
 * stays because a label that exists twice is a label that can disagree with
 * itself -- the failure this codebase has already had with a palette and with
 * a set of table columns.
 */

import type { StudioGroup } from "@/lib/studioEditors"

/**
 * The three ids a stored panel selection can name, as values.
 *
 * IDS AND NOT A TABLE, which is the change that let BOARD_TOOLS below become
 * the only place a product's label is written. This list used to carry the
 * labels too and BOARD_TOOLS spread it, so the two agreed by construction --
 * until the board's row had to be ORDERED by subject, which a spread cannot
 * do. Keeping the labels here as well would have been the failure this file's
 * own header names: a label that exists twice is a label that can disagree
 * with itself.
 *
 * What is left here is the thing MAP_TOOLS was actually for -- constraining
 * what a stored selection may be -- and it is the narrower of the two lists,
 * so it is the one that has to be stated.
 */
const MAP_TOOL_IDS = ["classify", "compose", "water"] as const

export type MapToolId = (typeof MAP_TOOL_IDS)[number]

export interface MapTool {
  id: MapToolId
  label: string
}

/**
 * Every product the studio's band can start.
 *
 * A separate name from MapToolId, and the distinction still means something
 * with both the map screen and the navigation column gone: `MapToolId` is what
 * a stored panel selection can be, and widening it would make a value the
 * store has never written suddenly representable. The mineral map is the one
 * product the band offers that is not a map tool: it was added to the band
 * alone, after the panels were gone, so it is added here and not there.
 */
export type BoardToolId = MapToolId | "mineral"

/**
 * Every product the band can start, and the subject each one answers about.
 *
 * The groups are the studio's own -- the same three the workspace bar and the
 * editor menu use, from the same table in studioEditors -- so a reader who has
 * learnt "Land cover" on either of those has learnt it here. What they buy in
 * a row this short is not navigation but a statement: each product sits under
 * the subject it answers about.
 *
 * COMPOSITIONS IS `board` AND NOT `crop`, which is the one call here worth
 * disagreeing with. Classification answers what the ground IS; a composition
 * is a way of LOOKING at the imagery, in whatever bands the question wants,
 * and is as useful over a reservoir as over a field. It sits with the
 * arrangement rather than with the subject.
 */
export interface BoardTool {
  id: BoardToolId
  label: string
  group: StudioGroup
}

export const BOARD_TOOLS: readonly BoardTool[] = [
  { id: "compose", label: "Compositions", group: "board" },
  { id: "classify", label: "Classification", group: "crop" },
  /*
    Land cover and not a subject of its own. The mineral map answers what the
    exposed surface is made of, which is the classification's question asked
    of a spectrometer instead of a multispectral imager; a fourth group for one
    product would be a menu of one in a bar of three.
  */
  { id: "mineral", label: "Mineral map", group: "crop" },
  { id: "water", label: "Surface water", group: "water" },
]

/**
 * Whether a board tool is one the stored panel selection can hold.
 *
 * AN ALLOWLIST, AND IT HAS TO BE. This was written as the complement -- a
 * list of the board-only ids it excluded -- which is a denylist wearing a type
 * predicate. A predicate is ASSERTED, not checked: adding a fourth board tool
 * made this return true for it, TypeScript said nothing, and the stored panel
 * selection could then hold a value MapToolId has never contained. That is
 * exactly what the header above says the two tables exist to prevent, so the
 * check now reads the table it is about.
 */
export function isMapTool(id: BoardToolId): id is MapToolId {
  return (MAP_TOOL_IDS as readonly string[]).includes(id)
}

/**
 * The three, derived rather than declared, so they cannot fall out of step
 * with the board's row or carry a second copy of a label.
 */
export const MAP_TOOLS: readonly MapTool[] = BOARD_TOOLS.filter(
  (t): t is BoardTool & { id: MapToolId } => isMapTool(t.id)
)
