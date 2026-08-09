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
