import type { Area } from "@/lib/areas"
import type { JobKind, JobSpec } from "@/lib/jobs"
import type { MineralRunOptions } from "@/lib/mineral"
import { notifyError, notifySuccess } from "@/lib/notify"
import type { WaterIndex } from "@/lib/types"
import { GetEarthdataStatus, QueueJobs } from "../../wailsjs/go/main/App"
import {
  healthRequest,
  mineralRequest,
  overlapRequest,
  predictRequest,
  radarRequest,
  waterRequest,
  zonesRequest,
  type RequestContext,
  type RunGround,
} from "./runRequests"

export function useJobQueue({
  context,
  areas,
  activeAreaId,
  liveSelection,
  waterIndex,
  mineralOptions,
}: {
  context: RequestContext
  areas: Area[]
  activeAreaId?: string
  liveSelection: string[]
  waterIndex: WaterIndex
  mineralOptions: MineralRunOptions
}) {
  const { start, end } = context
  /*
    The band's product over every selected area, one job each, run one after
    another by the Go side. The band's own run stays free: a job reports on
    its own channel (runner.go WithProgress), so the two do not share a bar.

    The mineral map's token is asked for here as the band asks for it, once
    for the whole list rather than once per job refused.
  */
  const handleQueueJobs = async (kind: JobKind) => {
    /*
      The selection, or the area in hand where nothing is selected: vegetation
      health runs from the band as a job even over one area, and a job needs a
      saved area to be filed under.
    */
    const ids = liveSelection.length
      ? liveSelection
      : activeAreaId
        ? [activeAreaId]
        : []
    const targets = ids
      .map((id) => areas.find((a) => a.id === id))
      .filter((a): a is Area => !!a)
    if (!targets.length) {
      notifyError(
        "Select the areas to run over: shift-press them on the globe or under Areas."
      )
      return
    }
    // The overlap reads registers, not imagery, and so has no period.
    if (kind !== "overlap" && (!start || !end)) {
      notifyError("Set the acquisition period.")
      return
    }
    if (kind === "mineral") {
      try {
        const status = await GetEarthdataStatus()
        if (!status.configured) {
          notifyError(
            "No Earthdata token is set. Add one in Settings > System (Earthdata token) to read EMIT reflectance."
          )
          return
        }
      } catch (e) {
        notifyError("Could not read the Earthdata token status", e)
        return
      }
    }
    const specs: JobSpec[] = targets.map((a) => {
      const g: RunGround = { polygon: a.geometry, areaId: a.id, label: a.name }
      return kind === "classify"
        ? { kind, area_name: a.name, classify: predictRequest(g, context) }
        : kind === "water"
          ? { kind, area_name: a.name, water: waterRequest(g, context, waterIndex) }
          : kind === "health"
            ? { kind, area_name: a.name, health: healthRequest(g, context) }
            : kind === "overlap"
              ? { kind, area_name: a.name, overlap: overlapRequest(g, context) }
              : kind === "radar"
                ? { kind, area_name: a.name, radar: radarRequest(g, context) }
                : kind === "zones"
                  ? { kind, area_name: a.name, zones: zonesRequest(g, context) }
                  : {
                      kind,
                      area_name: a.name,
                      mineral: mineralRequest(g, context, mineralOptions),
                    }
    })
    try {
      const queued = await QueueJobs(specs as never)
      notifySuccess(
        `${queued.length} ${queued.length === 1 ? "run" : "runs"} queued. Follow them in the Run graph's run card; each is saved under its area as it finishes.`
      )
    } catch (e) {
      notifyError("Could not queue the runs", e)
    }
  }

  return handleQueueJobs
}
