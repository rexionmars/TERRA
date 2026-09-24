/**
 * Where the compositor's nodes go when the reader asks for them to be arranged.
 *
 * A layered drawing of a directed graph, after Sugiyama, Tagawa and Toda
 * (1981, IEEE Transactions on Systems, Man, and Cybernetics 11:109-125), in
 * its three usual steps:
 *
 *   1. LAYERS. Each node's column is the longest chain of links reaching it
 *      from a node nothing feeds, so every link runs left to right: a Run node
 *      in the first column, what it feeds in the next, and so on. The graph
 *      has no cycle (compositorGraph refuses a link that would close one).
 *   2. ORDER. Within a column, nodes are sorted by the mean position of the
 *      nodes they are linked to in the neighbouring column -- the barycentre
 *      heuristic -- in sweeps to the right and back, which reduces the links
 *      that cross. Ties keep the order the reader had them in, top to bottom.
 *   3. PLACES. Columns stand side by side at their widest node's width, nodes
 *      stacked in their order and each column centred on the tallest.
 *
 * ONE ADDITION FOR THIS EDITOR: a column taller than the budget is folded into
 * several, side by side. A mineral map's thirteen cards all read one Run node,
 * so all stand in one column, and one column of them is a tower read by
 * panning. Folding keeps every link running left to right, because the next
 * column starts after the last fold.
 *
 * Pipelines that share no link are laid out apart and stacked, the one the
 * reader had highest first, so a field delineation's nodes and a mineral map's
 * do not interleave.
 */
import type { CompositorGraph, GraphNode, Place } from "@/lib/compositorGraph"

export interface Box {
  w: number
  h: number
}

export interface ArrangeOptions {
  /** Between one column and the next, where the links run. */
  columnGap?: number
  /** Between the folds of one column. */
  foldGap?: number
  /** Between nodes in a column. */
  rowGap?: number
  /** Between pipelines that share no link. */
  componentGap?: number
  /** A column taller than this is folded; never less than its tallest node. */
  maxColumnHeight?: number
}

const DEFAULTS: Required<ArrangeOptions> = {
  columnGap: 96,
  foldGap: 40,
  rowGap: 28,
  componentGap: 120,
  maxColumnHeight: 1100,
}

/** The pipelines of the graph: node ids joined by any link, highest first. */
function components(graph: CompositorGraph, ids: string[]): string[][] {
  const parent = new Map(ids.map((id) => [id, id]))
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  for (const l of graph.links) {
    if (!parent.has(l.from) || !parent.has(l.to)) continue
    parent.set(find(l.from), find(l.to))
  }
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const r = find(id)
    groups.set(r, [...(groups.get(r) ?? []), id])
  }
  const top = (g: string[]) => Math.min(...g.map((id) => graph.places[id]?.y ?? 0))
  const left = (g: string[]) => Math.min(...g.map((id) => graph.places[id]?.x ?? 0))
  return [...groups.values()].sort((a, b) => top(a) - top(b) || left(a) - left(b))
}

/**
 * New places for every node of `graph`, laid out from the top-left corner of
 * where the nodes stood, so arranging does not carry the graph off screen.
 */
export function arrange(
  graph: CompositorGraph,
  size: (node: GraphNode) => Box,
  options: ArrangeOptions = {}
): Record<string, Place> {
  const o = { ...DEFAULTS, ...options }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const ids = graph.nodes.map((n) => n.id)
  if (!ids.length) return {}
  const was = (id: string) => graph.places[id] ?? { x: 0, y: 0 }
  const box = new Map(graph.nodes.map((n) => [n.id, size(n)]))

  const preds = new Map(ids.map((id) => [id, new Set<string>()]))
  const succs = new Map(ids.map((id) => [id, new Set<string>()]))
  for (const l of graph.links) {
    if (!byId.has(l.from) || !byId.has(l.to) || l.from === l.to) continue
    preds.get(l.to)!.add(l.from)
    succs.get(l.from)!.add(l.to)
  }

  const origin = {
    x: Math.min(...ids.map((id) => was(id).x)),
    y: Math.min(...ids.map((id) => was(id).y)),
  }
  const out: Record<string, Place> = {}
  let top = origin.y

  for (const comp of components(graph, ids)) {
    // 1. Layers, by longest path, through a topological order (Kahn, 1962).
    const inComp = new Set(comp)
    const layer = new Map<string, number>()
    const waiting = new Map(comp.map((id) => [id, [...preds.get(id)!].filter((p) => inComp.has(p)).length]))
    const queue = comp.filter((id) => waiting.get(id) === 0)
    for (const id of queue) layer.set(id, 0)
    while (queue.length) {
      const id = queue.shift()!
      for (const s of succs.get(id)!) {
        if (!inComp.has(s)) continue
        layer.set(s, Math.max(layer.get(s) ?? 0, layer.get(id)! + 1))
        const left = waiting.get(s)! - 1
        waiting.set(s, left)
        if (left === 0) queue.push(s)
      }
    }
    // A node a cycle kept out of the order -- none should be -- goes first.
    for (const id of comp) if (!layer.has(id)) layer.set(id, 0)

    const depth = Math.max(...comp.map((id) => layer.get(id)!)) + 1
    const columns: string[][] = Array.from({ length: depth }, () => [])
    for (const id of [...comp].sort((a, b) => was(a).y - was(b).y || was(a).x - was(b).x)) {
      columns[layer.get(id)!].push(id)
    }

    // 2. Order, by barycentre, four sweeps each way.
    const rank = new Map<string, number>()
    const setRanks = () =>
      columns.forEach((c) => c.forEach((id, i) => rank.set(id, (i + 0.5) / c.length)))
    setRanks()
    const sweep = (c: string[], toward: Map<string, Set<string>>) => {
      const key = new Map(
        c.map((id) => {
          const near = [...toward.get(id)!].filter((x) => inComp.has(x))
          return [id, near.length ? near.reduce((s, x) => s + rank.get(x)!, 0) / near.length : rank.get(id)!]
        })
      )
      c.sort((a, b) => key.get(a)! - key.get(b)!)
    }
    for (let i = 0; i < 4; i++) {
      for (let l = 1; l < depth; l++) {
        sweep(columns[l], preds)
        setRanks()
      }
      for (let l = depth - 2; l >= 0; l--) {
        sweep(columns[l], succs)
        setRanks()
      }
    }

    // 3. Places: fold what is too tall, then centre every fold on the tallest.
    const stack = (c: string[]) => c.reduce((s, id) => s + box.get(id)!.h, 0) + Math.max(0, c.length - 1) * o.rowGap
    const folds: string[][][] = columns.map((c) => {
      const limit = Math.max(o.maxColumnHeight, ...c.map((id) => box.get(id)!.h))
      const parts: string[][] = [[]]
      for (const id of c) {
        const cur = parts[parts.length - 1]
        if (cur.length && stack([...cur, id]) > limit) parts.push([id])
        else cur.push(id)
      }
      return parts
    })
    const tallest = Math.max(...folds.flat().map(stack))
    let x = origin.x
    folds.forEach((parts, l) => {
      if (l > 0) x += o.columnGap - o.foldGap
      for (const part of parts) {
        const width = Math.max(...part.map((id) => box.get(id)!.w))
        let y = top + (tallest - stack(part)) / 2
        for (const id of part) {
          out[id] = { x: Math.round(x), y: Math.round(y) }
          y += box.get(id)!.h + o.rowGap
        }
        x += width + o.foldGap
      }
    })
    top += tallest + o.componentGap
  }
  return out
}
