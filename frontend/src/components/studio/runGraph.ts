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
 * Where one input does gate another -- the model gates the mode, a
 * composition's recipe gates its bands or its index -- an edge from it to what
 * it gates says which choice put that card on screen.
 */
import {
  CalendarBlank,
  CircleHalf,
  Drop,
  Images,
  MapTrifold,
  Network,
  Package,
  Palette,
  Pentagon,
  Repeat,
  Ruler,
  Stack,
  type Icon,
} from "@phosphor-icons/react"
import type { BoardToolId } from "@/lib/mapTools"

export type RunNodeId =
  | "area"
  | "period"
  | "model"
  | "mode"
  | "scene"
  | "composite"
  | "bands"
  | "spectralIndex"
  | "stretch"
  | "waterIndex"
  | "models"
  | "threshold"
  | "catalogue"
  | "run"

export interface RunNodeSpec {
  id: RunNodeId
  label: string
  /** The same glyph the band used for the group, so the vocabulary survives. */
  icon: Icon
  /** Distance from the left of the default layout, in whole node widths. */
  col: number
  /**
   * Roughly how tall the node draws, for THE FIRST FRAME ONLY.
   *
   * Nodes are sized by their contents like anything else; this number exists
   * so a column can be stacked before there is anything on screen to measure.
   * It is superseded the moment there is: `defaultPlaces` takes the measured
   * heights and prefers them, and NodeCanvas reports one per card.
   *
   * IT USED TO BE THE ONLY HEIGHT, and it went stale in the way a hand-copied
   * number does. One card declared 78 while the list it drew wrapped to about
   * six rows and stood near 200; the card declared below it in the same column
   * was placed 124px into it, and the overlap clipped two of its options out of
   * reach. Nothing compared the two numbers, so nothing failed.
   */
  h: number
}

/** Every node is this wide. A fixed width is what lets a port sit at a known x. */
export const NODE_W = 208

/**
 * Space between columns.
 *
 * WIDE ENOUGH TO READ A WIRE ON, which is a larger number than the one that
 * makes a curve read as a curve. It was 88 while a wire said only that two
 * cards were joined. A wire now carries the value it supplies, written along
 * it, and the flattest run of a wire is the part nearest the card it leaves --
 * at 88 that part was about 48 pixels long and the shortest reading on any
 * graph, "hourly", did not fit in it.
 *
 * The cost is a board about a quarter wider on a three-column graph. The
 * field is panned and zoomed and fits itself to the graph, so width is a
 * cheaper thing to spend here than legibility.
 */
export const COL_GAP = 200

/** Space between stacked nodes in a column. */
export const ROW_GAP = 28

/**
 * Where the first port sits, measured down from the node's own top edge.
 *
 * On the header row rather than at the node's vertical centre, so a card met
 * by a single wire is met on the band it already reserves for one, whatever it
 * feeds and whatever height it draws at. A card met by several fans downwards
 * from here; NodeCanvas owns that spread, since it is a fact about how crowded
 * a card is rather than about where the card belongs.
 */
export const PORT_Y = 17

const SPEC: Record<RunNodeId, Omit<RunNodeSpec, "col">> = {
  area: { id: "area", label: "Area", icon: Pentagon, h: 74 },
  period: { id: "period", label: "Period", icon: CalendarBlank, h: 168 },
  model: { id: "model", label: "Model", icon: Network, h: 74 },
  mode: { id: "mode", label: "Mode", icon: Repeat, h: 74 },
  scene: { id: "scene", label: "Scene", icon: Images, h: 92 },
  composite: { id: "composite", label: "Composite", icon: Stack, h: 78 },
  bands: { id: "bands", label: "Bands", icon: Palette, h: 74 },
  spectralIndex: { id: "spectralIndex", label: "Index", icon: Palette, h: 74 },
  stretch: { id: "stretch", label: "Stretch", icon: CircleHalf, h: 116 },
  waterIndex: { id: "waterIndex", label: "Index", icon: Drop, h: 78 },
  models: { id: "models", label: "Elevation models", icon: Stack, h: 140 },
  threshold: { id: "threshold", label: "Threshold", icon: Ruler, h: 116 },
  /*
    THE PUBLISHED BOUNDARIES, AS GROUND A RUN CAN BE MADE OVER.

    A polygon already reached this application two ways -- drawn on the map, or
    read from a file the reader has -- and both put the burden of HAVING the
    shape on them. For a state or a municipality that burden is misplaced: the
    boundary is published, it is the same for everyone, and a reader asking
    about Natal should not have to find a file first.

    NO EDGE. Everything else on a graph feeds the run and this does not: what
    it produces is an AREA of the project, and the area card's own edge is what
    carries it. A line from here to the run would say the run reads two
    geometries, and a line from here to the area card would draw a pipeline --
    which the note at the top of this file is written against. Filling a card
    is an action; only what a run is MADE OF is an edge.

    Offered on every graph rather than one: every product this application has
    is asked over ground.
  */
  catalogue: { id: "catalogue", label: "Catalogue", icon: MapTrifold, h: 200 },
  // The run node draws its own header from the tool, so it carries no icon of
  // its own here; TOOL_ICON in BoardRunGraph names it.
  run: { id: "run", label: "Run", icon: Package, h: 96 },
}

/**
 * The cards a reader can add to a graph, with what each is for.
 *
 * A TABLE AND NOT A UNION, because the menu that offers them has to name them
 * and say what they do -- and a list of ids somewhere else, matched by hand to
 * labels somewhere else again, is the drift this file's SPEC exists to end.
 */
export const OPTIONAL_NODES = [
  {
    id: "catalogue" as const,
    label: "Boundary catalogue",
    hint: "States and municipalities, as published, to make a run over",
  },
]

export type OptionalNodeId = (typeof OPTIONAL_NODES)[number]["id"]

export interface RunGraph {
  nodes: readonly RunNodeSpec[]
  edges: readonly (readonly [RunNodeId, RunNodeId])[]
}

/**
 * The graph for one product.
 *
 * `null` while no tool is chosen: there is no run to describe before there is
 * a product, which is the rule the band's method brief already followed.
 */
/**
 * The graph for a tool, with the cards the reader has added.
 *
 * A WRAPPER RATHER THAN A LINE IN EVERY BRANCH. Each product returns its own
 * node list, and appending the optional cards to each would be one place per
 * branch for them to be forgotten, which is the same argument SPEC itself is
 * built on. They are appended once, here.
 *
 * NO EDGE, DELIBERATELY. Everything else on a graph feeds the run. An added
 * card does not -- see SPEC.catalogue -- and a line to the run node would say
 * otherwise.
 */
export function runGraph(
  tool: BoardToolId | null,
  compositeKind: "rgb" | "index" | null = null,
  /** The optional cards the reader has added. See the note below. */
  extras: readonly OptionalNodeId[] = []
): RunGraph | null {
  const graph = productGraph(tool, compositeKind)
  if (!graph) return graph
  /*
    THE OPTIONAL CARDS, AND WHY THEY ARE NOT ON EVERY GRAPH.

    The catalogue was appended here unconditionally at first, on the argument
    that ground is what every product is asked over -- which is true, and is
    an argument for it being AVAILABLE rather than for it being present. A
    graph states what a run is made of, and a reader who draws their own areas
    has a card on every board that answers a question they are not asking.

    So it is asked for, from the additional-components menu on the band's own
    bar, and this appends what was asked for. None of them is reached by an
    edge -- see SPEC.catalogue -- so a graph gains a card and the request it
    describes is unchanged.
  */
  const nodes = [
    ...graph.nodes,
    ...extras.map((id) => ({ ...SPEC[id], col: 0 })),
  ]
  return { ...graph, nodes }
}

function productGraph(
  tool: BoardToolId | null,
  /** Which recipe a composition is built from; gates bands against an index. */
  compositeKind: "rgb" | "index" | null = null
): RunGraph | null {
  if (!tool) return null

  const at = (id: RunNodeId, col: number): RunNodeSpec => ({
    ...SPEC[id],
    col,
  })

  /*
    FLOOD READS NO IMAGERY, so it has no period card. The envelope is terrain
    and drainage: several elevation models over one polygon, compared against
    each other. No scene search, no cloud ceiling, and nothing dated.
  */
  if (tool === "flood") {
    return {
      nodes: [at("area", 0), at("models", 0), at("threshold", 1), at("run", 2)],
      edges: [
        ["area", "run"],
        ["models", "threshold"],
        ["threshold", "run"],
      ],
    }
  }

  if (tool === "classify") {
    /*
      THE MODEL HAS TWO EDGES AND BOTH ARE TRUE. It is an input to the run like
      the area and the period, and it also GATES the mode: cumulative retention
      is a Random Forest procedure, so under the other two models the temporal
      mode is not a choice -- see modeBlockedBy in lib/classifyOptions.ts. The
      edge into the mode card is that rule drawn.
    */
    return {
      nodes: [
        at("area", 0),
        at("period", 0),
        at("model", 0),
        at("mode", 1),
        at("run", 2),
      ],
      edges: [
        ["area", "run"],
        ["period", "run"],
        ["model", "run"],
        ["model", "mode"],
        ["mode", "run"],
      ],
    }
  }

  if (tool === "compose") {
    /*
      THE PERIOD DOES NOT FEED THE RUN HERE, IT FEEDS THE SCENE LIST.

      A composition is built from ONE scene, and which scenes there are to pick
      from is what the area and the period answer between them -- that is what
      "List scenes" asks. So the run consumes the scene, and the period reaches
      it through the list rather than directly. Drawing the period straight
      into the run would say the request carries a date range, and it does not.

      The recipe gates its own parameters: an RGB composite reads three bands,
      an index composite reads one index, and neither set means anything under
      the other kind.
    */
    const recipe: RunNodeId = compositeKind === "index" ? "spectralIndex" : "bands"
    return {
      nodes: [
        at("area", 0),
        at("period", 0),
        at("composite", 0),
        at("stretch", 0),
        at("scene", 1),
        at(recipe, 1),
        at("run", 2),
      ],
      edges: [
        ["area", "scene"],
        ["period", "scene"],
        ["scene", "run"],
        ["area", "run"],
        ["composite", recipe],
        [recipe, "run"],
        ["stretch", "run"],
      ],
    }
  }

  /*
    Surface water: an area, a period, and which index says what water is.

    NAMED RATHER THAN FALLEN THROUGH TO. This was the function's unguarded
    final return, so a tool with no branch of its own silently drew an
    area/period/water-index graph and looked like it worked -- a new product
    would ship a run band describing a run nobody wrote. The exhaustive
    Records elsewhere (TOOL_ICON, SPEC) fail to compile when they fall behind;
    this one could not, so it says the tool it is for and returns null
    otherwise.
  */
  if (tool === "water") {
    return {
      nodes: [at("area", 0), at("period", 0), at("waterIndex", 0), at("run", 1)],
      edges: [
        ["area", "run"],
        ["period", "run"],
        ["waterIndex", "run"],
      ],
    }
  }

  return null
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
export function defaultPlaces(
  graph: RunGraph,
  /**
   * What the cards were measured at, by id, for the ones that have been drawn.
   *
   * Empty on the first frame, which is what `RunNodeSpec.h` is for. Once a
   * card has been on screen its own height is the one that stacks the column,
   * so a card whose contents depend on the tool, or on a choice made on the
   * card, cannot be laid out against a number written for another case.
   */
  measured: Readonly<Record<string, number>> = {}
): Record<string, Place> {
  const cols = new Map<number, RunNodeSpec[]>()
  for (const n of graph.nodes) {
    const list = cols.get(n.col) ?? []
    list.push(n)
    cols.set(n.col, list)
  }

  const tallOf = (n: RunNodeSpec) => measured[n.id] ?? n.h
  const heightOf = (list: RunNodeSpec[]) =>
    list.reduce((sum, n) => sum + tallOf(n), 0) + ROW_GAP * (list.length - 1)

  const tallest = Math.max(...[...cols.values()].map(heightOf))
  const out: Record<string, Place> = {}
  for (const [col, list] of cols) {
    let y = (tallest - heightOf(list)) / 2
    for (const n of list) {
      out[n.id] = { x: col * (NODE_W + COL_GAP), y }
      y += tallOf(n) + ROW_GAP
    }
  }
  return out
}
