/** The classification and the land cover reading, which share the result on the map. */
import { useState } from "react"

import { useAuth } from "@/lib/auth"
import { notifyError, notifySuccess } from "@/lib/notify"
import type { GeoJSONGeometry, LULCAnalysis, PredictResult } from "@/lib/types"
import { AnalyzeLULC, Predict } from "../../wailsjs/go/main/App"
import type { useSharedProgress } from "./runProgress"
import { predictRequest, type RequestContext, type RunGround } from "./runRequests"

export interface ClassificationProps {
  result: PredictResult | null
  running: boolean
  progress: number
  progressMsg: string
  onRun: () => void
  onAnalyzeLULC: () => void
  lulcRunning?: boolean
  onCloseResult: () => void
}

export function useClassification({
  context,
  inHand,
  customPolygon,
  analysisLabel,
  setAnalysisLabel,
  activeProjectId,
  setShowPredictionOverlay,
  shared,
  retainRun,
  setCurrentRunId,
}: {
  context: RequestContext
  inHand: RunGround | null
  customPolygon: GeoJSONGeometry | null
  analysisLabel?: string
  setAnalysisLabel: (v: string | undefined) => void
  activeProjectId: string | null
  setShowPredictionOverlay: (v: boolean) => void
  shared: ReturnType<typeof useSharedProgress>
  retainRun: (outgoing: PredictResult | null, areaId?: string | null) => void
  setCurrentRunId: (id: string | null) => void
}) {
  const { refreshRuns, refreshProjects, goMap } = useAuth()
  const { start, end } = context
  const { progress, progressMsg, setProgress, setProgressMsg } = shared
  const [running, setRunning] = useState<boolean>(false)
  const [result, setResult] = useState<PredictResult | null>(null)
  const [lulcRunning, setLulcRunning] = useState(false)

  const handleRun = async () => {
    if (!start || !end) {
      notifyError("Set the acquisition period.")
      return
    }
    if (!customPolygon) {
      notifyError("Draw an area on the map first.")
      return
    }
    setRunning(true)
    setProgress(0)
    setProgressMsg("iniciando")
    // Before the slot is emptied, and before the request is built: a run that
    // fails now costs the reader nothing, where it used to cost them the map.
    retainRun(result)
    setResult(null)
    const req = predictRequest(inHand!, context)
    try {
      const res = (await Predict(req as never)) as unknown as PredictResult
      setResult(res)
      // The row the backend just wrote. Compositions made from here attach to
      // it; empty when nothing was saved, which leaves them project-level.
      /*
        THE RUN THIS STATE SHOWS. Every product that records a run sets it
        now; only the classification did.

        Stage one gave every product a run id and nothing on this side picked
        it up -- the standalone handlers read `res.run_id` solely to decide
        whether their toast said "(saved)". So a board opened over a water
        run received `result.run_id || "current"` as the sentinel and refused
        to save, reporting that none of its areas carried a run while the
        raster of one sat on it.

        Null where the save was refused. That is saveRun withdrawing its claim
        to have written a row, not an id going missing.
      */
      setCurrentRunId(res.run_id || null)
      setShowPredictionOverlay(true)
      if (!analysisLabel?.trim()) {
        setAnalysisLabel(req.label)
      }
      if (activeProjectId) {
        // The project's own counts change; its geometry does not, because it
        // has none. This used to write the map's polygon and label onto the
        // project row alongside the refresh.
        await refreshProjects()
      }
      /*
        The word AND the action, both conditional on the run existing.

        "View analysis" opens the hub, and the hub lists rows -- so offering it
        for a run that was never recorded sends the reader to look for
        something that is not there. See the water toast for what withdraws the
        claim.
      */
      notifySuccess(
        `Classification complete — ${res.n_dates} scenes${res.run_id ? " (saved)" : ""}.`
      )
      void refreshRuns()
      void refreshProjects()
    } catch (e) {
      notifyError("Inference error", e)
    } finally {
      setRunning(false)
    }
  }

  const handleAnalyzeLULC = async () => {
    if (!customPolygon) {
      notifyError("Draw an area on the map first.")
      return
    }
    setLulcRunning(true)
    setProgress(0)
    setProgressMsg("fetching MapBiomas COG")
    try {
      const lulc = (await AnalyzeLULC({
        polygon_geojson: customPolygon,
      } as never)) as unknown as LULCAnalysis
      if (!analysisLabel?.trim()) {
        const label = "Custom AOI"
        setAnalysisLabel(label)
      }
      const mapUri = lulc.map_uri ?? ""
      const extent = lulc.extent ?? {
        lon_min: 0,
        lat_min: 0,
        lon_max: 0,
        lat_max: 0,
      }
      const classStats = (lulc.composition ?? []).map((c) => ({
        class_id: c.class_id,
        name: c.name,
        color: c.color,
        pixels: c.pixels,
        pct: c.pct,
        area_ha: c.area_ha,
      }))
      const emptyPheno = {
        sos_doy: null,
        pos_doy: null,
        eos_doy: null,
        los_days: null,
        peak: null,
        base: null,
        amplitude: null,
      }
      // Keep prior classification if any; otherwise expose LULC as the map overlay.
      const prev = result
      const keepClassification =
        !!prev && ((prev.n_dates ?? 0) > 0 || !!prev.overlay_uri)
      setShowPredictionOverlay(true)
      setResult({
        extent: keepClassification && prev ? prev.extent : extent,
        overlay_uri:
          keepClassification && prev?.overlay_uri ? prev.overlay_uri : mapUri,
        confidence_uri: prev?.confidence_uri ?? "",
        ndvi_mean_uri: prev?.ndvi_mean_uri ?? "",
        true_color_uri: prev?.true_color_uri ?? "",
        reference_uri: mapUri || prev?.reference_uri || "",
        raster_tif: prev?.raster_tif ?? "",
        mean_confidence: prev?.mean_confidence ?? 0,
        n_dates: prev?.n_dates ?? 0,
        date_range: prev?.date_range ?? [],
        class_stats:
          keepClassification && prev?.class_stats?.length
            ? prev.class_stats
            : classStats,
        temporal: prev?.temporal ?? [],
        vi_series: prev?.vi_series ?? [],
        phenology: prev?.phenology ?? emptyPheno,
        phenology_states: prev?.phenology_states ?? [],
        lulc,
      })
      notifySuccess("Land cover / land use ready on map.")
      goMap()
    } catch (e) {
      notifyError("LULC analysis error", e)
    } finally {
      setLulcRunning(false)
      setProgress(0)
      setProgressMsg("")
    }
  }

  const props: ClassificationProps = {
    result,
    running,
    progress,
    progressMsg,
    onRun: () => void handleRun(),
    onAnalyzeLULC: () => void handleAnalyzeLULC(),
    lulcRunning,
    onCloseResult: () => {
      setResult(null)
      setShowPredictionOverlay(true)
      setAnalysisLabel(undefined)
    },
  }

  return { props, result, setResult }
}
