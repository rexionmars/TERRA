/**
 * What a run is made of, stated as a graph.
 *
 * The run editor used to be a band: one row of groups with dividers between
 * them, scrolling sideways, built for the 4rem foot it originally stood in.
 * Inside a studio area that shape spent the height on nothing -- a low strip
 * centred in a tall rectangle -- and the dividers were doing the work that
 * separate surfaces do better.
 *
 * THE EDGES ARE NOT DECORATION AND THEY ARE NOT A PIPELINE. A classification
 * request carries a geometry, a date range with its cloud ceiling, and a model;
 * the period does not consume the area and the model does not consume the
 * period. Drawing them as a chain would assert an order the request does not
 * have. What is true is a fan-in: several inputs, one run. That is what is
 * drawn, and it is also why nothing here is rewireable -- the shape is the
 * request's, not an arrangement someone chose.
 *
 * The one real dependency is solar's product. Irradiation reads a record and a
 * season, siting reads two slope limits, and neither set means anything under
 * the other product -- so the product GATES them, and an edge from it to each
 * says which choice put them on screen.
 */
import {
  CalendarRange,
  History,
  Mountain,
  Network,
  Package,
  Pentagon,
  SunSnow,
  type LucideIcon,
} from "lucide-react"
import type { BoardToolId } from "@/lib/mapTools"

export type RunNodeId =
  | "area"
  | "period"
  | "model"
  | "product"
  | "record"
  | "season"
  | "slope"
  | "run"

export interface RunNodeSpec {
  id: RunNodeId
  label: string
  /** The same glyph the band used for the group, so the vocabulary survives. */
  icon: LucideIcon
  /** Distance from the left of the default layout, in whole node widths. */
  col: number
  /**
   * Roughly how tall the node draws, for the DEFAULT LAYOUT ONLY.
   *
   * Nodes are sized by their contents like anything else; this number exists
   * so first placement can stack a column without measuring, and being a few
   * pixels out costs a few pixels of gap. It is not read again once a node has
   * been moved.
   */
  h: number
}

/** Every node is this wide. A fixed width is what lets a port sit at a known x. */
export const NODE_W = 208

/** Space between columns, wide enough for a curve to read as a curve. */
export const COL_GAP = 88

/** Space between stacked nodes in a column. */
export const ROW_GAP = 28

/**
 * Where a port sits, measured down from the node's own top edge.
 *
 * On the header row rather than at the node's vertical centre, which is what
 * keeps a wire's two ends level when a tall node feeds a short one -- and what
 * removes the need to measure a node at all before drawing the wire into it.
 */
export const PORT_Y = 17

const SPEC: Record<RunNodeId, Omit<RunNodeSpec, "col">> = {
  area: { id: "area", label: "Area", icon: Pentagon, h: 74 },
  period: { id: "period", label: "Period", icon: CalendarRange, h: 168 },
  model: { id: "model", label: "Model", icon: Network, h: 74 },
  product: { id: "product", label: "Product", icon: Package, h: 78 },
  record: { id: "record", label: "Record", icon: History, h: 78 },
  season: { id: "season", label: "Season", icon: SunSnow, h: 116 },
  slope: { id: "slope", label: "Slope", icon: Mountain, h: 116 },
  // The run node draws its own header from the tool, so it carries no icon of
  // its own here; TOOL_ICON in BoardRunGraph names it.
  run: { id: "run", label: "Run", icon: Package, h: 96 },
}

export interface RunGraph {
  nodes: readonly RunNodeSpec[]
  edges: readonly (readonly [RunNodeId, RunNodeId])[]
}

/**
 * The graph for one product, with solar's two shapes kept apart.
 *
 * `null` while no tool is chosen: there is no run to describe before there is
 * a product, which is the rule the band's method brief already followed.
 */
export function runGraph(
  tool: BoardToolId | null,
  solarProduct: "terrain" | "siting" | null
): RunGraph | null {
  if (!tool) return null

  const at = (id: RunNodeId, col: number): RunNodeSpec => ({
    ...SPEC[id],
    col,
  })

  if (tool === "solar") {
    if (!solarProduct) return null
    if (solarProduct === "terrain") {
      return {
        nodes: [at("area", 0), at("product", 0), at("record", 1), at("season", 1), at("run", 2)],
        edges: [
          ["area", "run"],
          ["product", "record"],
          ["product", "season"],
          ["record", "run"],
          ["season", "run"],
        ],
      }
    }
    return {
      nodes: [at("area", 0), at("product", 0), at("slope", 1), at("run", 2)],
      edges: [
        ["area", "run"],
        ["product", "slope"],
        ["slope", "run"],
      ],
    }
  }

  if (tool === "classify") {
    return {
      nodes: [at("area", 0), at("period", 0), at("model", 0), at("run", 1)],
      edges: [
        ["area", "run"],
        ["period", "run"],
        ["model", "run"],
      ],
    }
  }

  // Compositions and surface water: an area and a period, and no model to
  // choose -- both run one method on whatever the period returns.
  return {
    nodes: [at("area", 0), at("period", 0), at("run", 1)],
    edges: [
      ["area", "run"],
      ["period", "run"],
    ],
  }
}

export type Place = { x: number; y: number }

/**
 * First placement: columns left to right, each column stacked and centred
 * against the tallest one.
 *
 * Centring rather than top-aligning, because a run node opposite a column of
 * three reads as the thing they arrive at only if it sits across from their
 * middle. Computed rather than stored, so a graph that gains a node lays out
 * sensibly for a board that has never seen it.
 */
export function defaultPlaces(graph: RunGraph): Record<string, Place> {
  const cols = new Map<number, RunNodeSpec[]>()
  for (const n of graph.nodes) {
    const list = cols.get(n.col) ?? []
    list.push(n)
    cols.set(n.col, list)
  }

  const heightOf = (list: RunNodeSpec[]) =>
    list.reduce((sum, n) => sum + n.h, 0) + ROW_GAP * (list.length - 1)

  const tallest = Math.max(...[...cols.values()].map(heightOf))
  const out: Record<string, Place> = {}
  for (const [col, list] of cols) {
    let y = (tallest - heightOf(list)) / 2
    for (const n of list) {
      out[n.id] = { x: col * (NODE_W + COL_GAP), y }
      y += n.h + ROW_GAP
    }
  }
  return out
}
