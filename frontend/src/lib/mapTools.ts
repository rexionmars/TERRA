/**
 * The tools that act on the map, named once.
 *
 * These were a vertical tab rail floating over the map, so their names lived in
 * that component and the navigation column would have had to repeat them. One
 * table instead, because a label that exists twice is a label that can disagree
 * with itself -- the failure this codebase has already had with a palette and
 * with a set of table columns.
 */

export type MapToolId = "classify" | "compose" | "water"

export interface MapTool {
  id: MapToolId
  /** Shown in the navigation column, under Map. */
  label: string
}

export const MAP_TOOLS: readonly MapTool[] = [
  { id: "classify", label: "Classification" },
  { id: "compose", label: "Compositions" },
  { id: "water", label: "Surface water" },
]

/**
 * The tools the studio's band offers, which is MAP_TOOLS plus solar.
 *
 * A separate table, and deliberately NOT a fourth MapToolId. `MapToolId` is the
 * map's product table and it feeds more than the band: the navigation column
 * lists it under Map, the map screen's dock renders a panel per id, and its run
 * resolution is a ternary chain whose final branch is classification. A fourth
 * id would compile everywhere except one Record, and then read "Classify" on
 * the run button while launching a classification -- the map screen removed
 * solar from itself on purpose, and widening this union would put it back.
 *
 * Solar belongs on the BOARD because the board can do the thing the map could
 * not: name a solar raster, set its opacity and remove it, beside the run that
 * produced it. Two of the four solar products draw a raster; the band offers
 * those two and not the other two.
 */
export type BoardToolId = MapToolId | "solar"

export const BOARD_TOOLS: readonly { id: BoardToolId; label: string }[] = [
  ...MAP_TOOLS,
  { id: "solar", label: "Solar" },
]

/** Whether a board tool is one the map screen also understands. */
export function isMapTool(id: BoardToolId): id is MapToolId {
  return id !== "solar"
}
