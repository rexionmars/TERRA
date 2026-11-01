/**
 * Whether a product can be started now, what starting it is called, and why not.
 *
 * The enabling rules genuinely differ between products: a classification needs
 * both dates, a delineation needs a period long enough to cut into two windows
 * and an area that is not itself a field, the register overlap reads no imagery
 * at all. They are the rules the studio's run band applies, written once more
 * here because the band folds them into a chain that also answers which tool is
 * showing, and it goes with the studio.
 *
 * WHAT IS NEW IS `blocked`. The band greys its button out and leaves the reader
 * to work out which of several conditions failed. The shell's product list is
 * where someone arrives before knowing what a product asks for, so it says.
 */
import { MIN_PERIOD_DAYS, fieldWindows } from "@/lib/fields"
import { isJobKind, type JobKind } from "@/lib/jobs"
import type { BoardToolId } from "@/lib/mapTools"

/** The part of the surface's props these rules read. */
export interface ProductRunProps {
  hasArea: boolean
  activeAreaId?: string
  areas?: readonly { id: string; parent_id?: string }[]
  start: string
  end: string
  selectedAreaIds?: readonly string[]
  running: boolean
  progress: number
  progressMsg: string
  onRun: () => void
  waterRunning: boolean
  waterProgress: number
  waterProgressMsg: string
  onRunWater: () => void
  mineralBusy?: boolean
  mineralProgress?: number
  mineralProgressMsg?: string
  onRunMinerals?: () => void
  fieldsBusy?: boolean
  fieldsProgress?: number
  fieldsProgressMsg?: string
  onRunFields?: () => void
  onQueueJobs?: (kind: JobKind) => void
  lulcRunning?: boolean
}

export interface ProductRun {
  running: boolean
  progress: number
  progressMsg: string
  /** What the button says. */
  label: string
  /** Why it cannot be pressed, or null where it can. */
  blocked: string | null
  onRun: () => void
}

const NO_AREA = "Draw an area on the map, or choose one under Areas."
const NO_DATES = "Set both dates of the period."
/*
  These run as jobs, and a job names an area of the catalog: the job list shows
  each one by its area and opening a finished one activates it. internal/jobs
  refuses a bare polygon for that reason, so the refusal is stated before it.
*/
const NO_SAVED_AREA = "This product runs over a saved area. Choose one under Areas."

const idle = { running: false, progress: 0, progressMsg: "" }

/** Whether a product can be started from this build at all. */
export function productOffered(tool: BoardToolId, p: ProductRunProps): boolean {
  switch (tool) {
    case "mineral":
      return !!p.onRunMinerals
    case "fields":
      return !!p.onRunFields
    case "health":
    case "overlap":
    case "radar":
    case "zones":
      return !!p.onQueueJobs
    default:
      return true
  }
}

function needs(p: ProductRunProps, ...reasons: (string | false)[]): string | null {
  if (!p.hasArea) return NO_AREA
  return reasons.find((r): r is string => !!r) ?? null
}

/**
 * The run of one product.
 *
 * OVER A SELECTION THE SAME PRODUCT IS QUEUED, once per selected area, in place
 * of being run over the area in hand. The delineation is never queued: it makes
 * the fields a queue is for.
 */
export function productRun(tool: BoardToolId, p: ProductRunProps): ProductRun {
  const dates = !!p.start && !!p.end
  const selection = p.selectedAreaIds ?? []
  if (selection.length && p.onQueueJobs && isJobKind(tool)) {
    const queue = p.onQueueJobs
    return {
      ...idle,
      label: `Queue ${selection.length} ${selection.length === 1 ? "run" : "runs"}`,
      // The overlap reads registers as they stand, not a period's imagery.
      blocked: tool === "overlap" || dates ? null : NO_DATES,
      onRun: () => queue(tool),
    }
  }
  const job = (kind: JobKind, label: string, usesPeriod = true): ProductRun => ({
    ...idle,
    label,
    blocked: needs(
      p,
      !p.activeAreaId && NO_SAVED_AREA,
      usesPeriod && !dates && NO_DATES
    ),
    onRun: () => p.onQueueJobs?.(kind),
  })
  switch (tool) {
    case "water":
      return {
        running: p.waterRunning,
        progress: p.waterProgress,
        progressMsg: p.waterProgressMsg,
        label: p.waterRunning ? "Mapping" : "Map water",
        blocked: needs(p),
        onRun: p.onRunWater,
      }
    case "mineral":
      return {
        running: p.mineralBusy ?? false,
        progress: p.mineralProgress ?? 0,
        progressMsg: p.mineralProgressMsg ?? "",
        label: p.mineralBusy ? "Mapping" : "Map minerals",
        // The pass search is bounded by the period.
        blocked: needs(p, !dates && NO_DATES),
        onRun: () => p.onRunMinerals?.(),
      }
    case "fields": {
      const isField = !!p.areas?.find((a) => a.id === p.activeAreaId)?.parent_id
      return {
        running: p.fieldsBusy ?? false,
        progress: p.fieldsProgress ?? 0,
        progressMsg: p.fieldsProgressMsg ?? "",
        label: p.fieldsBusy ? "Delineating" : "Delineate fields",
        blocked: needs(
          p,
          isField && "A field holds no fields. Choose the area around it.",
          !fieldWindows(p.start, p.end) &&
            `The period has to span at least ${MIN_PERIOD_DAYS} days, to be cut into two windows.`
        ),
        onRun: () => p.onRunFields?.(),
      }
    }
    case "health":
      return job("health", "Queue health run")
    case "overlap":
      return job("overlap", "Queue overlap check", false)
    case "radar":
      return job("radar", "Queue radar run")
    case "zones":
      return job("zones", "Queue zones run")
    default:
      return {
        running: p.running,
        progress: p.progress,
        progressMsg: p.progressMsg,
        label: p.running ? "Classifying" : "Classify",
        blocked: needs(p, !dates && NO_DATES),
        onRun: p.onRun,
      }
  }
}

/** Every run the surface is making at the moment, for a strip that outlives the panel. */
export function activeRuns(p: ProductRunProps): ProductRun[] {
  const runs = (["classify", "water", "mineral", "fields"] as const)
    .map((t) => productRun(t, { ...p, selectedAreaIds: [] }))
    .filter((r) => r.running)
  // Land cover reports through the classification's progress, and is not a product.
  if (p.lulcRunning) {
    runs.push({
      running: true,
      progress: p.progress,
      progressMsg: p.progressMsg,
      label: "Reading land cover",
      blocked: null,
      onRun: () => {},
    })
  }
  return runs
}
