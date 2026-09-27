/**
 * The fields of an area as one subject for the compositor.
 *
 * A job leaves one run per field, and a Run node reads one run: a graph built
 * over field 34 answers for field 34, and asking the same of the other nine
 * meant nine more graphs. A FIELD SET is the other answer: a Run node that
 * stands for every field of an area, read through the latest run of one
 * product on each. The graph is built once, shown for the field in focus, and
 * evaluated once per field wherever the answer is wanted for all of them -- the
 * Globe node draws every field's, the Class areas node can sum them.
 *
 * THE LATEST RUN of the product on each field, because a field re-run is a
 * field whose earlier answer has been superseded; an older run is still one
 * pick away on a plain Run node.
 */
import { isField, type Area } from "@/lib/areas"
import type { CompositorGraph, GraphNode } from "@/lib/compositorGraph"

export interface FieldMember {
  fieldId: string
  fieldName: string
  runId: string
}

export interface FieldSet {
  areaId: string
  areaName: string
  /** The store's run kind: "classification", "water", "mineral". */
  runKind: string
  /** One per field that has a run of the kind, in the order the outliner names them. */
  members: FieldMember[]
}

type RunRow = { id: string; created_at: string; area_id?: string; kind?: string }

/** What a set's product is called, in the band's words. */
export function runKindProduct(runKind: string): string {
  if (runKind === "water") return "Surface water"
  if (runKind === "mineral") return "Mineral map"
  if (runKind === "health") return "Vegetation health"
  if (runKind === "overlap") return "Socio-environmental overlap"
  if (runKind === "radar") return "Sentinel-1 radar"
  if (runKind === "zones") return "Management zones"
  return "Classification"
}

// "field 2" before "field 10".
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

/**
 * Every field set the catalogue and the run list make: for each area with
 * fields and each product its fields have a run of, the latest run on each
 * field. A row written before the kind column is a classification, as the store
 * reads it back; a delineation is not a product a field has.
 */
export function fieldSets(areas: readonly Area[], runs: readonly RunRow[]): FieldSet[] {
  const fields = new Map(areas.filter(isField).map((a) => [a.id, a]))
  const latest = new Map<string, { field: Area; kind: string; run: RunRow }>()
  for (const r of runs) {
    const field = r.area_id ? fields.get(r.area_id) : undefined
    if (!field) continue
    const kind = r.kind || "classification"
    if (kind === "fields") continue
    const k = `${field.id}\u0000${kind}`
    const prev = latest.get(k)
    if (!prev || r.created_at > prev.run.created_at) latest.set(k, { field, kind, run: r })
  }
  const sets = new Map<string, FieldSet>()
  for (const { field, kind, run } of latest.values()) {
    const k = `${field.parent_id}\u0000${kind}`
    let set = sets.get(k)
    if (!set) {
      const parent = areas.find((a) => a.id === field.parent_id)
      set = { areaId: field.parent_id, areaName: parent?.name ?? "area", runKind: kind, members: [] }
      sets.set(k, set)
    }
    set.members.push({ fieldId: field.id, fieldName: field.name, runId: run.id })
  }
  const out = [...sets.values()]
  for (const s of out) s.members.sort((a, b) => byName.compare(a.fieldName, b.fieldName))
  return out.sort(
    (a, b) => byName.compare(a.areaName, b.areaName) || a.runKind.localeCompare(b.runKind)
  )
}

type RunNode = Extract<GraphNode, { kind: "run" }>
type EachNode = RunNode & { each: NonNullable<RunNode["each"]> }

const isEach = (n: GraphNode): n is EachNode => n.kind === "run" && !!n.each

/** The set a field-set node reads, or undefined where the catalogue no longer has it. */
export function setOf(sets: readonly FieldSet[], node: GraphNode): FieldSet | undefined {
  if (!isEach(node)) return undefined
  return sets.find((s) => s.areaId === node.each.areaId && s.runKind === node.each.runKind)
}

/** A graph with some Run nodes pointed at other runs; unchanged where none moves. */
function pointed(graph: CompositorGraph, runIdOf: (n: EachNode) => string | null): CompositorGraph {
  let changed = false
  const nodes = graph.nodes.map((n) => {
    if (!isEach(n)) return n
    const runId = runIdOf(n)
    if (runId === n.runId) return n
    changed = true
    return { ...n, runId }
  })
  return changed ? { ...graph, nodes } : graph
}

/**
 * The graph with each field-set node pointed at the run of its field in focus,
 * or its first field where the one in focus has no run of the product (a field
 * deleted, a focus never chosen). Everything that reads a Run node's `runId` --
 * its outputs, its sources, the links' types -- then reads the field in focus
 * with no second path.
 */
export function resolveEach(graph: CompositorGraph, sets: readonly FieldSet[]): CompositorGraph {
  return pointed(graph, (n) => {
    const set = setOf(sets, n)
    if (!set) return null
    return (set.members.find((m) => m.fieldId === n.each.fieldId) ?? set.members[0])?.runId ?? null
  })
}

/**
 * The graph once per field, or null where it holds no field-set node.
 *
 * The fields are those of the first field-set node's area that ANY set node of
 * that area has a run on. Every set node over that area reads the same field in
 * each copy -- a classification set and a health set of one area meet field by
 * field -- and reads nothing on a field its product has no run on, so a field
 * classified and not yet assessed keeps its row with the health column empty.
 * Taking the first node's fields alone dropped every field the other product
 * had and it did not. A set node of another area keeps its field in focus,
 * since its fields are not these.
 */
export function perField(
  graph: CompositorGraph,
  sets: readonly FieldSet[]
): { member: FieldMember; graph: CompositorGraph }[] | null {
  const first = graph.nodes.find(isEach)
  const lead = first ? setOf(sets, first) : undefined
  if (!first || !lead) return null
  const fields = new Map<string, FieldMember>()
  for (const n of graph.nodes) {
    if (!isEach(n) || n.each.areaId !== lead.areaId) continue
    for (const m of setOf(sets, n)?.members ?? []) if (!fields.has(m.fieldId)) fields.set(m.fieldId, m)
  }
  const members = [...fields.values()].sort((a, b) => byName.compare(a.fieldName, b.fieldName))
  return members.map((member) => ({
    member,
    graph: pointed(graph, (n) => {
      if (n.each.areaId !== lead.areaId) return n.runId
      const set = setOf(sets, n)
      return set?.members.find((m) => m.fieldId === member.fieldId)?.runId ?? null
    }),
  }))
}
