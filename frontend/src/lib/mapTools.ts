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
 * A separate table from MAP_TOOLS, and the distinction still means something
 * with both the map screen and the navigation column gone: `MapToolId` is what
 * a stored panel selection can be, and widening it would make a value the
 * store has never written suddenly representable.
 *
 * Flood joined by being ported rather than by being wrapped. It had a screen
 * of its own, and that screen was a fixed answer to "what do you want to see"
 * for a product whose parameters are a handful of numbers. It is a card on the
 * graph now, beside the area it reads.
 */
export type BoardToolId = MapToolId | "flood"

/**
 * Every product the band can start, and the subject each one answers about.
 *
 * The groups are the studio's own -- the same three the workspace bar and the
 * editor menu use, from the same table in studioEditors -- so a reader who has
 * learnt "Water" on either of those has learnt it here. What they buy in a row
 * this short is not navigation but a statement: Surface water and Flood
 * envelope are two readings of one subject and sit together.
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
  { id: "water", label: "Surface water", group: "water" },
  { id: "flood", label: "Flood envelope", group: "water" },
]

/**
 * Whether a board tool is one the stored panel selection can hold.
 *
 * AN ALLOWLIST, AND IT HAS TO BE. This was written as the complement -- `id
 * !== "solar" && id !== "wind" && id !== "flood"` -- which is a denylist
 * wearing a type predicate. A predicate is ASSERTED, not checked: adding a
 * fourth board tool made this return true for it, TypeScript said nothing, and
 * the stored panel selection could then hold a value MapToolId has never
 * contained. That is exactly what the header above says the two tables exist to
 * prevent, so the check now reads the table it is about.
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
