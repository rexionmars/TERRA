/**
 * Every product the run panel can start, and what each is called.
 *
 * One table because a label that exists twice is a label that can disagree with
 * itself -- the failure this codebase has already had with a palette and with a set
 * of table columns.
 */
export type BoardToolId =
  | "classify"
  | "compose"
  | "water"
  | "mineral"
  | "fields"
  | "health"
  | "overlap"
  | "radar"
  | "zones"

/**
 * A product the Products panel lists: every tool but compositions, which are a way
 * of looking at one scene rather than a run and have the Visualization panel.
 */
export type ProductId = Exclude<BoardToolId, "compose">

export function isProductId(id: BoardToolId): id is ProductId {
  return id !== "compose"
}

export interface BoardTool {
  id: BoardToolId
  label: string
}

export const BOARD_TOOLS: readonly BoardTool[] = [
  { id: "compose", label: "Compositions" },
  { id: "classify", label: "Classification" },
  { id: "mineral", label: "Mineral map" },
  { id: "fields", label: "Field boundaries" },
  { id: "health", label: "Vegetation health" },
  { id: "overlap", label: "Socio-environmental overlap" },
  { id: "radar", label: "Sentinel-1 radar" },
  { id: "zones", label: "Management zones" },
  { id: "water", label: "Surface water" },
]
