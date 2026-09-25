/**
 * The compositor's node graph: what nodes exist, which sockets each declares,
 * what each is set to, and which output feeds which input.
 *
 * Blender's compositor is the model, and the resemblance is structural. A node
 * declares its sockets; a link joins one output socket to one input socket;
 * an input takes one link and an output feeds any number. The Run node is the
 * Render Layers node of this editor: one output per raster the run produced.
 * The Viewer is the Viewer node: whatever reaches it is drawn in its card, and
 * passed on through its output. The Globe node is where a raster leaves the
 * graph: it is drawn on the Globe editor, over the ground it was measured on.
 *
 * NO NODE IS FOR ONE PURPOSE. The filters, the masks, the mix and the readings
 * are categories of one Add menu, as Blender's are, and any output goes to any
 * input that accepts its type. What the graph refuses is only what cannot mean
 * anything: a link into a node's own ancestry, and an image into an input that
 * needs classes -- the second because lib/classMask.ts explains why a class
 * cannot be read back out of a continuous raster.
 *
 * Data and rules only; `compositorEval` computes and `CompositorEditor` draws.
 */
import type { Connectivity, WindowSize } from "@/lib/classFilters"

export type Place = { x: number; y: number }

/**
 * What a socket carries.
 *
 * `classes` is a class map: legend ordinals per pixel, which can be counted,
 * filtered and compared. `image` is colour per pixel, which can be looked at
 * and composited and nothing else. A class map is also an image -- it is
 * painted in its legend -- so it goes wherever an image is taken.
 *
 * `fields` is not a raster at all: the polygons a field delineation drew, one
 * per field, with their figures. It goes only where fields are read -- a
 * filter on their size, the node that makes them areas, the one that writes
 * them to a file -- and no raster goes where it does.
 *
 * `mineral` is not a raster either: the figures of one mineral map, as the run
 * reported them -- the passes it compared, what each group identified, where
 * the bands sat, how firm the answers were. It goes only into the Mineral
 * nodes, each of which reads one part of it into its card.
 */
export type SocketType = "classes" | "image" | "fields" | "mineral"

export interface InputDef {
  id: string
  label: string
  accepts: readonly SocketType[]
}

export interface OutputDef {
  id: string
  label: string
  /** A fixed type, or the type of whatever reaches the named input. */
  type: SocketType | { follow: string }
}

export type NodeCategory = "input" | "filter" | "mask" | "color" | "analysis" | "mineral" | "output"

/** A Tetracorder group: 1 reads the Fe electronic bands, 2 the 2.0-2.5 um vibrational ones. */
export type MineralGroupId = 1 | 2
/** An absorption whose position the mineral map fitted. */
export type MineralBand = "fe3" | "aloh"

export type GraphNode =
  | {
      id: string
      kind: "run"
      /** The run it offers; for a field set, the run of the field in focus. */
      runId: string | null
      /**
       * EVERY FIELD OF AN AREA rather than one run: the latest run of
       * `runKind` on each of its fields (lib/fieldSets.ts). The node shows the
       * field in focus, and the graph is evaluated once per field wherever an
       * answer for all of them is wanted. Absent on a plain Run node.
       */
      each?: { areaId: string; runKind: string; fieldId: string | null }
    }
  | { id: string; kind: "majority"; size: WindowSize }
  | { id: string; kind: "sieve"; minPixels: number; connectivity: Connectivity }
  | {
      id: string
      kind: "morphology"
      op: "open" | "close"
      size: WindowSize
      /** The legend id of the class opened or closed; null until one is chosen. */
      classId: number | null
    }
  | { id: string; kind: "select"; keep: number[] }
  | { id: string; kind: "mask" }
  | { id: string; kind: "mix"; opacity: number }
  | { id: string; kind: "areas" }
  | { id: string; kind: "change" }
  | { id: string; kind: "viewer" }
  | { id: string; kind: "globe"; opacity: number }
  | {
      id: string
      kind: "fieldFilter"
      /** Fields smaller than this, in hectares, are left out. */
      minHa: number
      /** Fields MapBiomas calls cropland over less than this share are left out. */
      minCropland: number
    }
  | { id: string; kind: "adoptFields" }
  | { id: string; kind: "saveFields" }
  | { id: string; kind: "mineralCoverage" }
  | { id: string; kind: "mineralClasses"; group: MineralGroupId }
  | { id: string; kind: "mineralReferences"; group: MineralGroupId }
  | { id: string; kind: "mineralPasses" }
  | { id: string; kind: "mineralCover" }
  | { id: string; kind: "mineralPositions"; band: MineralBand }
  | { id: string; kind: "mineralAcid" }
  | { id: string; kind: "mineralConfidence" }
  | { id: string; kind: "mineralAgreement"; group: MineralGroupId }
  | { id: string; kind: "mineralSave" }

export type NodeKind = GraphNode["kind"]

export interface GraphLink {
  from: string
  fromSocket: string
  to: string
  toSocket: string
}

export interface CompositorGraph {
  nodes: GraphNode[]
  links: GraphLink[]
  places: Record<string, Place>
  /** The Viewer Ctrl+Shift+click sends to, as Blender's active viewer. */
  viewer: string | null
}

const CLASSES = ["classes"] as const
const ANY = ["classes", "image"] as const
const FIELDS = ["fields"] as const
const REPORT = [{ id: "report", label: "Mineral report", accepts: ["mineral"] as const }] as const

export interface KindMeta {
  kind: NodeKind
  category: NodeCategory
  label: string
  hint: string
  inputs: readonly InputDef[]
  /** Declared outputs; the Run node's are the run's rasters and are listed by the caller. */
  outputs: readonly OutputDef[]
}

/** Every kind, in the order its category lists them. */
export const NODE_KINDS: readonly KindMeta[] = [
  {
    kind: "run",
    category: "input",
    label: "Run",
    hint: "Every raster a run on the board produced, one output each",
    inputs: [],
    outputs: [],
  },
  {
    kind: "majority",
    category: "filter",
    label: "Majority filter",
    hint: "Each pixel takes the most frequent class in its window",
    inputs: [{ id: "classes", label: "Classes", accepts: CLASSES }],
    outputs: [{ id: "classes", label: "Classes", type: "classes" }],
  },
  {
    kind: "sieve",
    category: "filter",
    label: "Sieve",
    hint: "Patches below a size merge into their largest neighbour",
    inputs: [{ id: "classes", label: "Classes", accepts: CLASSES }],
    outputs: [{ id: "classes", label: "Classes", type: "classes" }],
  },
  {
    kind: "morphology",
    category: "filter",
    label: "Opening / closing",
    hint: "One class, with its narrow parts removed or its narrow gaps filled",
    inputs: [{ id: "classes", label: "Classes", accepts: CLASSES }],
    outputs: [{ id: "classes", label: "Classes", type: "classes" }],
  },
  {
    kind: "select",
    category: "mask",
    label: "Select classes",
    hint: "The chosen classes kept, every other class outside",
    inputs: [{ id: "classes", label: "Classes", accepts: CLASSES }],
    outputs: [{ id: "classes", label: "Classes", type: "classes" }],
  },
  {
    kind: "mask",
    category: "mask",
    label: "Mask",
    hint: "A raster kept only where a class map has a class",
    inputs: [
      { id: "raster", label: "Raster", accepts: ANY },
      { id: "mask", label: "Mask", accepts: CLASSES },
    ],
    outputs: [{ id: "raster", label: "Raster", type: { follow: "raster" } }],
  },
  {
    kind: "mix",
    category: "color",
    label: "Mix",
    hint: "One raster laid over another, placed by where both are on the ground",
    inputs: [
      { id: "base", label: "Base", accepts: ANY },
      { id: "overlay", label: "Overlay", accepts: ANY },
    ],
    outputs: [{ id: "image", label: "Image", type: "image" }],
  },
  {
    kind: "areas",
    category: "analysis",
    label: "Class areas",
    hint: "The area of each class in the map it reads",
    inputs: [{ id: "classes", label: "Classes", accepts: CLASSES }],
    outputs: [],
  },
  {
    kind: "change",
    category: "analysis",
    label: "Change",
    hint: "What differs between two class maps of one grid, class by class",
    inputs: [
      { id: "before", label: "Before", accepts: CLASSES },
      { id: "after", label: "After", accepts: CLASSES },
    ],
    outputs: [],
  },
  {
    kind: "viewer",
    category: "output",
    label: "Viewer",
    hint: "Draws what reaches it in its own card, and passes it on",
    inputs: [{ id: "image", label: "Image", accepts: ANY }],
    outputs: [{ id: "image", label: "Image", type: { follow: "image" } }],
  },
  {
    kind: "globe",
    category: "output",
    label: "Globe",
    hint: "Draws each raster that reaches it on the Globe editor, stacked in the order of its layers",
    // Its inputs are its layers, which grow with its links: see inputsOf.
    inputs: [],
    outputs: [],
  },
  {
    kind: "fieldFilter",
    category: "filter",
    label: "Field filter",
    hint: "Fields kept by their size, and by how much of each MapBiomas calls cropland",
    inputs: [{ id: "fields", label: "Fields", accepts: FIELDS }],
    outputs: [{ id: "fields", label: "Fields", type: "fields" }],
  },
  {
    kind: "adoptFields",
    category: "output",
    label: "Make fields",
    hint: "The fields that reach it made areas inside the area they were delineated over",
    inputs: [{ id: "fields", label: "Fields", accepts: FIELDS }],
    outputs: [],
  },
  {
    kind: "saveFields",
    category: "output",
    label: "Save fields",
    hint: "The fields that reach it written to a GeoJSON file",
    inputs: [{ id: "fields", label: "Fields", accepts: FIELDS }],
    outputs: [],
  },
  /*
    The mineral map's figures, one card each: what a reading panel used to hold
    in one column, now read where the reader chooses and placed beside the
    rasters they describe.
  */
  {
    kind: "mineralCoverage",
    category: "mineral",
    label: "Coverage",
    hint: "How much of the area was observed, exposed and identified, with the run's notes",
    inputs: REPORT,
    outputs: [],
  },
  {
    kind: "mineralClasses",
    category: "mineral",
    label: "Mineral classes",
    hint: "The classes one group identified, by area over the observed ground",
    inputs: REPORT,
    outputs: [],
  },
  {
    kind: "mineralReferences",
    category: "mineral",
    label: "References",
    hint: "The Tetracorder references that won the most cells in one group",
    inputs: REPORT,
    outputs: [],
  },
  {
    kind: "mineralPasses",
    category: "mineral",
    label: "Passes",
    hint: "The EMIT passes compared, and how many cells each answered for",
    inputs: REPORT,
    outputs: [],
  },
  {
    kind: "mineralCover",
    category: "mineral",
    label: "Fractional cover",
    hint: "EMIT L2B bare soil, green and dry vegetation over the cells observed",
    inputs: REPORT,
    outputs: [],
  },
  {
    kind: "mineralPositions",
    category: "mineral",
    label: "Band position",
    hint: "Where the Fe3+ or the Al-OH band sat, against the library references",
    inputs: REPORT,
    outputs: [],
  },
  {
    kind: "mineralAcid",
    category: "mineral",
    label: "Acid-sulfate minerals",
    hint: "The minerals of acid mine drainage the map identified, and in which group",
    inputs: REPORT,
    outputs: [],
  },
  {
    kind: "mineralConfidence",
    category: "mineral",
    label: "Confidence",
    hint: "Each group's fit margin over the next class, and its stability under noise",
    inputs: REPORT,
    outputs: [],
  },
  {
    kind: "mineralAgreement",
    category: "mineral",
    label: "Against EMIT L2B",
    hint: "One group's classes against the EMIT L2B product's, pixel by pixel",
    inputs: REPORT,
    outputs: [],
  },
  {
    kind: "mineralSave",
    category: "output",
    label: "Save mineral GeoTIFF",
    hint: "The mineral map's GeoTIFF: every per-cell quantity, one named band each",
    inputs: REPORT,
    outputs: [],
  },
]

/** The Run node's output carrying a field delineation's polygons. */
export const FIELDS_SOCKET = "fields:polygons"

/** The Run node's output carrying a mineral map's figures. */
export const MINERAL_SOCKET = "mineral:report"

/** The field filter's defaults: half a hectare, fifty 10 m cells, and no cropland floor. */
export const FIELD_FILTER_DEFAULT = { minHa: 0.5, minCropland: 0 } as const

/** The Add menu's categories, in Blender's order where Blender has the same one. */
export const CATEGORIES: readonly { id: NodeCategory; label: string }[] = [
  { id: "input", label: "Input" },
  { id: "output", label: "Output" },
  { id: "filter", label: "Filter" },
  { id: "mask", label: "Mask" },
  { id: "color", label: "Color" },
  { id: "analysis", label: "Analysis" },
  { id: "mineral", label: "Mineral" },
]

const META = new Map(NODE_KINDS.map((k) => [k.kind, k]))

export function kindMeta(kind: NodeKind): KindMeta {
  return META.get(kind)!
}

const LAYER = /^layer-(\d+)$/

/**
 * The inputs a node has on this graph.
 *
 * Declared per kind, except the Globe's. Its inputs are the layers of one
 * stack on the globe, and a stack has as many as the reader links: every
 * linked layer, in the order of their numbers, then one empty layer to link
 * the next raster to. Labelled by position rather than by id, so a stack
 * whose second layer was unlinked reads Layer 1, Layer 2 rather than 1, 3.
 */
export function inputsOf(graph: CompositorGraph, node: GraphNode): readonly InputDef[] {
  if (node.kind !== "globe") return kindMeta(node.kind).inputs
  const used = graph.links
    .filter((l) => l.to === node.id && LAYER.test(l.toSocket))
    .map((l) => Number(LAYER.exec(l.toSocket)![1]))
    .sort((a, b) => a - b)
  const next = (used[used.length - 1] ?? 0) + 1
  return [...used, next].map((n, i) => ({ id: `layer-${n}`, label: `Layer ${i + 1}`, accepts: ANY }))
}

/** Whether `socket` names an input a node of this kind can have at all. */
function canHaveInput(node: GraphNode, socket: string): boolean {
  return node.kind === "globe" ? LAYER.test(socket) : kindMeta(node.kind).inputs.some((i) => i.id === socket)
}

/** The sieve's threshold bounds, in pixels. Below 2 the sieve does nothing. */
export const SIEVE_MIN = 2
export const SIEVE_MAX = 1_000_000

export const EMPTY_GRAPH: CompositorGraph = {
  nodes: [],
  links: [],
  places: {},
  viewer: null,
}

/** A node of `kind` with its defaults. */
export function createNode(kind: NodeKind, id: string): GraphNode {
  switch (kind) {
    case "run":
      return { id, kind, runId: null }
    case "majority":
      return { id, kind, size: 3 }
    case "sieve":
      return { id, kind, minPixels: 4, connectivity: 8 }
    case "morphology":
      return { id, kind, op: "open", size: 3, classId: null }
    case "select":
      return { id, kind, keep: [] }
    case "mask":
      return { id, kind }
    case "mix":
      return { id, kind, opacity: 0.6 }
    case "areas":
      return { id, kind }
    case "change":
      return { id, kind }
    case "viewer":
      return { id, kind }
    case "globe":
      return { id, kind, opacity: 0.85 }
    case "fieldFilter":
      return { id, kind, ...FIELD_FILTER_DEFAULT }
    case "adoptFields":
      return { id, kind }
    case "saveFields":
      return { id, kind }
    case "mineralClasses":
    case "mineralReferences":
    case "mineralAgreement":
      return { id, kind, group: 2 }
    case "mineralPositions":
      return { id, kind, band: "fe3" }
    case "mineralCoverage":
    case "mineralPasses":
    case "mineralCover":
    case "mineralAcid":
    case "mineralConfidence":
    case "mineralSave":
      return { id, kind }
  }
}

/** The next free id for a node of `kind`: `majority-1`, `majority-2`... */
export function nextNodeId(graph: CompositorGraph, kind: NodeKind): string {
  const taken = new Set(graph.nodes.map((n) => n.id))
  let n = 1
  while (taken.has(`${kind}-${n}`)) n++
  return `${kind}-${n}`
}

export function nodeOf(graph: CompositorGraph, id: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id)
}

/** The link into one input, or undefined where nothing feeds it. */
export function linkInto(graph: CompositorGraph, to: string, toSocket: string): GraphLink | undefined {
  return graph.links.find((l) => l.to === to && l.toSocket === toSocket)
}

/**
 * The outputs a node has. The Run node's are its run's rasters, which only the
 * caller knows; `runOutputs` answers for them.
 */
export function outputsOf(
  node: GraphNode,
  runOutputs: (runId: string | null) => readonly { id: string; label: string; type: SocketType }[]
): readonly { id: string; label: string; type: SocketType | { follow: string } }[] {
  return node.kind === "run" ? runOutputs(node.runId) : kindMeta(node.kind).outputs
}

/**
 * The type an output carries, or null where it is not yet known -- a Mask
 * whose raster input is not connected carries whatever will be.
 */
export function outputType(
  graph: CompositorGraph,
  nodeId: string,
  socketId: string,
  runOutputs: Parameters<typeof outputsOf>[1],
  seen: Set<string> = new Set()
): SocketType | null {
  const node = nodeOf(graph, nodeId)
  if (!node || seen.has(nodeId)) return null
  const out = outputsOf(node, runOutputs).find((o) => o.id === socketId)
  if (!out) return null
  if (typeof out.type === "string") return out.type
  const link = linkInto(graph, nodeId, out.type.follow)
  if (!link) return null
  return outputType(graph, link.from, link.fromSocket, runOutputs, new Set(seen).add(nodeId))
}

/** Whether `ancestor` feeds `id` through any chain of links. */
export function feeds(graph: CompositorGraph, ancestor: string, id: string): boolean {
  const seen = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const at = stack.pop()!
    if (at === ancestor) return true
    if (seen.has(at)) continue
    seen.add(at)
    for (const l of graph.links) if (l.to === at) stack.push(l.from)
  }
  return false
}

export type ConnectResult = { ok: true; graph: CompositorGraph } | { ok: false; reason: string }

/**
 * A link from one output onto one input, replacing whatever fed that input.
 *
 * Refused with the reason in words where it cannot mean anything. A type that
 * is not known yet is let through: the evaluation reports it on the link if it
 * turns out wrong, which is what Blender does with a link it cannot convert.
 */
export function connect(
  graph: CompositorGraph,
  link: GraphLink,
  runOutputs: Parameters<typeof outputsOf>[1]
): ConnectResult {
  const a = nodeOf(graph, link.from)
  const b = nodeOf(graph, link.to)
  if (!a || !b) return { ok: false, reason: "That node is no longer on the graph." }
  if (a.id === b.id) return { ok: false, reason: "A node cannot read its own output." }
  const input = canHaveInput(b, link.toSocket)
    ? (inputsOf(graph, b).find((i) => i.id === link.toSocket) ?? { id: link.toSocket, label: "Layer", accepts: ANY })
    : undefined
  if (!input) return { ok: false, reason: `${kindMeta(b.kind).label} has no input called ${link.toSocket}.` }
  if (!outputsOf(a, runOutputs).some((o) => o.id === link.fromSocket)) {
    return { ok: false, reason: "That output is no longer on its node." }
  }
  if (feeds(graph, b.id, a.id)) {
    return { ok: false, reason: "That link would make the graph read its own output." }
  }
  const type = outputType(graph, a.id, link.fromSocket, runOutputs)
  if (type && !input.accepts.includes(type)) {
    return { ok: false, reason: refusal(input, type) }
  }
  return {
    ok: true,
    graph: {
      ...graph,
      links: [...graph.links.filter((l) => !(l.to === link.to && l.toSocket === link.toSocket)), link],
    },
  }
}

const CARRIES: Record<SocketType, string> = {
  classes: "a class map",
  image: "an image",
  fields: "a set of field polygons",
  mineral: "a mineral map's figures",
}

/** Why an output of `type` cannot go into `input`, in words. */
export function refusal(input: InputDef, type: SocketType): string {
  if (input.accepts.includes("fields")) {
    return `${input.label} takes the fields a delineation drew, and this output is ${CARRIES[type]}.`
  }
  if (input.accepts.includes("mineral")) {
    return `${input.label} takes a mineral map's figures, from a mineral run's Run node, and this output is ${CARRIES[type]}.`
  }
  if (type === "fields" || type === "mineral") {
    return `${input.label} takes a raster, and this output is ${CARRIES[type]}.`
  }
  return `${input.label} needs a class map, and this output is an image: a class cannot be read back out of colour.`
}

export function disconnect(graph: CompositorGraph, to: string, toSocket: string): CompositorGraph {
  return {
    ...graph,
    links: graph.links.filter((l) => !(l.to === to && l.toSocket === toSocket)),
  }
}

/** Add a node at `place`. The first Viewer added becomes the active one. */
export function addNode(graph: CompositorGraph, node: GraphNode, place: Place): CompositorGraph {
  return {
    ...graph,
    nodes: [...graph.nodes, node],
    places: { ...graph.places, [node.id]: place },
    viewer: node.kind === "viewer" && !graph.viewer ? node.id : graph.viewer,
  }
}

/** Remove a node, every link on it, and where it was. */
export function removeNode(graph: CompositorGraph, id: string): CompositorGraph {
  const places = { ...graph.places }
  delete places[id]
  const nodes = graph.nodes.filter((n) => n.id !== id)
  return {
    ...graph,
    nodes,
    links: graph.links.filter((l) => l.from !== id && l.to !== id),
    places,
    viewer:
      graph.viewer === id ? (nodes.find((n) => n.kind === "viewer")?.id ?? null) : graph.viewer,
  }
}

/** Replace a node's settings. The kind and id cannot change. */
export function updateNode(graph: CompositorGraph, next: GraphNode): CompositorGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === next.id && n.kind === next.kind ? next : n)),
  }
}

export function moveNode(graph: CompositorGraph, id: string, place: Place): CompositorGraph {
  return { ...graph, places: { ...graph.places, [id]: place } }
}

/**
 * The graph a reader first sees over one run: its class map through a 3x3
 * majority filter to the Viewer, the areas that leaves, and what it changed.
 *
 * Shown rather than stored until the reader changes it, so opening the editor
 * is not an edit to the board.
 */
export function defaultGraph(runId: string, classOutput: string): CompositorGraph {
  return {
    nodes: [
      { id: "run-1", kind: "run", runId },
      { id: "majority-1", kind: "majority", size: 3 },
      { id: "viewer-1", kind: "viewer" },
      { id: "areas-1", kind: "areas" },
      { id: "change-1", kind: "change" },
    ],
    links: [
      { from: "run-1", fromSocket: classOutput, to: "majority-1", toSocket: "classes" },
      { from: "majority-1", fromSocket: "classes", to: "viewer-1", toSocket: "image" },
      { from: "majority-1", fromSocket: "classes", to: "areas-1", toSocket: "classes" },
      { from: "run-1", fromSocket: classOutput, to: "change-1", toSocket: "before" },
      { from: "majority-1", fromSocket: "classes", to: "change-1", toSocket: "after" },
    ],
    places: {
      "run-1": { x: 0, y: 0 },
      "majority-1": { x: 280, y: 0 },
      "viewer-1": { x: 540, y: -40 },
      "areas-1": { x: 540, y: 150 },
      "change-1": { x: 880, y: 60 },
    },
    viewer: "viewer-1",
  }
}

/**
 * A field delineation's nodes on the graph: its polygons through a Field
 * filter to Make fields and Save fields, and its class map to a Viewer.
 *
 * THE LAST DELINEATION'S NODES ARE REUSED. A Run node that already feeds
 * fields somewhere is pointed at the new run, rather than a second set of
 * nodes being added beside it: a delineation is usually run again over the
 * same area with another period, and a graph that grew five nodes each time
 * would bury the one set the reader is using. A graph with none gets the set,
 * placed under whatever is already there.
 */
export function withFieldNodes(
  graph: CompositorGraph,
  runId: string,
  classOutput: string | null
): CompositorGraph {
  const existing = graph.nodes.find(
    (n): n is Extract<GraphNode, { kind: "run" }> =>
      n.kind === "run" && graph.links.some((l) => l.from === n.id && l.fromSocket === FIELDS_SOCKET)
  )
  if (existing) {
    return existing.runId === runId ? graph : updateNode(graph, { ...existing, runId })
  }
  const bottom = Math.max(0, ...Object.values(graph.places).map((p) => p.y + 320))
  const id = (kind: NodeKind) => nextNodeId(graph, kind)
  const run = id("run")
  const filter = id("fieldFilter")
  const adopt = id("adoptFields")
  const save = id("saveFields")
  const viewer = id("viewer")
  let g: CompositorGraph = graph
  g = addNode(g, { id: run, kind: "run", runId }, { x: 0, y: bottom })
  g = addNode(g, { id: filter, kind: "fieldFilter", ...FIELD_FILTER_DEFAULT }, { x: 280, y: bottom })
  g = addNode(g, { id: adopt, kind: "adoptFields" }, { x: 540, y: bottom - 40 })
  g = addNode(g, { id: save, kind: "saveFields" }, { x: 540, y: bottom + 150 })
  const links: GraphLink[] = [
    { from: run, fromSocket: FIELDS_SOCKET, to: filter, toSocket: "fields" },
    { from: filter, fromSocket: "fields", to: adopt, toSocket: "fields" },
    { from: filter, fromSocket: "fields", to: save, toSocket: "fields" },
  ]
  if (classOutput) {
    // Under the Run node, clear of the filter above it and of Save fields,
    // which a Viewer 320 px wide beside the filter would cover.
    g = addNode(g, { id: viewer, kind: "viewer" }, { x: 0, y: bottom + 260 })
    links.push({ from: run, fromSocket: classOutput, to: viewer, toSocket: "image" })
  }
  return { ...g, links: [...g.links, ...links] }
}

/** What a mineral run has figures for, which decides the cards placed for it. */
export interface MineralParts {
  cover: boolean
  bands: readonly MineralBand[]
  acid: boolean
  /** The groups compared with EMIT L2B. */
  agreement: readonly MineralGroupId[]
}

/**
 * A mineral map's cards on the graph, fed from one Run node's Mineral report:
 * coverage, the classes and references of both groups, the passes, the
 * confidence, and each of fractional cover, band position, acid-sulfate
 * minerals and agreement with L2B that the run has figures for; and the node
 * that saves its GeoTIFF.
 *
 * THE LAST MINERAL RUN'S NODES ARE REUSED, as a delineation's are: a Run node
 * that already feeds a Mineral report is pointed at the new run rather than a
 * second set being added beside it, since the same area is mapped again with
 * another period more often than two maps are read side by side. A graph with
 * none gets the set in rows under whatever is already there.
 */
export function withMineralNodes(
  graph: CompositorGraph,
  runId: string,
  parts: MineralParts
): CompositorGraph {
  const existing = graph.nodes.find(
    (n): n is Extract<GraphNode, { kind: "run" }> =>
      n.kind === "run" && graph.links.some((l) => l.from === n.id && l.fromSocket === MINERAL_SOCKET)
  )
  if (existing) {
    return existing.runId === runId ? graph : updateNode(graph, { ...existing, runId })
  }
  const bottom = Math.max(0, ...Object.values(graph.places).map((p) => p.y + 320))
  const cards: GraphNode[][] = [
    [
      { id: "", kind: "mineralCoverage" },
      { id: "", kind: "mineralClasses", group: 2 },
      { id: "", kind: "mineralClasses", group: 1 },
    ],
    [
      { id: "", kind: "mineralPasses" },
      { id: "", kind: "mineralReferences", group: 2 },
      { id: "", kind: "mineralReferences", group: 1 },
    ],
    [
      { id: "", kind: "mineralConfidence" },
      ...parts.agreement.map((group): GraphNode => ({ id: "", kind: "mineralAgreement", group })),
      ...(parts.cover ? [{ id: "", kind: "mineralCover" } as GraphNode] : []),
    ],
    [
      ...parts.bands.map((band): GraphNode => ({ id: "", kind: "mineralPositions", band })),
      ...(parts.acid ? [{ id: "", kind: "mineralAcid" } as GraphNode] : []),
      { id: "", kind: "mineralSave" },
    ],
  ]
  let g = graph
  const run = nextNodeId(g, "run")
  g = addNode(g, { id: run, kind: "run", runId }, { x: 0, y: bottom })
  const links: GraphLink[] = []
  cards.forEach((row, r) => {
    row.forEach((card, c) => {
      const id = nextNodeId(g, card.kind)
      g = addNode(g, { ...card, id }, { x: 300 + c * 380, y: bottom + r * 330 })
      links.push({ from: run, fromSocket: MINERAL_SOCKET, to: id, toSocket: "report" })
    })
  })
  return { ...g, links: [...g.links, ...links] }
}

const WINDOWS: readonly number[] = [3, 5, 7]
const group = (v: unknown): MineralGroupId => (v === 1 ? 1 : 2)

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null)

function parseNode(raw: unknown): GraphNode | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const id = str(o.id)
  if (!id) return null
  const size = (WINDOWS.includes(o.size as number) ? o.size : 3) as WindowSize
  switch (o.kind) {
    case "run": {
      const e = o.each as Record<string, unknown> | undefined
      const areaId = e && typeof e === "object" ? str(e.areaId) : null
      const runKind = e && typeof e === "object" ? str(e.runKind) : null
      return areaId && runKind
        ? { id, kind: "run", runId: str(o.runId), each: { areaId, runKind, fieldId: str(e!.fieldId) } }
        : { id, kind: "run", runId: str(o.runId) }
    }
    case "majority":
      return { id, kind: "majority", size }
    case "sieve": {
      const n = Math.round(Number(o.minPixels))
      return {
        id,
        kind: "sieve",
        minPixels: Number.isFinite(n) ? Math.min(SIEVE_MAX, Math.max(SIEVE_MIN, n)) : 4,
        connectivity: o.connectivity === 4 ? 4 : 8,
      }
    }
    case "morphology":
      return {
        id,
        kind: "morphology",
        op: o.op === "close" ? "close" : "open",
        size,
        classId: typeof o.classId === "number" && Number.isFinite(o.classId) ? o.classId : null,
      }
    case "select":
      return {
        id,
        kind: "select",
        keep: Array.isArray(o.keep)
          ? [...new Set(o.keep.filter((v): v is number => typeof v === "number" && Number.isFinite(v)))]
          : [],
      }
    case "mask":
      return { id, kind: "mask" }
    case "mix": {
      const v = Number(o.opacity)
      return { id, kind: "mix", opacity: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.6 }
    }
    case "areas":
      return { id, kind: "areas" }
    case "change":
      return { id, kind: "change" }
    case "viewer":
      return { id, kind: "viewer" }
    case "globe": {
      const v = Number(o.opacity)
      return { id, kind: "globe", opacity: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.85 }
    }
    case "fieldFilter": {
      const ha = Number(o.minHa)
      const crop = Number(o.minCropland)
      return {
        id,
        kind: "fieldFilter",
        minHa: Number.isFinite(ha) ? Math.max(0, ha) : FIELD_FILTER_DEFAULT.minHa,
        minCropland: Number.isFinite(crop) ? Math.min(1, Math.max(0, crop)) : FIELD_FILTER_DEFAULT.minCropland,
      }
    }
    case "adoptFields":
      return { id, kind: "adoptFields" }
    case "saveFields":
      return { id, kind: "saveFields" }
    case "mineralClasses":
    case "mineralReferences":
    case "mineralAgreement":
      return { id, kind: o.kind, group: group(o.group) }
    case "mineralPositions":
      return { id, kind: "mineralPositions", band: o.band === "aloh" ? "aloh" : "fe3" }
    case "mineralCoverage":
    case "mineralPasses":
    case "mineralCover":
    case "mineralAcid":
    case "mineralConfidence":
    case "mineralSave":
      return { id, kind: o.kind }
    default:
      return null
  }
}

/**
 * A graph read back from a saved board, or null where there is none.
 *
 * Every part is checked rather than assumed, for the reason lib/studios.ts
 * gives for the snapshot around it. A node that cannot be read is dropped with
 * its links; a link onto an input that does not exist, into a node's own
 * ancestry, or onto an input already fed is dropped. Links out of a Run node
 * are kept whatever their socket, because which rasters a run has is only
 * known once the board has loaded it.
 */
export function parseGraph(raw: unknown): CompositorGraph | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const nodes: GraphNode[] = []
  const ids = new Set<string>()
  for (const n of Array.isArray(o.nodes) ? o.nodes : []) {
    const node = parseNode(n)
    if (!node || ids.has(node.id)) continue
    ids.add(node.id)
    nodes.push(node)
  }

  let graph: CompositorGraph = { ...EMPTY_GRAPH, nodes }
  for (const l of Array.isArray(o.links) ? o.links : []) {
    const r = (l ?? {}) as Record<string, unknown>
    const link = {
      from: str(r.from),
      fromSocket: str(r.fromSocket),
      to: str(r.to),
      toSocket: str(r.toSocket),
    }
    if (!link.from || !link.fromSocket || !link.to || !link.toSocket) continue
    const from = nodeOf(graph, link.from)
    const to = nodeOf(graph, link.to)
    if (!from || !to || from.id === to.id) continue
    // The Globe took one input, `image`, before it took layers.
    if (to.kind === "globe" && link.toSocket === "image") link.toSocket = "layer-1"
    if (linkInto(graph, link.to, link.toSocket)) continue
    if (!canHaveInput(to, link.toSocket)) continue
    // Structure only. A Run node's outputs, and so the types, are not known
    // until its run has loaded; the evaluation reports a link that is wrong.
    if (from.kind !== "run" && !kindMeta(from.kind).outputs.some((x) => x.id === link.fromSocket)) continue
    if (feeds(graph, to.id, from.id)) continue
    graph = { ...graph, links: [...graph.links, link as GraphLink] }
  }

  const rawPlaces = (o.places && typeof o.places === "object" ? o.places : {}) as Record<string, unknown>
  const places: Record<string, Place> = {}
  for (const id of ids) {
    const p = rawPlaces[id] as { x?: unknown; y?: unknown } | undefined
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) places[id] = { x: p.x as number, y: p.y as number }
  }
  const viewer = str(o.viewer)
  return {
    ...graph,
    places,
    viewer: viewer && nodes.some((n) => n.id === viewer && n.kind === "viewer") ? viewer : null,
  }
}
