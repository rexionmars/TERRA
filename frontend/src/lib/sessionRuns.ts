/**
 * The runs in hand this session, wherever each of them came from.
 *
 * Three sources feed Compare and Workflows: the run the map is on, the ones it has
 * moved on from, and those brought in by name or by opening a saved workflow. They
 * are listed once each, in that order, so a run that is both on the map and picked
 * by hand does not stand on the grid twice.
 */
import { modelLabel } from "@/lib/runAssets"
import type { InferenceRun, ModelKind, PredictResult } from "@/lib/types"

export interface SessionRun {
  id: string
  label: string
  model: string | null
  period: string | null
  result: PredictResult
  /** Its row in the store, or null for a run that was never saved. */
  record: InferenceRun | null
  /** Whether it is the run on the map, whose rasters App holds. */
  live: boolean
}

function periodOf(r: PredictResult, record?: InferenceRun | null): string | null {
  const d = r.date_range
  if (d?.length)
    return d[0] === d[d.length - 1] ? d[0] : `${d[0]} to ${d[d.length - 1]}`
  return record?.period_start ? `${record.period_start} to ${record.period_end}` : null
}

const modelOf = (kind?: string | null) => (kind ? modelLabel(kind as ModelKind) : null)

export function sessionRuns(i: {
  live: {
    id: string
    label: string
    model?: string | null
    result: PredictResult
  } | null
  retained: readonly { id: string; result: PredictResult }[]
  extra: readonly { run: InferenceRun; result: PredictResult }[]
  saved: readonly InferenceRun[]
  areas: readonly { id: string; name: string }[]
}): SessionRun[] {
  const out: SessionRun[] = []
  const has = (id: string) => out.some((r) => r.id === id)
  const areaName = (id?: string | null) => i.areas.find((a) => a.id === id)?.name

  if (i.live) {
    const record = i.saved.find((r) => r.id === i.live?.id) ?? null
    out.push({
      id: i.live.id,
      label: i.live.label,
      // What made this raster, from its record. The control says what the next
      // run will use, and the two part as soon as the model is changed.
      model: modelOf(record?.model_kind) ?? modelOf(i.live.model),
      period: periodOf(i.live.result, record),
      result: i.live.result,
      record,
      live: true,
    })
  }
  for (const r of i.retained) {
    // Kept under the ground it was over; the run names itself where it can.
    const id = r.result.run_id || r.id
    if (has(id) || i.extra.some((x) => x.run.id === id)) continue
    const record = i.saved.find((s) => s.id === id) ?? null
    out.push({
      id,
      label:
        areaName(record?.area_id) ?? areaName(r.id) ?? record?.label ?? "Earlier run",
      model: modelOf(record?.model_kind),
      period: periodOf(r.result, record),
      result: r.result,
      record,
      live: false,
    })
  }
  for (const { run, result } of i.extra) {
    if (has(run.id)) continue
    out.push({
      id: run.id,
      label: areaName(run.area_id) ?? run.label ?? `Run of ${run.period_start}`,
      model: modelOf(run.model_kind),
      period: periodOf(result, run),
      result,
      record: run,
      live: false,
    })
  }
  return out
}
