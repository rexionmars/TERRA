/** Surface water: its result, its run, and how it is drawn. */
import { useCallback, useEffect, useRef, useState } from "react"

import { useAuth } from "@/lib/auth"
import { notifyError, notifySuccess } from "@/lib/notify"
import type { GeoJSONGeometry, WaterAnalysis, WaterIndex } from "@/lib/types"
import { AnalyzeWater } from "../../wailsjs/go/main/App"
import { waterRequest, type RequestContext, type RunGround } from "./runRequests"
import type { useSharedProgress } from "./runProgress"

export interface SurfaceWaterProps {
  water?: WaterAnalysis | null
  waterIndex: WaterIndex
  waterRunning: boolean
  waterProgress: number
  waterProgressMsg: string
  showWaterOverlay: boolean
  onWaterIndexChange: (i: WaterIndex) => void
  onRunWater: () => void
  onClearWater: () => void
  onShowWaterOverlayChange: (v: boolean) => void
  waterOpacity: number
  onWaterOpacityChange: (v: number) => void
}

export function useSurfaceWater({
  context,
  inHand,
  customPolygon,
  aoiSignature,
  shared,
  setCurrentRunId,
}: {
  context: RequestContext
  inHand: RunGround | null
  customPolygon: GeoJSONGeometry | null
  aoiSignature: string
  shared: ReturnType<typeof useSharedProgress>
  setCurrentRunId: (id: string | null) => void
}) {
  const { refreshRuns, refreshProjects } = useAuth()
  const { start, end } = context
  const { progress, progressMsg, setProgress, setProgressMsg } = shared
  const [water, setWater] = useState<WaterAnalysis | null>(null)
  const [waterIndex, setWaterIndex] = useState<WaterIndex>("MNDWI")
  const [waterRunning, setWaterRunning] = useState(false)
  const [showWaterOverlay, setShowWaterOverlay] = useState(true)
  const [waterOpacity, setWaterOpacity] = useState(0.8)

  /** The AOI the current water result was computed over. */
  const waterAoiRef = useRef<string>("")

  /**
   * A water result belongs to the AOI it was measured on. When the AOI changes
   * the raster no longer describes what is on the map, so it is dropped.
   *
   * Done by comparing against the AOI the run was made on rather than by
   * clearing at each call site: the AOI changes from drawing, from loading an
   * example, from opening a project and from opening a composition, and a
   * missed path leaves a raster from one field painted over another.
   */
  useEffect(() => {
    if (!water) return
    if (aoiSignature === waterAoiRef.current) return
    setWater(null)
    setShowWaterOverlay(true)
  }, [aoiSignature, water])

  const handleRunWater = async () => {
    if (!start || !end) {
      notifyError("Set the acquisition period.")
      return
    }
    if (!customPolygon) {
      notifyError("Draw an area on the map first.")
      return
    }
    setWaterRunning(true)
    // The sidecar emits on the shared predict:progress channel and only one
    // action runs at a time, so the panel reads the shared progress.
    setProgress(0)
    setProgressMsg("starting")
    try {
      const req = waterRequest(inHand!, context, waterIndex)
      const res = (await AnalyzeWater(req as never)) as unknown as WaterAnalysis
      waterAoiRef.current = aoiSignature
      setCurrentRunId(res.run_id || null)
      setWater(res)
      setShowWaterOverlay(true)
      notifySuccess(
        /*
          The word only where the run was actually recorded.

          saveRun withdraws its claim to have saved by returning nothing, on
          three failures it states -- and this said "(saved)" either way, which
          is exactly the claim that comment exists to withdraw. A reader told a
          run was saved goes looking for it in the hub.
        */
        `Surface water mapped: ${res.n_dates} dates, peak ${res.peak_water_fraction_pct.toFixed(1)}%${res.run_id ? " (saved)" : ""}.`
      )
      void refreshRuns()
      void refreshProjects()
    } catch (e) {
      notifyError("Surface water error", e)
    } finally {
      setWaterRunning(false)
      setProgress(0)
      setProgressMsg("")
    }
  }

  /** A saved run's water, or none, as opening it restores the rest. */
  const restore = useCallback(
    (saved: WaterAnalysis | null | undefined, aoi: string) => {
      // A water run carries its raster in the same field a live run
      // uses, so opening one puts the overlay back on the map. The AOI it was
      // measured on is recorded first, otherwise the invalidation effect sees
      // a mismatch and drops the raster that was just restored.
      if (saved) {
        waterAoiRef.current = aoi
        setWater(saved)
        setShowWaterOverlay(true)
      } else {
        setWater(null)
      }
    },
    []
  )

  const props: SurfaceWaterProps = {
    water,
    waterIndex,
    waterRunning,
    waterProgress: progress,
    waterProgressMsg: progressMsg,
    showWaterOverlay,
    onWaterIndexChange: setWaterIndex,
    onRunWater: () => void handleRunWater(),
    onClearWater: () => {
      setWater(null)
      setShowWaterOverlay(true)
    },
    onShowWaterOverlayChange: setShowWaterOverlay,
    waterOpacity,
    onWaterOpacityChange: setWaterOpacity,
  }

  return { props, water, setWater, waterIndex, restore }
}
