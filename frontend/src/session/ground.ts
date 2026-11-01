/** The ground in hand: the shape on the map, the project's areas, and which is active. */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"

import { toAreas, type Area } from "@/lib/areas"
import { useAuth } from "@/lib/auth"
import { countJobs, useJobs } from "@/lib/jobs"
import { notifyError } from "@/lib/notify"
import type { GeoJSONGeometry } from "@/lib/types"
import { ListAreas } from "../../wailsjs/go/main/App"

export interface GroundState {
  customPolygon: GeoJSONGeometry | null
  setCustomPolygon: (g: GeoJSONGeometry | null) => void
  areas: Area[]
  setAreas: Dispatch<SetStateAction<Area[]>>
  activeAreaId?: string
  setActiveAreaId: (id: string | undefined) => void
  analysisLabel?: string
  setAnalysisLabel: (v: string | undefined) => void
  refreshAreas: (projectId: string | null) => Promise<void>
  /** Identity of the AOI on the map. Changes whenever the drawn polygon changes. */
  aoiSignature: string
  areaLabel?: string
  polygonGeoJSON: string
}

export function useGround(activeProjectId: string | null): GroundState {
  const { refreshRuns } = useAuth()
  const [customPolygon, setCustomPolygon] = useState<GeoJSONGeometry | null>(null)
  const [areas, setAreas] = useState<Area[]>([])
  const [activeAreaId, setActiveAreaId] = useState<string | undefined>()
  const [analysisLabel, setAnalysisLabel] = useState<string | undefined>()

  /*
    The open project's grounds, re-read from the store.

    A LOAD, NOT A CACHE TO KEEP IN STEP. Every mutation below re-reads rather
    than patching the list in place, because the store decides two things the
    frontend cannot: the id an area gets, and the name it is given when the
    caller supplies none -- "drawn", "drawn 2", numbered against what the
    project already holds. A local patch would have to reimplement both, and
    the previous catalogue is what happened when it did.
  */
  const refreshAreas = useCallback(
    async (projectId: string | null) => {
      if (!projectId) {
        setAreas([])
        return
      }
      try {
        const rows = await ListAreas(projectId)
        setAreas(toAreas(rows))
      } catch (e) {
        notifyError("Could not load the project's areas", e)
      }
    },
    [setAreas]
  )

  useEffect(() => {
    void refreshAreas(activeProjectId)
  }, [activeProjectId, refreshAreas])

  /*
    A finished job has recorded a run under its area, and the lists that count
    runs -- the hub's, the areas' run counts -- were read before it. Re-read on
    each one that finishes, as the band's own run does after it returns.
  */
  const jobsDone = countJobs(useJobs()).done
  useEffect(() => {
    if (!jobsDone) return
    void refreshRuns()
    void refreshAreas(activeProjectId)
    // Only a job finishing is the reason to re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsDone])

  const aoiSignature = useMemo(
    () => (customPolygon ? `poly:${JSON.stringify(customPolygon)}` : ""),
    [customPolygon]
  )

  const areaLabel = useMemo(() => {
    if (analysisLabel) return analysisLabel
    return customPolygon ? "Custom AOI" : undefined
  }, [analysisLabel, customPolygon])

  const polygonGeoJSON = useMemo(
    () => (customPolygon ? JSON.stringify(customPolygon) : ""),
    [customPolygon]
  )

  return {
    customPolygon,
    setCustomPolygon,
    areas,
    setAreas,
    activeAreaId,
    setActiveAreaId,
    analysisLabel,
    setAnalysisLabel,
    refreshAreas,
    aoiSignature,
    areaLabel,
    polygonGeoJSON,
  }
}
