/** The field delineation: its result, its run, and adopting its fields as areas. */
import { useCallback, useEffect, useRef, useState } from "react"

import { makeRunLabel } from "@/lib/aoiLabel"
import type { Area } from "@/lib/areas"
import { useAuth } from "@/lib/auth"
import { fieldWindows, MIN_PERIOD_DAYS } from "@/lib/fields"
import { notifyError, notifySuccess } from "@/lib/notify"
import type { FieldsAnalysis, FieldsRequest, GeoJSONGeometry } from "@/lib/types"
import { AdoptFields, AnalyzeFields } from "../../wailsjs/go/main/App"
import { useRunChannel } from "./runProgress"
import type { RequestContext } from "./runRequests"

export interface FieldDelineationProps {
  /**
   * The field delineation, as the mineral map's props are: absent runner, no
   * band entry. Adoption is asked for by the compositor's Make fields node,
   * with the run and the thresholds that reached it.
   */
  fields?: FieldsAnalysis | null
  onRunFields?: () => void
  fieldsBusy?: boolean
  fieldsProgress?: number
  fieldsProgressMsg?: string
  onAdoptFields?: (
    runId: string,
    minHa: number,
    minCropland: number,
    replace: boolean
  ) => Promise<boolean>
  onClearFields?: () => void
}

export function useFieldDelineation({
  context,
  customPolygon,
  activeAreaId,
  areas,
  analysisLabel,
  aoiSignature,
  refreshAreas,
  setCurrentRunId,
}: {
  context: RequestContext
  customPolygon: GeoJSONGeometry | null
  activeAreaId?: string
  areas: Area[]
  analysisLabel?: string
  aoiSignature: string
  refreshAreas: (projectId: string | null) => Promise<void>
  setCurrentRunId: (id: string | null) => void
}) {
  const { refreshRuns, refreshProjects } = useAuth()
  const { start, end, maxCloud } = context
  /*
    The field delineation and its run status, held here for the reason the
    mineral map's are: the screen unmounts on every navigation away.
  */
  const [fields, setFields] = useState<FieldsAnalysis | null>(null)
  const channel = useRunChannel()

  /** The AOI the field delineation on screen was drawn over, and its area. */
  const fieldsAoiRef = useRef<string>("")
  const fieldsAreaRef = useRef<string>("")

  /*
    The same for the field delineation, WITH ONE EXCEPTION: moving onto one of
    the delineated area's own fields keeps it. Choosing a field is what the
    delineation is for, and a reading that vanished the moment a field was
    chosen would take the table of fields, and the adoption beside it, away
    from the reader at the point they were being used.
  */
  useEffect(() => {
    if (!fields) return
    if (aoiSignature === fieldsAoiRef.current) return
    const active = areas.find((a) => a.id === activeAreaId)
    const area = fieldsAreaRef.current
    if (area && (activeAreaId === area || active?.parent_id === area)) return
    setFields(null)
  }, [aoiSignature, fields, areas, activeAreaId])

  /*
    The field boundaries over the area in hand, from two scenes of the period.

    THE WINDOWS ARE THE PERIOD'S FIRST AND LAST THIRD (lib/fields.ts says why),
    so a period that cannot hold two is refused here rather than by a search
    that finds one scene for both.

    A FIELD CANNOT BE DELINEATED. Its fields would be areas inside an area
    inside an area, which the store refuses; and a network run over one field
    finds the one field. The check is here as well as in the band, which
    withholds the button, because a run can also be started from the console.

    The cloud ceiling is the period card's: the sidecar reads the scene-level
    cover as a first cut and then measures each candidate over the area itself.
  */
  const handleRunFields = async () => {
    if (!customPolygon) {
      notifyError("Draw an area on the map first.")
      return
    }
    const windows = fieldWindows(start, end)
    if (!windows) {
      notifyError(
        `Set a period of at least ${MIN_PERIOD_DAYS} days that spans a season: its first third gives window A, its last third window B.`
      )
      return
    }
    const active = areas.find((a) => a.id === activeAreaId)
    if (active?.parent_id) {
      notifyError(
        "Choose the area the field belongs to: fields are delineated over an area, not over one field."
      )
      return
    }
    channel.begin()
    const runAoi = aoiSignature
    const runArea = activeAreaId ?? ""
    try {
      const aoiLabel = analysisLabel?.trim() || "Custom AOI"
      const req: FieldsRequest = {
        polygon_geojson: customPolygon,
        window_a: windows.a,
        window_b: windows.b,
        max_cloud: maxCloud,
        min_area_m2: 0,
        label: aoiLabel,
        run_label: makeRunLabel(aoiLabel),
        area_id: activeAreaId ?? undefined,
        project_id: context.projectId || undefined,
      }
      const res = (await AnalyzeFields(req as never)) as unknown as FieldsAnalysis
      fieldsAoiRef.current = runAoi
      fieldsAreaRef.current = runArea
      setCurrentRunId(res.run_id || null)
      setFields(res)
      /*
        No reveal. The delineation's actions are compositor nodes, placed by
        the board (withFieldNodes), and the compositor's floor is wider than
        the area a reveal would retype in the Layout preset -- it arrived as a
        note saying it did not fit. The Field boundaries preset shows the
        compositor beside the globe, and the notification says where.
      */
      const sizes = res.field_area_ha
      notifySuccess(
        `Field boundaries: ${res.n_fields} fields` +
          (sizes ? `, median ${sizes.median.toFixed(1)} ha` : "") +
          `, from ${res.window_a.date} and ${res.window_b.date}` +
          `${res.run_id ? " (saved)" : ""}. Filter, make and save them in the Compositor.`
      )
      void refreshRuns()
      void refreshProjects()
    } catch (e) {
      notifyError("Field boundaries error", e)
    } finally {
      channel.end()
    }
  }

  /*
    A delineation's fields made areas of the area it was run over, with the
    thresholds the compositor's filters applied on the way to the node.

    Returns whether it was done, so the node can close its confirmation. The
    area listing is re-read rather than patched, for the reason refreshAreas
    gives: the store names the fields.
  */
  const handleAdoptFields = async (
    runId: string,
    minHa: number,
    minCropland: number,
    replace: boolean
  ): Promise<boolean> => {
    try {
      const made = await AdoptFields(runId, minHa, minCropland, replace)
      await refreshAreas(context.projectId)
      const parent = areas.find((a) => a.id === made[0]?.parent_id)
      notifySuccess(
        `${made.length} fields made areas of ${parent?.name ?? "the area"}; choose one under Areas or on the globe to run over it.`
      )
      return true
    } catch (e) {
      notifyError("Could not make the fields", e)
      return false
    }
  }

  /**
   * A saved run's delineation, which also records the area it was of so choosing one of
   * that area's fields keeps it on screen.
   */
  const restore = useCallback(
    (
      saved: FieldsAnalysis | null | undefined,
      aoi: string,
      areaId: string | undefined
    ) => {
      if (saved) {
        fieldsAoiRef.current = aoi
        fieldsAreaRef.current = areaId ?? ""
        setFields(saved)
      } else {
        setFields(null)
      }
    },
    []
  )

  const props: FieldDelineationProps = {
    fields,
    onRunFields: () => void handleRunFields(),
    fieldsBusy: channel.run.active,
    fieldsProgress: channel.run.progress,
    fieldsProgressMsg: channel.run.message,
    onAdoptFields: handleAdoptFields,
    onClearFields: () => setFields(null),
  }

  return { props, fields, setFields, channel, restore }
}
