/**
 * The runs this session holds: the live one, those the map moved on from, those brought
 * in by name. What Compare and Workflows read.
 */
import { useCallback, useMemo, useState } from "react"

import type { Area } from "@/lib/areas"
import { useAuth } from "@/lib/auth"
import { fieldSets as fieldSetsOf } from "@/lib/fieldSets"
import type { FieldsTarget } from "@/lib/fields"
import { notifyError } from "@/lib/notify"
import type { PdfReportRun } from "@/lib/pdfReport"
import { sessionRuns, type SessionRun } from "@/lib/sessionRuns"
import type { InferenceRun, PredictResult } from "@/lib/types"
import type { MapShellProps } from "@/pages/MapShell"
import { LoadAnalysis } from "../../../wailsjs/go/main/App"

/** The list with this run in it, once. */
export const withRun = (
  list: readonly { run: InferenceRun; result: PredictResult }[],
  run: InferenceRun,
  result: PredictResult
) => (list.some((x) => x.run.id === run.id) ? [...list] : [...list, { run, result }])

export function useRunsInHand(
  props: MapShellProps,
  areas: readonly Area[],
  areaName: string
) {
  const { runs: savedRuns } = useAuth()
  /*
    Runs brought in by name, or by opening a saved workflow. A session's: they
    survive a look at the map and not a restart.
  */
  const [extraRuns, setExtraRuns] = useState<
    { run: InferenceRun; result: PredictResult }[]
  >([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const addRuns = useCallback(async (list: readonly InferenceRun[]) => {
    setLoadingRuns(true)
    try {
      for (const run of list) {
        try {
          const result = (await LoadAnalysis(run.id)) as unknown as PredictResult
          setExtraRuns((prev) => withRun(prev, run, result))
        } catch (e) {
          notifyError("Could not load that run", e)
        }
      }
    } finally {
      setLoadingRuns(false)
    }
  }, [])

  const liveRunId =
    props.result?.run_id ||
    props.water?.run_id ||
    props.mineral?.run_id ||
    props.fields?.run_id ||
    "current"
  const session = useMemo<SessionRun[]>(() => {
    const anything = props.result || props.water || props.mineral || props.fields
    return sessionRuns({
      live: anything
        ? {
            id: liveRunId,
            label: areaName,
            model: props.modelKind,
            result: {
              ...props.result,
              water: props.water ?? props.result?.water,
              mineral: props.mineral ?? props.result?.mineral,
              fields: props.fields ?? props.result?.fields,
            } as PredictResult,
          }
        : null,
      retained: props.retainedRuns ?? [],
      extra: extraRuns,
      saved: savedRuns,
      areas,
    })
  }, [
    props.result,
    props.water,
    props.mineral,
    props.fields,
    props.modelKind,
    props.retainedRuns,
    liveRunId,
    areaName,
    extraRuns,
    savedRuns,
    areas,
  ])
  const dropRun = (run: SessionRun) => {
    const held = props.retainedRuns?.find((x) => (x.result.run_id || x.id) === run.id)
    if (held) props.onDropRetainedRun?.(held.id)
    setExtraRuns((prev) => prev.filter((x) => x.run.id !== run.id))
  }

  const sessionRunIds = session.map((r) => r.id)
  const fieldSets = useMemo(() => fieldSetsOf(areas, savedRuns), [areas, savedRuns])
  const fieldsTargetOf = (runId: string): FieldsTarget | null => {
    const areaOfRun = savedRuns.find((r) => r.id === runId)?.area_id
    const area = areas.find((a) => a.id === areaOfRun && !a.parent_id)
    if (!area) return null
    const adopted = areas.filter((a) => a.parent_id === area.id && a.source_run_id)
    return {
      name: area.name,
      adopted: adopted.length,
      adoptedWithRuns: adopted.filter((a) => a.run_count > 0).length,
    }
  }
  const runRecordOf = (runId: string): PdfReportRun | null => {
    const r =
      savedRuns.find((x) => x.id === runId) ??
      extraRuns.find((x) => x.run.id === runId)?.run
    if (!r) return null
    return {
      id: r.id,
      kind: r.kind || "classification",
      title: r.label || r.id,
      modelKind: r.model_kind,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      created: r.created_at,
    }
  }

  return {
    setExtraRuns,
    loadingRuns,
    addRuns,
    session,
    dropRun,
    sessionRunIds,
    fieldSets,
    fieldsTargetOf,
    runRecordOf,
  }
}
