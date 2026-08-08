import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { notifyError, notifyInfo, notifySuccess } from "@/lib/notify"
import { useTheme } from "next-themes"
import {
  ListEmbeddedAreas,
  LoadAnalysis,
  Predict,
  AnalyzeLULC,
  ListDataCube,
  RenderComposite,
  OpenExternal,
  RevealMainWindow,
  SaveProjectOverlay,
  ListProjectOverlays,
  GetProject,
  UpdateProjectAOI,
  CreateProject,
  AnalyzeWater,
  AnalyzeSolar,
  AnalyzeSolarTerrain,
  AnalyzeSolarSiting,
  AnalyzeEnergyModel,
  AnalyzeWind,
} from "../wailsjs/go/main/App"
import { EventsOn, EventsOff } from "../wailsjs/runtime/runtime"
import type {
  Area,
  PredictResult,
  PredictRequest,
  ProgressEvent,
  GeoJSONGeometry,
  Preferences,
  ModelKind,
  InferenceRun,
  LULCAnalysis,
  DataCubeResult,
  DataCubeRequest,
  DataCubeScene,
  CompositionOverlay,
  CompositeRequest,
  CompositeKind,
  CompositeIndex,
  CompositeResult,
  Project,
  ProjectOverlay,
  SaveProjectOverlayRequest,
  WaterAnalysis,
  WaterIndex,
  WaterRequest,
  SolarAnalysis,
  SolarRequest,
  SolarTerrainAnalysis,
  SolarTerrainRequest,
  SolarSitingAnalysis,
  SolarSitingRequest,
  EnergyModelAnalysis,
  EnergyModelRequest,
  WindAnalysis,
  WindRequest,
} from "@/lib/types"
import { parsePreferenceExtras } from "@/lib/preferenceExtras"
import { makeRunLabel, resolveAoiDisplayLabel, aoiLabelFromRunSummary } from "@/lib/aoiLabel"
import { projectOverlayToComposition } from "@/lib/projectOverlays"
import { geometryCentroid, usesExampleArea } from "@/lib/geometry"
import { ProjectSwitcher } from "@/components/ProjectSwitcher"
import { resolveCompositionMeta } from "@/lib/compositeCatalog"
import {
  DEFAULT_AOI_CONTOUR_SCHEME,
  type AoiContourSchemeId,
} from "@/lib/aoiStyle"
import { AuthProvider, useAuth } from "@/lib/auth"
import { ThemeSync } from "@/components/ThemeSync"
import { TitleBar } from "@/components/TitleBar"
import { SplashScreen } from "@/components/SplashScreen"
import { WhatsNewGate } from "@/components/WhatsNewGate"
import { AppNav } from "@/components/AppNav"
import { MapScreen } from "@/pages/MapScreen"
import type { MapToolId } from "@/lib/mapTools"
import { EnergyScreen, type EnergyTab } from "@/pages/EnergyScreen"
import { useSolarState, useWindState } from "@/lib/energyState"
import type {
  SolarLayers,
  SolarParams,
  SolarProductId,
  WindParams,
} from "@/lib/energyState"
import { AuthPage } from "@/pages/AuthPage"
import { ProfilePage } from "@/pages/ProfilePage"
import { AnalysisPage } from "@/pages/AnalysisPage"

function defaultPeriod(): { start: string; end: string } {
  const now = new Date()
  const end = now.toISOString().slice(0, 10)
  const past = new Date(now)
  past.setFullYear(past.getFullYear() - 1)
  const start = past.toISOString().slice(0, 10)
  return { start, end }
}

/**
 * A result with no classification in it.
 *
 * Solar needs no satellite scene, so it can be the only product an AOI carries.
 * The analysis view keys "is there a classification" off n_dates and the overlay
 * URI, so those stay at zero and the page presents only what was actually run.
 */
const EMPTY_RESULT: PredictResult = {
  extent: { lon_min: 0, lat_min: 0, lon_max: 0, lat_max: 0 },
  overlay_uri: "",
  confidence_uri: "",
  ndvi_mean_uri: "",
  true_color_uri: "",
  reference_uri: "",
  raster_tif: "",
  mean_confidence: 0,
  n_dates: 0,
  date_range: [],
  class_stats: [],
  temporal: [],
  vi_series: [],
  phenology: {
    sos_doy: null,
    pos_doy: null,
    eos_doy: null,
    los_days: null,
    peak: null,
    base: null,
    amplitude: null,
  },
  phenology_states: [],
}

function isModelKind(v: string): v is ModelKind {
  return v === "spectral" || v === "prithvi" || v === "temporal_transformer"
}

/** Restore AOI from a saved run's polygon_geojson (GeoJSON or {"area_id":"..."}). */
function parseRunPolygon(
  raw: string,
  areas: Area[]
): { exampleId: string; polygon: GeoJSONGeometry | null } {
  const empty = { exampleId: "", polygon: null as GeoJSONGeometry | null }
  if (!raw?.trim()) return empty
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.area_id === "string") {
      const area = areas.find((a) => a.id === parsed.area_id)
      if (area) return { exampleId: area.id, polygon: area.geometry }
      return empty
    }
    if (parsed.type === "Polygon" || parsed.type === "MultiPolygon") {
      return { exampleId: "", polygon: parsed as unknown as GeoJSONGeometry }
    }
    if (parsed.type === "Feature") {
      const geom = (parsed as { geometry?: GeoJSONGeometry }).geometry
      if (geom?.type === "Polygon" || geom?.type === "MultiPolygon") {
        return { exampleId: "", polygon: geom }
      }
    }
    if (parsed.type === "FeatureCollection") {
      const features = (parsed as { features?: { geometry?: GeoJSONGeometry }[] }).features
      const geom = features?.find(
        (f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon"
      )?.geometry
      if (geom) return { exampleId: "", polygon: geom }
    }
  } catch {
    /* ignore malformed */
  }
  return empty
}

function App() {
  const period = useMemo(defaultPeriod, [])
  const [areas, setAreas] = useState<Area[]>([])
  const [customPolygon, setCustomPolygon] = useState<GeoJSONGeometry | null>(null)
  const [activeExample, setActiveExample] = useState<string>("")
  const [flyTo, setFlyTo] = useState<{ lat: number; lon: number; key: number } | null>(null)
  const [view, setView] = useState<{ lat: number; lon: number; zoom: number }>({
    lat: -14.5,
    lon: -52,
    zoom: 4,
  })
  const [start, setStart] = useState<string>(period.start)
  const [end, setEnd] = useState<string>(period.end)
  const [maxCloud, setMaxCloud] = useState<number>(40)
  const [monthlyBest, setMonthlyBest] = useState<boolean>(true)
  const [mode, setMode] = useState<"single" | "temporal">("single")
  const [modelKind, setModelKind] = useState<ModelKind>("spectral")
  const [prithviMode, setPrithviMode] = useState<"pixel" | "patch">("pixel")
  const [overlayOpacity, setOverlayOpacity] = useState<number>(0.75)
  const [showConfidence, setShowConfidence] = useState(false)
  const [confidenceOnTop, setConfidenceOnTop] = useState(true)
  const [smoothOverlay, setSmoothOverlay] = useState(false)
  const [showPredictionOverlay, setShowPredictionOverlay] = useState(true)
  const [swipeCompare, setSwipeCompare] = useState(false)
  const [swipeRatio, setSwipeRatio] = useState(0.5)
  const [aoiContourScheme, setAoiContourScheme] =
    useState<AoiContourSchemeId>(DEFAULT_AOI_CONTOUR_SCHEME)
  const [running, setRunning] = useState<boolean>(false)
  const [progress, setProgress] = useState<number>(0)
  const [progressMsg, setProgressMsg] = useState<string>("")
  const [result, setResult] = useState<PredictResult | null>(null)
  const [analysisLabel, setAnalysisLabel] = useState<string | undefined>()
  const [lulcRunning, setLulcRunning] = useState(false)
  const [booting, setBooting] = useState(true)
  const [splashExiting, setSplashExiting] = useState(false)
  const { setTheme } = useTheme()

  const applyPrefs = useCallback(
    (p: Preferences) => {
      if (
        p.default_model === "spectral" ||
        p.default_model === "prithvi" ||
        p.default_model === "temporal_transformer"
      ) {
        setModelKind(p.default_model)
      }
      if (typeof p.overlay_opacity === "number" && p.overlay_opacity > 0) {
        setOverlayOpacity(p.overlay_opacity)
      }
      if (p.theme === "dark" || p.theme === "light" || p.theme === "system") {
        setTheme(p.theme)
      }
    },
    [setTheme]
  )

  useEffect(() => {
    ListEmbeddedAreas()
      .then((a) => setAreas((a ?? []) as unknown as Area[]))
      .catch((e) => notifyError("Failed to load examples", e))
  }, [])

  useEffect(() => {
    let cancelled = false
    let started = false
    let exitTimer: number | undefined
    let revealTimer: number | undefined

    const finish = async () => {
      if (cancelled || started) return
      started = true
      setSplashExiting(true)
      // Match .splash-screen--exit transition (~480ms).
      exitTimer = window.setTimeout(async () => {
        if (cancelled) return
        try {
          await RevealMainWindow()
        } catch {
          /* ignore */
        }
        // Let the OS settle the maximised frame before mounting the shell.
        revealTimer = window.setTimeout(() => {
          if (!cancelled) setBooting(false)
        }, 120)
      }, 480)
    }

    EventsOn("boot:ready", finish)
    const safety = window.setTimeout(finish, 20_000)
    return () => {
      cancelled = true
      EventsOff("boot:ready")
      window.clearTimeout(safety)
      if (exitTimer) window.clearTimeout(exitTimer)
      if (revealTimer) window.clearTimeout(revealTimer)
    }
  }, [])

  const hasArea = !!customPolygon || !!activeExample

  const handleSelectExample = (id: string) => {
    const area = areas.find((a) => a.id === id)
    if (!area) return
    setActiveExample(id)
    setCustomPolygon(area.geometry)
    setResult(null)
    setShowPredictionOverlay(true)
    setAnalysisLabel(undefined)
  }

  const clearArea = () => {
    setCustomPolygon(null)
    setActiveExample("")
    setAnalysisLabel(undefined)
  }

  const handleImportPolygon = async () => {
    try {
      const { kml } = await import("@tmcw/togeojson")
      const input = document.createElement("input")
      input.type = "file"
      input.accept = ".kml,.geojson,.json"
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const text = await file.text()
        let geom: GeoJSONGeometry | null = null
        try {
          if (file.name.toLowerCase().endsWith(".kml")) {
            const dom = new DOMParser().parseFromString(text, "text/xml")
            const fc = kml(dom)
            const poly = fc.features.find(
              (f) => f.geometry && f.geometry.type === "Polygon"
            )
            geom = (poly?.geometry as GeoJSONGeometry) ?? null
          } else {
            const parsed = JSON.parse(text)
            if (parsed.type === "FeatureCollection") {
              geom =
                parsed.features.find(
                  (f: { geometry?: { type?: string } }) => f.geometry?.type === "Polygon"
                )?.geometry ?? null
            } else if (parsed.type === "Feature") {
              geom = parsed.geometry
            } else if (parsed.type === "Polygon") {
              geom = parsed
            }
          }
        } catch (e) {
          notifyError("Invalid file", e)
          return
        }
        if (!geom) {
          notifyError("No polygon found in the file.")
          return
        }
        setActiveExample("")
        setCustomPolygon(geom)
        setAnalysisLabel(undefined)
        notifySuccess("Polygon imported.")
      }
      input.click()
    } catch (e) {
      notifyError("Import failed", e)
    }
  }

  return (
    <AuthProvider onPrefsApplied={applyPrefs}>
      <ThemeSync />
      {booting ? (
        <SplashScreen exiting={splashExiting} />
      ) : (
        <div className="app-shell-enter h-full w-full">
          <WhatsNewGate />
          <AppBody
            areas={areas}
            activeExample={activeExample}
            customPolygon={customPolygon}
            flyTo={flyTo}
            view={view}
            start={start}
            end={end}
            maxCloud={maxCloud}
            monthlyBest={monthlyBest}
            mode={mode}
            modelKind={modelKind}
            prithviMode={prithviMode}
            overlayOpacity={overlayOpacity}
            showConfidence={showConfidence}
            confidenceOnTop={confidenceOnTop}
            smoothOverlay={smoothOverlay}
            showPredictionOverlay={showPredictionOverlay}
            swipeCompare={swipeCompare}
            swipeRatio={swipeRatio}
            aoiContourScheme={aoiContourScheme}
            running={running}
            progress={progress}
            progressMsg={progressMsg}
            result={result}
            analysisLabel={analysisLabel}
            hasArea={hasArea}
            setView={setView}
            setCustomPolygon={setCustomPolygon}
            setActiveExample={setActiveExample}
            setFlyTo={setFlyTo}
            setStart={setStart}
            setEnd={setEnd}
            setMaxCloud={setMaxCloud}
            setMonthlyBest={setMonthlyBest}
            setMode={setMode}
            setModelKind={setModelKind}
            setPrithviMode={setPrithviMode}
            setOverlayOpacity={setOverlayOpacity}
            setShowConfidence={setShowConfidence}
            setConfidenceOnTop={setConfidenceOnTop}
            setSmoothOverlay={setSmoothOverlay}
            setShowPredictionOverlay={setShowPredictionOverlay}
            setSwipeCompare={setSwipeCompare}
            setSwipeRatio={setSwipeRatio}
            setAoiContourScheme={setAoiContourScheme}
            setRunning={setRunning}
            setProgress={setProgress}
            setProgressMsg={setProgressMsg}
            setResult={setResult}
            setAnalysisLabel={setAnalysisLabel}
            lulcRunning={lulcRunning}
            setLulcRunning={setLulcRunning}
            onSelectExample={handleSelectExample}
            onClearArea={clearArea}
            onImportPolygon={handleImportPolygon}
          />
        </div>
      )}
    </AuthProvider>
  )
}

function AppBody(props: {
  areas: Area[]
  activeExample: string
  customPolygon: GeoJSONGeometry | null
  flyTo: { lat: number; lon: number; key: number } | null
  view: { lat: number; lon: number; zoom: number }
  start: string
  end: string
  maxCloud: number
  monthlyBest: boolean
  mode: "single" | "temporal"
  modelKind: ModelKind
  prithviMode: "pixel" | "patch"
  overlayOpacity: number
  showConfidence: boolean
  confidenceOnTop: boolean
  smoothOverlay: boolean
  showPredictionOverlay: boolean
  swipeCompare: boolean
  swipeRatio: number
  aoiContourScheme: AoiContourSchemeId
  running: boolean
  progress: number
  progressMsg: string
  result: PredictResult | null
  analysisLabel?: string
  hasArea: boolean
  setView: (v: { lat: number; lon: number; zoom: number }) => void
  setCustomPolygon: (g: GeoJSONGeometry | null) => void
  setActiveExample: (id: string) => void
  setFlyTo: (v: { lat: number; lon: number; key: number } | null) => void
  setStart: (v: string) => void
  setEnd: (v: string) => void
  setMaxCloud: (v: number) => void
  setMonthlyBest: (v: boolean) => void
  setMode: (m: "single" | "temporal") => void
  setModelKind: (m: ModelKind) => void
  setPrithviMode: (m: "pixel" | "patch") => void
  setOverlayOpacity: (v: number) => void
  setShowConfidence: (v: boolean) => void
  setConfidenceOnTop: (v: boolean) => void
  setSmoothOverlay: (v: boolean) => void
  setShowPredictionOverlay: (v: boolean) => void
  setSwipeCompare: (v: boolean) => void
  setSwipeRatio: (v: number) => void
  setAoiContourScheme: (id: AoiContourSchemeId) => void
  setRunning: (v: boolean) => void
  setProgress: (v: number) => void
  setProgressMsg: (v: string) => void
  setResult: (r: PredictResult | null) => void
  setAnalysisLabel: (v: string | undefined) => void
  lulcRunning: boolean
  setLulcRunning: (v: boolean) => void
  onSelectExample: (id: string) => void
  onClearArea: () => void
  onImportPolygon: () => void
}) {
  const { refreshRuns, refreshProjects, screen, goAnalysis, goMap, runs, projects, prefs, savePrefs } =
    useAuth()
  const [loadingRun, setLoadingRun] = useState(false)
  /**
   * Open tool tab of the map's left dock.
   *
   * Held here rather than inside MapScreen because that screen unmounts on
   * every navigation away, so local state reset the dock to the classification
   * panel on every return.
   */
  const [leftPanel, setLeftPanel] = useState<MapToolId | null>("classify")
  /**
   * Open tab of the energy screen, held here for the same reason as the dock
   * tab above: that screen unmounts on every navigation away, so a local value
   * put a returning user back on Solar after they had been reading Wind. The
   * navigation column also reads it, to name which resource is in view.
   */
  const [energyTab, setEnergyTab] = useState<EnergyTab>("solar")
  /**
   * Title of the run whose result is on screen, for the title bar.
   *
   * Every action already generates one and sends it to be persisted, but the
   * generated value was discarded, so the running session had no name for what
   * it had just produced. Set when a run is made and when a saved one is
   * opened; cleared wherever the result is.
   */
  const [currentRunLabel, setCurrentRunLabel] = useState<string | null>(null)

  /**
   * Name a run about to be sent, and record the name.
   *
   * One call so the title shown and the title persisted cannot be two different
   * strings: makeRunLabel stamps the current time, so calling it twice for one
   * run yields two labels a second apart.
   */
  const nameThisRun = useCallback((aoiHint?: string | null): string => {
    const label = makeRunLabel(aoiHint)
    setCurrentRunLabel(label)
    return label
  }, [])
  const [dataCubeOpen, setDataCubeOpen] = useState(false)
  const [dataCubeLoading, setDataCubeLoading] = useState(false)
  const [dataCubeError, setDataCubeError] = useState<string | null>(null)
  const [dataCubeResult, setDataCubeResult] = useState<DataCubeResult | null>(null)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)

  const [composition, setComposition] = useState<CompositionOverlay | null>(null)
  /** Session gallery of applied compositions (newest first); map shows `composition`. */
  const [compositionGallery, setCompositionGallery] = useState<
    CompositionOverlay[]
  >([])
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
  const [water, setWater] = useState<WaterAnalysis | null>(null)
  const [waterIndex, setWaterIndex] = useState<WaterIndex>("MNDWI")
  const [waterRunning, setWaterRunning] = useState(false)
  const [showWaterOverlay, setShowWaterOverlay] = useState(true)
  const [waterOpacity, setWaterOpacity] = useState(0.8)
  /**
   * The energy axis: parameters, results, layer state and run status for the
   * four photovoltaic products and for the wind screening.
   *
   * Two stores rather than one, and neither one a set of useState values here.
   * The defaults, the shape of the shared parameters and the rule that a result
   * is recorded together with the AOI it was computed over all live in
   * lib/energyState.ts, so this file no longer restates them.
   */
  const [solar, solarDispatch] = useSolarState()
  const [wind, windDispatch] = useWindState()

  const setSolarParams = useCallback(
    (patch: Partial<SolarParams>) => solarDispatch({ type: "params/set", patch }),
    [solarDispatch]
  )
  const setSolarLayers = useCallback(
    (patch: Partial<SolarLayers>) => solarDispatch({ type: "layers/set", patch }),
    [solarDispatch]
  )
  const setWindParams = useCallback(
    (patch: Partial<WindParams>) => windDispatch({ type: "params/set", patch }),
    [windDispatch]
  )

  const didRestoreProjectRef = useRef(false)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const activeProjectIdRef = useRef(activeProjectId)
  activeProjectIdRef.current = activeProjectId
  /** Set when activate runs before prefs have loaded; flushed on next prefs hydrate. */
  const pendingActiveProjectRef = useRef<string | null | undefined>(undefined)

  const persistAoiLabel = useCallback(
    async (label: string | null) => {
      const current = prefsRef.current
      if (!current) return
      const extras = parsePreferenceExtras(current.extras_json)
      // Keep React's active project — prefs may lag behind a just-activated id.
      const aid = activeProjectIdRef.current?.trim()
      if (aid) extras.active_project_id = aid
      else delete extras.active_project_id
      const next = label?.trim()
      if (next) extras.aoi_label = next
      else delete extras.aoi_label
      try {
        await savePrefs(
          {
            ...current,
            extras_json: JSON.stringify(extras),
          },
          { silent: true }
        )
      } catch {
        /* best-effort */
      }
    },
    [savePrefs]
  )

  /**
   * Remember where the map was left, so the next session resumes there.
   *
   * The map emits on every pan and zoom frame, so this is debounced and only
   * writes once the view has settled. Failures are ignored: this is a
   * convenience, and losing it must never interrupt work.
   */
  const viewSaveTimer = useRef<number | undefined>(undefined)
  /**
   * Live map position, so returning to the map screen resumes exactly where it
   * was left rather than at whatever the debounced write last committed.
   */
  const liveViewRef = useRef<{ lat: number; lon: number; zoom: number } | null>(
    null
  )
  const persistMapView = useCallback(
    (v: { lat: number; lon: number; zoom: number }) => {
      if (viewSaveTimer.current) window.clearTimeout(viewSaveTimer.current)
      viewSaveTimer.current = window.setTimeout(() => {
        const current = prefsRef.current
        if (!current) return
        const extras = parsePreferenceExtras(current.extras_json)
        const last = extras.map_view
        // Skip a write when nothing meaningful moved.
        if (
          last &&
          Math.abs(last.lat - v.lat) < 1e-4 &&
          Math.abs(last.lon - v.lon) < 1e-4 &&
          last.zoom === v.zoom
        ) {
          return
        }
        extras.map_view = {
          lat: Number(v.lat.toFixed(5)),
          lon: Number(v.lon.toFixed(5)),
          zoom: v.zoom,
        }
        void savePrefs(
          { ...current, extras_json: JSON.stringify(extras) },
          { silent: true }
        ).catch(() => {
          /* best-effort */
        })
      }, 1200)
    },
    [savePrefs]
  )

  useEffect(
    () => () => {
      if (viewSaveTimer.current) window.clearTimeout(viewSaveTimer.current)
    },
    []
  )

  const persistActiveProjectId = useCallback(
    async (id: string | null) => {
      setActiveProjectId(id)
      activeProjectIdRef.current = id
      const current = prefsRef.current
      if (!current) {
        pendingActiveProjectRef.current = id
        return
      }
      pendingActiveProjectRef.current = undefined
      const extras = parsePreferenceExtras(current.extras_json)
      if (id) extras.active_project_id = id
      else delete extras.active_project_id
      try {
        await savePrefs(
          {
            ...current,
            extras_json: JSON.stringify(extras),
          },
          { silent: true }
        )
      } catch {
        /* best-effort */
      }
    },
    [savePrefs]
  )

  // Hydrate active project from prefs only when extras change — never on AOI rename.
  useEffect(() => {
    if (!prefs) return
    if (pendingActiveProjectRef.current !== undefined) {
      const pending = pendingActiveProjectRef.current
      pendingActiveProjectRef.current = undefined
      void persistActiveProjectId(pending)
      return
    }
    const extras = parsePreferenceExtras(prefs.extras_json)
    const id = extras.active_project_id?.trim() || null
    if (id) {
      setActiveProjectId(id)
      return
    }
    setActiveProjectId(null)
    const orphanLabel = extras.aoi_label?.trim()
    if (orphanLabel && !props.analysisLabel) {
      props.setAnalysisLabel(orphanLabel)
    }
    // Intentionally omit analysisLabel: renaming AOI must not re-run this sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only follow prefs extras
  }, [prefs, prefs?.extras_json, persistActiveProjectId])

  const syncProjectAoi = useCallback(
    async (projectId: string, labelOverride?: string) => {
      const useExample = usesExampleArea(props.activeExample, props.areas)
      const renamed = (labelOverride ?? props.analysisLabel)?.trim()
      let label = renamed
      if (!label) {
        if (useExample) {
          label =
            props.areas.find((a) => a.id === props.activeExample)?.label ||
            props.activeExample
        } else if (props.customPolygon) {
          // Keep an existing project label; never clobber a rename with "Custom AOI".
          try {
            const p = (await GetProject(projectId)) as unknown as Project
            label =
              p.label?.trim() ||
              parsePreferenceExtras(prefs?.extras_json).aoi_label?.trim() ||
              "Custom AOI"
          } catch {
            label =
              parsePreferenceExtras(prefs?.extras_json).aoi_label?.trim() ||
              "Custom AOI"
          }
        } else {
          label = ""
        }
      }
      let poly = ""
      if (!useExample && props.customPolygon) {
        poly = JSON.stringify(props.customPolygon)
      }
      try {
        await UpdateProjectAOI(
          projectId,
          useExample ? props.activeExample : "",
          poly,
          label
        )
        if (label) void persistAoiLabel(label)
        await refreshProjects()
      } catch {
        /* best-effort */
      }
    },
    [
      props.activeExample,
      props.areas,
      props.customPolygon,
      props.analysisLabel,
      prefs?.extras_json,
      persistAoiLabel,
      refreshProjects,
    ]
  )

  const activateProject = useCallback(
    async (
      id: string | null,
      opts?: { userInitiated?: boolean }
    ) => {
      // Opening a project is an explicit action and draws its AOI and most
      // recent composition on the map. Restoring one at startup is not, and
      // must not: a session that begins with an AOI outline and an overlay the
      // user did not ask for in that session leaves them clearing both by hand.
      const userInitiated = opts?.userInitiated ?? true
      await persistActiveProjectId(id)
      if (!id) {
        setComposition(null)
        setCompositionGallery([])
        setShowCompositionOverlay(true)
        return
      }
      try {
        const p = (await GetProject(id)) as unknown as Project
        const savedLabel =
          p.label?.trim() ||
          parsePreferenceExtras(prefs?.extras_json).aoi_label?.trim() ||
          ""
        if (userInitiated && p.area_id) {
          props.setActiveExample(p.area_id)
          props.setCustomPolygon(null)
          const label = savedLabel || p.name
          props.setAnalysisLabel(label)
          void persistAoiLabel(label)
        } else if (userInitiated && p.polygon_geojson) {
          const aoi = parseRunPolygon(p.polygon_geojson, props.areas)
          props.setActiveExample(aoi.exampleId)
          props.setCustomPolygon(aoi.polygon)
          const label = savedLabel || p.name
          props.setAnalysisLabel(label)
          void persistAoiLabel(label)
          const centroid = geometryCentroid(aoi.polygon)
          if (centroid) {
            props.setFlyTo({
              lat: centroid[1],
              lon: centroid[0],
              key: Date.now(),
            })
          }
        }
        const overlays = (await ListProjectOverlays(
          id
        )) as unknown as import("@/lib/types").ProjectOverlay[]
        const gallery = overlays
          .map(projectOverlayToComposition)
          .filter((x): x is CompositionOverlay => !!x)
        // The gallery is always loaded so the compositions stay one click away
        // in Overlay Tools; only the display is conditional.
        setCompositionGallery(gallery)
        setComposition(userInitiated ? gallery[0] ?? null : null)
        setShowCompositionOverlay(userInitiated && !!gallery[0])
      } catch (e) {
        notifyError("Could not open project", e)
      }
    },
    [
      persistActiveProjectId,
      persistAoiLabel,
      prefs?.extras_json,
      props.areas,
      props.setActiveExample,
      props.setCustomPolygon,
      props.setAnalysisLabel,
      props.setFlyTo,
    ]
  )

  // On boot, restore AOI + label from the last active project (prefs only stored the id).
  useEffect(() => {
    if (didRestoreProjectRef.current) return
    const id = parsePreferenceExtras(prefs?.extras_json).active_project_id?.trim()
    if (!id) return
    if (!projects.some((p) => p.id === id)) return
    didRestoreProjectRef.current = true
    void activateProject(id, { userInitiated: false })
  }, [prefs?.extras_json, projects, activateProject])

  const handleCreateProjectFromMap = useCallback(async () => {
    const hint =
      props.analysisLabel ||
      (props.activeExample
        ? props.areas.find((a) => a.id === props.activeExample)?.label
        : null) ||
      (props.customPolygon ? "Custom AOI" : "New field")
    const name = window.prompt("Project name", hint)
    if (!name?.trim()) return
    try {
      const p = (await CreateProject(name.trim(), "")) as unknown as Project
      await refreshProjects()
      await activateProject(p.id)
      await syncProjectAoi(p.id)
      notifySuccess("Project created", p.name)
    } catch (e) {
      notifyError("Could not create project", e)
    }
  }, [
    activateProject,
    refreshProjects,
    syncProjectAoi,
    props.analysisLabel,
    props.activeExample,
    props.areas,
    props.customPolygon,
  ])

  const clearAreaAndComposition = useCallback(() => {
    setComposition(null)
    setCompositionGallery([])
    setShowCompositionOverlay(true)
    setComposeScenes([])
    setSelectedSceneId("")
    setComposeScenesError(null)
    props.setAnalysisLabel(undefined)
    void persistAoiLabel(null)
    props.onClearArea()
  }, [props.onClearArea, props.setAnalysisLabel, persistAoiLabel])

  const handleListComposeScenes = async () => {
    if (!props.start || !props.end) {
      notifyError("Set the acquisition period.")
      return
    }
    if (!props.customPolygon && !props.activeExample) {
      notifyError("Define an area: draw, search, or load an example.")
      return
    }
    const useExample = usesExampleArea(props.activeExample, props.areas)
    const req: DataCubeRequest = {
      area_id: useExample ? props.activeExample : "",
      polygon_geojson: useExample ? null : props.customPolygon,
      start: props.start,
      end: props.end,
      max_cloud: props.maxCloud,
      monthly_best: props.monthlyBest,
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
    if (!selectedSceneId) {
      notifyError("Select a scene first.")
      return
    }
    if (!props.start || !props.end) {
      notifyError("Set the acquisition period.")
      return
    }
    if (!props.customPolygon && !props.activeExample) {
      notifyError("Define an area first.")
      return
    }
    const useExample = usesExampleArea(props.activeExample, props.areas)
    const req: CompositeRequest = {
      area_id: useExample ? props.activeExample : "",
      polygon_geojson: useExample ? null : props.customPolygon,
      start: props.start,
      end: props.end,
      max_cloud: props.maxCloud,
      monthly_best: props.monthlyBest,
      tiles: [],
      scene_id: selectedSceneId,
      kind: composeKind,
      bands: composeKind === "rgb" ? [...composeBands] : undefined,
      index: composeKind === "index" ? composeIndex : undefined,
      stretch_pct: [composeStretchLow, composeStretchHigh],
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
      })
      const sceneDate =
        composeScenes.find((s) => s.id === selectedSceneId)?.date ?? undefined
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
        raster_tif: res.raster_tif,
      }
      setComposition(entry)
      setCompositionGallery((prev) => [entry, ...prev].slice(0, 12))
      setShowCompositionOverlay(true)
      props.setShowPredictionOverlay(false)
      if (activeProjectId) {
        try {
          const metaJson = JSON.stringify({
            description: meta.description,
            kind: meta.kind,
            bands: meta.bands,
            index: meta.index,
            presetId: meta.presetId,
            sceneDate,
            opacity: composeOpacity,
            extent: res.extent,
            label: meta.label,
          })
          const reqSave: SaveProjectOverlayRequest = {
            project_id: activeProjectId,
            kind: "composition",
            title: meta.title,
            meta_json: metaJson,
            overlay_uri: res.overlay_uri,
            raster_tif: res.raster_tif,
          }
          await SaveProjectOverlay(reqSave as never)
          await syncProjectAoi(activeProjectId)
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

  /**
   * Identity of the AOI currently on the map. Changes whenever the drawn
   * polygon or the selected example changes.
   */
  const aoiSignature = useMemo(() => {
    if (props.activeExample) return `area:${props.activeExample}`
    return props.customPolygon ? `poly:${JSON.stringify(props.customPolygon)}` : ""
  }, [props.activeExample, props.customPolygon])

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

  /**
   * The same for the four solar products. All four are read off one AOI -- the
   * resource and the energy model from its centroid, the terrain and siting
   * rasters from its extent -- so they are invalidated together. The store
   * compares against the signature recorded with the result and no-ops when it
   * has not moved, so this fires on every AOI change without a guard here.
   *
   * The store's own signature is a dependency, not only the map's. A run that
   * finishes after the AOI has moved records the signature it was computed on,
   * and without that dependency this effect would not re-run to notice the
   * mismatch, leaving one field's raster on another field's map.
   */
  useEffect(() => {
    solarDispatch({ type: "aoi/changed", aoiSignature })
  }, [aoiSignature, solar.aoiSignature, solarDispatch])

  /**
   * The wind screening, invalidated separately.
   *
   * Not folded into the effect above: wind resolves on the MERRA-2 grid of 0.5
   * by 0.625 degrees against the 1 degree radiation grid, so an AOI can leave
   * the radiation cell while staying inside the reanalysis cell, and neither
   * result's validity implies the other's. Two effects keep the two signatures
   * independent even though both read the same AOI.
   */
  useEffect(() => {
    windDispatch({ type: "aoi/changed", aoiSignature })
  }, [aoiSignature, wind.aoiSignature, windDispatch])

  /**
   * One sidecar progress channel, three destinations.
   *
   * The sidecar emits on a single event and runs one action at a time, so the
   * store with a run in flight decides which display receives it. Sharing one
   * display let a finished classification leave its last message under a solar
   * run's button.
   *
   * Read through refs so the subscription is registered once: re-registering on
   * every run state change would drop events emitted between the unsubscribe
   * and the resubscribe.
   *
   * The carried percentage is mirrored in solarSeenRef / windSeenRef rather
   * than read back from the store. The sidecar emits every raw log line as
   * progress -1, meaning "message only, percentage unchanged", and several of
   * those can arrive in one React batch; carrying the store's value would then
   * read a percentage from before the batch and roll the bar backwards. The
   * mirrors are reset by startSolarRun / startWindRun below, so a second run of
   * the same product cannot open on the previous run's percentage.
   */
  const solarRunRef = useRef(solar.run)
  solarRunRef.current = solar.run
  const windRunRef = useRef(wind.run)
  windRunRef.current = wind.run
  const solarSeenRef = useRef({ progress: 0, message: "" })
  const windSeenRef = useRef({ progress: 0, message: "" })
  const setProgressRef = useRef(props.setProgress)
  setProgressRef.current = props.setProgress
  const setProgressMsgRef = useRef(props.setProgressMsg)
  setProgressMsgRef.current = props.setProgressMsg

  const startSolarRun = useCallback(
    (product: SolarProductId) => {
      solarSeenRef.current = { progress: 0, message: "starting" }
      solarDispatch({ type: "run/start", product })
    },
    [solarDispatch]
  )
  const startWindRun = useCallback(() => {
    windSeenRef.current = { progress: 0, message: "starting" }
    windDispatch({ type: "run/start" })
  }, [windDispatch])

  useEffect(() => {
    EventsOn("predict:progress", (ev: ProgressEvent) => {
      if (solarRunRef.current.active) {
        const seen = solarSeenRef.current
        if (ev.progress >= 0) seen.progress = ev.progress
        if (ev.msg) seen.message = ev.msg
        solarDispatch({
          type: "run/progress",
          progress: seen.progress,
          message: seen.message,
        })
        return
      }
      if (windRunRef.current.active) {
        const seen = windSeenRef.current
        if (ev.progress >= 0) seen.progress = ev.progress
        if (ev.msg) seen.message = ev.msg
        windDispatch({
          type: "run/progress",
          progress: seen.progress,
          message: seen.message,
        })
        return
      }
      // No energy run in flight, so this belongs to the classification channel.
      if (ev.progress >= 0) setProgressRef.current(ev.progress)
      if (ev.msg) setProgressMsgRef.current(ev.msg)
    })
    return () => EventsOff("predict:progress")
  }, [solarDispatch, windDispatch])

  const handleRunWater = async () => {
    if (!props.start || !props.end) {
      notifyError("Set the acquisition period.")
      return
    }
    const useExample = usesExampleArea(props.activeExample, props.areas)
    if (!useExample && !props.customPolygon) {
      notifyError("Define an area: draw, search, or load an example.")
      return
    }
    setWaterRunning(true)
    // The sidecar emits on the shared predict:progress channel and only one
    // action runs at a time, so the panel reads the shared progress.
    props.setProgress(0)
    props.setProgressMsg("starting")
    try {
      const aoiLabel =
        props.analysisLabel?.trim() ||
        (useExample
          ? props.areas.find((a) => a.id === props.activeExample)?.label
          : undefined) ||
        (useExample ? props.activeExample : "Custom AOI")
      const req: WaterRequest = {
        area_id: useExample ? props.activeExample : "",
        polygon_geojson: useExample ? null : props.customPolygon,
        start: props.start,
        end: props.end,
        max_cloud: props.maxCloud,
        monthly_best: props.monthlyBest,
        index: waterIndex,
        label: aoiLabel,
        run_label: nameThisRun(aoiLabel),
        project_id: activeProjectId || undefined,
      }
      const res = (await AnalyzeWater(req as never)) as unknown as WaterAnalysis
      waterAoiRef.current = aoiSignature
      setWater(res)
      setShowWaterOverlay(true)
      notifySuccess(
        `Surface water mapped: ${res.n_dates} dates, peak ${res.peak_water_fraction_pct.toFixed(1)}% (saved).`,
        undefined,
        { action: { label: "View analysis", onClick: () => goAnalysis() } }
      )
      void refreshRuns()
      void refreshProjects()
    } catch (e) {
      notifyError("Surface water error", e)
    } finally {
      setWaterRunning(false)
      props.setProgress(0)
      props.setProgressMsg("")
    }
  }

  const handleRunSolar = async () => {
    const useExample = usesExampleArea(props.activeExample, props.areas)
    if (!useExample && !props.customPolygon) {
      notifyError("Define an area: draw, search, or load an example.")
      return
    }
    const p = solar.params
    const parsedPR = p.performanceRatio.trim()
      ? Number(p.performanceRatio.trim())
      : null
    if (
      parsedPR !== null &&
      (!Number.isFinite(parsedPR) || parsedPR <= 0 || parsedPR > 1)
    ) {
      notifyError("Performance ratio must be between 0 and 1.")
      return
    }
    startSolarRun("resource")
    try {
      const aoiLabel =
        props.analysisLabel?.trim() ||
        (useExample
          ? props.areas.find((a) => a.id === props.activeExample)?.label
          : undefined) ||
        (useExample ? props.activeExample : "Custom AOI")
      const req: SolarRequest = {
        label: aoiLabel,
        run_label: nameThisRun(aoiLabel),
        project_id: activeProjectId || undefined,
        area_id: useExample ? props.activeExample : "",
        polygon_geojson: useExample ? null : props.customPolygon,
        climatology_years: p.climatologyYears,
        hourly_years: p.hourlyYears,
        surface_azimuth: p.surfaceAzimuth,
        performance_ratio: parsedPR,
      }
      const res = (await AnalyzeSolar(req as never)) as unknown as SolarAnalysis
      // Result and AOI signature in one action. Assigned separately, the
      // invalidation effect above can observe the fresh result against the old
      // signature and drop what was just produced.
      solarDispatch({
        type: "result/set",
        product: "resource",
        result: res,
        aoiSignature,
      })
      notifySuccess(
        `Solar resource: ${res.resource.ghi_annual_kwh_m2.toFixed(0)} kWh/m2/yr, optimum tilt ${res.geometry.optimal_tilt_deg.toFixed(0)} degrees (saved).`,
        undefined,
        { action: { label: "View analysis", onClick: () => goAnalysis() } }
      )
      void refreshRuns()
      void refreshProjects()
    } catch (e) {
      notifyError("Solar analysis error", e)
    } finally {
      solarDispatch({ type: "run/finish" })
    }
  }

  const handleRunSolarTerrain = async () => {
    const useExample = usesExampleArea(props.activeExample, props.areas)
    if (!useExample && !props.customPolygon) {
      notifyError("Define an area: draw, search, or load an example.")
      return
    }
    startSolarRun("terrain")
    try {
      const aoiLabel =
        props.analysisLabel?.trim() ||
        (useExample
          ? props.areas.find((a) => a.id === props.activeExample)?.label
          : undefined) ||
        (useExample ? props.activeExample : "Custom AOI")
      const req: SolarTerrainRequest = {
        label: aoiLabel,
        run_label: nameThisRun(aoiLabel),
        project_id: activeProjectId || undefined,
        area_id: useExample ? props.activeExample : "",
        polygon_geojson: useExample ? null : props.customPolygon,
        hourly_years: solar.params.hourlyYears,
        season: solar.params.season,
      }
      const res = (await AnalyzeSolarTerrain(
        req as never
      )) as unknown as SolarTerrainAnalysis
      solarDispatch({
        type: "result/set",
        product: "terrain",
        result: res,
        aoiSignature,
      })
      // A fresh raster has to be visible even if its layer had been switched off.
      solarDispatch({ type: "layers/set", patch: { showTerrain: true } })
      notifySuccess(
        `Terrain irradiation: ${res.poa_min.toFixed(0)} to ${res.poa_max.toFixed(0)} kWh/m2/yr.`
      )
    } catch (e) {
      notifyError("Solar terrain error", e)
    } finally {
      solarDispatch({ type: "run/finish" })
    }
  }

  const handleRunSolarSiting = async () => {
    const useExample = usesExampleArea(props.activeExample, props.areas)
    if (!useExample && !props.customPolygon) {
      notifyError("Define an area: draw, search, or load an example.")
      return
    }
    startSolarRun("siting")
    try {
      const aoiLabel =
        props.analysisLabel?.trim() ||
        (useExample
          ? props.areas.find((a) => a.id === props.activeExample)?.label
          : undefined) ||
        (useExample ? props.activeExample : "Custom AOI")
      const req: SolarSitingRequest = {
        label: aoiLabel,
        run_label: nameThisRun(aoiLabel),
        project_id: activeProjectId || undefined,
        area_id: useExample ? props.activeExample : "",
        polygon_geojson: useExample ? null : props.customPolygon,
        slope_acceptable_deg: solar.params.slopeAcceptableDeg,
        slope_restrictive_deg: solar.params.slopeRestrictiveDeg,
      }
      const res = (await AnalyzeSolarSiting(
        req as never
      )) as unknown as SolarSitingAnalysis
      solarDispatch({
        type: "result/set",
        product: "siting",
        result: res,
        aoiSignature,
      })
      // A fresh run has to be visible, the same way a water run is. The terrain
      // result is no longer discarded here: that existed because both rasters
      // shared one map slot, so keeping two meant one of them was silently
      // unreachable. They now have a layer each.
      solarDispatch({ type: "layers/set", patch: { showSiting: true } })
      notifySuccess(
        `Siting: ${res.suitable_no_conflict_ha.toFixed(1)} ha without land-use conflict, ${res.suitable_cropland_ha.toFixed(1)} ha on cropland.`
      )
    } catch (e) {
      notifyError("Solar siting error", e)
    } finally {
      solarDispatch({ type: "run/finish" })
    }
  }

  const handleRunEnergyModel = async () => {
    const useExample = usesExampleArea(props.activeExample, props.areas)
    if (!useExample && !props.customPolygon) {
      notifyError("Define an area: draw, search, or load an example.")
      return
    }
    // Same field and same range check as the resource run: one performance
    // ratio is resolved for the whole energy axis, so the two products cannot
    // report a yield on two different ratios for one AOI.
    const p = solar.params
    const parsedPR = p.performanceRatio.trim()
      ? Number(p.performanceRatio.trim())
      : null
    if (
      parsedPR !== null &&
      (!Number.isFinite(parsedPR) || parsedPR <= 0 || parsedPR > 1)
    ) {
      notifyError("Performance ratio must be between 0 and 1.")
      return
    }
    const parsedOffset = p.utcOffset.trim() ? Number(p.utcOffset.trim()) : null
    if (
      parsedOffset !== null &&
      (!Number.isFinite(parsedOffset) || parsedOffset < -12 || parsedOffset > 14)
    ) {
      notifyError("UTC offset must be between -12 and 14 hours.")
      return
    }
    startSolarRun("energy")
    try {
      const aoiLabel =
        props.analysisLabel?.trim() ||
        (useExample
          ? props.areas.find((a) => a.id === props.activeExample)?.label
          : undefined) ||
        (useExample ? props.activeExample : "Custom AOI")
      const req: EnergyModelRequest = {
        label: aoiLabel,
        run_label: nameThisRun(aoiLabel),
        project_id: activeProjectId || undefined,
        area_id: useExample ? props.activeExample : "",
        polygon_geojson: useExample ? null : props.customPolygon,
        climatology_years: p.climatologyYears,
        hourly_years: p.hourlyYears,
        surface_azimuth: p.surfaceAzimuth,
        performance_ratio: parsedPR,
        reporting_basis: p.reportingBasis,
        // Every numeric below is sent as read. No `x || default` anywhere on
        // this path, because that reads a deliberate zero as an omission: a
        // degradation rate of exactly 0 states that no degradation is
        // modelled, and under an `or` default it became the 0.5 %/yr reference
        // and multiplied every lifetime-mean figure by 0.9422 instead of 1.0.
        // Go forwards these through pointers, so a zero reaches the sidecar,
        // which either admits it (degradation, tracker angle, buildable share,
        // shading) or fails the run naming the parameter. Neither end
        // substitutes a default for a value the caller did set.
        degradation_rate_per_year: p.degradationPct / 100,
        analysis_period_years: p.analysisPeriodYears,
        gcr_fixed: p.gcrFixed,
        gcr_tracker: p.gcrTracker,
        tracker_max_angle_deg: p.trackerMaxAngleDeg,
        capacity_density_basis: p.densityBasis,
        buildable_fraction: p.buildableFraction,
        utc_offset_hours: parsedOffset,
        declared_loss_pct: p.declaredLoss,
        optional_loss_pct: p.optionalLoss,
        slope_acceptable_deg: p.slopeAcceptableDeg,
        slope_restrictive_deg: p.slopeRestrictiveDeg,
        // A siting run already classified this AOI. Reusing its GeoTIFF makes
        // the capacity figure and the raster that published the area behind it
        // come from one classification rather than two.
        siting_raster_tif: solar.results.siting?.raster_tif || undefined,
        // Off unless the user asks for it. The terrain product measures
        // shading over the whole AOI, while the field it feeds is documented
        // as shading over the suitable pixels; carrying it across silently
        // would file an AOI mean under a different quantity's name. Left off,
        // the response states that the figures are unshaded.
        shading_derate:
          p.applyShading && solar.results.terrain?.shading_mean_pct != null
            ? 1 - solar.results.terrain.shading_mean_pct / 100
            : undefined,
        shading_applied:
          p.applyShading && solar.results.terrain?.shading_mean_pct != null,
      }
      const res = (await AnalyzeEnergyModel(
        req as never
      )) as unknown as EnergyModelAnalysis
      solarDispatch({
        type: "result/set",
        product: "energy",
        result: res,
        aoiSignature,
      })
      notifySuccess(
        `Energy model: ${res.plant.suitable.specific_yield_kwh_kwp_year.toFixed(0)} kWh/kWp/yr at performance ratio ${res.performance_ratio.applied.toFixed(3)} (${res.performance_ratio.applied_source}), ${res.reporting_basis} basis.`,
        undefined,
        { action: { label: "View analysis", onClick: () => goAnalysis() } }
      )
      void refreshRuns()
      void refreshProjects()
    } catch (e) {
      notifyError("Energy model error", e)
    } finally {
      solarDispatch({ type: "run/finish" })
    }
  }

  const handleRunWind = async () => {
    const useExample = usesExampleArea(props.activeExample, props.areas)
    if (!useExample && !props.customPolygon) {
      notifyError("Define an area: draw, search, or load an example.")
      return
    }
    const w = wind.params
    if (!(w.roughnessLowM > 0) || !(w.roughnessHighM > w.roughnessLowM)) {
      notifyError(
        "Roughness band must be two increasing lengths in metres, both above zero."
      )
      return
    }
    startWindRun()
    try {
      const aoiLabel =
        props.analysisLabel?.trim() ||
        (useExample
          ? props.areas.find((a) => a.id === props.activeExample)?.label
          : undefined) ||
        (useExample ? props.activeExample : "Custom AOI")
      const req: WindRequest = {
        label: aoiLabel,
        run_label: nameThisRun(aoiLabel),
        project_id: activeProjectId || undefined,
        area_id: useExample ? props.activeExample : "",
        polygon_geojson: useExample ? null : props.customPolygon,
        record_years: w.recordYears,
        hub_height_m: w.hubHeightM,
        calm_threshold_ms: w.calmThresholdMS,
        record_max_floor_ms: w.recordMaxFloorMS,
        roughness_band_m: [w.roughnessLowM, w.roughnessHighM],
      }
      const res = (await AnalyzeWind(req as never)) as unknown as WindAnalysis
      windDispatch({ type: "result/set", result: res, aoiSignature })
      // Never stated beside the photovoltaic capacity factor and never without
      // the qualifier: this figure is gross of every plant loss, rests on an
      // extrapolation above the highest measured level, and has no external
      // benchmark of the kind the solar ratio has.
      notifySuccess(
        `Wind screening: mean ${res.measured.mean_speed_50m_ms.toFixed(2)} m/s at 50 m, gross capacity factor ${res.hub.gross_capacity_factor_pct.toFixed(1)}% at ${res.hub_height_m.toFixed(0)} m hub. Screening indication, gross of losses, unvalidated.`,
        undefined,
        { action: { label: "View analysis", onClick: () => goAnalysis() } }
      )
      void refreshRuns()
      void refreshProjects()
    } catch (e) {
      notifyError("Wind screening error", e)
    } finally {
      windDispatch({ type: "run/finish" })
    }
  }

  const handleViewDataCube = async () => {
    if (!props.start || !props.end) {
      notifyError("Set the acquisition period.")
      return
    }
    if (!props.customPolygon && !props.activeExample) {
      notifyError("Define an area: draw, search, or load an example.")
      return
    }
    const useExample = usesExampleArea(props.activeExample, props.areas)
    const req: DataCubeRequest = {
      area_id: useExample ? props.activeExample : "",
      polygon_geojson: useExample ? null : props.customPolygon,
      start: props.start,
      end: props.end,
      max_cloud: props.maxCloud,
      monthly_best: props.monthlyBest,
      tiles: [],
    }
    setDataCubeOpen(true)
    setDataCubeLoading(true)
    setDataCubeError(null)
    setDataCubeResult(null)
    try {
      const res = (await ListDataCube(req as never)) as unknown as DataCubeResult
      setDataCubeResult(res)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setDataCubeError(msg)
      notifyError("Data cube error", msg)
    } finally {
      setDataCubeLoading(false)
    }
  }

  const handleRun = async () => {
    if (!props.start || !props.end) {
      notifyError("Set the acquisition period.")
      return
    }
    if (!props.customPolygon && !props.activeExample) {
      notifyError("Define an area: draw, search, or load an example.")
      return
    }
    props.setRunning(true)
    props.setProgress(0)
    props.setProgressMsg("iniciando")
    props.setResult(null)
    const useExample = usesExampleArea(props.activeExample, props.areas)
    const aoiLabel =
      props.analysisLabel?.trim() ||
      (useExample
        ? props.areas.find((a) => a.id === props.activeExample)?.label
        : undefined) ||
      (useExample ? props.activeExample : "Custom AOI")
    const req: PredictRequest = {
      area_id: useExample ? props.activeExample : "",
      polygon_geojson: useExample ? null : props.customPolygon,
      start: props.start,
      end: props.end,
      max_cloud: props.maxCloud,
      monthly_best: props.monthlyBest,
      tiles: [],
      mode: props.mode,
      model_kind: props.modelKind,
      prithvi_mode: props.prithviMode,
      project_id: activeProjectId || undefined,
      label: aoiLabel,
      run_label: nameThisRun(aoiLabel),
    }
    try {
      const res = (await Predict(req as never)) as unknown as PredictResult
      props.setResult(res)
      props.setShowPredictionOverlay(true)
      if (!props.analysisLabel?.trim()) {
        props.setAnalysisLabel(req.label)
      }
      if (activeProjectId) {
        await syncProjectAoi(activeProjectId, req.label)
        await refreshProjects()
      }
      notifySuccess(`Classification complete — ${res.n_dates} scenes (saved).`, undefined, {
        action: {
          label: "View analysis",
          onClick: () => goAnalysis(),
        },
      })
      void refreshRuns()
      void refreshProjects()
    } catch (e) {
      notifyError("Inference error", e)
    } finally {
      props.setRunning(false)
    }
  }

  const handleAnalyzeLULC = async () => {
    const useExample = usesExampleArea(props.activeExample, props.areas)
    if (!useExample && !props.customPolygon) {
      notifyError("Draw a polygon or select example A/B/C.")
      return
    }
    props.setLulcRunning(true)
    props.setProgress(0)
    props.setProgressMsg(
      useExample ? "analyzing MapBiomas" : "fetching MapBiomas COG"
    )
    try {
      const lulc = (await AnalyzeLULC({
        area_id: useExample ? props.activeExample : "",
        polygon_geojson: useExample ? null : props.customPolygon,
      } as never)) as unknown as LULCAnalysis
      if (!props.analysisLabel?.trim()) {
        const label = useExample
          ? props.areas.find((a) => a.id === props.activeExample)?.label
          : "Custom AOI"
        props.setAnalysisLabel(label)
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
      const prev = props.result
      const keepClassification = !!prev && ((prev.n_dates ?? 0) > 0 || !!prev.overlay_uri)
      props.setShowPredictionOverlay(true)
      props.setResult({
        extent: keepClassification && prev ? prev.extent : extent,
        overlay_uri: keepClassification && prev?.overlay_uri ? prev.overlay_uri : mapUri,
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
      notifySuccess("Land cover / land use ready on map.", undefined, {
        action: { label: "Open analysis", onClick: () => goAnalysis() },
      })
      goMap()
    } catch (e) {
      notifyError("LULC analysis error", e)
    } finally {
      props.setLulcRunning(false)
      props.setProgress(0)
      props.setProgressMsg("")
    }
  }

  const openSavedAnalysis = useCallback(
    async (run: InferenceRun) => {
      setLoadingRun(true)
      try {
        const res = (await LoadAnalysis(run.id)) as unknown as PredictResult
        // A water or solar run carries no classification: no class stats, no
        // overlay, no scenes. Held as the result it made the map screen present
        // one, and the result panel then read a class list that was never
        // there. The standalone products below are what such a run restores.
        const isClassification =
          (res.class_stats?.length ?? 0) > 0 ||
          !!res.overlay_uri ||
          !!res.lulc ||
          res.n_dates > 0
        props.setResult(isClassification ? res : null)
        setCurrentRunLabel(run.label ?? null)
        props.setShowPredictionOverlay(true)
        if (isModelKind(run.model_kind)) props.setModelKind(run.model_kind)
        const extras = parsePreferenceExtras(prefs?.extras_json)
        const project = projects.find(
          (p) => p.id === (run.project_id || activeProjectId || "")
        )
        const displayLabel = resolveAoiDisplayLabel({
          analysisLabel: props.analysisLabel,
          projectLabel: project?.label,
          prefsAoiLabel: extras.aoi_label,
          summaryAoiLabel: aoiLabelFromRunSummary(run.summary),
        })
        props.setAnalysisLabel(displayLabel)
        if (displayLabel) void persistAoiLabel(displayLabel)
        const aoi = parseRunPolygon(run.polygon_geojson, props.areas)
        props.setActiveExample(aoi.exampleId)
        props.setCustomPolygon(aoi.polygon)
        // A water or solar run carries its raster in the same field a live run
        // uses, so opening one puts the overlay back on the map. The AOI it was
        // measured on is recorded first, otherwise the invalidation effect sees
        // a mismatch and drops the raster that was just restored.
        const restoredAoi = aoi.exampleId
          ? `area:${aoi.exampleId}`
          : aoi.polygon
            ? `poly:${JSON.stringify(aoi.polygon)}`
            : ""
        // Results and the AOI they were computed over in one action, for the
        // reason a live run records them together: assigned separately, the
        // invalidation effect can run against the old signature and drop the
        // results that were just restored.
        solarDispatch({
          type: "results/restore",
          results: {
            resource: res.solar ?? null,
            terrain: res.solar_terrain ?? null,
            siting: res.solar_siting ?? null,
            energy: res.energy_model ?? null,
          },
          aoiSignature: restoredAoi,
        })
        // Wind carries its own signature, so a restored wind run records the
        // AOI it was screened on separately.
        if (res.wind) {
          windDispatch({
            type: "result/set",
            result: res.wind,
            aoiSignature: restoredAoi,
          })
        } else {
          windDispatch({ type: "result/clear" })
        }
        if (res.water) {
          waterAoiRef.current = restoredAoi
          setWater(res.water)
          setShowWaterOverlay(true)
        } else {
          setWater(null)
        }
        const centroid = geometryCentroid(aoi.polygon)
        if (centroid) {
          props.setFlyTo({
            lat: centroid[1],
            lon: centroid[0],
            key: Date.now(),
          })
        }
        goAnalysis()
        notifySuccess("Analysis restored.")
      } catch (e) {
        notifyError("Could not load analysis", e)
      } finally {
        setLoadingRun(false)
      }
    },
    // props setters are stable from useState in parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      goAnalysis,
      solarDispatch,
      windDispatch,
      props.areas,
      props.analysisLabel,
      props.setResult,
      props.setModelKind,
      props.setAnalysisLabel,
      props.setActiveExample,
      props.setCustomPolygon,
      props.setFlyTo,
      persistAoiLabel,
      prefs?.extras_json,
      projects,
      activeProjectId,
    ]
  )

  const backToAnalysesList = useCallback(() => {
    props.setResult(null)
    setCurrentRunLabel(null)
    // The standalone products have to go too. The analysis payload is
    // non-null whenever any of them is present, so clearing only the
    // classification leaves the detail view up and the saved list unreachable.
    setWater(null)
    solarDispatch({ type: "results/clearAll" })
    windDispatch({ type: "result/clear" })
    props.setShowPredictionOverlay(true)
    props.setAnalysisLabel(undefined)
    props.setSwipeCompare(false)
    goAnalysis()
  }, [
    goAnalysis,
    solarDispatch,
    windDispatch,
    props.setResult,
    props.setShowPredictionOverlay,
    props.setAnalysisLabel,
    props.setSwipeCompare,
  ])

  const showCompositionFromHub = useCallback((overlay: ProjectOverlay) => {
    const entry = projectOverlayToComposition(overlay)
    if (!entry) {
      notifyError("Composition preview unavailable")
      return
    }
    setComposition(entry)
    setCompositionGallery((prev) => {
      if (prev.some((c) => c.id === entry.id)) return prev
      return [entry, ...prev].slice(0, 12)
    })
    setShowCompositionOverlay(true)
    props.setShowPredictionOverlay(false)
  }, [props.setShowPredictionOverlay])

  const startNewClassification = useCallback(() => {
    props.setResult(null)
    setCurrentRunLabel(null)
    props.setShowPredictionOverlay(true)
    props.setSwipeCompare(false)
    props.setSwipeRatio(0.5)
    setWater(null)
    solarDispatch({ type: "results/clearAll" })
    windDispatch({ type: "result/clear" })
    // Starting over drops the AOI, so the session composition must go with it:
    // otherwise the previous AOI's overlay stays painted over the empty map.
    // Saved compositions are reloaded from the project on reopen.
    clearAreaAndComposition()
    goMap()
  }, [
    goMap,
    solarDispatch,
    windDispatch,
    clearAreaAndComposition,
    props.setResult,
    props.setShowPredictionOverlay,
    props.setSwipeCompare,
    props.setSwipeRatio,
  ])
  const applyAoiRename = useCallback(
    async (label: string) => {
      const next = label.trim()
      if (!next) return
      props.setAnalysisLabel(next)
      void persistAoiLabel(next)
      if (activeProjectId) {
        try {
          await syncProjectAoi(activeProjectId, next)
          await refreshProjects()
        } catch {
          /* best-effort */
        }
      }
    },
    [
      activeProjectId,
      persistAoiLabel,
      props.setAnalysisLabel,
      refreshProjects,
      syncProjectAoi,
    ]
  )

  const areaLabel = useMemo(() => {
    if (props.analysisLabel) return props.analysisLabel
    if (props.activeExample) {
      return props.areas.find((a) => a.id === props.activeExample)?.label
    }
    return props.customPolygon ? "Custom AOI" : undefined
  }, [props.analysisLabel, props.activeExample, props.areas, props.customPolygon])

  /**
   * The one progress pair the dock's solar panel reads.
   *
   * That panel predates the two stores and has a single display for all five
   * products, so the running store supplies it. The energy screen reads each
   * store's own run state directly and needs no such collapse.
   */
  const energyProgress = wind.run.active ? wind.run : solar.run

  /**
   * Where the map is, for both screens that carry one.
   *
   * One live ref and one debounced write to the same map_view preference. Two
   * memories would let a pan made on the energy screen be lost on the way back
   * to the map, or the reverse, depending on which one last committed.
   */
  const handleViewChange = useCallback(
    (v: { lat: number; lon: number; zoom: number }) => {
      liveViewRef.current = v
      props.setView(v)
      persistMapView(v)
    },
    [persistMapView, props.setView]
  )

  const initialMapView =
    liveViewRef.current ??
    parsePreferenceExtras(prefs?.extras_json).map_view ??
    null

  /**
   * A polygon drawn on either map. The composition is dropped with it: it was
   * rendered for the previous AOI and does not describe this one. Water and the
   * energy products are dropped by their own AOI-change effects.
   */
  const handlePolygonDrawn = useCallback(
    (geom: GeoJSONGeometry | null) => {
      props.setCustomPolygon(geom)
      if (!geom) return
      props.setActiveExample("")
      props.setAnalysisLabel(undefined)
      setComposition(null)
      setShowCompositionOverlay(true)
    },
    [props.setCustomPolygon, props.setActiveExample, props.setAnalysisLabel]
  )

  /**
   * The analysis payload as the Analysis screen and the exporter see it.
   *
   * Water comes from its own action, so it is merged at render time rather
   * than written into the classification result: either can be produced first,
   * and neither must overwrite the other.
   */
  const resultWithWater = useMemo(
    () => {
      // Every standalone product counts. A run that carries only one of them
      // no longer sets a classification result, so leaving any out here would
      // hand the analysis screen nothing to show for it.
      const r = solar.results
      const w = wind.result
      if (
        !props.result &&
        !water &&
        !r.resource &&
        !r.terrain &&
        !r.siting &&
        !r.energy &&
        !w
      ) {
        return null
      }
      return {
        ...(props.result ?? EMPTY_RESULT),
        water,
        solar: r.resource,
        solar_terrain: r.terrain,
        solar_siting: r.siting,
        energy_model: r.energy,
        wind: w,
      }
    },
    [props.result, water, solar.results, wind.result]
  )

  const analysisPolygonGeoJSON = useMemo(() => {
    if (props.customPolygon) return JSON.stringify(props.customPolygon)
    if (props.activeExample) {
      const geom = props.areas.find((a) => a.id === props.activeExample)?.geometry
      if (geom) return JSON.stringify(geom)
    }
    return ""
  }, [props.customPolygon, props.activeExample, props.areas])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar
        view={props.view}
        result={props.result}
        runLabel={currentRunLabel}
        projectSwitcher={
          screen === "map" ? (
            <ProjectSwitcher
              projects={projects}
              activeProjectId={activeProjectId}
              onSelect={(id) => void activateProject(id)}
              onCreate={() => void handleCreateProjectFromMap()}
              onOpenHub={() => goAnalysis()}
            />
          ) : undefined
        }
      />

      <div className="flex min-h-0 flex-1">
        <AppNav
          onOpenRepo={() => OpenExternal("https://github.com/rexionmars")}
          hasAnalysis={!!props.result || runs.length > 0}
          onAnalysisClick={() => {
            // Tested on the payload the page is actually showing, not on the
            // classification: a water or solar run has no classification and
            // would otherwise leave the list unreachable.
            if (screen === "analysis" && resultWithWater) backToAnalysesList()
            else goAnalysis()
          }}
          leftPanel={leftPanel}
          onLeftPanelChange={setLeftPanel}
          energyTab={energyTab}
          onEnergyTabChange={setEnergyTab}
        />
        <div className="relative min-h-0 min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            {screen === "map" && (
              <motion.div
                key="screen-map"
                className="absolute inset-0 min-h-0"
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                <MapScreen
                  initialView={initialMapView}
                  leftPanel={leftPanel}
                  onLeftPanelChange={setLeftPanel}
                  areas={props.areas}
                  activeExample={props.activeExample}
                  customPolygon={props.customPolygon}
                  flyTo={props.flyTo}
                  result={props.result}
                  overlayOpacity={props.overlayOpacity}
                  showConfidence={props.showConfidence}
                  confidenceOnTop={props.confidenceOnTop}
                  smoothOverlay={props.smoothOverlay}
                  showPredictionOverlay={props.showPredictionOverlay}
                  showCompositionOverlay={showCompositionOverlay}
                  composition={
                    composition
                      ? { ...composition, opacity: composeOpacity }
                      : null
                  }
                  swipeCompare={props.swipeCompare}
                  swipeRatio={props.swipeRatio}
                  areaLabel={areaLabel}
                  onAreaLabelChange={(label) => {
                    void applyAoiRename(label)
                  }}
                  aoiContourScheme={props.aoiContourScheme}
                  onAoiContourSchemeChange={props.setAoiContourScheme}
                  hasArea={props.hasArea}
                  start={props.start}
                  end={props.end}
                  maxCloud={props.maxCloud}
                  monthlyBest={props.monthlyBest}
                  mode={props.mode}
                  modelKind={props.modelKind}
                  prithviMode={props.prithviMode}
                  running={props.running}
                  progress={props.progress}
                  progressMsg={props.progressMsg}
                  composeRunning={composeRunning}
                  composeProgress={composeProgress}
                  composeProgressMsg={composeProgressMsg}
                  composeScenes={composeScenes}
                  composeScenesLoading={composeScenesLoading}
                  composeScenesError={composeScenesError}
                  selectedSceneId={selectedSceneId}
                  composeKind={composeKind}
                  composeBands={composeBands}
                  composeIndex={composeIndex}
                  composeStretchLow={composeStretchLow}
                  composeStretchHigh={composeStretchHigh}
                  composeOpacity={composeOpacity}
                  onViewChange={handleViewChange}
                  onPolygonDrawn={handlePolygonDrawn}
                  onSelectExample={props.onSelectExample}
                  onLocationSelect={(lat, lon) =>
                    props.setFlyTo({ lat, lon, key: Date.now() })
                  }
                  onClearArea={clearAreaAndComposition}
                  onImportPolygon={props.onImportPolygon}
                  onStartChange={props.setStart}
                  onEndChange={props.setEnd}
                  onMaxCloudChange={props.setMaxCloud}
                  onMonthlyBestChange={props.setMonthlyBest}
                  onModeChange={props.setMode}
                  onModelKindChange={props.setModelKind}
                  onPrithviModeChange={props.setPrithviMode}
                  onOpacityChange={props.setOverlayOpacity}
                  onShowConfidenceChange={props.setShowConfidence}
                  onConfidenceOnTopChange={props.setConfidenceOnTop}
                  onSmoothOverlayChange={props.setSmoothOverlay}
                  onShowPredictionOverlayChange={props.setShowPredictionOverlay}
                  onShowCompositionOverlayChange={setShowCompositionOverlay}
                  onSelectScene={setSelectedSceneId}
                  onComposeKindChange={setComposeKind}
                  onComposeBandsChange={setComposeBands}
                  onComposeIndexChange={setComposeIndex}
                  onComposeStretchChange={(low, high) => {
                    setComposeStretchLow(low)
                    setComposeStretchHigh(high)
                  }}
                  onComposeOpacityChange={setComposeOpacity}
                  onListComposeScenes={() => void handleListComposeScenes()}
                  onApplyComposition={() => void handleApplyComposition()}
                  onClearComposition={() => {
                    setComposition(null)
                    setCompositionGallery([])
                    setShowCompositionOverlay(true)
                  }}
                  compositionGallery={compositionGallery}
                  onSelectComposition={(id) => {
                    const hit = compositionGallery.find((c) => c.id === id)
                    if (hit) {
                      setComposition(hit)
                      setShowCompositionOverlay(true)
                    }
                  }}
                  onRemoveComposition={(id) => {
                    setCompositionGallery((prev) => {
                      const next = prev.filter((c) => c.id !== id)
                      setComposition((cur) =>
                        cur?.id === id ? (next[0] ?? null) : cur
                      )
                      return next
                    })
                  }}
                  onSwipeCompareChange={props.setSwipeCompare}
                  onSwipeRatioChange={props.setSwipeRatio}
                  onRun={handleRun}
                  onAnalyzeLULC={handleAnalyzeLULC}
                  lulcRunning={props.lulcRunning}
                  onCloseResult={() => {
                    props.setResult(null)
                    props.setShowPredictionOverlay(true)
                    props.setAnalysisLabel(undefined)
                    props.setSwipeCompare(false)
                    props.setSwipeRatio(0.5)
                  }}
                  onNewClassification={startNewClassification}
                  onViewDataCube={() => void handleViewDataCube()}
                  dataCubeLoading={dataCubeLoading}
                  dataCubeOpen={dataCubeOpen}
                  dataCubeError={dataCubeError}
                  dataCubeResult={dataCubeResult}
                  onCloseDataCube={() => {
                    setDataCubeOpen(false)
                    setDataCubeError(null)
                  }}
                  water={water}
                  waterIndex={waterIndex}
                  waterRunning={waterRunning}
                  waterProgress={props.progress}
                  waterProgressMsg={props.progressMsg}
                  showWaterOverlay={showWaterOverlay}
                  onWaterIndexChange={setWaterIndex}
                  onRunWater={() => void handleRunWater()}
                  onClearWater={() => {
                    setWater(null)
                    setShowWaterOverlay(true)
                  }}
                  onShowWaterOverlayChange={setShowWaterOverlay}
                  waterOpacity={waterOpacity}
                  onWaterOpacityChange={setWaterOpacity}
                />
              </motion.div>
            )}
            {screen === "energy" && (
              <motion.div
                key="screen-energy"
                className="absolute inset-0 min-h-0"
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                <EnergyScreen
                  solar={solar}
                  solarDispatch={solarDispatch}
                  wind={wind}
                  windDispatch={windDispatch}
                  onRunSolar={(product: SolarProductId) => {
                    if (product === "resource") void handleRunSolar()
                    else if (product === "terrain") void handleRunSolarTerrain()
                    else if (product === "siting") void handleRunSolarSiting()
                    else void handleRunEnergyModel()
                  }}
                  onRunWind={() => void handleRunWind()}
                  hasArea={props.hasArea}
                  areas={props.areas}
                  activeExample={props.activeExample}
                  onSelectExample={props.onSelectExample}
                  customPolygon={props.customPolygon}
                  onPolygonDrawn={handlePolygonDrawn}
                  onImportPolygon={props.onImportPolygon}
                  onClearArea={clearAreaAndComposition}
                  areaLabel={areaLabel}
                  onAreaLabelChange={(label) => {
                    void applyAoiRename(label)
                  }}
                  aoiContourScheme={props.aoiContourScheme}
                  onAoiContourSchemeChange={props.setAoiContourScheme}
                  // The same live ref and the same debounced map_view write the
                  // map screen uses, so panning here and returning there lands
                  // in the same place.
                  initialView={initialMapView}
                  onViewChange={handleViewChange}
                  flyTo={props.flyTo}
                  tab={energyTab}
                  onTabChange={setEnergyTab}
                />
              </motion.div>
            )}
            {screen === "analysis" && (
              <motion.div
                key="screen-analysis"
                className="absolute inset-0 min-h-0"
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                <AnalysisPage
                  result={resultWithWater}
                  areas={props.areas}
                  modelKind={props.modelKind}
                  areaLabel={areaLabel}
                  areaId={props.activeExample || undefined}
                  polygonGeoJSON={analysisPolygonGeoJSON}
                  loadingRun={loadingRun}
                  onOpenRun={openSavedAnalysis}
                  onBackToList={backToAnalysesList}
                  onNewClassification={startNewClassification}
                  onAreaLabelChange={(label) => {
                    void applyAoiRename(label)
                  }}
                  onActivateProject={(id) => void activateProject(id)}
                  onShowComposition={showCompositionFromHub}
                  activeProjectId={activeProjectId}
                />
              </motion.div>
            )}
          </AnimatePresence>
          {screen === "auth" && <AuthPage />}
          {screen === "profile" && (
            <ProfilePage loadingRun={loadingRun} onOpenRun={openSavedAnalysis} />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
