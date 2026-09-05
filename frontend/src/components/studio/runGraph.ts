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
  CalendarBlank,
  ChartLineUp,
  CircleHalf,
  ChartLineDown,
  Database,
  Factory,
  ClockCounterClockwise,
  Drop,
  Fan,
  Images,
  Mountains,
  Network,
  Package,
  Palette,
  Pentagon,
  Repeat,
  Ruler,
  Stack,
  Sun,
  ThermometerSimple,
  type Icon,
  Waves,
} from "@phosphor-icons/react"
import type { SolarProductId } from "@/lib/energyState"
import type { GridProductId } from "@/lib/gridOptions"
import { energyFamily, type BoardToolId, type EnergyProductId } from "@/lib/mapTools"

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
  | "product"
  | "record"
  | "season"
  | "slope"
  | "turbine"
  | "roughness"
  | "models"
  | "threshold"
  | "store"
  | "layers"
  | "window"
  | "figure"
  | "radiation"
  | "plant"
  | "array"
  | "losses"
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
   * number does. `product` says 78, which was true of the four short names
   * under solar; the same card draws the nine ENERGY_PRODUCTS labels, wraps to
   * about six rows and stands near 200. The card declared below it in the same
   * column was placed 124px into it, and the overlap clipped two of the nine
   * options out of reach. Nothing compared the two numbers, so nothing failed.
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
  product: { id: "product", label: "Product", icon: Package, h: 78 },
  record: { id: "record", label: "Record", icon: ClockCounterClockwise, h: 78 },
  season: { id: "season", label: "Season", icon: ThermometerSimple, h: 116 },
  slope: { id: "slope", label: "Slope", icon: Mountains, h: 116 },
  turbine: { id: "turbine", label: "Turbine", icon: Fan, h: 116 },
  roughness: { id: "roughness", label: "Roughness", icon: Waves, h: 116 },
  models: { id: "models", label: "Elevation models", icon: Stack, h: 140 },
  threshold: { id: "threshold", label: "Threshold", icon: Ruler, h: 116 },
  // The local operational record, and the span of it a run reads.
  //
  // `store` is at column 0 beside `area` because it is the other thing the
  // request is OF: the area says which ground, the store says which record.
  // A run made against a different revision is a different run, so a value
  // that decides a result belongs on the graph that describes the result --
  // which is the same argument that keeps the area off a settings screen.
  store: { id: "store", label: "Store", icon: Database, h: 116 },
  /*
    THE MAP'S OWN SOURCES, WHICH ARE NOT A RUN'S INPUT.

    Every other node on this graph feeds the run: change it and the answer
    changes. This one changes nothing about the answer -- it says what is DRAWN
    while the question is being set up, which is the register a reader needs in
    front of them to choose a polygon at all. So it is placed in the first
    column beside the store and wired to nothing, and the absent edge is the
    statement: a line from here to the run would claim the layer is read, and it
    is not.

    It sits on this graph rather than in a map control because the reader is
    already here. Choosing where to ask and seeing what can be asked about are
    one gesture, and putting the second behind a toolbar on the other surface is
    what left the map bare while a product card offered to read it.
  */
  layers: { id: "layers", label: "Layers", icon: Stack, h: 148 },
  // The solar parameters, back on the graph. Named for what they configure,
  // not for the product that sends them: `radiation` and `slope` are each read
  // by two products, which is why SolarParams holds one of each for the axis.
  radiation: { id: "radiation", label: "Radiation", icon: Sun, h: 168 },
  plant: { id: "plant", label: "Plant", icon: Factory, h: 200 },
  array: { id: "array", label: "Array", icon: Ruler, h: 168 },
  losses: { id: "losses", label: "Losses", icon: ChartLineDown, h: 200 },
  window: { id: "window", label: "Record window", icon: CalendarBlank, h: 116 },
  // Which analysis of the published series. A card and not a menu inside the
  // reading, because it is part of the request: a different figure is a
  // different run, not a different view of one.
  figure: { id: "figure", label: "Figure", icon: ChartLineUp, h: 200 },
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
/**
 * The graph for a tool, with the map's sources added where they belong.
 *
 * A WRAPPER RATHER THAN A LINE IN EIGHT BRANCHES. The Energy entry has eight
 * products and each returns its own node list; adding the layers card to each
 * would be eight places for it to be forgotten, which is the same argument
 * SPEC itself is built on. It is appended once, here, and only for Energy --
 * the register it draws is the one this slice can be asked about, and hanging
 * it off a classification graph would offer a control over a layer that run
 * has nothing to do with.
 *
 * NO EDGE, DELIBERATELY. Everything else on a graph feeds the run. This does
 * not: it changes what is drawn while the question is set up and changes
 * nothing about the answer, and a line to the run node would say otherwise.
 */
export function runGraph(
  tool: BoardToolId | null,
  solarProduct: SolarProductId | null,
  compositeKind: "rgb" | "index" | null = null,
  gridProduct: GridProductId | null = null,
  energyProduct: EnergyProductId | null = null
): RunGraph | null {
  const graph = productGraph(
    tool,
    solarProduct,
    compositeKind,
    gridProduct,
    energyProduct
  )
  if (!graph || tool !== "energy") return graph
  return {
    ...graph,
    nodes: [...graph.nodes, { ...SPEC.layers, col: 0 }],
  }
}

function productGraph(
  tool: BoardToolId | null,
  solarProduct: SolarProductId | null,
  /** Which recipe a composition is built from; gates bands against an index. */
  compositeKind: "rgb" | "index" | null = null,
  /** Which grid question is being asked; gates the area and the window. */
  gridProduct: GridProductId | null = null,
  /**
   * Which energy product, when the band is on Energy.
   *
   * The three families kept their graphs -- what changed is that the reader no
   * longer picks the family first. So the branches below still ask which slice
   * answers, and that question is now answered by the product instead of by
   * the tool.
   */
  energyProduct: EnergyProductId | null = null
): RunGraph | null {
  if (!tool) return null

  const family =
    tool === "energy"
      ? energyProduct
        ? energyFamily(energyProduct)
        : null
      : tool
  if (tool === "energy" && !family) return null

  const at = (id: RunNodeId, col: number): RunNodeSpec => ({
    ...SPEC[id],
    col,
  })

  /*
    SOLAR IS AREA, PRODUCT AND WHAT THE PRODUCT SENDS.

    The parameters were moved off this graph and into an editor of their own,
    on an argument that was true about ONE product and was applied to four:
    the energy model alone carries a reporting basis, an analysis period, a
    degradation rate, two ground-cover ratios, a tracker limit, a density
    basis, a buildable fraction, a UTC offset and two tables of loss terms,
    and "a card that wide is a panel with a card's chrome" is a fair thing to
    say about it. It is not a fair thing to say about the siting map, which
    sends two slope limits, or the terrain map, which sends a window and a
    season.

    A panel configures nothing that a card cannot; what a panel is FOR is
    showing a result. So the parameters come back, per product, and the
    heaviest one is split across cards named for what they configure rather
    than crammed into one.
  */
  if (family === "solar") {
    if (!solarProduct) return null
    if (solarProduct === "resource") {
      return {
        nodes: [
          at("area", 0),
          at("record", 0),
          at("product", 1),
          at("radiation", 1),
          at("run", 2),
        ],
        edges: [
          ["area", "run"],
          ["record", "run"],
          ["radiation", "run"],
          ["product", "run"],
        ],
      }
    }
    if (solarProduct === "terrain") {
      return {
        nodes: [
          at("area", 0),
          at("record", 0),
          at("product", 1),
          at("season", 1),
          at("run", 2),
        ],
        edges: [
          ["area", "run"],
          ["record", "run"],
          ["season", "run"],
          ["product", "run"],
        ],
      }
    }
    if (solarProduct === "siting") {
      return {
        nodes: [at("area", 0), at("product", 1), at("slope", 1), at("run", 2)],
        edges: [
          ["area", "run"],
          ["slope", "run"],
          ["product", "run"],
        ],
      }
    }
    /*
      The energy model, which is the one the panel was built for.

      Six parameter cards, grouped by what they configure rather than by what
      fits: the radiation chain, the ground it stands on, the plant's own
      accounting, the array geometry, and the loss stack behind the ratio. It
      is a dense graph and it is meant to be -- this product sends more than
      any other, and the density is that fact drawn rather than hidden behind
      a panel that looked the same as the siting map's.
    */
    return {
      nodes: [
        at("area", 0),
        at("record", 0),
        at("radiation", 0),
        at("product", 1),
        at("slope", 1),
        at("plant", 1),
        at("array", 2),
        at("losses", 2),
        at("run", 3),
      ],
      edges: [
        ["area", "run"],
        ["record", "run"],
        ["radiation", "run"],
        ["slope", "run"],
        ["plant", "run"],
        ["array", "run"],
        ["losses", "run"],
        ["product", "run"],
      ],
    }
  }

  /*
    WIND READS NO IMAGERY, so it has no period card. The record is a span of
    NASA POWER hours at the centroid, and the area is what locates that
    centroid -- which is why the area still fans in while the acquisition
    window does not appear at all.
  */
  if (family === "wind") {
    return {
      nodes: [at("area", 0), at("record", 0), at("turbine", 1), at("roughness", 1), at("run", 2)],
      edges: [
        ["area", "run"],
        ["record", "run"],
        ["turbine", "run"],
        ["roughness", "run"],
      ],
    }
  }

  /*
    NEITHER DOES FLOOD. The envelope is terrain and drainage: several elevation
    models over one polygon, compared against each other. No scene search, no
    cloud ceiling, and nothing dated.
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

      The recipe gates its own parameters the way solar's product does: an RGB
      composite reads three bands, an index composite reads one index, and
      neither set means anything under the other kind.
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
    THE OPERATIONAL RECORD, and the store gates the window.

    Two edges leave `store` and both are true. It is an input to the request --
    the connection travels in it -- and it also GATES the window, because the
    sidecar clamps every requested span to what the store actually holds and
    refuses one that falls outside. Until the store has answered there is no
    window to state, and that edge is that rule drawn. It is the second real
    gate in this file, after solar's product.

    The area is absent under the record product, and its absence is the
    content: asking what this installation holds is not a question about any
    ground.
  */
  if (family === "grid") {
    if (!gridProduct) return null
    if (gridProduct === "figure") {
      /*
        THE SERIES DOES NOT TAKE AN AREA HERE, and the absent card is the
        statement. Five of the twelve are read over an area and seven are about
        the system; the site-scoped ones arrive with the area card when they
        do. Fig. 1, the only one computed today, has n = 87 clusters across the
        SIN and answering it over one polygon would be a different quantity
        under the same name.
      */
      return {
        nodes: [
          at("store", 0),
          at("product", 1),
          at("figure", 1),
          at("window", 2),
          at("run", 3),
        ],
        edges: [
          ["store", "product"],
          ["product", "figure"],
          ["store", "window"],
          ["figure", "run"],
          ["window", "run"],
        ],
      }
    }
    if (gridProduct === "connection") {
      /*
        NO WINDOW CARD, AND ITS ABSENCE IS THE STATEMENT. Every other question
        in this slice is a reading over a period. This one asks where the
        network is and what the plants on this ground are joined to, and both
        are facts about a register: asking them "over 2025" would be asking a
        map when it was drawn.
      */
      return {
        nodes: [at("store", 0), at("area", 0), at("product", 1), at("run", 2)],
        edges: [
          ["store", "product"],
          ["area", "run"],
          ["product", "run"],
        ],
      }
    }
    if (gridProduct === "record") {
      return {
        nodes: [at("store", 0), at("product", 1), at("run", 2)],
        edges: [
          ["store", "product"],
          ["product", "run"],
        ],
      }
    }
    return {
      nodes: [
        at("store", 0),
        at("area", 0),
        at("product", 1),
        at("window", 1),
        at("run", 2),
      ],
      edges: [
        ["store", "product"],
        ["product", "window"],
        ["area", "run"],
        ["window", "run"],
        ["product", "run"],
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
   * so a card whose contents depend on the tool -- `product` carries four
   * short names under solar and nine long ones under energy -- cannot be laid
   * out against a number written for the other case.
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
