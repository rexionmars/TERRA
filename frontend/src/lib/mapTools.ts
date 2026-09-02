/**
 * The three products a stored panel selection can name.
 *
 * They were a vertical tab rail floating over the map, then children of the
 * navigation column; both are gone and the run band names them now. The table
 * stays because a label that exists twice is a label that can disagree with
 * itself -- the failure this codebase has already had with a palette and with
 * a set of table columns.
 */

export type MapToolId = "classify" | "compose" | "water"

export interface MapTool {
  id: MapToolId
  label: string
}

export const MAP_TOOLS: readonly MapTool[] = [
  { id: "classify", label: "Classification" },
  { id: "compose", label: "Compositions" },
  { id: "water", label: "Surface water" },
]

/**
 * Every product the studio's band can start.
 *
 * A separate table from MAP_TOOLS, and the distinction still means something
 * with both the map screen and the navigation column gone: `MapToolId` is what
 * a stored panel selection can be, and widening it would make a value the
 * store has never written suddenly representable.
 *
 * Solar, wind and flood joined by being ported rather than by being wrapped.
 * Each had a screen of its own -- Energy carried solar and wind, Flood carried
 * the envelope -- and each screen was a fixed answer to "what do you want to
 * see" for a product whose parameters are a handful of numbers. They are cards
 * on the graph now, beside the area and the period they read.
 */
export type BoardToolId = MapToolId | "solar" | "wind" | "flood"

export const BOARD_TOOLS: readonly { id: BoardToolId; label: string }[] = [
  ...MAP_TOOLS,
  { id: "solar", label: "Solar" },
  { id: "wind", label: "Wind" },
  { id: "flood", label: "Flood envelope" },
]

/** Whether a board tool is one the stored panel selection can hold. */
export function isMapTool(id: BoardToolId): id is MapToolId {
  return id !== "solar" && id !== "wind" && id !== "flood"
}
