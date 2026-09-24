import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SCREEN } from "@/lib/motion"
import type { Dispatch, SetStateAction } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
  TELEMETRY_DEFAULT,
  setStudioTelemetry,
} from "@/lib/studioTelemetry"
import { setStudioGutter } from "@/lib/studioGutter"
import { notifyError, notifyInfo, notifySuccess } from "@/lib/notify"
import type { EditorId } from "@/lib/studioEditors"
import type { Studio } from "@/lib/studios"
import { listStudios, openStudio, saveStudio } from "@/lib/studios"
import {
  clearBoardMemory,
  onBoardDirtyChange,
  readBoardMemory,
  restoreBoard,
  snapshotBoard,
  writeBoardMemory,
} from "@/components/studio/boardMemory"
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
  SetProjectLastArea,
  ListAreas,
  CreateArea,
  UpdateArea,
  DeleteArea,
  AnalyzeWater,
  AnalyzeMinerals,
  GetEarthdataStatus,
  SetBoardDirty,
} from "../wailsjs/go/main/App"
import { EventsOn, EventsOff } from "../wailsjs/runtime/runtime"
import type {
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
  SaveProjectOverlayRequest,
  WaterAnalysis,
  WaterIndex,
  WaterRequest,
  MineralAnalysis,
  MineralRequest,
} from "@/lib/types"
import {
  parsePreferenceExtras,
} from "@/lib/preferenceExtras"
import { makeRunLabel, resolveAoiDisplayLabel, aoiLabelFromRunSummary } from "@/lib/aoiLabel"
import {
  projectOverlayToComposition,
  scopeCompositionsToView,
} from "@/lib/projectOverlays"
import {
  geometryBounds,
  geometryCentroid,
} from "@/lib/geometry"
import { resolveCompositionMeta } from "@/lib/compositeCatalog"
import {
  DEFAULT_AOI_CONTOUR_SCHEME,
  type AoiContourSchemeId,
} from "@/lib/aoiStyle"
import { AuthProvider, useAuth } from "@/lib/auth"
import { toArea, toAreas, type Area } from "@/lib/areas"

import { ThemeSync } from "@/components/ThemeSync"
import { TitleBar } from "@/components/TitleBar"
import { OperatorHost } from "@/components/OperatorHost"
import { ProjectFileHost } from "@/components/ProjectFileHost"
import { SplashScreen } from "@/components/SplashScreen"
import { WhatsNewGate } from "@/components/WhatsNewGate"
import { StudioScreen } from "@/pages/StudioScreen"
import type { BasemapKind } from "@/lib/basemaps"
import { AuthPage } from "@/pages/AuthPage"
import { ProfilePage } from "@/pages/ProfilePage"

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
 * Water needs no classification, so it can be the only product an AOI
 * carries. The analysis view keys "is there a classification" off n_dates and the overlay
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
      const features = (parsed as { features?: { geometry?: GeoJSONGeometry }[] }).features
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

function App() {
  const period = useMemo(defaultPeriod, [])
  const [customPolygon, setCustomPolygon] = useState<GeoJSONGeometry | null>(null)
  const [areas, setAreas] = useState<Area[]>([])
  const [activeAreaId, setActiveAreaId] = useState<string | undefined>()
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
      r.mineral?.run_id ||
      r.overlay_uri ||
      null
    )
  }, [])

  const retainRun = useCallback((
    outgoing: PredictResult | null,
    /**
     * The board's own id for the ground this run was over.
     *
     * THREE IDENTITIES HAD TO BE MADE ONE. The board keys its live area by the
     * GROUND -- `liveAreaId` returns the area id whenever it knows it -- while
     * `runId` reaching it is `result.run_id || "current"`, which every product
     * but the classification then left on the sentinel, and this function
     * keyed what it kept by the run. Three names for one area, so the retained
     * entry and the area it came from could never find each other: the entry appeared in the data
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

      This used to read: "a result with no classification is a standalone
      payload the board reads from its own fields; nothing of it belongs to a
      scene." That was true of the LIVE area and of nothing else. The board
      reads the standalone products from its own props only while the map is
      still on that ground; the moment the AOI moves, the aoiSignature effects
      clear them and the props go empty. Such a run left the board the instant
      a new area was drawn, and there was nothing to bring it back because it
      had never been retained.

      The board was already able to draw one: `legendByArea` in BoardSurface
      builds a retained area's legends from `result.water` -- a field that
      exists on every result. What was missing was a result reaching it.

      So the test is whether the outgoing run produced ANYTHING. A result with
      none of these is an empty shell from a run that never finished, and that
      is the only case worth dropping.
    */
    const carries =
      !!outgoing &&
      (!!outgoing.class_stats?.length ||
        !!outgoing.overlay_uri ||
        !!outgoing.water ||
        !!outgoing.mineral)
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
      */
      const id =
        areaId?.trim() ||
        outgoing.run_id ||
        outgoing.water?.run_id ||
        outgoing.mineral?.run_id ||
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
      /*
        Into a module rather than into state: the readers are the studio's
        status bar and the scene, and the scene is not React. Seeded here
        because this is where preferences arrive, and absent means none --
        which is what a reader who has never opened the setting should get.
      */
      setStudioTelemetry(extras.studio_telemetry ?? TELEMETRY_DEFAULT)
      // Same reason, and the same shape: the readers are the area tree, the
      // areas themselves and a keydown handler outside React.
      setStudioGutter(extras.studio_panel_gap)
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
      // Match the .splash--exit transition in splash.css (~480ms).
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

  const hasArea = !!customPolygon

  const clearArea = () => {
    setCustomPolygon(null)
    setAnalysisLabel(undefined)
    setActiveAreaId(undefined)
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
            customPolygon={customPolygon}
            areas={areas}
            activeAreaId={activeAreaId}
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
            setAreas={setAreas}
            setActiveAreaId={setActiveAreaId}
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
          />
        </div>
      )}
    </AuthProvider>
  )
}

function AppBody(props: {
  customPolygon: GeoJSONGeometry | null
  areas: Area[]
  activeAreaId?: string
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
  setAreas: Dispatch<SetStateAction<Area[]>>
  setActiveAreaId: (id: string | undefined) => void
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
}) {
  const {
    user,
    refreshRuns,
    refreshProjects,
    screen,
    goStudio,
    goProfile,
    projects,
    prefs,
    savePrefs,
  } = useAuth()
  const [loadingRun, setLoadingRun] = useState(false)

  /*
    The board's unsaved state, told to the shell as it changes, so a close or
    Cmd-Q that would discard it is asked about first -- see beforeClose in
    app_studios.go. Here rather than in the board, which unmounts on every
    trip to Settings while what it holds does not.
  */
  useEffect(
    () => onBoardDirtyChange((dirty) => void SetBoardDirty(dirty).catch(() => {})),
    []
  )

  /**
   * Saved studios, and the request to open one.
   *
   * The nonce is how the map screen is told to open its board: the board's
   * open state is that screen's, and a boolean would only fire the first time
   * -- opening the same studio twice in a row has to work.
   */
  const [studios, setStudios] = useState<Studio[]>([])
  const [openBoardNonce, setOpenBoardNonce] = useState(0)
  /*
    The mineral map and its run status, held here rather than in the screen,
    which unmounts on every navigation away. Plain state rather than a
    reducer: one product with one result, so there is no second consumer to
    keep in step. Its progress has a channel of its own below, so a mineral
    run's messages do not land under the classification's button.
  */
  /*
    The editor a just-finished run needs on screen, consumed once.

    A request rather than a command: the board owns its tree and decides
    whether this is already satisfied. Cleared as soon as it is honoured, so a
    run cannot rearrange a board long after it finished.
  */
  const [reveal, setReveal] = useState<EditorId | null>(null)
  const [mineral, setMineral] = useState<MineralAnalysis | null>(null)
  const [mineralRun, setMineralRun] = useState({
    active: false,
    progress: 0,
    message: "",
  })
  /*
    THE OUTCOME OF THE LAST RUN, AND THE VALUES IT WAS MADE FROM.

    Every handler below already knows how its run ended -- it says so in a
    toast -- and until this existed the toast was the only place that answer
    went. A toast is gone in seconds and the raster it was about stays on the
    map, so nothing on screen could say WHICH of the values the board is
    holding that raster is an answer about. The board's wires say it now, and
    this is what they read.

    ONE OUTCOME FOR THE APPLICATION, because there is one run: the sidecar
    takes a single analysis at a time and every branch that starts one enforces
    it. What tells two runs apart is not a key but the inputs recorded beside
    the outcome -- change the product, or the period, and the wire carrying
    that value falls back to pending on its own, because the value it carries
    is one of the values compared.

    DECLARED HERE, ahead of every handler that settles it, rather than beside
    the run state further down: a handler defined above a `const` can call it
    at run time, and this file has already been bitten once by reading a
    binding in its temporal dead zone. See `retainableRef` for that note.
  */
  const boardInputs = useRef<Record<string, string>>({})
  const [lastBoardRun, setLastBoardRun] = useState<{
    ok: boolean
    inputs: Record<string, string>
  } | null>(null)
  const settleRun = useCallback((ok: boolean) => {
    setLastBoardRun({ ok, inputs: boardInputs.current })
  }, [])
  /* What the board's cards supply, kept current so a settle can record it. */
  const onBoardInputs = useCallback((inputs: Record<string, string>) => {
    boardInputs.current = inputs
  }, [])

  /*
    Whether the studio's board is up, mirrored here for the title bar.

    It is always true while the studio screen is mounted -- the board is the
    screen now -- and false everywhere else, which is what the bar reads to
    decide whether the map's own telemetry has anything to describe.
  */
  const [boardOpen, setBoardOpen] = useState(false)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)

  /*
    The boards of the open project.

    SCOPED, because the menu offered every board ever saved regardless of which
    project was open -- which is how a board came to hold runs from several. It
    reloads when the project changes for the same reason: a menu left showing
    the previous project's boards is the same offer by a slower route.

    With no project open there is no menu to fill. Listing everything there
    would put the boards of every project in front of a reader who has said
    nothing about which one they mean.
  */
  const refreshStudios = useCallback(async () => {
    if (!activeProjectId) {
      setStudios([])
      return
    }
    try {
      setStudios(await listStudios(activeProjectId))
    } catch {
      // A board list that cannot be read is an empty menu section, not an
      // error in front of whatever the user was actually doing.
    }
  }, [activeProjectId])
  useEffect(() => {
    void refreshStudios()
  }, [refreshStudios])

  /**
   * Put these runs on the board and show it.
   *
   * NAMED RATHER THAN NEW. This is exactly what opening a saved studio has
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
      goStudio()
      setOpenBoardNonce((n) => n + 1)
    },
    [goStudio]
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
  /*
    The ground the map is leaving, and what was on it.

    DECLARED HERE, ABOVE THE TWO HANDLERS THAT HAVE TO CLEAR IT. Its effect is
    further down, beside the state it reads; this is only the cell. See
    handleOpenStudio for what goes wrong when a studio switch reaches that
    effect with the cell still full.
  */
  const leavingRef = useRef<{
    id: string | undefined
    result: PredictResult | null
  }>({ id: undefined, result: null })
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
   * Held here rather than inside StudioScreen because that screen unmounts on
   * every navigation away, so local state reset the dock to the classification
   * panel on every return.
   */
  /**
   * Which map layout is drawn.
   *
   * Read in exactly two places -- here, to decide whether the navigation column
   * is rendered, and inside StudioScreen -- which are a parent and its direct
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
  /**
   * Title of the run whose result is on screen, for the title bar.
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
   * Name a run about to be sent.
   *
   * It also held the name in state, so the title bar could print it beside the
   * wordmark. Nothing reads it now: a run is named where it is listed, which is
   * the browser and the outliner, and the bar was stating the same fact a third
   * time over whichever surface happened to be up.
   *
   * Still one call rather than a bare `makeRunLabel` at each site: it stamps
   * the current time, so calling it twice for one run yields two labels a
   * second apart, and the label sent is the label saved.
   */
  const nameThisRun = useCallback(
    (aoiHint?: string | null): string => makeRunLabel(aoiHint),
    []
  )
  const [dataCubeOpen, setDataCubeOpen] = useState(false)
  const [dataCubeLoading, setDataCubeLoading] = useState(false)
  const [dataCubeError, setDataCubeError] = useState<string | null>(null)
  const [dataCubeResult, setDataCubeResult] = useState<DataCubeResult | null>(null)

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
    const b = geometryBounds(props.customPolygon)
    return b
      ? {
          lon_min: b.lonMin,
          lat_min: b.latMin,
          lon_max: b.lonMax,
          lat_max: b.latMax,
        }
      : null
  }, [props.customPolygon])

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

  /*
    Every result the screens can be holding, dropped together.

    ONE PLACE BECAUSE A PARTIAL COPY HAS ALREADY COST US ONE. The comment this
    replaces recorded it: a standalone product was added to `resultWithWater`
    and not to the clearing, so the two disagreed about what a standalone
    product is -- the payload counted the loaded result, the clearing did not
    remove it, and the detail view rebuilt itself from that result the moment
    the reader asked for the list. The list was then unreachable for the rest
    of the session.

    A third caller was about to be written with the same shape and the same
    chance of missing one, which is what turned three copies into this.

    THE RETAIN IS NOT HERE. Two callers keep the run they are leaving so the
    board can still show it; one does not, because it is leaving the project
    that run belongs to. That is a decision about the caller's subject rather
    than about what a result is, so it stays with them.
  */
  const clearAnalysisResults = useCallback(() => {
    props.setResult(null)
    setCurrentRunId(null)
    setWater(null)
    setMineral(null)
  }, [props.setResult])

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
        the live area from it and from `activeAreaId`; carrying both across meant
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
        props.setActiveAreaId(undefined)
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
        /*
          THE GROUND THE READER WAS LAST ON, not the project's own shape.

          A project used to carry one polygon and one label, written from
          whatever was on the map, and opening it put that back. A project
          working several fields therefore always reopened on one of them, and
          which one depended on the order things had been done in. It carries a
          cursor now -- last_area_id -- into the areas it owns.

          An id that resolves to nothing is treated as no cursor: an area
          deleted since has DeleteArea clear this column, so the only way to
          reach that is a row that never existed, and reopening on nothing is
          the honest answer to it.
        */
        const rows = await ListAreas(id)
        const opened = toAreas(rows)
        const resume =
          opened.find((a) => a.id === p.last_area_id) ?? opened[0] ?? null
        if (userInitiated && resume) {
          props.setActiveAreaId(resume.id)
          props.setCustomPolygon(resume.geometry)
          props.setAnalysisLabel(resume.name)
          void persistAoiLabel(resume.name)
          const centroid = geometryCentroid(resume.geometry)
          if (centroid) {
            props.setFlyTo({
              lat: centroid[1],
              lon: centroid[0],
              key: Date.now(),
            })
          }
        } else if (userInitiated) {
          /*
            A PROJECT WITH NO GROUND YET OPENS ON NO GROUND.

            The branch above replaces the drawing when the project being opened
            has one to resume on, so the case that was never handled is the
            project that has none: the previous project's outline stayed on the
            map, over a field the opened project does not own, and a run made
            there was filed against it. The clear above this only dropped the
            catalogued id -- the shape itself was left drawn, which is the half
            a reader can see.
          */
          props.setCustomPolygon(null)
          props.setAnalysisLabel(undefined)
          void persistAoiLabel(null)
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
        // From the ground being resumed on, not from the branch above, which
        // only runs when the user asked for this.
        const openedAoi = resume ? geometryBounds(resume.geometry) : null
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
      props.setActiveAreaId,
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
    if (!props.customPolygon) {
      notifyError("Draw an area on the map first.")
      return
    }
    const req: DataCubeRequest = {
      polygon_geojson: props.customPolygon,
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
    if (!props.customPolygon) {
      notifyError("Define an area first.")
      return
    }
    const req: CompositeRequest = {
      polygon_geojson: props.customPolygon,
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
        /*
          Both, as the saved row carries them. The entry in hand used to carry
          neither, so the board could not tell it from a composition of another
          field until the project was reopened -- and a composition with no run
          made over this area was listed only while it was the one on the map.
        */
        runId: currentRunId ?? undefined,
        areaId: props.activeAreaId,
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
            // And the ground, which is what files one made with no run open.
            area_id: props.activeAreaId ?? "",
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
      settleRun(true)
    } catch (e) {
      settleRun(false)
      notifyError("Composition error", e)
    } finally {
      setComposeRunning(false)
    }
  }

  /**
   * Identity of the AOI currently on the map. Changes whenever the drawn
   * polygon changes.
   */
  const aoiSignature = useMemo(
    () => (props.customPolygon ? `poly:${JSON.stringify(props.customPolygon)}` : ""),
    [props.customPolygon]
  )

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

  /** The AOI the mineral map on screen was identified over. */
  const mineralAoiRef = useRef<string>("")

  /*
    The same for the mineral map: its class rasters are placed on the extent
    of the area they were identified over, and every figure in its reading is
    over that area, so once the AOI moves both describe other ground.
  */
  useEffect(() => {
    if (!mineral) return
    if (aoiSignature === mineralAoiRef.current) return
    setMineral(null)
  }, [aoiSignature, mineral])

  /**
   * The sidecar's progress channel, and the two displays that read it.
   *
   * The sidecar emits on a single event and runs one action at a time, so the
   * run in progress decides which display receives it: the mineral map's own
   * while one is running, the shared display otherwise. One display for both
   * would put a mineral run's messages under the classification's button.
   *
   * Read through refs so the subscription is registered once: re-registering on
   * every run state change would drop events emitted between the unsubscribe
   * and the resubscribe. A progress of -1 means "message only, percentage
   * unchanged", which is why the percentage is set only when it is not
   * negative. The mineral map's is mirrored in mineralSeenRef rather than read
   * back from its state, because several such lines can arrive in one React
   * batch and a value read from state would be from before the batch;
   * handleRunMinerals resets the mirror, so a second run cannot open on the
   * previous run's percentage.
   */
  const mineralRunRef = useRef(mineralRun)
  mineralRunRef.current = mineralRun
  const mineralSeenRef = useRef({ progress: 0, message: "" })
  const setProgressRef = useRef(props.setProgress)
  setProgressRef.current = props.setProgress
  const setProgressMsgRef = useRef(props.setProgressMsg)
  setProgressMsgRef.current = props.setProgressMsg

  useEffect(() => {
    EventsOn("predict:progress", (ev: ProgressEvent) => {
      if (mineralRunRef.current.active) {
        const seen = mineralSeenRef.current
        if (ev.progress >= 0) seen.progress = ev.progress
        if (ev.msg) seen.message = ev.msg
        setMineralRun({
          active: true,
          progress: seen.progress,
          message: seen.message,
        })
        return
      }
      if (ev.progress >= 0) setProgressRef.current(ev.progress)
      if (ev.msg) setProgressMsgRef.current(ev.msg)
    })
    return () => EventsOff("predict:progress")
  }, [])

  const handleRunWater = async () => {
    if (!props.start || !props.end) {
      notifyError("Set the acquisition period.")
      return
    }
    if (!props.customPolygon) {
      notifyError("Draw an area on the map first.")
      return
    }
    setWaterRunning(true)
    // The sidecar emits on the shared predict:progress channel and only one
    // action runs at a time, so the panel reads the shared progress.
    props.setProgress(0)
    props.setProgressMsg("starting")
    try {
      const aoiLabel = props.analysisLabel?.trim() || "Custom AOI"
      const req: WaterRequest = {
        polygon_geojson: props.customPolygon,
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
        area_id: props.activeAreaId,
        project_id: activeProjectId || undefined,
      }
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
      settleRun(true)
    } catch (e) {
      settleRun(false)
      notifyError("Surface water error", e)
    } finally {
      setWaterRunning(false)
      props.setProgress(0)
      props.setProgressMsg("")
    }
  }

  /*
    The mineral map over the drawn area and the period.

    THE TOKEN IS ASKED FOR BEFORE THE RUN, not discovered by it. Every EMIT
    read goes through NASA Earthdata, and without a token the sidecar is
    refused on its first read -- after a CMR search it has already waited for.
    Asking the Go side here costs a file read and turns that failure into a
    sentence naming where the token is set. The status is read on each run
    rather than cached, so a token saved in Settings a moment ago applies.

    The cloud ceiling is the period card's own, because that is the value the
    reader sees beside the dates; the sidecar applies it per pass. max_scenes
    is left at 0, which the sidecar reads as its default of 3.
  */
  const handleRunMinerals = async () => {
    if (!props.customPolygon) {
      notifyError("Draw an area on the map first.")
      return
    }
    if (!props.start || !props.end) {
      notifyError("Set the acquisition period.")
      return
    }
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
    mineralSeenRef.current = { progress: 0, message: "starting" }
    setMineralRun({ active: true, progress: 0, message: "starting" })
    const runAoi = aoiSignature
    try {
      const aoiLabel = props.analysisLabel?.trim() || "Custom AOI"
      const req: MineralRequest = {
        polygon_geojson: props.customPolygon,
        start: props.start,
        end: props.end,
        // Zero: the sidecar's ceiling of 100%, not the period card's value.
        // That value is chosen for Sentinel-2 scenes; an EMIT pass is scored
        // for cloud over its whole ~75 km scene, and over the humid tropics
        // every pass exceeds a typical card value while the area itself may be
        // clear. Passes are read least cloudy first and cloud is excluded per
        // cell by the EMIT mask.
        max_cloud: 0,
        max_scenes: 0,
        label: aoiLabel,
        run_label: nameThisRun(aoiLabel),
        area_id: props.activeAreaId,
        project_id: activeProjectId || undefined,
      }
      const res = (await AnalyzeMinerals(req as never)) as unknown as MineralAnalysis
      // Recorded before the result, so the invalidation effect above compares
      // against the AOI this run was made on rather than dropping the map it
      // has just been handed.
      mineralAoiRef.current = runAoi
      setCurrentRunId(res.run_id || null)
      setMineral(res)
      setReveal("mineralReading")
      // The observed area travels with the identified one, here as in the
      // reading: over vegetated ground most of an area has no mineral answer.
      const identified = res.groups
        .map((g) => `group ${g.group} ${g.detected_area_ha.toFixed(1)} ha`)
        .join(", ")
      notifySuccess(
        `Mineral map: ${identified || "no group reported"} identified over ` +
          `${res.observed_area_ha.toFixed(1)} of ${res.aoi_area_ha.toFixed(1)} ha observed, ` +
          `${res.scenes.length} EMIT ${res.scenes.length === 1 ? "pass" : "passes"}` +
          `${res.run_id ? " (saved)" : ""}.`
      )
      void refreshRuns()
      void refreshProjects()
      settleRun(true)
    } catch (e) {
      settleRun(false)
      notifyError("Mineral map error", e)
    } finally {
      setMineralRun({ active: false, progress: 0, message: "" })
    }
  }

  const handleViewDataCube = async () => {
    if (!props.start || !props.end) {
      notifyError("Set the acquisition period.")
      return
    }
    if (!props.customPolygon) {
      notifyError("Draw an area on the map first.")
      return
    }
    const req: DataCubeRequest = {
      polygon_geojson: props.customPolygon,
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
    if (!props.customPolygon) {
      notifyError("Draw an area on the map first.")
      return
    }
    props.setRunning(true)
    props.setProgress(0)
    props.setProgressMsg("iniciando")
    // Before the slot is emptied, and before the request is built: a run that
    // fails now costs the reader nothing, where it used to cost them the map.
    props.retainRun(props.result)
    props.setResult(null)
    const aoiLabel = props.analysisLabel?.trim() || "Custom AOI"
    const req: PredictRequest = {
      polygon_geojson: props.customPolygon,
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
      area_id: props.activeAreaId,
    }
    try {
      const res = (await Predict(req as never)) as unknown as PredictResult
      props.setResult(res)
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
      props.setShowPredictionOverlay(true)
      if (!props.analysisLabel?.trim()) {
        props.setAnalysisLabel(req.label)
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
      settleRun(true)
    } catch (e) {
      settleRun(false)
      notifyError("Inference error", e)
    } finally {
      props.setRunning(false)
    }
  }

  const handleAnalyzeLULC = async () => {
    if (!props.customPolygon) {
      notifyError("Draw an area on the map first.")
      return
    }
    props.setLulcRunning(true)
    props.setProgress(0)
    props.setProgressMsg("fetching MapBiomas COG")
    try {
      const lulc = (await AnalyzeLULC({
        polygon_geojson: props.customPolygon,
      } as never)) as unknown as LULCAnalysis
      if (!props.analysisLabel?.trim()) {
        const label = "Custom AOI"
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
      notifySuccess("Land cover / land use ready on map.")
      goStudio()
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
    async (run: InferenceRun) => {
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
        props.setResult(isClassification ? res : null)
        setCurrentRunId(run.id)
        props.setShowPredictionOverlay(true)
        if (isModelKind(run.model_kind)) props.setModelKind(run.model_kind)
        const extras = parsePreferenceExtras(prefs?.extras_json)
        // The ground the run was measured on names it, where the project's own
        // AOI label used to. A run of a ground in another project resolves to
        // nothing here and falls through to what its summary froze at predict.
        const runArea = props.areas.find((a) => a.id === run.area_id)
        const displayLabel = resolveAoiDisplayLabel({
          analysisLabel: props.analysisLabel,
          areaName: runArea?.name,
          prefsAoiLabel: extras.aoi_label,
          summaryAoiLabel: aoiLabelFromRunSummary(run.summary),
        })
        props.setAnalysisLabel(displayLabel)
        if (displayLabel) void persistAoiLabel(displayLabel)
        const polygon = parseRunPolygon(run.polygon_geojson)
        props.setCustomPolygon(polygon)
        // A water run carries its raster in the same field a live run
        // uses, so opening one puts the overlay back on the map. The AOI it was
        // measured on is recorded first, otherwise the invalidation effect sees
        // a mismatch and drops the raster that was just restored.
        const restoredAoi = polygon ? `poly:${JSON.stringify(polygon)}` : ""
        if (res.water) {
          waterAoiRef.current = restoredAoi
          setWater(res.water)
          setShowWaterOverlay(true)
        } else {
          setWater(null)
        }
        // The same for a mineral map, whose class rasters are placed on the
        // extent of the area it was identified over.
        if (res.mineral) {
          mineralAoiRef.current = restoredAoi
          setMineral(res.mineral)
        } else {
          setMineral(null)
        }
        const centroid = geometryCentroid(polygon)
        if (centroid) {
          props.setFlyTo({
            lat: centroid[1],
            lon: centroid[0],
            key: Date.now(),
          })
        }
        /*
          One destination. This once chose between several screens, one per
          product, because each product was read where it was run. Everything
          is read in the studio now, the rasters as planes, so `run.kind` no
          longer chooses a screen.
        */
        goStudio()
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
      goStudio,
      props.analysisLabel,
      props.setResult,
      props.setModelKind,
      props.setAnalysisLabel,
      props.setCustomPolygon,
      props.setFlyTo,
      persistAoiLabel,
      prefs?.extras_json,
      projects,
      activeProjectId,
    ]
  )


  /**
   * Starts a run of any product, from wherever the user is.
   *
   * The hub offered New classification and nothing else, while the application
   * produces three run kinds and a composition. A user in a project could reach
   * a classification in one click and everything else by navigating and
   * remembering which screen holds it.
   *
   * The three map products clear the session the same way -- the previous
   * result, overlay and AOI all belong to the run being replaced -- so they
   * share startNewClassification and differ only in the panel they open.
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
    goStudio()
  }, [
    goStudio,
    clearAreaAndComposition,
    props.setResult,
    props.setShowPredictionOverlay,
    props.setSwipeCompare,
    props.setSwipeRatio,
  ])

  /**
   * Open a saved studio.
   *
   * MOVED HERE FROM ABOVE THE STATE IT NEEDS. It used to sit beside
   * openInStudio, hundreds of lines before clearAnalysisResults and the
   * composition are declared, which is why it could not do what
   * handleNewStudio does -- naming any of them in its dependency list from up
   * there is a reference before initialisation. Sitting next to its mirror is
   * also where a reader compares the two, which is the comparison that was
   * needed to find what follows.
   */
  const handleOpenStudio = useCallback(
    async (board: Studio) => {
      try {
        const opened = await openStudio(board.id)
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
          AND THE MAP'S OWN ANALYSIS, which this path was leaving behind.

          handleNewStudio says why in full: a plane on the board comes from
          three places and only two of them are the board's, the third being
          whatever the map is showing right now. That fix was made for the new
          studio and not for this one, so opening a saved studio kept the
          previous studio's run on the map -- as the live area of the board
          just opened, since liveRunId in StudioScreen resolves from these very
          fields.

          What that costs is not cosmetic. The live area is a member like any
          other when the board is saved, so the studio being opened inherits
          the run of the studio being left, and saving it writes that run into
          its arrangement. One installation carried two studios saved two
          minutes apart naming the same run, with no analysis having been made
          between them, and the arrangement of the second holding a name for
          the ground of a third.

          THE AOI GOES TOO. Both of these paths used to keep it, on the
          argument that an area belongs to the project rather than to the
          board. The argument holds for the ownership and not for the drawing:
          a reader who has just changed studios is not standing on the ground
          they left, and the outline of it stays on the map saying they are.

          It is not only an outline. The area carries the auto-name the store
          minted for it -- "drawn", "drawn 2" -- and that name becomes the
          label of the next run made over it, so the run made after a switch
          was filed under the ground of the studio before it. That is visible
          in an installation where a studio named "Sao gonçalo" holds a run
          called run-drawn-2, which is the area of the studio saved two minutes
          earlier.
        */
        /*
          NOT A MOVE FROM ONE GROUND TO ANOTHER, so the run being left is not
          kept in hand.

          Clearing the area below moves activeAreaId, and an effect further
          down retains whatever the map was showing whenever that id changes --
          which put the run of the studio being left straight back onto the
          board of the one being opened, as an area of its own, after every
          clear above had already run. The board showed a studio named for one
          ground holding the run of another, which is the defect these clears
          exist to prevent, arriving one render later than they do.

          Retention is the map's affordance: a ground the map moved on from
          stays in hand so the board can still show it beside the new one.
          Putting the board down is the opposite gesture, and clearRetainedRuns
          above already says so.
        */
        leavingRef.current = { id: undefined, result: null }
        clearAnalysisResults()
        clearAreaAndComposition()
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
    [
      openInStudio,
      clearAnalysisResults,
      clearAreaAndComposition,
      props.clearRetainedRuns,
    ]
  )

  /**
   * An empty board, bound to no saved studio.
   *
   * The mirror of handleOpenStudio: that one restores an arrangement and writes
   * the id and name it came from, this one clears both. Clearing the id is the
   * point rather than a detail -- taking every plane off by hand leaves the
   * board still bound to what it was opened from, so the next save writes over
   * the studio it started from instead of making the second one.
   *
   * THE MAP'S OWN ANALYSIS GOES TOO, and that is what the first attempt at this
   * missed. A plane on the board comes from one of three places, and only two
   * of them are the board's: the runs added through the picker and the runs the
   * map has finished with, both of which live in boardMemory. The third is
   * whatever the map is showing right now, which is not a member of any board
   * -- it is the ground the studio is standing on, and it appears in a saved
   * studio just as it does here. So clearing the board left it, and a new
   * studio opened holding the last analysis.
   *
   * Cleared WITHOUT being retained, unlike startNewClassification, which hands
   * the result to retainRun on the way out. A retained run becomes an area of
   * the board, which is the thing being emptied.
   *
   * THE AOI GOES WITH IT, which reverses what this used to do. It kept the
   * drawing on the argument that an area belongs to the project and not to the
   * board -- true of the ownership, and not of what the map should be showing
   * a reader who has just left one studio for another. See handleOpenStudio,
   * where the same reversal is made and where the cost of the old behaviour is
   * recorded: the kept area carries its "drawn N" name into the label of the
   * next run, so a run made after a switch is filed under the previous
   * studio's ground.
   *
   * The composition goes with it, since it would otherwise be the one plane
   * left on an empty board.
   *
   * `clearBoardMemory` runs first, because openInStudio writes pendingRunIds
   * into that same store and a clear afterwards would take them with it.
   */
  const handleNewStudio = useCallback(
    async (name: string) => {
      clearBoardMemory()
      props.clearRetainedRuns()
      // Not a move from one ground to another either. See handleOpenStudio.
      leavingRef.current = { id: undefined, result: null }
      clearAnalysisResults()
      clearAreaAndComposition()
      props.setShowPredictionOverlay(true)
      props.setSwipeCompare(false)
      props.setSwipeRatio(0.5)
      /*
        WRITTEN NOW, EMPTY, RATHER THAN AT THE FIRST SAVE.

        A studio that exists only in the board's memory has no name to lend,
        and the ground drawn under it therefore took the store's provisional
        one -- "drawn 2" -- which then became the label of the run made over
        it. Both were written before the studio had a name of its own, and
        neither is revisited when it gets one.

        The row is created here so the name exists first. It costs a studio
        with no members, which the store already permits: SaveStudio requires a
        name and does not require an arrangement, because an arrangement is
        what a studio accumulates rather than what makes it one.

        Best effort. If the write fails the board is still cleared and still
        usable; what is lost is the binding, so the next save creates the
        studio instead of updating it -- which is exactly the behaviour this
        replaces.
      */
      try {
        const board = await saveStudio(
          name,
          snapshotBoard([]),
          undefined,
          activeProjectId
        )
        writeBoardMemory("savedId", board.id)
        writeBoardMemory("savedName", board.name)
        void refreshStudios()
      } catch (e) {
        notifyError("Could not start the studio", e)
      }
      openInStudio([])
    },
    [
      openInStudio,
      clearAnalysisResults,
      clearAreaAndComposition,
      activeProjectId,
      refreshStudios,
      props.clearRetainedRuns,
      props.setShowPredictionOverlay,
      props.setSwipeCompare,
      props.setSwipeRatio,
    ]
  )

  const areaLabel = useMemo(() => {
    if (props.analysisLabel) return props.analysisLabel
    return props.customPolygon ? "Custom AOI" : undefined
  }, [props.analysisLabel, props.customPolygon])

  /**
   * Where the map is, for every surface that carries one.
   *
   * One live ref and one debounced write to the same map_view preference. Two
   * memories would let a pan made on one surface be lost on the way back to
   * another, or the reverse, depending on which one last committed.
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
        props.setAreas([])
        return
      }
      try {
        const rows = await ListAreas(projectId)
        props.setAreas(toAreas(rows))
      } catch (e) {
        notifyError("Could not load the project's areas", e)
      }
    },
    [props.setAreas]
  )

  useEffect(() => {
    void refreshAreas(activeProjectId)
  }, [activeProjectId, refreshAreas])

  /*
    One drawn ground, written to the open project.

    THE REFUSAL IS THE POINT. An area used to be created wherever a shape
    arrived, belonging to nothing, and the run made over it inherited whichever
    project happened to be selected -- which is how 58 runs from several fields
    came to sit inside one project. There is nowhere to put an area without a
    project, so this says so instead of inventing somewhere.

    Returns the created area, or null when it refused or the write failed. The
    callers use that to decide whether to say anything.
  */
  const createArea = useCallback(
    async (geom: GeoJSONGeometry, nameHint?: string): Promise<Area | null> => {
      if (!activeProjectId) {
        notifyError("Open a project first: an area belongs to one.")
        return null
      }
      try {
        const row = await CreateArea(activeProjectId, nameHint?.trim() ?? "", JSON.stringify(geom))
        const entry = toArea(row)
        if (!entry) {
          notifyError("The area was saved but its shape could not be read back.")
          return null
        }
        await refreshAreas(activeProjectId)
        props.setActiveAreaId(entry.id)
        props.setCustomPolygon(entry.geometry)
        props.setAnalysisLabel(entry.name)
        setComposition(null)
        setShowCompositionOverlay(true)
        // A ground just drawn is the ground being worked on, so the project
        // resumes here. Best effort, as in activateArea.
        void SetProjectLastArea(activeProjectId, entry.id).catch(() => {})
        return entry
      } catch (e) {
        notifyError("Could not save the area", e)
        return null
      }
    },
    [
      activeProjectId,
      refreshAreas,
      props.setActiveAreaId,
      props.setCustomPolygon,
      props.setAnalysisLabel,
    ]
  )

  /*
    A boundary chosen in the catalogue card, kept as an area of the project.

    BELOW createArea AND NOT BESIDE THE OTHER HANDLERS, which is where it was
    first written: naming createArea in a dependency list above its own
    declaration is a reference before initialisation. It belongs next to the
    writer it calls anyway.

    THE SAME DOOR THE OTHER TWO USE. A polygon reaches this application by
    being drawn, by being read from a file, and now by being chosen from a
    published register -- and all three end here, at createArea, which is what
    decides the id, files it under the open project and puts it on the map. A
    third path with its own writer would be a third set of those decisions to
    keep in step.

    The name is the boundary's own, so an area taken from the register is
    called what the register calls it -- and the store numbers it if the
    project already holds a ground by that name, which is what makes two runs
    over Natal two areas rather than one overwritten.
  */
  const handlePickBoundary = useCallback(
    async (name: string, geometry: GeoJSONGeometry) => {
      const entry = await createArea(geometry, name)
      if (!entry) return
      const centroid = geometryCentroid(geometry)
      if (centroid) {
        props.setFlyTo({ lat: centroid[1], lon: centroid[0], key: Date.now() })
      }
      notifySuccess(`\u201c${entry.name}\u201d is the area now.`)
    },
    [createArea, props.setFlyTo]
  )

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
   * React batch the second still sees the activeAreaId the first has not
   * committed yet -- so both create an entry, both name it from the same
   * `areas`, and the catalog gets two areas with one name between them.
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
        props.setActiveAreaId(undefined)
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
        whatever `areas` looked like when the batch started, so a pair of
        them arrive with one name between them.

        Compared by geometry rather than by identity: the value that comes back
        from the draw store is a fresh object every time and would never be the
        one already held.
      */
      const shape = JSON.stringify(geom)
      const active = props.areas.find((a) => a.id === props.activeAreaId)
      if (
        shape === lastDrawnRef.current ||
        (active && JSON.stringify(active.geometry) === shape)
      ) {
        props.setCustomPolygon(geom)
        if (active) props.setAnalysisLabel(active.name)
        return
      }
      lastDrawnRef.current = shape
      /*
        Retention is NOT done here. Setting `activeAreaId` inside createArea is
        what the effect beside `resultWithWater` watches, and it keeps the
        outgoing ground's work for every way of leaving it rather than for this
        one.

        The shape goes on the map before the write returns. Waiting would leave
        a drawn outline invisible for the round trip, and the write is what
        decides the id and the name, not the geometry.

        IF THE WRITE IS REFUSED THE OUTLINE GOES WITH IT. An outline the map
        shows and the area card calls "none" is the disagreement this whole
        change exists to end; a reader told to open a project first should be
        looking at a map that is waiting for them, not at half a result.
      */
      props.setCustomPolygon(geom)
      /*
        THE STUDIO IS THE STEM, WHEN THERE IS ONE.

        Without it the store mints "drawn", "drawn 2", and that name becomes
        the label of the run made over the ground -- so a studio called "Serra
        do mel" ended up holding a run called run-drawn-2, named after nothing
        a reader chose. The name is available here because a studio is now
        named when it begins rather than when it is first saved; see
        handleNewStudio. The store numbers the stem, so two grounds drawn under
        one studio do not arrive with one name between them.

        Empty when the board is not bound to a studio -- an area drawn from the
        map with no studio open -- and then the sequence is the one it has
        always been.
      */
      void createArea(
        geom,
        readBoardMemory<string | null>("savedName", null) ?? undefined
      ).then((entry) => {
        if (entry) return
        lastDrawnRef.current = null
        props.setCustomPolygon(null)
        props.setAnalysisLabel(undefined)
      })
    },
    [
      props.areas,
      props.activeAreaId,
      props.setActiveAreaId,
      props.setCustomPolygon,
      props.setAnalysisLabel,
      createArea,
    ]
  )

  /*
    A polygon from a file, kept as an area of the open project.

    IN APPBODY, not in App where it used to live, because creating an area now
    needs the project to put it in and that id is state here. It was written
    where it was when an area was a local object with a browser-minted id and
    belonged to nothing.
  */
  const handleImportPolygon = async () => {
    if (!activeProjectId) {
      notifyError("Open a project first: an area belongs to one.")
      return
    }
    try {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = ".kml,.geojson,.json"
      /*
        THE INPUT IS PUT IN THE DOCUMENT BEFORE IT IS CLICKED.

        It used to be a detached element, created and clicked without ever being
        attached, which is the form every snippet for this uses and which this
        webview ignores: WKWebView opens a file picker for an input that is in
        the document and silently does nothing for one that is not. The button
        looked dead and reported nothing. The avatar upload on the profile page
        never had the problem because its input is rendered into the page and
        clicked through a ref -- the same property, arrived at by writing it in
        JSX rather than by knowing the rule.

        Hidden rather than off-screen, and removed once the dialog has been
        answered, so nothing is left behind on a cancel either.

        THE PICKER IS ALSO OPENED BEFORE ANYTHING IS AWAITED.

        togeojson used to be imported first, and a dynamic import is a promise:
        after awaiting it the call below is no longer running inside the user
        gesture that started it, and a WKWebView refuses a programmatic click on
        a file input outside one. The dialog then never appeared and nothing
        said why -- the button looked dead. The parser is only needed once a
        file has been chosen, so it is loaded there instead.
      */
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const { kml } = await import("@tmcw/togeojson")
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
        input.remove()
        const entry = await createArea(geom, file.name.replace(/\.[^.]+$/, ""))
        if (!entry) return
        notifySuccess(`Polygon saved as \u201c${entry.name}\u201d.`)
      }
      input.style.display = "none"
      document.body.appendChild(input)
      const cleanup = () => input.remove()
      // Covers the cancel, where onchange never fires. Not perfectly: a webview
      // that reports no focus event would leave the node, which is why it is
      // display:none and carries no listeners of its own.
      window.addEventListener("focus", cleanup, { once: true })
      input.click()
    } catch (e) {
      notifyError("Import failed", e)
    }
  }

  const activateArea = useCallback(
    (id: string) => {
      const entry = props.areas.find((a) => a.id === id)
      if (!entry) return
      props.setActiveAreaId(entry.id)
      props.setCustomPolygon(entry.geometry)
      props.setAnalysisLabel(entry.name)
      setComposition(null)
      setShowCompositionOverlay(true)
      /*
        Recorded on the project so opening it again resumes on this ground.

        Best effort: failing to remember where a reader was is worth nothing in
        front of the action they actually took, which has already happened.
      */
      if (activeProjectId) {
        void SetProjectLastArea(activeProjectId, entry.id).catch(() => {})
      }
    },
    [
      props.areas,
      props.setActiveAreaId,
      props.setCustomPolygon,
      props.setAnalysisLabel,
      activeProjectId,
    ]
  )

  /** Put a run's stored polygon on the map without adding a catalog entry. */
  const adoptAreaGeometry = useCallback(
    (geom: GeoJSONGeometry | null) => {
      if (!geom) {
        props.setCustomPolygon(null)
        props.setActiveAreaId(undefined)
        props.setAnalysisLabel(undefined)
        return
      }
      props.setCustomPolygon(geom)
      props.setActiveAreaId(undefined)
      setComposition(null)
      setShowCompositionOverlay(true)
    },
    [
      props.setCustomPolygon,
      props.setActiveAreaId,
      props.setAnalysisLabel,
    ]
  )

  const renameArea = useCallback(
    async (id: string, name: string) => {
      const next = name.trim()
      if (!next) return
      const current = props.areas.find((a) => a.id === id)
      if (!current) return
      /*
        THROUGH THE STORE, which is what makes the new name outlive the
        session. Renaming used to patch the local list and stop there, so the
        name a reader typed was gone at the next start and every run recorded
        under it still carried the old one.
      */
      try {
        await UpdateArea({
          id,
          name: next,
          notes: current.notes,
          polygon_geojson: JSON.stringify(current.geometry),
        } as never)
        await refreshAreas(activeProjectId)
        if (props.activeAreaId === id) props.setAnalysisLabel(next)
      } catch (e) {
        notifyError("Could not rename the area", e)
      }
    },
    [
      props.areas,
      props.activeAreaId,
      props.setAnalysisLabel,
      refreshAreas,
      activeProjectId,
    ]
  )

  /*
    Renaming what is on the map renames the AREA it is.

    It used to write the new name onto the PROJECT, as projects.label, because
    that is where a name for the map's shape lived. A project working several
    fields then carried one of their names, and renaming a second field
    overwrote the first. The name belongs to the ground, and the ground is a
    row that can hold it.

    With nothing catalogued on the map -- a geometry adopted from an opened run
    -- there is no row to rename, so the label stays a session-local display
    name. That is what it was for every shape before areas existed.
  */
  const applyAoiRename = useCallback(
    async (label: string) => {
      const next = label.trim()
      if (!next) return
      props.setAnalysisLabel(next)
      void persistAoiLabel(next)
      if (props.activeAreaId) await renameArea(props.activeAreaId, next)
    },
    [props.activeAreaId, persistAoiLabel, props.setAnalysisLabel, renameArea]
  )

  const deleteArea = useCallback(
    async (id: string) => {
      const target = props.areas.find((a) => a.id === id)
      if (!target) return
      /*
        ASKED FOR, BECAUSE IT TAKES THE RUNS TOO.

        Deleting an entry from the old catalogue left the runs alone -- nothing
        linked them, so nothing could follow. An area owns its runs now, and
        DeleteArea removes their rows and their rasters. That is the behaviour
        wanted; it is not a behaviour to discover afterwards.
      */
      const owned = target.run_count
      const warning = owned
        ? `Delete "${target.name}" and the ${owned} run${owned === 1 ? "" : "s"} measured on it? This cannot be undone.`
        : `Delete "${target.name}"?`
      if (!window.confirm(warning)) return
      try {
        await DeleteArea(id)
        await refreshAreas(activeProjectId)
        if (props.activeAreaId === id) {
          props.setCustomPolygon(null)
          props.setActiveAreaId(undefined)
          props.setAnalysisLabel(undefined)
        }
      } catch (e) {
        notifyError("Could not delete the area", e)
      }
    },
    [
      props.areas,
      props.activeAreaId,
      props.setCustomPolygon,
      props.setActiveAreaId,
      props.setAnalysisLabel,
      refreshAreas,
      activeProjectId,
    ]
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
      //
      // THE SAME LIST APPEARS IN clearAnalysisResults, WHICH CLEARS IT. A
      // product added to one and not the other is a defect that has shipped
      // once: this counted a loaded result, the clearing did not remove it, and
      // the detail view rebuilt itself from what the clearing left behind.
      // Adding a product here means adding it there.
      if (!props.result && !water && !mineral) {
        return null
      }
      return {
        ...(props.result ?? EMPTY_RESULT),
        /*
          Whatever produced this state, not only a classification.

          The spread above supplies `run_id` from `props.result`, which a
          standalone product never sets -- so this object described a water
          run and carried no id for it, and every reader of
          `result.run_id` was told there was none. `currentRunId` is set by
          every handler that records a run and by opening a saved run, so it
          answers for each.
        */
        run_id: currentRunId ?? "",
        water,
        mineral,
      }
    },
    [props.result, water, mineral, currentRunId]
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
  useEffect(() => {
    const leaving = leavingRef.current
    leavingRef.current = { id: props.activeAreaId, result: resultWithWater }
    if (!leaving.id || leaving.id === props.activeAreaId) return
    props.retainRun(leaving.result, leaving.id)
  }, [props.activeAreaId, resultWithWater, props.retainRun])



  const analysisPolygonGeoJSON = useMemo(
    () => (props.customPolygon ? JSON.stringify(props.customPolygon) : ""),
    [props.customPolygon]
  )

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-app text-foreground">
      <TitleBar
        view={props.view}
        /*
          Handed back so the map screen can portal its studio toggle up
          here. What App holds is WHERE the button goes; whether the board is
          open stays in the screen, which is the only place it can stay without
          surviving a trip to another screen.
        */
        boardOpen={boardOpen}
        result={props.result}
        credit={credit}
      />
      {/* The keymap and the operator search, on every screen. */}
      <OperatorHost />
      {/* Project files: opening, saving, and what the Finder hands over. */}
      <ProjectFileHost
        activeProjectId={activeProjectId}
        onActivateProject={activateProject}
      />

      <div className="flex min-h-0 flex-1">
        {/*
          NO NAVIGATION COLUMN. There is one destination that is work.

          The column named five, four of which were screens the studio has
          since absorbed -- the map it grew out of, three product screens that
          became cards on the run band before those products were removed, and
          the project hub, whose management moved into the studio itself. What
          was left named the studio, and a list of one is not navigation.

          Settings and sign-in are reached from the title bar, which is where
          an account control belongs and where this column had put it too.
        */}
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
            {screen === "studio" && (
              <motion.div
                key="screen-map"
                className="absolute inset-0 min-h-0"
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={SCREEN}
              >
                <StudioScreen
                  onOpenReading={openSavedAnalysis}
                  onPickBoundary={handlePickBoundary}
                  activeProjectId={activeProjectId}
                  activeProjectName={
                    projects.find((p) => p.id === activeProjectId)?.name ?? null
                  }
                  retainedRuns={props.retainedRuns}
                  onDropRetainedRun={props.onDropRetainedRun}
                  onCreditChange={setCredit}
                  onBoardOpenChange={setBoardOpen}
                  lastRun={lastBoardRun}
                  onBoardInputs={onBoardInputs}
                  onActivateProject={(id) => void activateProject(id)}
                  polygonGeoJSON={analysisPolygonGeoJSON}
                  mineral={mineral}
                  onRunMinerals={() => void handleRunMinerals()}
                  mineralBusy={mineralRun.active}
                  mineralProgress={mineralRun.progress}
                  mineralProgressMsg={mineralRun.message}
                  onClearMineral={() => setMineral(null)}
                  reveal={reveal}
                  onRevealed={() => setReveal(null)}
                  initialView={initialMapView}
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
                  areas={props.areas}
                  activeAreaId={props.activeAreaId}
                  onActivateArea={activateArea}
                  onRenameArea={renameArea}
                  onDeleteArea={deleteArea}
                  onLocationSelect={(lat, lon) =>
                    props.setFlyTo({ lat, lon, key: Date.now() })
                  }
                  onClearArea={clearAreaAndComposition}
                  onImportPolygon={handleImportPolygon}
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
                  studios={studios}
                  onOpenStudio={(b) => void handleOpenStudio(b)}
                  onNewStudio={handleNewStudio}
                  onStudiosMenu={refreshStudios}
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
