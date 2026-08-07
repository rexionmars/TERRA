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
  LeftDockTabsMode,
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
  SolarSeason,
  SolarSitingAnalysis,
  SolarSitingRequest,
  EnergyModelAnalysis,
  EnergyModelRequest,
  WindAnalysis,
  WindRequest,
} from "@/lib/types"
import { leftDockTabsModeFromPrefs, parsePreferenceExtras } from "@/lib/preferenceExtras"
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
import { AppSidebar } from "@/components/AppSidebar"
import { MapScreen } from "@/pages/MapScreen"
import {
  ENERGY_DECLARED_LOSSES,
  ENERGY_DEFAULTS,
  ENERGY_OPTIONAL_LOSSES,
  WIND_DEFAULTS,
} from "@/components/SolarPanel"
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
  const [leftDockTabs, setLeftDockTabs] =
    useState<LeftDockTabsMode>("retracted_only")
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
      setLeftDockTabs(leftDockTabsModeFromPrefs(p))
    },
    [setTheme]
  )

  useEffect(() => {
    ListEmbeddedAreas()
      .then((a) => setAreas((a ?? []) as unknown as Area[]))
      .catch((e) => notifyError("Failed to load examples", e))
  }, [])

  useEffect(() => {
    EventsOn("predict:progress", (ev: ProgressEvent) => {
      if (ev.progress >= 0) setProgress(ev.progress)
      if (ev.msg) setProgressMsg(ev.msg)
    })
    return () => EventsOff("predict:progress")
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
            leftDockTabs={leftDockTabs}
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
  leftDockTabs: LeftDockTabsMode
  onSelectExample: (id: string) => void
  onClearArea: () => void
  onImportPolygon: () => void
}) {
  const { refreshRuns, refreshProjects, screen, goAnalysis, goMap, runs, projects, prefs, savePrefs } =
    useAuth()
  const [loadingRun, setLoadingRun] = useState(false)
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
  const [solar, setSolar] = useState<SolarAnalysis | null>(null)
  const [solarRunning, setSolarRunning] = useState(false)
  const [solarClimYears, setSolarClimYears] = useState(30)
  const [solarHourlyYears, setSolarHourlyYears] = useState(10)
  const [solarAzimuth, setSolarAzimuth] = useState(0)
  const [solarPR, setSolarPR] = useState("")
  const [solarTerrain, setSolarTerrain] = useState<SolarTerrainAnalysis | null>(null)
  const [solarTerrainRunning, setSolarTerrainRunning] = useState(false)
  // Gates both solar rasters: siting takes priority over terrain on the map,
  // so one switch and one opacity match what the user sees.
  const [showSolarOverlay, setShowSolarOverlay] = useState(true)
  const [solarOpacity, setSolarOpacity] = useState(0.85)
  const [solarSeason, setSolarSeason] = useState<SolarSeason>("annual")
  const [solarSiting, setSolarSiting] = useState<SolarSitingAnalysis | null>(null)
  const [solarSitingRunning, setSolarSitingRunning] = useState(false)
  const [solarSlopeAcceptable, setSolarSlopeAcceptable] = useState(10)
  const [solarSlopeRestrictive, setSolarSlopeRestrictive] = useState(15)
  // Every default below mirrors a sidecar module constant. The two are
  // duplicated with no link between them, so the panel states each default and
  // its source, and the response echoes back the value actually used.
  const [energyModel, setEnergyModel] =
    useState<EnergyModelAnalysis | null>(null)
  const [energyRunning, setEnergyRunning] = useState(false)
  const [energyReportingBasis, setEnergyReportingBasis] = useState<
    "year_one" | "lifetime_mean"
  >(ENERGY_DEFAULTS.reportingBasis)
  const [energyDegradationPct, setEnergyDegradationPct] = useState(
    ENERGY_DEFAULTS.degradationRatePctPerYear
  )
  const [energyAnalysisPeriod, setEnergyAnalysisPeriod] = useState(
    ENERGY_DEFAULTS.analysisPeriodYears
  )
  const [energyGcrFixed, setEnergyGcrFixed] = useState(ENERGY_DEFAULTS.gcrFixed)
  const [energyGcrTracker, setEnergyGcrTracker] = useState(
    ENERGY_DEFAULTS.gcrTracker
  )
  const [energyTrackerMaxAngle, setEnergyTrackerMaxAngle] = useState(
    ENERGY_DEFAULTS.trackerMaxAngleDeg
  )
  const [energyDensityBasis, setEnergyDensityBasis] = useState(
    ENERGY_DEFAULTS.capacityDensityBasis
  )
  const [energyBuildableFraction, setEnergyBuildableFraction] = useState(
    ENERGY_DEFAULTS.buildableFraction
  )
  /** Blank labels the diurnal profile in UTC, which is what POWER publishes. */
  const [energyUtcOffset, setEnergyUtcOffset] = useState("")
  /** Off by default: see the comment where the request is built. */
  const [applyShading, setApplyShading] = useState(false)
  const [energyDeclaredLoss, setEnergyDeclaredLoss] = useState<
    Record<string, number>
  >(() =>
    Object.fromEntries(ENERGY_DECLARED_LOSSES.map((t) => [t.key, t.defaultPct]))
  )
  const [energyOptionalLoss, setEnergyOptionalLoss] = useState<
    Record<string, number>
  >(() =>
    Object.fromEntries(ENERGY_OPTIONAL_LOSSES.map((t) => [t.key, t.defaultPct]))
  )
  const [wind, setWind] = useState<WindAnalysis | null>(null)
  const [windRunning, setWindRunning] = useState(false)
  const [windRecordYears, setWindRecordYears] = useState(
    WIND_DEFAULTS.recordYears
  )
  const [windHubHeight, setWindHubHeight] = useState(WIND_DEFAULTS.hubHeightM)
  const [windCalmThreshold, setWindCalmThreshold] = useState(
    WIND_DEFAULTS.calmThresholdMS
  )
  const [windRecordMaxFloor, setWindRecordMaxFloor] = useState(
    WIND_DEFAULTS.recordMaxFloorMS
  )
  const [windRoughnessLow, setWindRoughnessLow] = useState(
    WIND_DEFAULTS.roughnessLowM
  )
  const [windRoughnessHigh, setWindRoughnessHigh] = useState(
    WIND_DEFAULTS.roughnessHighM
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

  /** The AOI the current solar products were computed over. */
  const solarAoiRef = useRef<string>("")

  /**
   * The same for the four solar products. All four are read off one AOI -- the
   * resource and the energy model from its centroid, the terrain and siting
   * rasters from its extent -- so they are invalidated together.
   */
  useEffect(() => {
    if (!solar && !solarTerrain && !solarSiting && !energyModel) return
    if (aoiSignature === solarAoiRef.current) return
    setSolar(null)
    setSolarTerrain(null)
    setSolarSiting(null)
    setEnergyModel(null)
    setShowSolarOverlay(true)
  }, [aoiSignature, solar, solarTerrain, solarSiting, energyModel])

  /**
   * The AOI the current wind screening was computed over.
   *
   * A separate ref from the solar one because wind resolves on a different
   * reanalysis grid (0.5 by 0.625 degrees against the solar 1 degree), so the
   * two products can describe the same AOI through different cells and neither
   * one's validity implies the other's.
   */
  const windAoiRef = useRef<string>("")

  useEffect(() => {
    if (!wind) return
    if (aoiSignature === windAoiRef.current) return
    setWind(null)
  }, [aoiSignature, wind])

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
        run_label: makeRunLabel(aoiLabel),
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
    const parsedPR = solarPR.trim() ? Number(solarPR.trim()) : null
    if (
      parsedPR !== null &&
      (!Number.isFinite(parsedPR) || parsedPR <= 0 || parsedPR > 1)
    ) {
      notifyError("Performance ratio must be between 0 and 1.")
      return
    }
    setSolarRunning(true)
    props.setProgress(0)
    props.setProgressMsg("starting")
    try {
      const aoiLabel =
        props.analysisLabel?.trim() ||
        (useExample
          ? props.areas.find((a) => a.id === props.activeExample)?.label
          : undefined) ||
        (useExample ? props.activeExample : "Custom AOI")
      const req: SolarRequest = {
        label: aoiLabel,
        run_label: makeRunLabel(aoiLabel),
        project_id: activeProjectId || undefined,
        area_id: useExample ? props.activeExample : "",
        polygon_geojson: useExample ? null : props.customPolygon,
        climatology_years: solarClimYears,
        hourly_years: solarHourlyYears,
        surface_azimuth: solarAzimuth,
        performance_ratio: parsedPR,
      }
      const res = (await AnalyzeSolar(req as never)) as unknown as SolarAnalysis
      solarAoiRef.current = aoiSignature
      setSolar(res)
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
      setSolarRunning(false)
      props.setProgress(0)
      props.setProgressMsg("")
    }
  }

  const handleRunSolarTerrain = async () => {
    const useExample = usesExampleArea(props.activeExample, props.areas)
    if (!useExample && !props.customPolygon) {
      notifyError("Define an area: draw, search, or load an example.")
      return
    }
    setSolarTerrainRunning(true)
    props.setProgress(0)
    props.setProgressMsg("starting")
    try {
      const aoiLabel =
        props.analysisLabel?.trim() ||
        (useExample
          ? props.areas.find((a) => a.id === props.activeExample)?.label
          : undefined) ||
        (useExample ? props.activeExample : "Custom AOI")
      const req: SolarTerrainRequest = {
        label: aoiLabel,
        run_label: makeRunLabel(aoiLabel),
        project_id: activeProjectId || undefined,
        area_id: useExample ? props.activeExample : "",
        polygon_geojson: useExample ? null : props.customPolygon,
        hourly_years: solarHourlyYears,
        season: solarSeason,
      }
      const res = (await AnalyzeSolarTerrain(
        req as never
      )) as unknown as SolarTerrainAnalysis
      solarAoiRef.current = aoiSignature
      setSolarTerrain(res)
      setShowSolarOverlay(true)
      notifySuccess(
        `Terrain irradiation: ${res.poa_min.toFixed(0)} to ${res.poa_max.toFixed(0)} kWh/m2/yr.`
      )
    } catch (e) {
      notifyError("Solar terrain error", e)
    } finally {
      setSolarTerrainRunning(false)
      props.setProgress(0)
      props.setProgressMsg("")
    }
  }

  const handleRunSolarSiting = async () => {
    const useExample = usesExampleArea(props.activeExample, props.areas)
    if (!useExample && !props.customPolygon) {
      notifyError("Define an area: draw, search, or load an example.")
      return
    }
    setSolarSitingRunning(true)
    props.setProgress(0)
    props.setProgressMsg("starting")
    try {
      const aoiLabel =
        props.analysisLabel?.trim() ||
        (useExample
          ? props.areas.find((a) => a.id === props.activeExample)?.label
          : undefined) ||
        (useExample ? props.activeExample : "Custom AOI")
      const req: SolarSitingRequest = {
        label: aoiLabel,
        run_label: makeRunLabel(aoiLabel),
        project_id: activeProjectId || undefined,
        area_id: useExample ? props.activeExample : "",
        polygon_geojson: useExample ? null : props.customPolygon,
        slope_acceptable_deg: solarSlopeAcceptable,
        slope_restrictive_deg: solarSlopeRestrictive,
      }
      const res = (await AnalyzeSolarSiting(
        req as never
      )) as unknown as SolarSitingAnalysis
      solarAoiRef.current = aoiSignature
      setSolarSiting(res)
      // A fresh run has to be visible, the same way a water run is.
      setShowSolarOverlay(true)
      setSolarTerrain(null)
      notifySuccess(
        `Siting: ${res.suitable_no_conflict_ha.toFixed(1)} ha without land-use conflict, ${res.suitable_cropland_ha.toFixed(1)} ha on cropland.`
      )
    } catch (e) {
      notifyError("Solar siting error", e)
    } finally {
      setSolarSitingRunning(false)
      props.setProgress(0)
      props.setProgressMsg("")
    }
  }

  const handleRunEnergyModel = async () => {
    const useExample = usesExampleArea(props.activeExample, props.areas)
    if (!useExample && !props.customPolygon) {
      notifyError("Define an area: draw, search, or load an example.")
      return
    }
    // Same field and same range check as the resource run: one performance
    // ratio is resolved for the whole solar panel, so the two products cannot
    // report a yield on two different ratios for one AOI.
    const parsedPR = solarPR.trim() ? Number(solarPR.trim()) : null
    if (
      parsedPR !== null &&
      (!Number.isFinite(parsedPR) || parsedPR <= 0 || parsedPR > 1)
    ) {
      notifyError("Performance ratio must be between 0 and 1.")
      return
    }
    const parsedOffset = energyUtcOffset.trim()
      ? Number(energyUtcOffset.trim())
      : null
    if (
      parsedOffset !== null &&
      (!Number.isFinite(parsedOffset) || parsedOffset < -12 || parsedOffset > 14)
    ) {
      notifyError("UTC offset must be between -12 and 14 hours.")
      return
    }
    setEnergyRunning(true)
    props.setProgress(0)
    props.setProgressMsg("starting")
    try {
      const aoiLabel =
        props.analysisLabel?.trim() ||
        (useExample
          ? props.areas.find((a) => a.id === props.activeExample)?.label
          : undefined) ||
        (useExample ? props.activeExample : "Custom AOI")
      const req: EnergyModelRequest = {
        label: aoiLabel,
        run_label: makeRunLabel(aoiLabel),
        project_id: activeProjectId || undefined,
        area_id: useExample ? props.activeExample : "",
        polygon_geojson: useExample ? null : props.customPolygon,
        climatology_years: solarClimYears,
        hourly_years: solarHourlyYears,
        surface_azimuth: solarAzimuth,
        performance_ratio: parsedPR,
        reporting_basis: energyReportingBasis,
        degradation_rate_per_year: energyDegradationPct / 100,
        analysis_period_years: energyAnalysisPeriod,
        gcr_fixed: energyGcrFixed,
        gcr_tracker: energyGcrTracker,
        tracker_max_angle_deg: energyTrackerMaxAngle,
        capacity_density_basis: energyDensityBasis,
        buildable_fraction: energyBuildableFraction,
        utc_offset_hours: parsedOffset,
        declared_loss_pct: energyDeclaredLoss,
        optional_loss_pct: energyOptionalLoss,
        slope_acceptable_deg: solarSlopeAcceptable,
        slope_restrictive_deg: solarSlopeRestrictive,
        // A siting run already classified this AOI. Reusing its GeoTIFF makes
        // the capacity figure and the raster that published the area behind it
        // come from one classification rather than two.
        siting_raster_tif: solarSiting?.raster_tif || undefined,
        // Off unless the user asks for it. The terrain product measures
        // shading over the whole AOI, while the field it feeds is documented
        // as shading over the suitable pixels; carrying it across silently
        // would file an AOI mean under a different quantity's name. Left off,
        // the response states that the figures are unshaded.
        shading_derate:
          applyShading && solarTerrain?.shading_mean_pct != null
            ? 1 - solarTerrain.shading_mean_pct / 100
            : undefined,
        shading_applied: applyShading && solarTerrain?.shading_mean_pct != null,
      }
      const res = (await AnalyzeEnergyModel(
        req as never
      )) as unknown as EnergyModelAnalysis
      solarAoiRef.current = aoiSignature
      setEnergyModel(res)
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
      setEnergyRunning(false)
      props.setProgress(0)
      props.setProgressMsg("")
    }
  }

  const handleRunWind = async () => {
    const useExample = usesExampleArea(props.activeExample, props.areas)
    if (!useExample && !props.customPolygon) {
      notifyError("Define an area: draw, search, or load an example.")
      return
    }
    if (!(windRoughnessLow > 0) || !(windRoughnessHigh > windRoughnessLow)) {
      notifyError(
        "Roughness band must be two increasing lengths in metres, both above zero."
      )
      return
    }
    setWindRunning(true)
    props.setProgress(0)
    props.setProgressMsg("starting")
    try {
      const aoiLabel =
        props.analysisLabel?.trim() ||
        (useExample
          ? props.areas.find((a) => a.id === props.activeExample)?.label
          : undefined) ||
        (useExample ? props.activeExample : "Custom AOI")
      const req: WindRequest = {
        label: aoiLabel,
        run_label: makeRunLabel(aoiLabel),
        project_id: activeProjectId || undefined,
        area_id: useExample ? props.activeExample : "",
        polygon_geojson: useExample ? null : props.customPolygon,
        record_years: windRecordYears,
        hub_height_m: windHubHeight,
        calm_threshold_ms: windCalmThreshold,
        record_max_floor_ms: windRecordMaxFloor,
        roughness_band_m: [windRoughnessLow, windRoughnessHigh],
      }
      const res = (await AnalyzeWind(req as never)) as unknown as WindAnalysis
      windAoiRef.current = aoiSignature
      setWind(res)
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
      setWindRunning(false)
      props.setProgress(0)
      props.setProgressMsg("")
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
      run_label: makeRunLabel(aoiLabel),
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
        setSolar(res.solar ?? null)
        setSolarTerrain(res.solar_terrain ?? null)
        setSolarSiting(res.solar_siting ?? null)
        setEnergyModel(res.energy_model ?? null)
        if (
          res.solar ||
          res.solar_terrain ||
          res.solar_siting ||
          res.energy_model
        ) {
          solarAoiRef.current = restoredAoi
          setShowSolarOverlay(true)
        }
        // Wind is invalidated against its own AOI ref, so a restored wind run
        // has to record the AOI it was screened on the same way.
        if (res.wind) {
          windAoiRef.current = restoredAoi
          setWind(res.wind)
        } else {
          setWind(null)
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
    // The standalone products have to go too. The analysis payload is
    // non-null whenever any of them is present, so clearing only the
    // classification leaves the detail view up and the saved list unreachable.
    setWater(null)
    setSolar(null)
    setSolarTerrain(null)
    setSolarSiting(null)
    setEnergyModel(null)
    setWind(null)
    props.setShowPredictionOverlay(true)
    props.setAnalysisLabel(undefined)
    props.setSwipeCompare(false)
    goAnalysis()
  }, [
    goAnalysis,
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
    props.setShowPredictionOverlay(true)
    props.setSwipeCompare(false)
    props.setSwipeRatio(0.5)
    setWater(null)
    setSolar(null)
    setSolarTerrain(null)
    setSolarSiting(null)
    setEnergyModel(null)
    setWind(null)
    // Starting over drops the AOI, so the session composition must go with it:
    // otherwise the previous AOI's overlay stays painted over the empty map.
    // Saved compositions are reloaded from the project on reopen.
    clearAreaAndComposition()
    goMap()
  }, [
    goMap,
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
   * The analysis payload as the Analysis screen and the exporter see it.
   *
   * Water comes from its own action, so it is merged at render time rather
   * than written into the classification result: either can be produced first,
   * and neither must overwrite the other.
   */
  const resultWithWater = useMemo(
    () =>
      // Every standalone product counts. A run that carries only one of them
      // no longer sets a classification result, so leaving any out here would
      // hand the analysis screen nothing to show for it.
      props.result ||
      water ||
      solar ||
      solarTerrain ||
      solarSiting ||
      energyModel ||
      wind
        ? {
            ...(props.result ?? EMPTY_RESULT),
            water,
            solar,
            solar_terrain: solarTerrain,
            solar_siting: solarSiting,
            energy_model: energyModel,
            wind,
          }
        : null,
    [
      props.result,
      water,
      solar,
      solarTerrain,
      solarSiting,
      energyModel,
      wind,
    ]
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
        <AppSidebar
          onOpenRepo={() => OpenExternal("https://github.com/rexionmars")}
          hasAnalysis={!!props.result || runs.length > 0}
          onAnalysisClick={() => {
            // Tested on the payload the page is actually showing, not on the
            // classification: a water or solar run has no classification and
            // would otherwise leave the list unreachable.
            if (screen === "analysis" && resultWithWater) backToAnalysesList()
            else goAnalysis()
          }}
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
                  initialView={
                    liveViewRef.current ??
                    parsePreferenceExtras(prefs?.extras_json).map_view ??
                    null
                  }
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
                  onViewChange={(v) => {
                    liveViewRef.current = v
                    props.setView(v)
                    persistMapView(v)
                  }}
                  onPolygonDrawn={(geom) => {
                    props.setCustomPolygon(geom)
                    if (geom) {
                      props.setActiveExample("")
                      props.setAnalysisLabel(undefined)
                      // A composition was rendered for the previous AOI and
                      // does not describe this one. Water is dropped by the
                      // AOI-change effect above.
                      setComposition(null)
                      setShowCompositionOverlay(true)
                    }
                  }}
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
                  solar={solar}
                  solarRunning={solarRunning}
                  solarClimYears={solarClimYears}
                  solarHourlyYears={solarHourlyYears}
                  solarAzimuth={solarAzimuth}
                  solarPR={solarPR}
                  onSolarClimYearsChange={setSolarClimYears}
                  onSolarHourlyYearsChange={setSolarHourlyYears}
                  onSolarAzimuthChange={setSolarAzimuth}
                  onSolarPRChange={setSolarPR}
                  onRunSolar={() => void handleRunSolar()}
                  onClearSolar={() => setSolar(null)}
                  solarTerrain={solarTerrain}
                  solarTerrainRunning={solarTerrainRunning}
                  showSolarOverlay={showSolarOverlay}
                  solarOpacity={solarOpacity}
                  onShowSolarOverlayChange={setShowSolarOverlay}
                  onSolarOpacityChange={setSolarOpacity}
                  onRunSolarTerrain={() => void handleRunSolarTerrain()}
                  onClearSolarTerrain={() => setSolarTerrain(null)}
                  solarSeason={solarSeason}
                  onSolarSeasonChange={setSolarSeason}
                  solarSiting={solarSiting}
                  solarSitingRunning={solarSitingRunning}
                  solarSlopeAcceptable={solarSlopeAcceptable}
                  solarSlopeRestrictive={solarSlopeRestrictive}
                  onSolarSlopeAcceptableChange={setSolarSlopeAcceptable}
                  onSolarSlopeRestrictiveChange={setSolarSlopeRestrictive}
                  onRunSolarSiting={() => void handleRunSolarSiting()}
                  onClearSolarSiting={() => setSolarSiting(null)}
                  energyModel={energyModel}
                  energyRunning={energyRunning}
                  energyReportingBasis={energyReportingBasis}
                  onEnergyReportingBasisChange={setEnergyReportingBasis}
                  energyDegradationPct={energyDegradationPct}
                  onEnergyDegradationPctChange={setEnergyDegradationPct}
                  energyAnalysisPeriod={energyAnalysisPeriod}
                  onEnergyAnalysisPeriodChange={setEnergyAnalysisPeriod}
                  energyGcrFixed={energyGcrFixed}
                  onEnergyGcrFixedChange={setEnergyGcrFixed}
                  energyGcrTracker={energyGcrTracker}
                  onEnergyGcrTrackerChange={setEnergyGcrTracker}
                  energyTrackerMaxAngle={energyTrackerMaxAngle}
                  onEnergyTrackerMaxAngleChange={setEnergyTrackerMaxAngle}
                  energyDensityBasis={energyDensityBasis}
                  onEnergyDensityBasisChange={setEnergyDensityBasis}
                  energyBuildableFraction={energyBuildableFraction}
                  onEnergyBuildableFractionChange={setEnergyBuildableFraction}
                  energyUtcOffset={energyUtcOffset}
                  onEnergyUtcOffsetChange={setEnergyUtcOffset}
                  energyApplyShading={applyShading}
                  onEnergyApplyShadingChange={setApplyShading}
                  energyShadingMeanPct={solarTerrain?.shading_mean_pct ?? null}
                  energyDeclaredLoss={energyDeclaredLoss}
                  onEnergyDeclaredLossChange={(key, pct) =>
                    setEnergyDeclaredLoss((prev) => ({ ...prev, [key]: pct }))
                  }
                  energyOptionalLoss={energyOptionalLoss}
                  onEnergyOptionalLossChange={(key, pct) =>
                    setEnergyOptionalLoss((prev) => ({ ...prev, [key]: pct }))
                  }
                  onRunEnergyModel={() => void handleRunEnergyModel()}
                  onClearEnergyModel={() => setEnergyModel(null)}
                  wind={wind}
                  windRunning={windRunning}
                  windRecordYears={windRecordYears}
                  onWindRecordYearsChange={setWindRecordYears}
                  windHubHeight={windHubHeight}
                  onWindHubHeightChange={setWindHubHeight}
                  windCalmThreshold={windCalmThreshold}
                  onWindCalmThresholdChange={setWindCalmThreshold}
                  windRecordMaxFloor={windRecordMaxFloor}
                  onWindRecordMaxFloorChange={setWindRecordMaxFloor}
                  windRoughnessLow={windRoughnessLow}
                  onWindRoughnessLowChange={setWindRoughnessLow}
                  windRoughnessHigh={windRoughnessHigh}
                  onWindRoughnessHighChange={setWindRoughnessHigh}
                  onRunWind={() => void handleRunWind()}
                  onClearWind={() => setWind(null)}
                  leftDockTabs={props.leftDockTabs}
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
