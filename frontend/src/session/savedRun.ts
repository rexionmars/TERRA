/** A saved run, opened: every product it holds back in its place, and its ground in hand. */
import { useCallback, useState } from "react"

import { aoiLabelFromRunSummary, resolveAoiDisplayLabel } from "@/lib/aoiLabel"
import type { Area } from "@/lib/areas"
import { useAuth } from "@/lib/auth"
import { notifyError, notifySuccess } from "@/lib/notify"
import { parsePreferenceExtras } from "@/lib/preferenceExtras"
import type {
  FieldsAnalysis,
  GeoJSONGeometry,
  InferenceRun,
  MineralAnalysis,
  ModelKind,
  PredictResult,
  WaterAnalysis,
} from "@/lib/types"
import { LoadAnalysis } from "../../wailsjs/go/main/App"

function isModelKind(v: string): v is ModelKind {
  return v === "spectral" || v === "prithvi" || v === "temporal_transformer"
}

/*
  The ground a saved run was measured on, read back from its polygon_geojson.

  It also accepted `{"area_id":"A"}` there, because saveRun used to write that
  when a request named an embedded example instead of drawing a shape -- a
  geometry column holding something that is not geometry, resolved on the way
  out by looking the id up in a list. Both ends of that are gone: nothing writes
  the shape, and the schema-3 migration emptied every run that could still
  carry it.

  Returns null for anything it cannot read, malformed rows included. A run whose
  ground cannot be recovered is shown without one rather than refused.
*/
function parseRunPolygon(raw: string): GeoJSONGeometry | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.type === "Polygon" || parsed.type === "MultiPolygon") {
      return parsed as unknown as GeoJSONGeometry
    }
    if (parsed.type === "Feature") {
      const geom = (parsed as { geometry?: GeoJSONGeometry }).geometry
      if (geom?.type === "Polygon" || geom?.type === "MultiPolygon") return geom
    }
    if (parsed.type === "FeatureCollection") {
      const features = (parsed as { features?: { geometry?: GeoJSONGeometry }[] })
        .features
      const geom = features?.find(
        (f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon"
      )?.geometry
      if (geom) return geom
    }
  } catch {
    /* ignore malformed */
  }
  return null
}

export function useSavedRunLoader({
  areas,
  analysisLabel,
  setAnalysisLabel,
  setCustomPolygon,
  setActiveAreaId,
  setResult,
  setCurrentRunId,
  setShowPredictionOverlay,
  setModelKind,
  persistAoiLabel,
  restoreWater,
  restoreMineral,
  restoreFields,
}: {
  areas: Area[]
  analysisLabel?: string
  setAnalysisLabel: (v: string | undefined) => void
  setCustomPolygon: (g: GeoJSONGeometry | null) => void
  setActiveAreaId: (id: string | undefined) => void
  setResult: (r: PredictResult | null) => void
  setCurrentRunId: (id: string | null) => void
  setShowPredictionOverlay: (v: boolean) => void
  setModelKind: (m: ModelKind) => void
  persistAoiLabel: (label: string | null) => Promise<void>
  restoreWater: (saved: WaterAnalysis | null | undefined, aoi: string) => void
  restoreMineral: (saved: MineralAnalysis | null | undefined, aoi: string) => void
  restoreFields: (
    saved: FieldsAnalysis | null | undefined,
    aoi: string,
    areaId: string | undefined
  ) => void
}) {
  const { goMap, prefs } = useAuth()
  const [loadingRun, setLoadingRun] = useState(false)

  const openSavedAnalysis = useCallback(
    /**
     * @param opts.land Where to leave the user once the run is restored.
     *
     * The hub and the profile list send someone to the analysis page, which
     * for the hub is where they already are. The project menu does not: it is
     * opened from the map, and a run picked there is a request to look at that
     * run on the map. Passed rather than corrected afterwards -- navigating to
     * one screen and then to another shows the first one on the way past.
     */
    async (run: InferenceRun): Promise<PredictResult | null> => {
      setLoadingRun(true)
      try {
        const res = (await LoadAnalysis(run.id)) as unknown as PredictResult
        // A water run carries no classification: no class stats, no
        // overlay, no scenes. Held as the result it made the map screen present
        // one, and the result panel then read a class list that was never
        // there. The standalone products below are what such a run restores.
        const isClassification =
          (res.class_stats?.length ?? 0) > 0 ||
          !!res.overlay_uri ||
          !!res.lulc ||
          res.n_dates > 0
        setResult(isClassification ? res : null)
        setCurrentRunId(run.id)
        setShowPredictionOverlay(true)
        if (isModelKind(run.model_kind)) setModelKind(run.model_kind)
        const extras = parsePreferenceExtras(prefs?.extras_json)
        // The ground the run was measured on names it, where the project's own
        // AOI label used to. A run of a ground in another project resolves to
        // nothing here and falls through to what its summary froze at predict.
        const runArea = areas.find((a) => a.id === run.area_id)
        const displayLabel = resolveAoiDisplayLabel({
          analysisLabel: analysisLabel,
          areaName: runArea?.name,
          prefsAoiLabel: extras.aoi_label,
          summaryAoiLabel: aoiLabelFromRunSummary(run.summary),
        })
        setAnalysisLabel(displayLabel)
        if (displayLabel) void persistAoiLabel(displayLabel)
        const polygon = parseRunPolygon(run.polygon_geojson)
        setCustomPolygon(polygon)
        // Its ground is the area in hand, so the next run made here is filed under it.
        setActiveAreaId(runArea?.id)
        const restoredAoi = polygon ? `poly:${JSON.stringify(polygon)}` : ""
        restoreWater(res.water, restoredAoi)
        restoreMineral(res.mineral, restoredAoi)
        restoreFields(res.fields, restoredAoi, run.area_id)
        /*
          One destination. This once chose between several screens, one per
          product, because each product was read where it was run. Everything
          is read in the studio now, the rasters as planes, so `run.kind` no
          longer chooses a screen.
        */
        goMap()
        notifySuccess("Analysis restored.")
        // The queued products have no state here; the map shell holds their reading.
        return res
      } catch (e) {
        notifyError("Could not load analysis", e)
        return null
      } finally {
        setLoadingRun(false)
      }
    },
    [
      goMap,
      analysisLabel,
      setResult,
      setCurrentRunId,
      setShowPredictionOverlay,
      setModelKind,
      setAnalysisLabel,
      setCustomPolygon,
      persistAoiLabel,
      prefs?.extras_json,
      // Which area the run is of is read from these, and they load after this is made.
      areas,
      setActiveAreaId,
      restoreWater,
      restoreMineral,
      restoreFields,
    ]
  )

  return { openSavedAnalysis, loadingRun }
}
