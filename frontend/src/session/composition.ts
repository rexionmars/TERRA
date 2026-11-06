/** The composition on the map, the gallery beside it, and how one is made. */
import { useCallback, useMemo, useState } from "react"

import { useAuth } from "@/lib/auth"
import { kindDef, resolveCompositionMeta } from "@/lib/compositeCatalog"
import { compositionLegendOf } from "@/lib/compositionLegend"
import { geometryBounds } from "@/lib/geometry"
import { notifyError, notifyInfo, notifySuccess } from "@/lib/notify"
import { scopeCompositionsToView } from "@/lib/projectOverlays"
import type {
  BiophysicalVariable,
  CompositeIndex,
  CompositeKind,
  CompositeRequest,
  CompositeResult,
  CompositionOverlay,
  DataCubeRequest,
  DataCubeResult,
  DataCubeScene,
  GeoJSONGeometry,
  SaveProjectOverlayRequest,
} from "@/lib/types"
import {
  ListDataCube,
  RenderComposite,
  SaveProjectOverlay,
} from "../../wailsjs/go/main/App"

export interface CompositionProps {
  showCompositionOverlay: boolean
  composition: CompositionOverlay | null
  /** Session gallery of applied compositions (newest first). */
  compositionGallery?: CompositionOverlay[]
  onSelectComposition?: (id: string) => void
  onRemoveComposition?: (id: string) => void
  composeRunning: boolean
  composeProgress: number
  composeProgressMsg: string
  composeScenes: DataCubeScene[]
  composeScenesLoading: boolean
  composeScenesError: string | null
  selectedSceneId: string
  composeKind: CompositeKind
  composeBands: [string, string, string]
  composeIndex: CompositeIndex
  composeStretchLow: number
  composeStretchHigh: number
  composeOpacity: number
  /** Drawn from the period's cloud-free median rather than from one scene. */
  composeMedian: boolean
  /** The earlier scene of a change; selectedSceneId is the later. */
  composeSceneBefore: string
  composeClusters: number
  composeVariable: BiophysicalVariable
  composeYear: number
  onComposeMedianChange: (v: boolean) => void
  onSelectSceneBefore: (id: string) => void
  onComposeClustersChange: (k: number) => void
  onComposeVariableChange: (v: BiophysicalVariable) => void
  onComposeYearChange: (y: number) => void
  onShowCompositionOverlayChange: (v: boolean) => void
  onSelectScene: (id: string) => void
  onComposeKindChange: (k: CompositeKind) => void
  onComposeBandsChange: (b: [string, string, string]) => void
  onComposeIndexChange: (i: CompositeIndex) => void
  onComposeStretchChange: (low: number, high: number) => void
  onComposeOpacityChange: (v: number) => void
  onListComposeScenes: () => void
  onApplyComposition: () => void
  onClearComposition: () => void
}

export function useComposition({
  customPolygon,
  activeAreaId,
  activeProjectId,
  currentRunId,
  start,
  end,
  maxCloud,
  monthlyBest,
  setShowPredictionOverlay,
}: {
  customPolygon: GeoJSONGeometry | null
  activeAreaId?: string
  activeProjectId: string | null
  currentRunId: string | null
  start: string
  end: string
  maxCloud: number
  monthlyBest: boolean
  setShowPredictionOverlay: (v: boolean) => void
}) {
  const { refreshProjects } = useAuth()
  const [composition, setComposition] = useState<CompositionOverlay | null>(null)
  /** Session gallery of applied compositions (newest first); map shows `composition`. */
  const [compositionGallery, setCompositionGallery] = useState<CompositionOverlay[]>([])
  /*
    The compositions that belong with what is on screen.

    The gallery holds every composition in the project, and a project spans
    fields: one here had thirteen across three locations up to 100 km apart,
    all listed whichever run was open, so applying one put a raster off the
    edge of the area in view. Scoped by the run that made it, or -- for the
    ones that predate the association, and for any made with no run open -- by
    whether it covers the area at all.
  */
  const visibleAoi = useMemo(() => {
    const b = geometryBounds(customPolygon)
    return b
      ? {
          lon_min: b.lonMin,
          lat_min: b.latMin,
          lon_max: b.lonMax,
          lat_max: b.latMax,
        }
      : null
  }, [customPolygon])

  const scopedCompositions = useMemo(
    () => scopeCompositionsToView(compositionGallery, currentRunId, visibleAoi),
    [compositionGallery, currentRunId, visibleAoi]
  )

  const [showCompositionOverlay, setShowCompositionOverlay] = useState(true)
  const [composeRunning, setComposeRunning] = useState(false)
  const [composeProgress, setComposeProgress] = useState(0)
  const [composeProgressMsg, setComposeProgressMsg] = useState("")
  const [composeScenes, setComposeScenes] = useState<DataCubeScene[]>([])
  const [composeScenesLoading, setComposeScenesLoading] = useState(false)
  const [composeScenesError, setComposeScenesError] = useState<string | null>(null)
  const [selectedSceneId, setSelectedSceneId] = useState("")
  const [composeKind, setComposeKind] = useState<CompositeKind>("rgb")
  const [composeBands, setComposeBands] = useState<[string, string, string]>([
    "B04",
    "B03",
    "B02",
  ])
  const [composeIndex, setComposeIndex] = useState<CompositeIndex>("ndvi")
  const [composeStretchLow, setComposeStretchLow] = useState(2)
  const [composeStretchHigh, setComposeStretchHigh] = useState(98)
  const [composeOpacity, setComposeOpacity] = useState(0.85)
  const [composeMedian, setComposeMedian] = useState(false)
  const [composeSceneBefore, setComposeSceneBefore] = useState("")
  const [composeClusters, setComposeClusters] = useState(5)
  const [composeVariable, setComposeVariable] = useState<BiophysicalVariable>("lai")
  const [composeYear, setComposeYear] = useState(2022)

  const handleListComposeScenes = async () => {
    if (!start || !end) {
      notifyError("Set the acquisition period.")
      return
    }
    if (!customPolygon) {
      notifyError("Draw an area on the map first.")
      return
    }
    const req: DataCubeRequest = {
      polygon_geojson: customPolygon,
      start: start,
      end: end,
      max_cloud: maxCloud,
      monthly_best: monthlyBest,
      tiles: [],
    }
    setComposeScenesLoading(true)
    setComposeScenesError(null)
    try {
      const res = (await ListDataCube(req as never)) as unknown as DataCubeResult
      setComposeScenes(res.scenes ?? [])
      if ((res.scenes?.length ?? 0) === 0) {
        notifyInfo("No scenes found for this period / cloud filter.")
      } else if (!selectedSceneId && res.scenes[0]) {
        setSelectedSceneId(res.scenes[0].id)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setComposeScenesError(msg)
      notifyError("Scene list error", msg)
    } finally {
      setComposeScenesLoading(false)
    }
  }

  const handleApplyComposition = async () => {
    // A biomass map reads the area alone; a view of the median needs the period
    // and no scene; a change needs two scenes. internal/analysis compositeAction
    // asks the same, and this answers first without starting a process.
    const biomass = composeKind === "biomass"
    const fromMedian = kindDef(composeKind).median && composeMedian
    if (!biomass && !fromMedian && !selectedSceneId) {
      notifyError("Select a scene first.")
      return
    }
    if (composeKind === "change" && !composeSceneBefore) {
      notifyError("Select the earlier scene of the change.")
      return
    }
    if (!biomass && (!start || !end)) {
      notifyError("Set the acquisition period.")
      return
    }
    if (!customPolygon) {
      notifyError("Define an area first.")
      return
    }
    const req: CompositeRequest = {
      polygon_geojson: customPolygon,
      start: start,
      end: end,
      max_cloud: maxCloud,
      monthly_best: monthlyBest,
      tiles: [],
      scene_id: biomass || fromMedian ? "" : selectedSceneId,
      kind: composeKind,
      bands: composeKind === "rgb" ? [...composeBands] : undefined,
      index:
        composeKind === "index" || composeKind === "change" ? composeIndex : undefined,
      stretch_pct: [composeStretchLow, composeStretchHigh],
      median: fromMedian || undefined,
      scene_id_before: composeKind === "change" ? composeSceneBefore : undefined,
      clusters: composeKind === "clusters" ? composeClusters : undefined,
      variable: composeKind === "biophysical" ? composeVariable : undefined,
      year: biomass ? composeYear : undefined,
    }
    setComposeRunning(true)
    setComposeProgress(5)
    setComposeProgressMsg("requesting composite…")
    try {
      const res = (await RenderComposite(req as never)) as unknown as CompositeResult
      setComposeProgress(100)
      setComposeProgressMsg("done")
      const meta = resolveCompositionMeta({
        kind: composeKind,
        bands: composeBands,
        index: composeIndex,
        variable: composeVariable,
        clusters: composeClusters,
      })
      const legend = compositionLegendOf(res.meta)
      // What the sidecar says it drew from: a scene's date, "median of 7 clear
      // scenes, ...", two dates for a change, or a year for biomass.
      const drawnFrom = typeof res.meta?.date === "string" ? res.meta.date : undefined
      const sceneDate =
        drawnFrom ??
        composeScenes.find((s) => s.id === selectedSceneId)?.date ??
        undefined
      const variable = composeKind === "biophysical" ? composeVariable : undefined
      const clusters = composeKind === "clusters" ? composeClusters : undefined
      const year = biomass ? composeYear : undefined
      const median = fromMedian || undefined
      const entry: CompositionOverlay = {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        overlay_uri: res.overlay_uri,
        extent: res.extent,
        opacity: composeOpacity,
        label: meta.label,
        title: meta.title,
        description: meta.description,
        kind: meta.kind,
        bands: meta.bands,
        index: meta.index,
        presetId: meta.presetId,
        sceneDate,
        legend,
        variable,
        clusters,
        year,
        median,
        raster_tif: res.raster_tif,
        /*
          Both, as the saved row carries them. The entry in hand used to carry
          neither, so the board could not tell it from a composition of another
          field until the project was reopened -- and a composition with no run
          made over this area was listed only while it was the one on the map.
        */
        runId: currentRunId ?? undefined,
        areaId: activeAreaId,
      }
      setComposition(entry)
      setCompositionGallery((prev) => [entry, ...prev].slice(0, 12))
      setShowCompositionOverlay(true)
      setShowPredictionOverlay(false)
      if (activeProjectId) {
        try {
          const metaJson = JSON.stringify({
            description: meta.description,
            kind: meta.kind,
            bands: meta.bands,
            index: meta.index,
            presetId: meta.presetId,
            sceneDate,
            legend,
            variable,
            clusters,
            year,
            median,
            opacity: composeOpacity,
            extent: res.extent,
            label: meta.label,
          })
          const reqSave: SaveProjectOverlayRequest = {
            project_id: activeProjectId,
            // The run on screen, so this composition surfaces with that run
            // and not with every other run in the project.
            run_id: currentRunId ?? "",
            // And the ground, which is what files one made with no run open.
            area_id: activeAreaId ?? "",
            kind: "composition",
            title: meta.title,
            meta_json: metaJson,
            overlay_uri: res.overlay_uri,
            raster_tif: res.raster_tif,
          }
          await SaveProjectOverlay(reqSave as never)
          await refreshProjects()
        } catch (e) {
          notifyError("Composition applied, but save to project failed", e)
        }
      }
      notifySuccess("Composition applied to map.")
    } catch (e) {
      notifyError("Composition error", e)
    } finally {
      setComposeRunning(false)
    }
  }

  /** Off the map, and the gallery left as it is. */
  const takeOffMap = useCallback(() => {
    setComposition(null)
    setShowCompositionOverlay(true)
  }, [])
  /** Off the map, and the gallery with it. */
  const clearGallery = useCallback(() => {
    setComposition(null)
    setCompositionGallery([])
    setShowCompositionOverlay(true)
  }, [])
  /** The gallery and the scene list, where what they were made over has gone. */
  const forgetAll = useCallback(() => {
    clearGallery()
    setComposeScenes([])
    setSelectedSceneId("")
    setComposeScenesError(null)
  }, [clearGallery])
  /** A project's own gallery, with what it should open on. */
  const loadGallery = useCallback(
    (gallery: CompositionOverlay[], shown: CompositionOverlay | null) => {
      setCompositionGallery(gallery)
      setComposition(shown)
    },
    []
  )

  const props: CompositionProps = {
    showCompositionOverlay,
    composition: composition ? { ...composition, opacity: composeOpacity } : null,
    compositionGallery: scopedCompositions,
    onSelectComposition: (id) => {
      const hit = scopedCompositions.find((c) => c.id === id)
      if (hit) {
        setComposition(hit)
        setShowCompositionOverlay(true)
      }
    },
    onRemoveComposition: (id) => {
      setCompositionGallery((prev) => {
        const next = prev.filter((c) => c.id !== id)
        setComposition((cur) => (cur?.id === id ? (next[0] ?? null) : cur))
        return next
      })
    },
    composeRunning,
    composeProgress,
    composeProgressMsg,
    composeScenes,
    composeScenesLoading,
    composeScenesError,
    selectedSceneId,
    composeKind,
    composeBands,
    composeIndex,
    composeStretchLow,
    composeStretchHigh,
    composeOpacity,
    composeMedian,
    composeSceneBefore,
    composeClusters,
    composeVariable,
    composeYear,
    onComposeMedianChange: setComposeMedian,
    onSelectSceneBefore: setComposeSceneBefore,
    onComposeClustersChange: setComposeClusters,
    onComposeVariableChange: setComposeVariable,
    onComposeYearChange: setComposeYear,
    onShowCompositionOverlayChange: setShowCompositionOverlay,
    onSelectScene: setSelectedSceneId,
    onComposeKindChange: setComposeKind,
    onComposeBandsChange: setComposeBands,
    onComposeIndexChange: setComposeIndex,
    onComposeStretchChange: (low, high) => {
      setComposeStretchLow(low)
      setComposeStretchHigh(high)
    },
    onComposeOpacityChange: setComposeOpacity,
    onListComposeScenes: () => void handleListComposeScenes(),
    onApplyComposition: () => void handleApplyComposition(),
    onClearComposition: clearGallery,
  }

  return {
    props,
    setShowCompositionOverlay,
    takeOffMap,
    clearGallery,
    forgetAll,
    loadGallery,
  }
}
