/**
 * The compositor's node graph: what nodes exist, which sockets each declares,
 * what each is set to, and which output feeds which input.
 *
 * Blender's compositor is the model, and the resemblance is structural. A node
 * declares its sockets; a link joins one output socket to one input socket;
 * an input takes one link and an output feeds any number. The Run node is the
 * Render Layers node of this editor: one output per raster the run produced.
 * The Viewer is the Viewer node: whatever reaches it is drawn in its card.
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
 */
export type SocketType = "classes" | "image"

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

export type NodeCategory = "input" | "filter" | "mask" | "color" | "analysis" | "output"

export type GraphNode =
  | { id: string; kind: "run"; runId: string | null }
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
    hint: "Draws what reaches it, in its own card",
    inputs: [{ id: "image", label: "Image", accepts: ANY }],
    outputs: [],
  },
]

/** The Add menu's categories, in Blender's order where Blender has the same one. */
export const CATEGORIES: readonly { id: NodeCategory; label: string }[] = [
  { id: "input", label: "Input" },
  { id: "output", label: "Output" },
  { id: "filter", label: "Filter" },
  { id: "mask", label: "Mask" },
  { id: "color", label: "Color" },
  { id: "analysis", label: "Analysis" },
]

const META = new Map(NODE_KINDS.map((k) => [k.kind, k]))

export function kindMeta(kind: NodeKind): KindMeta {
  return META.get(kind)!
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
  const input = kindMeta(b.kind).inputs.find((i) => i.id === link.toSocket)
  if (!input) return { ok: false, reason: `${kindMeta(b.kind).label} has no input called ${link.toSocket}.` }
  if (!outputsOf(a, runOutputs).some((o) => o.id === link.fromSocket)) {
    return { ok: false, reason: "That output is no longer on its node." }
  }
  if (feeds(graph, b.id, a.id)) {
    return { ok: false, reason: "That link would make the graph read its own output." }
  }
  const type = outputType(graph, a.id, link.fromSocket, runOutputs)
  if (type && !input.accepts.includes(type)) {
    return {
      ok: false,
      reason: `${input.label} needs a class map, and this output is an image: a class cannot be read back out of colour.`,
    }
  }
  return {
    ok: true,
    graph: {
      ...graph,
      links: [...graph.links.filter((l) => !(l.to === link.to && l.toSocket === link.toSocket)), link],
    },
  }
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

const WINDOWS: readonly number[] = [3, 5, 7]

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null)

function parseNode(raw: unknown): GraphNode | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const id = str(o.id)
  if (!id) return null
  const size = (WINDOWS.includes(o.size as number) ? o.size : 3) as WindowSize
  switch (o.kind) {
    case "run":
      return { id, kind: "run", runId: str(o.runId) }
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
    if (linkInto(graph, link.to, link.toSocket)) continue
    if (!kindMeta(to.kind).inputs.some((i) => i.id === link.toSocket)) continue
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
