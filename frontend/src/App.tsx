import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import { AnimatePresence, motion } from "motion/react"
import { selectPanel } from "@/lib/panelSelection"
import {
  TELEMETRY_DEFAULT,
  setStudioTelemetry,
} from "@/lib/studioTelemetry"
import { notifyError, notifyInfo, notifySuccess } from "@/lib/notify"
import type { Whiteboard } from "@/lib/whiteboards"
import { listWhiteboards, openWhiteboard } from "@/lib/whiteboards"
import {
  restoreBoard,
  writeBoardMemory,
} from "@/components/whiteboard/boardMemory"
import { AccentLab } from "@/components/AccentLab"
import { useTheme } from "next-themes"
import {
  LoadAnalysis,
  Predict,
  AnalyzeLULC,
  ListDataCube,
  InspectEnvironment,
  RenderComposite,
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
  AnalyzeFlood,
} from "../wailsjs/go/main/App"
import { EventsOn, EventsOff } from "../wailsjs/runtime/runtime"
import type {
  Area,
  LayoutMode,
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
  FloodAnalysis,
  FloodRequest,
} from "@/lib/types"
import {
  layoutModeFromPrefs,
  mergePreferenceExtras,
  parsePreferenceExtras,
  startSurfaceFromPrefs,
} from "@/lib/preferenceExtras"
import { makeRunLabel, resolveAoiDisplayLabel, aoiLabelFromRunSummary } from "@/lib/aoiLabel"
import {
  projectOverlayToComposition,
  scopeCompositionsToView,
} from "@/lib/projectOverlays"
import {
  geometryBounds,
  geometryCentroid,
  usesExampleArea,
} from "@/lib/geometry"
import { ProjectSwitcher } from "@/components/ProjectSwitcher"
import { resolveCompositionMeta } from "@/lib/compositeCatalog"
import {
  DEFAULT_AOI_CONTOUR_SCHEME,
  type AoiContourSchemeId,
} from "@/lib/aoiStyle"
import { AuthProvider, useAuth } from "@/lib/auth"
import {
  createSavedAoi,
  type SavedAoi,
} from "@/lib/savedAois"

import { ThemeSync } from "@/components/ThemeSync"
import { TitleBar } from "@/components/TitleBar"
import { SplashScreen } from "@/components/SplashScreen"
import { WhatsNewGate } from "@/components/WhatsNewGate"
import { AppNav } from "@/components/AppNav"
import { MapScreen } from "@/pages/MapScreen"
import type { MapToolId } from "@/lib/mapTools"
import type { BasemapKind } from "@/lib/basemaps"
import { type EnergyTab } from "@/pages/EnergyScreen"
/*
  Loaded when opened, not at startup.

  These two screens pull recharts (493 KB) and most of the analysis UI, and
  neither is reachable from the map -- yet both were parsed on every launch,
  including the many that never leave the map. The map is what the application
  opens on, so it is the one screen that should not wait on the others.
*/
const EnergyScreen = lazy(() =>
  import("@/pages/EnergyScreen").then((m) => ({ default: m.EnergyScreen }))
)
/* Same argument: the flood screen is not reachable from the map, and it pulls
   the reading, its legend and the setup panel with it. */
const FloodScreen = lazy(() =>
  import("@/pages/FloodScreen").then((m) => ({ default: m.FloodScreen }))
)
import {
  FLOOD_DEFAULT_PARAMS,
  floodRequestBlocker,
  type FloodParams,
} from "@/components/flood/floodSetup"
import { qualifierHead } from "@/components/flood/floodFormat"
import { useSolarState, useWindState } from "@/lib/energyState"
import type {
  SolarLayers,
  SolarParams,
  SolarProductId,
  WindParams,
} from "@/lib/energyState"
import { AuthPage } from "@/pages/AuthPage"
import { ProfilePage } from "@/pages/ProfilePage"
const AnalysisPage = lazy(() =>
  import("@/pages/AnalysisPage").then((m) => ({ default: m.AnalysisPage }))
)

/*
  What a lazily-loaded screen shows while its chunk arrives.

  Deliberately quiet: the chunk is on local disk, so this is visible for a frame
  or two and a spinner that appears and vanishes that fast reads as a flicker.
  It holds the space and the background so the transition does not jump.
*/
function ScreenLoading() {
  return <div className="absolute inset-0 bg-background" aria-busy="true" />
}

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
  /*
    EMPTY, AND ABOUT TO GO. These were the three embedded example areas -- A, B
    and C -- loaded from geojson files beside the binary and offered as a second
    way to name a ground: a run pointed either at an example or at a drawn
    shape, and every reader had to handle both. That second path is one of the
    duplications this change exists to remove, so the examples are gone and
    nothing fills this list.

    The state and the `activeExample` beside it survive one more step because
    they are threaded through about a hundred places, and unpicking that in the
    same commit as the removal would hide the removal inside it. Read from an
    empty list, every one of those reads answers "no example", which is the
    behaviour the application now has.
  */
  const [areas] = useState<Area[]>([])
  const [customPolygon, setCustomPolygon] = useState<GeoJSONGeometry | null>(null)
  const [savedAois, setSavedAois] = useState<SavedAoi[]>([])
  const [activeAoiId, setActiveAoiId] = useState<string | undefined>()
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
  /**
   * Results the map has finished with, kept so the board can still show them.
   *
   * There is ONE live result, and starting a run empties it before the request
   * is even built. Everything the map was showing therefore ceased to exist at
   * the moment the next run began -- not when it finished, and not because of
   * anything the board did. A studio whose whole purpose is placing analyses
   * side by side could hold exactly one at a time, and the previous one went
   * without a word.
   *
   * Archived here rather than in the board because it has to outlive the map
   * screen unmounting, which is what took the rasters away on a trip to the
   * analyses list and back.
   *
   * Bounded at three by recency: each result carries several megabytes of data
   * URIs. A run that was saved is evicted before one that was not, since a
   * saved run can be brought back through the run picker and an unsaved one is
   * gone for good.
   */
  const [retainedRuns, setRetainedRuns] = useState<
    readonly { id: string; result: PredictResult }[]
  >([])
  /*
    Forgotten, when what they are a memory OF is no longer the subject.

    Retention is the map's affordance: the run it has moved on from stays in
    hand so the board can still show it beside the new one. Nothing ever
    dropped them, so they accumulated for the session and were injected into
    every board that opened -- a run from one project, or from before a stored
    board was opened, appearing as an area of that board. `assetRuns` adds them
    to whatever is on screen, which is right for the live board and wrong for a
    board whose membership was saved.
  */
  const clearRetainedRuns = useCallback(() => setRetainedRuns([]), [])
  /**
   * What identifies a run's WORK, independently of what it is filed under.
   *
   * The recorded row first, since that is the run itself. A standalone product
   * the store did not record leaves none, and then the raster it produced is
   * the only thing that distinguishes it -- two runs cannot share an overlay,
   * so its uri serves as an id for this purpose.
   */
  const runWorkKey = useCallback((r: PredictResult | null): string | null => {
    if (!r) return null
    return (
      r.run_id ||
      r.water?.run_id ||
      r.overlay_uri ||
      r.solar_terrain?.overlay_uri ||
      r.solar_siting?.overlay_uri ||
      null
    )
  }, [])

  const retainRun = useCallback((
    outgoing: PredictResult | null,
    /**
     * The board's own id for the ground this run was over.
     *
     * THREE IDENTITIES HAD TO BE MADE ONE. The board keys its live area by the
     * GROUND -- `liveAreaId` returns the AOI id whenever it knows it -- while
     * `runId` reaching it is `result.run_id || "current"`, which a standalone
     * product leaves as the sentinel, and this function keyed what it kept by
     * the run. Three names for one area, so the retained entry and the area it
     * came from could never find each other: the entry appeared in the data
     * tree as a run to add by hand, and the planes that had been on the board
     * were not carried over to it.
     *
     * Given rather than derived, because only the caller knows which ground is
     * being left. Falls back to the run row, then to an unsaved counter.
     */
    areaId?: string | null
  ) => {
    /*
      ANY PRODUCT IS WORTH KEEPING, not only a classification.

      This used to read: "a result with no classification is a water or solar
      payload the board reads from its own fields; nothing of it belongs to a
      scene." That was true of the LIVE area and of nothing else. The board
      reads water and solar from its own props only while the map is still on
      that ground; the moment the AOI moves, the aoiSignature effects clear
      those stores and the props go empty. A solar run left the board the
      instant a new area was drawn, and there was nothing to bring it back
      because it had never been retained.

      The board was already able to draw one: `legendByArea` in BoardSurface
      builds a retained area's legends from `result.water`,
      `result.solar_terrain` and `result.solar_siting` -- fields that exist on
      every result. What was missing was a result reaching it.

      So the test is whether the outgoing run produced ANYTHING. A result with
      none of these is an empty shell from a run that never finished, and that
      is the only case worth dropping.
    */
    const carries =
      !!outgoing &&
      (!!outgoing.class_stats?.length ||
        !!outgoing.overlay_uri ||
        !!outgoing.water ||
        !!outgoing.solar_terrain ||
        !!outgoing.solar_siting ||
        !!outgoing.flood)
    if (!outgoing || !carries) {
      return
    }
    const work = runWorkKey(outgoing)
    setRetainedRuns((prev) => {
      /*
        THE RECORDED ROW, WHEREVER IT WAS RECORDED.

        `run_id` on the result is the classification's. A run that produced
        only a standalone product leaves it empty, and the board then keys the
        area as `unsaved:` -- which costs it the run record, so it is titled
        "Previous run" and outlined as its raster's rectangle instead of its
        real shape.

        Water records its row on its own payload and says why: "the Go side
        withdraws its claim to have saved by returning nothing". Reading it
        here gives a retained water run its name and its outline back.

        SolarTerrainAnalysis, SolarSitingAnalysis and FloodAnalysis carry no
        such field, so those still retain as `unsaved:`. The asymmetry is in
        the payloads rather than here, and closing it means the Go side
        returning the row it wrote for them too.
      */
      const id =
        areaId?.trim() ||
        outgoing.run_id ||
        outgoing.water?.run_id ||
        `unsaved:${prev.length + 1}`
      /*
        ONE ENTRY PER RUN, WHATEVER IT WAS FILED UNDER.

        Retention happens from the effect that watches the ground and from
        three older call sites that name none, so one run could arrive twice
        with two identities -- once under its recorded row, once under the area
        it was over. Both were kept, and the board drew one raster as two areas
        over one field: "drawn" beside "run-untitled", identical vertex count,
        identical hectares.

        THE GROUND WINS when it is offered. It is what the board files areas
        under -- `liveAreaId` answers with it -- so an entry keyed by the run
        is re-keyed rather than left to shadow the one that can be found.
      */
      const same = work
        ? prev.findIndex((r) => runWorkKey(r.result) === work)
        : -1
      if (same >= 0) {
        if (prev[same].id === id || !areaId?.trim()) return prev
        const rekeyed = [...prev]
        rekeyed[same] = { id, result: outgoing }
        return rekeyed
      }
      if (prev.some((r) => r.id === id)) return prev
      const next = [{ id, result: outgoing }, ...prev]
      if (next.length <= 3) return next
      // Drop the oldest RECOVERABLE one; an unsaved run has nowhere to return
      // from, so it outlives a saved neighbour.
      for (let i = next.length - 1; i >= 0; i--) {
        if (!next[i].id.startsWith("unsaved:")) return next.filter((_, j) => j !== i)
      }
      return next.slice(0, 3)
    })
  }, [runWorkKey])
  /**
   * Let go of a retained run, which the board could list and not remove.
   *
   * The studio's X drops a run from the board and leaves it on disk. It did
   * that for runs added from the picker and could not for retained ones,
   * because those live here and the board only receives them -- so a retained
   * entry had no way off the board at all. It became visible when retention
   * stopped being tied to two gestures: a reader now accumulates them by
   * working, and an entry that cannot be dismissed accumulates forever.
   */
  const dropRetainedRun = useCallback((id: string) => {
    setRetainedRuns((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const [analysisLabel, setAnalysisLabel] = useState<string | undefined>()
  const [lulcRunning, setLulcRunning] = useState(false)
  const [booting, setBooting] = useState(true)
  const [splashExiting, setSplashExiting] = useState(false)
  const { setTheme } = useTheme()

  /**
   * Stored preferences into the controls they own. LOAD ONLY.
   *
   * Called once when preferences arrive, and never as the echo of a save.
   * Every field here is a control the reader can also move by hand, so
   * re-running it after a save overwrites whatever they moved since -- which
   * is what silently put the model picker back on the stored default after any
   * of the five actions that write preferences on their own.
   */
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
      const extras = parsePreferenceExtras(p.extras_json)
      setSavedAois(extras.saved_aois ?? [])
      setActiveAoiId(extras.active_aoi_id)
      /*
        Into a module rather than into state: the readers are the studio's
        status bar and the scene, and the scene is not React. Seeded here
        because this is where preferences arrive, and absent means none --
        which is what a reader who has never opened the setting should get.
      */
      setStudioTelemetry(extras.studio_telemetry ?? TELEMETRY_DEFAULT)
    },
    [setTheme]
  )

  useEffect(() => {
    let cancelled = false
    let started = false
    let exitTimer: number | undefined
    let revealTimer: number | undefined

    /*
      boot:ready carries whether the probe succeeded, and nothing read it.

      A sidecar that failed its probe wrote the reason into the boot log, the
      splash showed it for a moment, and then the splash was replaced by an
      application that looked healthy -- the one report of the failure went
      away with the screen that carried it.

      The environment gate covers an unusable interpreter specifically. This
      covers the rest: a missing sidecar script, a probe that timed out, a
      runner that never built. Reported once, as a notification the user can
      read after the window opens.
    */
    const finish = async (ok?: boolean) => {
      if (cancelled || started) return
      started = true
      if (ok === false) {
        notifyError(
          "TERRA started, but the analysis sidecar did not respond. " +
            "Settings › System reports what is wrong."
        )
      }
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
    /*
      The backstop, for a boot:ready that never arrives.

      Twelve seconds rather than twenty: the probe caps itself at eight and the
      floor below it is under a second, so anything past that is something
      genuinely stuck -- and the old timeout meant staring at a frozen splash
      for twenty seconds before the window would open at all.

      Called with no argument, so it is not reported as a failed probe. Nothing
      is known here; the probe may still answer after this fires.
    */
    const safety = window.setTimeout(() => void finish(), 12_000)
    return () => {
      cancelled = true
      EventsOff("boot:ready")
      window.clearTimeout(safety)
      if (exitTimer) window.clearTimeout(exitTimer)
      if (revealTimer) window.clearTimeout(revealTimer)
    }
  }, [])

  const hasArea = !!customPolygon || !!activeExample

  const clearArea = () => {
    setCustomPolygon(null)
    setActiveExample("")
    setAnalysisLabel(undefined)
    setActiveAoiId(undefined)
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
        const entry = createSavedAoi(geom, savedAois, file.name.replace(/\.[^.]+$/, ""))
        setSavedAois((prev) => [...prev, entry])
        setActiveAoiId(entry.id)
        setActiveExample("")
        setCustomPolygon(geom)
        setAnalysisLabel(entry.name)
        notifySuccess(`Polygon saved as “${entry.name}”.`)
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
            savedAois={savedAois}
            activeAoiId={activeAoiId}
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
            setSavedAois={setSavedAois}
            setActiveAoiId={setActiveAoiId}
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
            retainRun={retainRun}
            retainedRuns={retainedRuns}
            onDropRetainedRun={dropRetainedRun}
            clearRetainedRuns={clearRetainedRuns}
            setAnalysisLabel={setAnalysisLabel}
            lulcRunning={lulcRunning}
            setLulcRunning={setLulcRunning}
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
  savedAois: SavedAoi[]
  activeAoiId?: string
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
  setSavedAois: Dispatch<SetStateAction<SavedAoi[]>>
  setActiveAoiId: (id: string | undefined) => void
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
  /** Archive the outgoing result before the live slot is emptied. */
  retainRun: (outgoing: PredictResult | null, areaId?: string | null) => void
  retainedRuns: readonly { id: string; result: PredictResult }[]
  onDropRetainedRun: (id: string) => void
  /** Drops them all, where what they are a memory of stops being the subject. */
  clearRetainedRuns: () => void
  setAnalysisLabel: (v: string | undefined) => void
  lulcRunning: boolean
  setLulcRunning: (v: boolean) => void
  onClearArea: () => void
  onImportPolygon: () => void
}) {
  const {
    user,
    refreshRuns,
    refreshProjects,
    screen,
    goAnalysis,
    goMap,
    goEnergy,
    goFlood,
    goProfile,
    runs,
    projects,
    prefs,
    savePrefs,
  } = useAuth()
  const [loadingRun, setLoadingRun] = useState(false)

  /**
   * Saved whiteboards, and the request to open one.
   *
   * The nonce is how the map screen is told to open its board: the board's
   * open state is that screen's, and a boolean would only fire the first time
   * -- opening the same whiteboard twice in a row has to work.
   */
  const [whiteboards, setWhiteboards] = useState<Whiteboard[]>([])
  const [openBoardNonce, setOpenBoardNonce] = useState(0)
  /*
    A request to show a restored energy result, counted rather than flagged.

    Same mechanism as the board nonce beside it and for the same reason:
    restoring the same solar run twice in a row has to open its result both
    times, and a boolean already true does nothing the second time.
  */
  const [openEnergyResultNonce, setOpenEnergyResultNonce] = useState(0)
  /* The same, for a restored flood envelope. */
  const [openFloodResultNonce, setOpenFloodResultNonce] = useState(0)

  /*
    The flood envelope: its parameters, its result and its run status.

    Held here rather than in the screen because the screen unmounts on every
    navigation away, and a product set chosen for a run is not a thing to
    rebuild after looking at the map. Plain state rather than a reducer of its
    own: unlike the energy axis this is one product with one result, so there
    is no second consumer to keep in step.
  */
  const [floodParams, setFloodParams] = useState<FloodParams>(FLOOD_DEFAULT_PARAMS)
  const [flood, setFlood] = useState<FloodAnalysis | null>(null)
  const [floodRun, setFloodRun] = useState({
    active: false,
    progress: 0,
    message: "",
  })
  const setFloodParamsPatch = useCallback(
    (patch: Partial<FloodParams>) =>
      setFloodParams((prev) => ({ ...prev, ...patch })),
    []
  )

  /*
    THE SURFACE THE SESSION OPENS ON, asked for once and not again.

    The same nonce a saved whiteboard uses, because it means the same thing: the
    studio was asked for BY NAME rather than toggled over what happens to be on
    screen. That distinction is what lets it open with an empty board -- the
    toggle refuses that, and should, since a press with nothing to work on has
    no result to show for itself.

    Once per run of the application, guarded by a ref rather than by the
    preference's value: prefs arrive after the shell is up and change again
    whenever anything else is saved, and an effect keyed on them alone would
    reopen the studio over a reader who had just closed it.
  */
  const startSurfaceAsked = useRef(false)
  useEffect(() => {
    if (!prefs || startSurfaceAsked.current) return
    startSurfaceAsked.current = true
    if (startSurfaceFromPrefs(prefs) === "studio") {
      setOpenBoardNonce((n) => n + 1)
    }
  }, [prefs])
  /**
   * The title bar's host element for the map screen's whiteboard toggle.
   *
   * A DOM node, not a board state. The button is drawn in the bar because the
   * bar is above the board in both layouts, and the two surfaces that used to
   * carry it each had a layout they could not serve. What stays in the map
   * screen is whether the board is open -- deliberately, so leaving the screen
   * and coming back gives the map. Same bridge as MapView's BottomRightSlot.
   */
  /*
    Whether the studio covers the map, mirrored here for the title bar alone.

    The state itself stays in the map screen -- it must not survive a trip to
    another screen -- and this is a report of it, reset when the screen changes
    so a stale `true` cannot outlive the screen that set it.
  */
  const [boardOpen, setBoardOpen] = useState(false)
  const [boardSlotHost, setBoardSlotHost] = useState<HTMLDivElement | null>(
    null
  )
  const refreshWhiteboards = useCallback(async () => {
    try {
      setWhiteboards(await listWhiteboards())
    } catch {
      // A board list that cannot be read is an empty menu section, not an
      // error in front of whatever the user was actually doing.
    }
  }, [])
  useEffect(() => {
    void refreshWhiteboards()
  }, [refreshWhiteboards])

  /**
   * Put these runs on the board and show it.
   *
   * NAMED RATHER THAN NEW. This is exactly what opening a saved whiteboard has
   * always done, and it was written inline inside that one handler: hand the
   * run ids to the board's own memory, go to the map the board sits over, and
   * bump the nonce that opens it. Every surface that wants to send a reader to
   * the studio needs the same three steps, and a second copy of them would be
   * a second answer to one question.
   *
   * The nonce rather than a boolean, for the reason `openBoardNonce` was a
   * nonce to begin with: opening the same thing twice in a row has to work, and
   * a flag that is already true does nothing the second time.
   *
   * The ids are CONSUMED by the board on mount, not read -- see the effect in
   * BoardSurface -- so sending the same run twice does not queue it twice.
   */
  const openInStudio = useCallback(
    (runIds: readonly string[], workspace?: string) => {
      writeBoardMemory("pendingRunIds", [...runIds])
      if (workspace) writeBoardMemory("pendingWorkspace", workspace)
      goMap()
      setOpenBoardNonce((n) => n + 1)
    },
    [goMap]
  )

  const handleOpenWhiteboard = useCallback(
    async (board: Whiteboard) => {
      try {
        const opened = await openWhiteboard(board.id)
        if (!opened.snapshot) {
          notifyError(
            "Could not read this studio",
            new Error("its arrangement is unreadable")
          )
          return
        }
        restoreBoard(opened.snapshot)
        /*
          The map's retained runs go with it. A stored board is the runs it was
          saved with; anything the map happened to be holding is not one of
          them, and `assetRuns` would add it as an area of this board.
        */
        props.clearRetainedRuns()
        /*
          The rasters are fetched by the board itself, where LoadAnalysis
          already lives. Members whose run has been deleted are left out with
          a word rather than silently: a board that opened with one side
          missing and said nothing would look like it had been built that way.
        */
        const wanted = opened.snapshot.runIds.filter(
          (id) => !opened.missingRunIds.includes(id)
        )
        writeBoardMemory("savedId", board.id)
        writeBoardMemory("savedName", board.name)
        if (opened.missingRunIds.length) {
          notifyInfo(
            `${opened.missingRunIds.length} run(s) in this studio no longer exist.`
          )
        }
        /*
          No workspace: a saved board carries its own arrangement, which
          `restoreBoard` has just put back. Asking for one here would replace
          what the reader saved with a preset.
        */
        openInStudio(wanted)
      } catch (e) {
        notifyError("Could not open this studio", e)
      }
    },
    [openInStudio, props.clearRetainedRuns]
  )

  /**
   * Open settings at System when nothing can be computed.
   *
   * Checked here rather than during boot: it imports every dependency in the
   * target interpreter, which costs seconds, and the splash has a fast probe
   * for the interpreter itself. This runs once the shell is already up.
   *
   * Sending the user somewhere is the point. Without it the application opens
   * looking healthy, the user draws an area, chooses a period, waits, and the
   * run dies on an import -- this moves that failure earlier, to the page that
   * can fix it.
   *
   * It goes to a settings page rather than a screen of its own. Configuring the
   * interpreter is a setting; giving it a separate full-screen route meant the
   * same subject could be reached three ways and left the window with no way
   * back to anything else.
   *
   * Once per session, and never over an explicit navigation: this is a
   * first-run gate, not a guard that keeps pulling someone out of a screen
   * they chose to open.
   *
   * Waits for a signed-in user. goProfile sends anyone without one to the auth
   * screen instead, so firing before sign-in spent the one attempt this gate
   * gets on a redirect to a page it did not mean -- and an unusable interpreter
   * then went unreported for the rest of the session, which is precisely the
   * silence the gate exists to break.
   */
  const envGateDone = useRef(false)
  useEffect(() => {
    if (!user || envGateDone.current) return
    envGateDone.current = true
    void (async () => {
      /*
        It says why before it moves anyone.

        This used to redirect in silence: the map appeared, then settings
        replaced it a moment later with nothing on screen accounting for the
        jump. That is indistinguishable from a navigation bug, and it was read
        as one -- the person it was trying to help concluded the application
        was broken, which is worse than the silence it replaced.

        The toast names what is missing rather than saying "something is
        wrong", because the specific package is what the user has to act on and
        the page it lands them on can only repeat it.
      */
      try {
        const state = await InspectEnvironment()
        if (state.active?.usable) return

        const missing = (state.active?.packages ?? []).filter(
          (p) => !p.optional && (!p.present || p.version_problem)
        )
        const detail = state.active?.unreachable
          ? state.active.unreachable
          : missing.length > 0
            ? `Missing: ${missing
                .slice(0, 3)
                .map((p) => p.distribution)
                .join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}.`
            : "The selected interpreter cannot run the analysis sidecar."

        notifyError(
          "Analyses cannot run yet — opening Settings › System",
          `${detail} Choose a Python there, or let TERRA build one.`,
          { duration: 9000 }
        )
        goProfile("system")
      } catch (e) {
        // Failing to inspect is itself a reason to show the page: it is the
        // only place that can report what went wrong.
        notifyError("Could not check the Python environment", e, {
          duration: 9000,
        })
        goProfile("system")
      }
    })()
  }, [user, goProfile])
  /**
   * Open tool tab of the map's left dock.
   *
   * Held here rather than inside MapScreen because that screen unmounts on
   * every navigation away, so local state reset the dock to the classification
   * panel on every return.
   */
  /**
   * Which map layout is drawn.
   *
   * Read in exactly two places -- here, to decide whether the navigation column
   * is rendered, and inside MapScreen -- which are a parent and its direct
   * child. That is one level of travel, so it stays a useState rather than
   * joining the auth context, which already carries user, prefs, runs,
   * projects, screen and settings page.
   *
   * Seeded from prefs below rather than in the initialiser: prefs arrive after
   * the first render, so an initialiser would read null and pin every session
   * to docked.
   */
  /**
   * Which basemap the map is showing, for the credit line in the title bar.
   *
   * Held here rather than in either screen because both draw a map and the bar
   * is above both: a credit owned by one screen would be blank on the other.
   */
  const [credit, setCredit] = useState<{
    kind: BasemapKind
    date: string | null
    /** Relief on: a second provider is on screen and is credited with it. */
    terrain?: boolean
  }>({ kind: "esri", date: null })
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("docked")

  /**
   * The last value this component wrote, so its own save does not echo back.
   *
   * The mode is state rather than derived from prefs because savePrefs
   * round-trips to Go and SQLite before the context updates, and a layout
   * toggle that waits on a disk write does not feel like a toggle. But the
   * settings page writes the same preference, so a stored value this component
   * did not write is one to follow -- which is also how it is seeded on start.
   */
  const lastWrittenLayoutRef = useRef<LayoutMode | null>(null)
  useEffect(() => {
    if (!prefs) return
    const stored = layoutModeFromPrefs(prefs)
    if (stored === lastWrittenLayoutRef.current) return
    lastWrittenLayoutRef.current = stored
    setLayoutMode(stored)
  }, [prefs])

  /*
    `persist: false` applies a layout for this session without storing it.

    The whiteboard forces Dock while it is up -- the two fight for the left
    edge -- and puts the previous one back on close. That is an arrangement the
    surface requires, not a choice the reader made, and writing it to
    preferences turned "open the studio, quit" into a silent edit of the Map
    layout setting. With a session that OPENS on the studio the edit would have
    happened on every launch.

    The ref is left alone in that case, on purpose: it records what this
    component wrote, and the seeding effect follows any stored value that
    differs from it. A forced mode written into the ref would make the next
    preference refresh look like the reader's own change and flip the layout
    out from under the board.
  */
  const changeLayoutMode = useCallback(
    (mode: LayoutMode, opts?: { persist?: boolean }) => {
      setLayoutMode(mode)
      if (opts?.persist === false) return
      lastWrittenLayoutRef.current = mode
      if (!prefs) return
      // Silent: this fires on a toggle the user just watched happen, and a
      // "Preferences saved" toast on every flip is noise about a result that
      // is already on screen.
      void savePrefs(
        {
          ...prefs,
          extras_json: mergePreferenceExtras(prefs.extras_json, {
            layout_mode: mode,
          }),
        },
        { silent: true }
      ).catch(() => {
        // A layout that fails to persist still applies for this session. The
        // next start falls back to docked, which is the safe direction.
      })
    },
    [prefs, savePrefs]
  )
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
  /*
    The saved run on screen, by id.

    The label was the only run identity the frontend held, and a label can be
    renamed. Compositions attach to this, so it has to be the row's own id: a
    composition filed under a renamed label would come loose from its run.

    Null while a run is being made -- the id only exists once the backend has
    saved it -- and null when the result on screen is a live one nobody kept.
  */
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)

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
    const geom =
      props.customPolygon ??
      props.areas.find((a) => a.id === props.activeExample)?.geometry ??
      null
    const b = geometryBounds(geom)
    return b
      ? {
          lon_min: b.lonMin,
          lat_min: b.latMin,
          lon_max: b.lonMax,
          lat_max: b.latMax,
        }
      : null
  }, [props.customPolygon, props.activeExample, props.areas])

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
  /**
   * A solar row on the whiteboard, translated into the store's own vocabulary.
   *
   * The board says which raster changed and how; only this file knows that
   * `terrain` answers to showTerrain/terrainOpacity. Handing the map screen the
   * reducer instead would have made every surface that draws a solar raster
   * know the shape of the store that holds it.
   */
  const setSolarBoardLayer = useCallback(
    (
      id: "terrain" | "siting",
      patch: { visible?: boolean; opacity?: number }
    ) => {
      const next: Partial<SolarLayers> = {}
      if (patch.visible !== undefined) {
        if (id === "terrain") next.showTerrain = patch.visible
        else next.showSiting = patch.visible
      }
      if (patch.opacity !== undefined) {
        if (id === "terrain") next.terrainOpacity = patch.opacity
        else next.sitingOpacity = patch.opacity
      }
      if (Object.keys(next).length > 0) setSolarLayers(next)
    },
    [setSolarLayers]
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

  /*
    Every result the screens can be holding, dropped together.

    ONE PLACE BECAUSE A PARTIAL COPY HAS ALREADY COST US ONE. The comment this
    replaces recorded it: flood was added to `resultWithWater` and not to the
    clearing, so the two disagreed about what a standalone product is -- the
    payload counted a loaded envelope, the clearing did not remove it, and the
    detail view rebuilt itself from the flood result the moment the reader asked
    for the list. The list was then unreachable for the rest of the session.

    A third caller was about to be written with the same shape and the same
    chance of missing one, which is what turned three copies into this.

    THE RETAIN IS NOT HERE. Two callers keep the run they are leaving so the
    board can still show it; one does not, because it is leaving the project
    that run belongs to. That is a decision about the caller's subject rather
    than about what a result is, so it stays with them.
  */
  const clearAnalysisResults = useCallback(() => {
    props.setResult(null)
    setCurrentRunLabel(null)
    setCurrentRunId(null)
    setWater(null)
    solarDispatch({ type: "results/clearAll" })
    windDispatch({ type: "result/clear" })
    setFlood(null)
  }, [props.setResult, solarDispatch, windDispatch])

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
      /*
        WHAT THE PREVIOUS PROJECT LEFT BEHIND, dropped before this one arrives.

        Opening a project set the AOI, the label and the composition and cleared
        nothing, so the run on the map, the standalone products beside it and
        the catalogued AOI id all stayed -- every one of them belonging to the
        project just left. The visible half is a raster from another field
        sitting over the new one.

        The half that is not visible is worse, because it reaches the studio.
        The board receives `runId` as `result?.run_id || "current"` and resolves
        the live area from it and from `activeAoiId`; carrying both across meant
        the new project's ground opened under the OLD project's identity, and
        that identity is the key to everything the board keeps per area -- the
        name a reader typed, the layer order, what they removed, where they
        dragged it. boardMemory.ts describes this failure and the work done to
        end it; this path was still reaching it.

        Read before persisting, since persisting is what moves the ref.

        NOT ON RESTORE. A session resuming at its last project is not leaving
        anything, and clearing there would drop the AOI that the same startup
        restored from preferences a moment earlier.

        NOT RETAINED, either, unlike the other two callers of the clear. They
        keep the run they are leaving so the board can still show it; this is
        leaving the project that run belongs to, and putting it on the next
        project's board is the contamination being removed.
      */
      const leaving = activeProjectIdRef.current
      if (userInitiated && leaving !== id) {
        clearAnalysisResults()
        // The retained ones too. Clearing the shown result while leaving the
        // runs it moved on from in hand carries the previous project onto this
        // one's boards by the other door.
        props.clearRetainedRuns()
        props.setActiveAoiId(undefined)
      }
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
        /*
          Only a composition that covers the area being opened is put on the
          map. This took gallery[0] -- the project's most recent -- and turned
          the overlay on, so opening a project whose latest composition was
          made over a different field drew a raster off the edge of the view
          the same action had just flown to.
        */
        // From the project, not from the branch above: the AOI arrives either
        // as an example area or as a saved polygon, and only one of those runs.
        const openedGeom = p.area_id
          ? (props.areas.find((a) => a.id === p.area_id)?.geometry ?? null)
          : parseRunPolygon(p.polygon_geojson ?? "", props.areas).polygon
        const openedAoi = geometryBounds(openedGeom)
        const inView = openedAoi
          ? scopeCompositionsToView(gallery, null, {
              lon_min: openedAoi.lonMin,
              lat_min: openedAoi.latMin,
              lon_max: openedAoi.lonMax,
              lat_max: openedAoi.latMax,
            })
          : gallery
        setComposition(userInitiated ? inView[0] ?? null : null)
        setShowCompositionOverlay(userInitiated && !!inView[0])
      } catch (e) {
        notifyError("Could not open project", e)
      }
    },
    [
      clearAnalysisResults,
      persistActiveProjectId,
      props.clearRetainedRuns,
      persistAoiLabel,
      prefs?.extras_json,
      props.areas,
      props.setActiveAoiId,
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

  const handleCreateProjectFromAoi = useCallback(async () => {
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
            // The run on screen, so this composition surfaces with that run
            // and not with every other run in the project.
            run_id: currentRunId ?? "",
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

  /** The AOI the flood envelope on screen was measured over. */
  const floodAoiRef = useRef<string>("")

  /*
    The same for the flood envelope, and for the same reason as the water
    raster: every area, every cell count and the agreement raster itself are
    over one window, so once the AOI moves the reading describes ground that is
    no longer on the map. Compared against the AOI the run was made on rather
    than cleared at each call site, because the AOI changes from drawing, from
    loading an example, from opening a project and from restoring a run.
  */
  useEffect(() => {
    if (!flood) return
    if (aoiSignature === floodAoiRef.current) return
    setFlood(null)
  }, [aoiSignature, flood])

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
   * One sidecar progress channel, four destinations.
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
  const floodRunRef = useRef(floodRun)
  floodRunRef.current = floodRun
  const floodSeenRef = useRef({ progress: 0, message: "" })
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
      if (floodRunRef.current.active) {
        const seen = floodSeenRef.current
        if (ev.progress >= 0) seen.progress = ev.progress
        if (ev.msg) seen.message = ev.msg
        setFloodRun({
          active: true,
          progress: seen.progress,
          message: seen.message,
        })
        return
      }
      // No energy or flood run in flight, so this belongs to the
      // classification channel.
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
        // Which catalogued area this run is OF. Without it a drawing and
        // the runs over it are separate subjects on the board, and the
        // same ground is drawn once per drawing plus once per run.
        aoi_id: props.activeAoiId,
        project_id: activeProjectId || undefined,
      }
      const res = (await AnalyzeWater(req as never)) as unknown as WaterAnalysis
      waterAoiRef.current = aoiSignature
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
        `Surface water mapped: ${res.n_dates} dates, peak ${res.peak_water_fraction_pct.toFixed(1)}%${res.run_id ? " (saved)" : ""}.`,
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
        // Which catalogued area this run is OF. Without it a drawing and
        // the runs over it are separate subjects on the board, and the
        // same ground is drawn once per drawing plus once per run.
        aoi_id: props.activeAoiId,
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
      /*
        No action. The result panel appears on this screen the moment the run
        lands and carries its own Read control, so a toast action would be a
        second route to a thing already in front of the reader -- and it used to
        be the only route, which is why it was here.
      */
      notifySuccess(
        // See the water toast: the word is conditional for the same reason.
        `Solar resource: ${res.resource.ghi_annual_kwh_m2.toFixed(0)} kWh/m2/yr, optimum tilt ${res.geometry.optimal_tilt_deg.toFixed(0)} degrees${res.run_id ? " (saved)" : ""}.`
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
        // Which catalogued area this run is OF. Without it a drawing and
        // the runs over it are separate subjects on the board, and the
        // same ground is drawn once per drawing plus once per run.
        aoi_id: props.activeAoiId,
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
        // Which catalogued area this run is OF. Without it a drawing and
        // the runs over it are separate subjects on the board, and the
        // same ground is drawn once per drawing plus once per run.
        aoi_id: props.activeAoiId,
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
        // Which catalogued area this run is OF. Without it a drawing and
        // the runs over it are separate subjects on the board, and the
        // same ground is drawn once per drawing plus once per run.
        aoi_id: props.activeAoiId,
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
      // No action: the result panel on this screen carries the Read control.
      notifySuccess(
        `Energy model: ${res.plant.suitable.specific_yield_kwh_kwp_year.toFixed(0)} kWh/kWp/yr at performance ratio ${res.performance_ratio.applied.toFixed(3)} (${res.performance_ratio.applied_source}), ${res.reporting_basis} basis.`
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
        // Which catalogued area this run is OF. Without it a drawing and
        // the runs over it are separate subjects on the board, and the
        // same ground is drawn once per drawing plus once per run.
        aoi_id: props.activeAoiId,
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
      // No action: the result panel on this screen carries the Read control.
      notifySuccess(
        `Wind screening: mean ${res.measured.mean_speed_50m_ms.toFixed(2)} m/s at 50 m, gross capacity factor ${res.hub.gross_capacity_factor_pct.toFixed(1)}% at ${res.hub_height_m.toFixed(0)} m hub. Screening indication, gross of losses, unvalidated.`
      )
      void refreshRuns()
      void refreshProjects()
    } catch (e) {
      notifyError("Wind screening error", e)
    } finally {
      windDispatch({ type: "run/finish" })
    }
  }

  /**
   * The flood envelope: the HAND extent and the disagreement between the DEM
   * products it can be derived from.
   *
   * The two parameters the sidecar derives per window -- the buffer from the
   * AOI extent, the inset margin from the cell size -- are sent only when the
   * reader took them over. Absent, the sidecar chooses; sent as a number
   * chosen for another window, they would replace that choice silently. This
   * is the reason the two are nullable in FloodParams and why neither is
   * defaulted here.
   *
   * The inset margin travels as inset_margin_cells. The sidecar refuses the
   * edge_margin_cells this used to send, by name: the ring it names is now cut
   * from the AOI polygon rather than from the computed window, and accepting
   * the old key would apply a number to a different ring than the one the
   * reading reports back.
   */
  const handleRunFlood = async () => {
    const useExample = usesExampleArea(props.activeExample, props.areas)
    if (!useExample && !props.customPolygon) {
      notifyError("Define an area: draw, search, or load an example.")
      return
    }
    const blocker = floodRequestBlocker(floodParams, true)
    if (blocker) {
      notifyError(blocker)
      return
    }
    floodSeenRef.current = { progress: 0, message: "starting" }
    setFloodRun({ active: true, progress: 0, message: "starting" })
    const runAoi = aoiSignature
    try {
      const aoiLabel =
        props.analysisLabel?.trim() ||
        (useExample
          ? props.areas.find((a) => a.id === props.activeExample)?.label
          : undefined) ||
        (useExample ? props.activeExample : "Custom AOI")
      const req: FloodRequest = {
        label: aoiLabel,
        run_label: nameThisRun(aoiLabel),
        aoi_id: props.activeAoiId,
        project_id: activeProjectId || undefined,
        area_id: useExample ? props.activeExample : "",
        polygon_geojson: useExample ? null : props.customPolygon,
        dem_ids: floodParams.demIds,
        reference_threshold_m: floodParams.referenceThresholdM,
        drainage_km2: floodParams.drainageKm2,
        ...(floodParams.bufferM !== null ? { buffer_m: floodParams.bufferM } : {}),
        ...(floodParams.insetMarginCells !== null
          ? { inset_margin_cells: floodParams.insetMarginCells }
          : {}),
      }
      const res = (await AnalyzeFlood(req as never)) as unknown as FloodAnalysis
      // Recorded before the result, so the invalidation effect above compares
      // against the AOI this run was made on rather than dropping the reading
      // it has just been handed.
      floodAoiRef.current = runAoi
      setFlood(res)
      // The qualifier travels with the figure, here as everywhere: a contested
      // share quoted without it reads as a published reproducibility range
      // rather than as this application's own measurement over its own DEM set.
      // Tested for a number rather than against null: the share is undefined
      // when no product calls anything wet, and an absent key multiplied by a
      // hundred would announce NaN where the fact is that there is no extent
      // to take a share of.
      const contested =
        typeof res.agreement.contested_frac_of_wet === "number"
          ? `${(res.agreement.contested_frac_of_wet * 100).toFixed(0)}% of the wet extent is contested`
          : "no product called any cell flooded"
      notifySuccess(
        `Flood envelope: ${contested} at HAND <= ${res.reference_threshold_m} m ` +
          `over ${res.products.length} DEM products. ` +
          qualifierHead(res.qualifier)
      )
      void refreshRuns()
      void refreshProjects()
    } catch (e) {
      notifyError("Flood envelope error", e)
    } finally {
      setFloodRun({ active: false, progress: 0, message: "" })
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
    // Before the slot is emptied, and before the request is built: a run that
    // fails now costs the reader nothing, where it used to cost them the map.
    props.retainRun(props.result)
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
      // See the note on the other requests: the board needs which area
      // this run is of, not only where it was made.
      aoi_id: props.activeAoiId,
    }
    try {
      const res = (await Predict(req as never)) as unknown as PredictResult
      props.setResult(res)
      // The row the backend just wrote. Compositions made from here attach to
      // it; empty when nothing was saved, which leaves them project-level.
      setCurrentRunId(res.run_id || null)
      props.setShowPredictionOverlay(true)
      if (!props.analysisLabel?.trim()) {
        props.setAnalysisLabel(req.label)
      }
      if (activeProjectId) {
        await syncProjectAoi(activeProjectId, req.label)
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
        `Classification complete — ${res.n_dates} scenes${res.run_id ? " (saved)" : ""}.`,
        undefined,
        res.run_id
          ? { action: { label: "View analysis", onClick: () => goAnalysis() } }
          : undefined
      )
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
    /**
     * @param opts.land Where to leave the user once the run is restored.
     *
     * The hub and the profile list send someone to the analysis page, which
     * for the hub is where they already are. The project menu does not: it is
     * opened from the map, and a run picked there is a request to look at that
     * run on the map. Passed rather than corrected afterwards -- navigating to
     * one screen and then to another shows the first one on the way past.
     */
    async (
      run: InferenceRun,
      opts?: { land?: "analysis" | "map" | "energy" | "flood" }
    ) => {
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
        setCurrentRunId(run.id)
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
        /* A flood envelope carries its own window and its own raster, so it is
           restored with the AOI it was measured over recorded first -- the
           invalidation effect would otherwise see a mismatch and drop the
           reading that has just been restored. */
        if (res.flood) {
          floodAoiRef.current = restoredAoi
          setFlood(res.flood)
        } else {
          setFlood(null)
        }
        const centroid = geometryCentroid(aoi.polygon)
        if (centroid) {
          props.setFlyTo({
            lat: centroid[1],
            lon: centroid[0],
            key: Date.now(),
          })
        }
        /*
          A solar or wind run is read on the energy screen now, so restoring one
          lands there with its result open rather than on the analysis page.

          Decided from `run.kind` rather than from the payload: the payload for
          a solar product and for a wind screening differ in shape, and the
          record already carries the one word that tells them apart. The caller
          can still override -- the project menu asks for the map, because a run
          picked from there is a request to see it on the map.
        */
        const kind =
          run.kind === "solar" || run.kind === "wind"
            ? "energy"
            : run.kind === "flood"
              ? "flood"
              : null
        const land = opts?.land ?? kind ?? "analysis"
        if (land === "map") goMap()
        else if (land === "energy") {
          goEnergy()
          setOpenEnergyResultNonce((n) => n + 1)
        } else if (land === "flood") {
          goFlood()
          setOpenFloodResultNonce((n) => n + 1)
        } else goAnalysis()
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
      goMap,
      goFlood,
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
    props.retainRun(props.result)
    clearAnalysisResults()
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

  /**
   * Starts a run of any product, from wherever the user is.
   *
   * The hub offered New classification and nothing else, while the application
   * produces four run kinds and a composition. A user in a project could reach
   * a classification in one click and everything else by navigating and
   * remembering which screen holds it.
   *
   * The three map products clear the session the same way -- the previous
   * result, overlay and AOI all belong to the run being replaced -- so they
   * share startNewClassification and differ only in the panel they open. Energy
   * defines its own AOI on its own screen and clears nothing here.
   */
  const startNewClassification = useCallback(() => {
    props.retainRun(props.result)
    clearAnalysisResults()
    props.setShowPredictionOverlay(true)
    props.setSwipeCompare(false)
    props.setSwipeRatio(0.5)
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

  /**
   * Starts a run of any product, from wherever the user is.
   *
   * The hub offered New classification and nothing else, while the application
   * produces four run kinds and a composition. A user in a project could reach
   * a classification in one click and everything else by navigating and
   * remembering which screen holds it.
   *
   * The three map products clear the session the same way -- the previous
   * result, overlay and AOI all belong to the run being replaced -- so they
   * share startNewClassification and differ only in the panel they open. Energy
   * defines its own AOI on its own screen and clears nothing here.
   */
  const startNewRun = useCallback(
    (product: MapToolId | "energy") => {
      if (product === "energy") {
        goEnergy()
        return
      }
      selectPanel(product)
      startNewClassification()
    },
    [goEnergy, startNewClassification]
  )

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
   * A polygon drawn on either map. Appended to the saved-AOI catalog so a
   * second draw does not throw the first away; the new entry becomes active.
   * Passing null clears the active shape only (catalog stays).
   */
  /**
   * The last shape this handler turned into a catalog entry.
   *
   * A REF, BECAUSE STATE CANNOT ANSWER THIS. The check below compares against
   * the active area, and when two reports of one drawing arrive in a single
   * React batch the second still sees the activeAoiId the first has not
   * committed yet -- so both create an entry, both name it from the same
   * `savedAois`, and the catalog gets two areas with one name between them.
   * That is exactly the pair reported. A ref is written synchronously and is
   * therefore the only thing that can see the first report from inside the
   * second.
   */
  const lastDrawnRef = useRef<string | null>(null)

  const handlePolygonDrawn = useCallback(
    (geom: GeoJSONGeometry | null) => {
      if (!geom) {
        lastDrawnRef.current = null
        props.setCustomPolygon(null)
        props.setActiveAoiId(undefined)
        props.setAnalysisLabel(undefined)
        return
      }
      /*
        THE SAME GROUND IS THE SAME AREA, so reporting it again does not make
        a second one.

        Belt to useAreaDrawing's braces. That hook now reports a finished
        polygon once, but it is not the only way in -- two map surfaces are
        mounted at a time and either can report -- and the cost of a stray
        second report is not a stray no-op: it is a catalog entry, named from
        whatever `savedAois` looked like when the batch started, so a pair of
        them arrive with one name between them.

        Compared by geometry rather than by identity: the value that comes back
        from the draw store is a fresh object every time and would never be the
        one already held.
      */
      const shape = JSON.stringify(geom)
      const active = props.savedAois.find((a) => a.id === props.activeAoiId)
      if (
        shape === lastDrawnRef.current ||
        (active && JSON.stringify(active.geometry) === shape)
      ) {
        props.setCustomPolygon(geom)
        props.setActiveExample("")
        if (active) props.setAnalysisLabel(active.name)
        return
      }
      lastDrawnRef.current = shape
      /*
        Retention is NOT done here. Setting `activeAoiId` below is what the
        effect beside `resultWithWater` watches, and it keeps the outgoing
        ground's work for every way of leaving it rather than for this one.
      */
      const entry = createSavedAoi(geom, props.savedAois)
      props.setSavedAois((prev) => [...prev, entry])
      props.setActiveAoiId(entry.id)
      props.setCustomPolygon(geom)
      props.setActiveExample("")
      props.setAnalysisLabel(entry.name)
      setComposition(null)
      setShowCompositionOverlay(true)
    },
    [
      props.savedAois,
      props.activeAoiId,
      props.setSavedAois,
      props.setActiveAoiId,
      props.setCustomPolygon,
      props.setActiveExample,
      props.setAnalysisLabel,
    ]
  )

  const activateSavedAoi = useCallback(
    (id: string) => {
      const entry = props.savedAois.find((a) => a.id === id)
      if (!entry) return
      props.setActiveAoiId(entry.id)
      props.setCustomPolygon(entry.geometry)
      props.setActiveExample("")
      props.setAnalysisLabel(entry.name)
      setComposition(null)
      setShowCompositionOverlay(true)
    },
    [
      props.savedAois,
      props.setActiveAoiId,
      props.setCustomPolygon,
      props.setActiveExample,
      props.setAnalysisLabel,
    ]
  )

  /** Put a run's stored polygon on the map without adding a catalog entry. */
  const adoptAreaGeometry = useCallback(
    (geom: GeoJSONGeometry | null) => {
      if (!geom) {
        props.setCustomPolygon(null)
        props.setActiveAoiId(undefined)
        props.setAnalysisLabel(undefined)
        return
      }
      props.setCustomPolygon(geom)
      props.setActiveExample("")
      props.setActiveAoiId(undefined)
      setComposition(null)
      setShowCompositionOverlay(true)
    },
    [
      props.setCustomPolygon,
      props.setActiveExample,
      props.setActiveAoiId,
      props.setAnalysisLabel,
    ]
  )

  const renameSavedAoi = useCallback(
    (id: string, name: string) => {
      const next = name.trim()
      if (!next) return
      props.setSavedAois((prev) =>
        prev.map((a) => (a.id === id ? { ...a, name: next } : a))
      )
      if (props.activeAoiId === id) props.setAnalysisLabel(next)
    },
    [props.setSavedAois, props.activeAoiId, props.setAnalysisLabel]
  )

  const deleteSavedAoi = useCallback(
    (id: string) => {
      props.setSavedAois((prev) => prev.filter((a) => a.id !== id))
      if (props.activeAoiId === id) {
        props.setCustomPolygon(null)
        props.setActiveAoiId(undefined)
        props.setAnalysisLabel(undefined)
      }
    },
    [
      props.setSavedAois,
      props.activeAoiId,
      props.setCustomPolygon,
      props.setActiveAoiId,
      props.setAnalysisLabel,
    ]
  )

  /** Persist the catalog whenever it changes (silent — no toast). */
  useEffect(() => {
    if (!prefs) return
    const extras = parsePreferenceExtras(prefs.extras_json)
    const sameAois =
      JSON.stringify(extras.saved_aois ?? []) === JSON.stringify(props.savedAois)
    const sameActive = (extras.active_aoi_id ?? undefined) === props.activeAoiId
    if (sameAois && sameActive) return
    void savePrefs(
      {
        ...prefs,
        extras_json: mergePreferenceExtras(prefs.extras_json, {
          saved_aois: props.savedAois,
          active_aoi_id: props.activeAoiId,
          aoi_label:
            props.savedAois.find((a) => a.id === props.activeAoiId)?.name ??
            extras.aoi_label,
        }),
      },
      { silent: true }
    ).catch(() => {})
  }, [props.savedAois, props.activeAoiId, prefs, savePrefs])

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
      //
      // THE SAME LIST APPEARS IN backToAnalysesList, WHICH CLEARS IT. A product
      // added to one and not the other is the defect flood shipped with: this
      // counted a loaded envelope, the clearing did not remove it, and the
      // detail view rebuilt itself from what the clearing left behind. Adding a
      // product here means adding it there.
      const r = solar.results
      const w = wind.result
      if (
        !props.result &&
        !water &&
        !r.resource &&
        !r.terrain &&
        !r.siting &&
        !r.energy &&
        !w &&
        !flood
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
        // Carried for the same reason as the rest: the analysis screen's data
        // views and the research pack read this one object, so a flood
        // envelope left out of it is a run whose tables cannot be exported
        // from the screen that lists it.
        flood,
      }
    },
    [props.result, water, solar.results, wind.result, flood]
  )

  /**
   * The merged result, readable from callbacks declared above this memo.
   *
   * `handlePolygonDrawn` retains the outgoing run and is defined earlier in
   * this component, so it cannot name `resultWithWater` in a dependency array
   * -- the array is evaluated while the binding is still in its temporal dead
   * zone. A ref is the idiom this file already uses for exactly that, and it
   * is the correct one here for a second reason: what is retained must be what
   * was on screen at the moment of the gesture, not what it was when the
   * callback was last rebuilt.
   */
  const retainableRef = useRef<PredictResult | null>(null)
  retainableRef.current = resultWithWater

  /*
    THE GROUND LEAVING IS WHAT TRIGGERS RETENTION, not any one gesture.

    Retaining was bolted to `startNewClassification` and `backToAnalysesList`,
    so every OTHER way of changing the active area lost the work on it: drawing
    a new one, pressing one in the catalog, adopting a run's geometry, opening
    a project. A reader clicking between two areas watched each one's rasters
    disappear as they arrived at the other, with only the outlines alternating.

    One effect instead of five call sites, and it catches the paths nobody has
    enumerated yet: what matters is that the active area STOPPED being what it
    was, not how.

    THE PAIR IS HELD IN A REF, which is what makes the capture correct. The
    products are cleared by the aoiSignature effects further down this file,
    and effects run in declaration order across renders -- so reading state
    here would be a race against them. The ref is written during render, so it
    always holds the result as it was while the previous area was still the
    active one.
  */
  const leavingRef = useRef<{
    id: string | undefined
    result: PredictResult | null
  }>({ id: undefined, result: null })
  useEffect(() => {
    const leaving = leavingRef.current
    leavingRef.current = { id: props.activeAoiId, result: resultWithWater }
    if (!leaving.id || leaving.id === props.activeAoiId) return
    props.retainRun(leaving.result, leaving.id)
  }, [props.activeAoiId, resultWithWater, props.retainRun])

  /**
   * The hub, from wherever the click came from.
   *
   * ONE CALLBACK FOR EVERY CONTROL THAT SAYS "project hub". It was written
   * inline on the navigation column, and the project switcher's own item went
   * on calling `goAnalysis()` directly -- so the same destination had two
   * implementations, one of which had the fix and one of which did not. That is
   * the shape of the defect this replaced, restated one control over: the
   * detail header's "Saved analyses" already cleared the payload and the
   * navigation column did not.
   *
   * `screen === "analysis"` is deliberately not the test. It assumed arriving
   * at the analysis screen from anywhere else lands on the hub, and it does
   * not: that screen picks between the hub and the detail view by whether a
   * result exists, so a run still loaded from an earlier visit captures the
   * destination and draws its own detail page. For solar and wind that page is
   * now empty, their sections having moved to the energy screen, so the button
   * appeared to lead nowhere.
   *
   * Tested on the payload the page is actually showing rather than on the
   * classification: a water or solar run has no classification and would
   * otherwise leave the list unreachable.
   *
   * Clearing costs nothing unrecoverable. `retainRun` holds the outgoing
   * classification for the board, and the run itself is in the store, reachable
   * from the hub this opens.
   */
  const openProjectHub = useCallback(() => {
    if (resultWithWater) backToAnalysesList()
    else goAnalysis()
  }, [resultWithWater, backToAnalysesList, goAnalysis])

  /**
   * Go to a destination from the dock layout's bar.
   *
   * Written here because navigating is two moves that live at this level: the
   * screen, which is in the auth context, and the sub-tab, which is the state
   * just above. The navigation table in lib/navigation carries the structure
   * and deliberately not this, so the table cannot reach into either.
   *
   * MOVED DOWN to sit beside `openProjectHub`, which it now calls. It read
   * `goAnalysis()` directly, and `NAV_GROUPS` labels that destination "Project
   * hub" -- so this was the third control carrying that label, and the second
   * of the three that did not have the fix. Its own dependencies were all
   * declared far above; what it could not reach from where it was is
   * `resultWithWater`, and reaching it is the whole correction.
   */
  const navigateTo = useCallback(
    (groupId: string, itemId?: string) => {
      if (groupId === "energy") {
        if (itemId) setEnergyTab(itemId as EnergyTab)
        goEnergy()
      } else if (groupId === "flood") {
        goFlood()
      } else if (groupId === "analysis") {
        openProjectHub()
      } else {
        if (itemId) selectPanel(itemId as MapToolId)
        goMap()
      }
    },
    [goEnergy, goFlood, openProjectHub, goMap]
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
        /*
          Handed back so the map screen can portal its whiteboard toggle up
          here. What App holds is WHERE the button goes; whether the board is
          open stays in the screen, which is the only place it can stay without
          surviving a trip to another screen.
        */
        boardSlotRef={setBoardSlotHost}
        boardOpen={boardOpen}
        result={props.result}
        runLabel={currentRunLabel}
        layoutMode={layoutMode}
        onLayoutModeChange={changeLayoutMode}
        credit={credit}
        /*
          Wherever a run is filed under the active project. The energy handlers
          send project_id exactly as the classification ones do, so a solar or
          wind run lands in a project the energy screen never named and offered
          no way to change -- the user could only discover it afterwards, in the
          hub.

          Not on the project hub itself, which selects a project as its whole
          purpose, and not on settings or sign-in, which have no project.
        */
        projectSwitcher={
          screen === "map" || screen === "energy" || screen === "flood" ? (
            <ProjectSwitcher
              projects={projects}
              activeProjectId={activeProjectId}
              runs={runs}
              whiteboards={whiteboards}
              onOpenWhiteboard={(b) => void handleOpenWhiteboard(b)}
              onMenuOpen={() => void refreshWhiteboards()}
              busy={loadingRun}
              onSelect={(id) => void activateProject(id)}
              onCreate={() => void handleCreateProjectFromAoi()}
              onOpenRun={(run) => {
                void (async () => {
                  /*
                    The header must not name one project while the map shows a
                    run belonging to another, and picking a run inside a
                    project's own list is as clear a statement of which project
                    is meant as clicking its name.

                    Not user-initiated: that draws the project's AOI and flies
                    to it, which is exactly what the run about to load is going
                    to replace. This sets the context and lets the run draw.
                  */
                  if (run.project_id && run.project_id !== activeProjectId) {
                    await activateProject(run.project_id, {
                      userInitiated: false,
                    })
                  }
                  await openSavedAnalysis(run, { land: "map" })
                })()
              }}
              onOpenHub={openProjectHub}
            />
          ) : undefined
        }
      />

      <div className="flex min-h-0 flex-1">
        {/*
          The dock layout replaces this column with surfaces inside the map, so
          it is withheld on the three screens that draw one. The project hub and
          settings keep it: they have no map to put a bar over, and hiding it
          there would leave them with no navigation at all.

          The column is in flow, not floating, so omitting it returns 13.5rem
          of width to the stage and the map fills it without being told.
        */}
        <AnimatePresence initial={false}>
          {(layoutMode === "docked" ||
            (screen !== "map" &&
              screen !== "energy" &&
              screen !== "flood")) && (
            <AppNav
              key="app-nav"
              hasAnalysis={!!props.result || runs.length > 0}
              onAnalysisClick={openProjectHub}
              energyTab={energyTab}
              onEnergyTabChange={setEnergyTab}
            />
          )}
        </AnimatePresence>
        <div className="relative min-h-0 min-w-0 flex-1">
          {/*
            NOT mode="wait". Under it the leaving screen has to finish its exit
            before the arriving one is allowed to mount, so every change of
            screen was 240ms of an empty stage followed by the mount -- and the
            mount is the expensive half, since a screen here builds a map, its
            overlays and sometimes the studio. Serialised by construction, and
            felt as the transition being slow rather than as the animation being
            long.

            Without it the two overlap. They are both `absolute inset-0`, so
            overlapping is what the layout already expects, and the arriving
            screen starts building at the moment it is asked for.
          */}
          <AnimatePresence initial={false}>
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
                  retainedRuns={props.retainedRuns}
                  onDropRetainedRun={props.onDropRetainedRun}
                  onCreditChange={setCredit}
                  titleBarSlot={boardSlotHost}
                  onBoardOpenChange={setBoardOpen}
                  /*
                    The two solar rasters, so the board can lift them like any
                    other. The energy screen keeps drawing them on its own map;
                    this is the same store read by a second surface, not a copy.
                  */
                  solarTerrain={solar.results.terrain}
                  solarSiting={solar.results.siting}
                  showSolarTerrain={solar.layers.showTerrain}
                  showSolarSiting={solar.layers.showSiting}
                  solarTerrainOpacity={solar.layers.terrainOpacity}
                  solarSitingOpacity={solar.layers.sitingOpacity}
                  onSolarLayerChange={setSolarBoardLayer}
                  /*
                    And the inputs, so the board can start a solar run rather
                    than only draw one somebody else started. The same store the
                    energy screen edits -- a second copy would let the two
                    disagree about what the next run will compute.
                  */
                  solarParams={solar.params}
                  onSolarParamsChange={setSolarParams}
                  onRunSolar={(product) => {
                    if (product === "terrain") void handleRunSolarTerrain()
                    else void handleRunSolarSiting()
                  }}
                  // Any solar product blocks the rest: one sidecar run at a time.
                  solarBusy={solar.run.active !== null}
                  solarProgress={solar.run.progress}
                  solarProgressMsg={solar.run.message}
                  initialView={initialMapView}
                  layoutMode={layoutMode}
                  onLayoutModeChange={changeLayoutMode}
                  onNavigate={navigateTo}
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
                  onAdoptAreaGeometry={adoptAreaGeometry}
                  savedAois={props.savedAois}
                  activeAoiId={props.activeAoiId}
                  onActivateSavedAoi={activateSavedAoi}
                  onRenameSavedAoi={renameSavedAoi}
                  onDeleteSavedAoi={deleteSavedAoi}
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
                  compositionGallery={scopedCompositions}
                  onSelectComposition={(id) => {
                    const hit = scopedCompositions.find((c) => c.id === id)
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
                  openBoardNonce={openBoardNonce}
                  /*
                    The saved boards, and the way back into one.

                    Offered inside the studio as well as in the project menu:
                    the studio's own title block names the board that is loaded,
                    and a name that cannot be changed from where it is shown is
                    a readout pretending to be a control.
                  */
                  whiteboards={whiteboards}
                  onOpenWhiteboard={(b) => void handleOpenWhiteboard(b)}
                  onWhiteboardsMenu={refreshWhiteboards}
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
                <Suspense fallback={<ScreenLoading />}>
                <EnergyScreen
                  onCreditChange={setCredit}
                  layoutMode={layoutMode}
                  onNavigate={navigateTo}
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
                  openResultNonce={openEnergyResultNonce}
                  onLocationSelect={(lat, lon) =>
                    props.setFlyTo({ lat, lon, key: Date.now() })
                  }
                  hasArea={props.hasArea}
                  areas={props.areas}
                  activeExample={props.activeExample}
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
                </Suspense>
              </motion.div>
            )}

            {screen === "flood" && (
              <motion.div
                key="screen-flood"
                className="absolute inset-0 min-h-0"
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                <Suspense fallback={<ScreenLoading />}>
                <FloodScreen
                  layoutMode={layoutMode}
                  onNavigate={navigateTo}
                  params={floodParams}
                  onParamsChange={setFloodParamsPatch}
                  result={flood}
                  onClearResult={() => setFlood(null)}
                  run={floodRun}
                  onRun={() => void handleRunFlood()}
                  openResultNonce={openFloodResultNonce}
                  onCreditChange={setCredit}
                  onLocationSelect={(lat, lon) =>
                    props.setFlyTo({ lat, lon, key: Date.now() })
                  }
                  hasArea={props.hasArea}
                  areas={props.areas}
                  activeExample={props.activeExample}
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
                  // The same live ref and the same debounced map_view the map
                  // and energy screens use, so panning here and returning
                  // there lands in the same place.
                  initialView={initialMapView}
                  onViewChange={handleViewChange}
                  flyTo={props.flyTo}
                />
                </Suspense>
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
                <Suspense fallback={<ScreenLoading />}>
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
                  onStartRun={startNewRun}
                  onAreaLabelChange={(label) => {
                    void applyAoiRename(label)
                  }}
                  onActivateProject={(id) => void activateProject(id)}
                  onShowComposition={showCompositionFromHub}
                  activeProjectId={activeProjectId}
                />
                </Suspense>
              </motion.div>
            )}
          </AnimatePresence>
          {screen === "auth" && <AuthPage />}
          {screen === "profile" && (
            <ProfilePage loadingRun={loadingRun} onOpenRun={openSavedAnalysis} />
          )}
        </div>
      </div>
      {/* TEMPORARY: accent lab. Delete this line and AccentLab.tsx. */}
      {import.meta.env.DEV && <AccentLab />}
    </div>
  )
}

export default App
