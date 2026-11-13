/**
 * Saved runs, grouped as the Analyses screen lays them out: by day, and inside
 * a day into batches and the runs between them.
 *
 * A BATCH IS ONE REQUEST OVER SEVERAL AREAS. Classifying twenty-three fields
 * at once saves twenty-three runs, each named run-<area>-<stamp> with the stamp
 * of the moment the request was made (aoiLabel.ts, makeRunLabel), so the stamp
 * is what ties them together; their own created_at differs by the minutes each
 * took. Two runs are of one batch when they share that stamp, the product and
 * the model. A stamp held by one run alone is not a batch.
 */
import type { InferenceRun } from "@/lib/types"

/** The stamp a run's label ends in, as makeRunLabel writes it. */
const STAMP = /-(\d{8}-\d{6})$/

type Dated = Pick<InferenceRun, "id" | "created_at" | "model_kind" | "kind" | "label">

export function batchKey(run: Dated): string | null {
  const m = STAMP.exec((run.label ?? "").trim())
  if (!m) return null
  return `${run.kind ?? ""}|${run.model_kind}|${m[1]}`
}

export type RunBlock<R extends Dated = InferenceRun> =
  { batch: true; key: string; runs: R[] } | { batch: false; runs: R[] }

export interface RunDay<R extends Dated = InferenceRun> {
  /** The local calendar day, YYYY-MM-DD. */
  day: string
  blocks: RunBlock<R>[]
  count: number
}

/** The local calendar day of an ISO timestamp, as YYYY-MM-DD. */
export function localDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Newest first. A batch is placed where its newest run falls and keeps every
 * member, even one made after midnight; the runs around it keep their order
 * and are split where the day changes.
 */
export function groupRuns<R extends Dated>(
  runs: readonly R[],
  dayOf: (iso: string) => string = localDay
): RunDay<R>[] {
  const sorted = [...runs].sort((a, b) => time(b.created_at) - time(a.created_at))

  const members = new Map<string, R[]>()
  for (const r of sorted) {
    const k = batchKey(r)
    if (k) members.set(k, [...(members.get(k) ?? []), r])
  }

  const blocks: { day: string; block: RunBlock<R> }[] = []
  const placed = new Set<string>()
  for (const r of sorted) {
    const k = batchKey(r)
    const group = k ? members.get(k) : undefined
    if (k && group && group.length > 1) {
      if (placed.has(k)) continue
      placed.add(k)
      blocks.push({
        day: dayOf(r.created_at),
        block: { batch: true, key: k, runs: group },
      })
      continue
    }
    const day = dayOf(r.created_at)
    const last = blocks.at(-1)
    if (last && !last.block.batch && last.day === day) last.block.runs.push(r)
    else blocks.push({ day, block: { batch: false, runs: [r] } })
  }

  const days: RunDay<R>[] = []
  for (const { day, block } of blocks) {
    const last = days.at(-1)
    if (last && last.day === day) {
      last.blocks.push(block)
      last.count += block.runs.length
    } else {
      days.push({ day, blocks: [block], count: block.runs.length })
    }
  }
  return days
}

function time(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}
