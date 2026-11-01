import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Sparkle, ChartLine, Crosshair, Image as ImageGlyph, Stack } from "@/components/icons"
import { MapButton } from "@/components/globe/MapChrome"
import { toGlobeArea, type GlobeArea } from "@/components/globe/globeArea"
import type { OverlayCaption } from "@/components/globe/OverlayCallout"
import { ActivityPanel } from "@/components/shell/ActivityPanel"
import { AreasPanel } from "@/components/shell/AreasPanel"
import { LayersPanel } from "@/components/shell/LayersPanel"
import { PointsPanel, type PointSlot } from "@/components/shell/PointsPanel"
import { ProductsPanel } from "@/components/shell/ProductsPanel"
import type { ClassificationView, ResultProduct } from "@/components/shell/ResultPanel"
import { ShellRail, ShellTopBar, keepRailOpen, readRailOpen } from "@/components/shell/ShellChrome"
import { VisualizationPanel } from "@/components/shell/VisualizationPanel"
import {
  COMPOSITOR,
  boardIsDirty,
  clearBoardDirty,
  markBoardDirty,
  onBoardDirtyChange,
  readBoardMemory,
  snapshotBoard,
  writeBoardMemory,
} from "@/components/workspace/boardMemory"
import type { CompositorGlobeOverlay } from "@/components/workspace/CompositorEditor"
import { claimLaunchStart, StartScreen } from "@/components/workspace/StartScreen"
import { WorkflowManager } from "@/components/workspace/WorkflowManager"
import { ConfirmDelete } from "@/components/ui/ConfirmDelete"
import { GlobeOverlayMenu, type GlobeOverlayTarget } from "@/components/workspace/GlobeOverlayMenu"
import { RunOnMapContext } from "@/components/workspace/RunQueue"
import { RunBrowser } from "@/components/workspace/RunBrowser"
import type { Area } from "@/lib/areas"
import { useAppSurfaces } from "@/lib/appSurfaces"
import { useAuth } from "@/lib/auth"
import { geometryBounds } from "@/lib/geometry"
import {
  EMPTY_GRAPH,
  linkInto,
  withFieldNodes,
  withMineralNodes,
  type CompositorGraph,
} from "@/lib/compositorGraph"
import { fieldSets as fieldSetsOf } from "@/lib/fieldSets"
import type { FieldsTarget } from "@/lib/fields"
import type { PdfReportRun } from "@/lib/pdfReport"
import { applyLayerPatch, mergeLayerPatch, type LayerPatch } from "@/lib/layerPatch"
import { legendFor } from "@/lib/layerLegend"
import type { ClassLayer, MapPoint } from "@/lib/mapProbe"
import { rasterLayers, type RasterLayer } from "@/lib/mapLayers"
import { countJobs, takeFinished, useJobs, type JobKind } from "@/lib/jobs"
import { notifyError, notifySuccess } from "@/lib/notify"
import { mergePreferenceExtras, parsePreferenceExtras } from "@/lib/preferenceExtras"
import { openProjectFile } from "@/lib/projectFiles"
import { sessionRuns, type SessionRun } from "@/lib/sessionRuns"
import { saveStudio, type Studio } from "@/lib/studios"
import { useReports } from "@/lib/reports"
import { cn } from "@/lib/utils"
import { useRunLog } from "@/lib/runLog"
import { majoritySmoothOverlay } from "@/lib/smoothOverlay"
import { pollOperator, runOperator, useOperators } from "@/lib/operators"
import { loadedRunAssets, runAssets } from "@/lib/runAssets"
import { jobReadingOf, withAssetLayers, type JobReading } from "@/lib/shellLayers"
import type { BoardToolId } from "@/lib/mapTools"
import type { MineralRunOptions } from "@/lib/mineral"
import { DEFAULT_MINERAL_RUN_OPTIONS } from "@/lib/mineral"
import { activeRuns } from "@/lib/productRun"
import type {
  Bounds,
  CompositeIndex,
  CompositeKind,
  CompositionOverlay,
  DataCubeScene,
  FieldsAnalysis,
  GeoJSONGeometry,
  InferenceRun,
  MineralAnalysis,
  ModelKind,
  PredictResult,
  WaterAnalysis,
  WaterIndex,
} from "@/lib/types"
import { ListProjectRuns, LoadAnalysis } from "../../wailsjs/go/main/App"

/*
  Lazy: MapLibre is 945 kB, and the result panel
  brings the agreement figures, which a reader who has run nothing has no use for.
*/
const GlobeSurface = lazy(() =>
  import("@/components/globe/GlobeSurface").then((m) => ({ default: m.GlobeSurface }))
)
const ResultPanel = lazy(() =>
  import("@/components/shell/ResultPanel").then((m) => ({ default: m.ResultPanel }))
)
const CompareScreen = lazy(() =>
  import("@/components/shell/CompareScreen").then((m) => ({ default: m.CompareScreen }))
)
const WorkflowsScreen = lazy(() =>
  import("@/components/shell/WorkflowsScreen").then((m) => ({ default: m.WorkflowsScreen }))
)

/** Which panel is held up over the map. One value, so there is only ever one. */
type ShellPanelId = "areas" | "products" | "visualization" | "result" | "points" | "layers" | "activity"

/**
 * The whole contract between App and the surface it draws: App owns the parameters,
 * the handlers and the results, and this says what is handed over.
 */
export interface MapShellProps {
  /** Where the map was left last session; null starts at the default view. */
  initialView?: { lat: number; lon: number; zoom: number } | null;
  customPolygon: GeoJSONGeometry | null;
  result: PredictResult | null;
  /** Results the map finished with, still in hand for Compare and Workflows. */
  retainedRuns: readonly { id: string; result: PredictResult }[];
  /** Let go of one. */
  onDropRetainedRun?: (id: string) => void;
  overlayOpacity: number;
  showConfidence: boolean;
  confidenceOnTop: boolean;
  smoothOverlay: boolean;
  showPredictionOverlay: boolean;
  showCompositionOverlay: boolean;
  composition: CompositionOverlay | null;
  /** Session gallery of applied compositions (newest first). */
  compositionGallery?: CompositionOverlay[];
  onSelectComposition?: (id: string) => void;
  onRemoveComposition?: (id: string) => void;
  areaLabel?: string;
  hasArea: boolean;
  start: string;
  end: string;
  maxCloud: number;
  monthlyBest: boolean;
  mode: "single" | "temporal";
  modelKind: ModelKind;
  prithviMode: "pixel" | "patch";
  running: boolean;
  progress: number;
  progressMsg: string;
  composeRunning: boolean;
  composeProgress: number;
  composeProgressMsg: string;
  composeScenes: DataCubeScene[];
  composeScenesLoading: boolean;
  composeScenesError: string | null;
  selectedSceneId: string;
  composeKind: CompositeKind;
  composeBands: [string, string, string];
  composeIndex: CompositeIndex;
  composeStretchLow: number;
  composeStretchHigh: number;
  composeOpacity: number;
  onViewChange: (v: { lat: number; lon: number; zoom: number }) => void;
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void;
  /** Catalog of drawn/imported AOIs kept beside the active shape. */
  areas?: import("@/lib/areas").Area[];
  activeAreaId?: string;
  activeProjectId?: string | null;
  /** File new runs under another project, offered by the browser per project. */
  onActivateProject?: (id: string) => void;
  activeProjectName?: string | null;
  onActivateArea?: (id: string) => void;
  onRenameArea?: (id: string, name: string) => void;
  onDeleteArea?: (id: string) => void;
  onClearArea: () => void;
  onImportPolygon: () => void;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
  onMaxCloudChange: (v: number) => void;
  onMonthlyBestChange: (v: boolean) => void;
  onModeChange: (m: "single" | "temporal") => void;
  onModelKindChange: (m: ModelKind) => void;
  onPrithviModeChange: (m: "pixel" | "patch") => void;
  onOpacityChange: (v: number) => void;
  onShowConfidenceChange: (v: boolean) => void;
  onConfidenceOnTopChange: (v: boolean) => void;
  onSmoothOverlayChange: (v: boolean) => void;
  onShowPredictionOverlayChange: (v: boolean) => void;
  onShowCompositionOverlayChange: (v: boolean) => void;
  onSelectScene: (id: string) => void;
  onComposeKindChange: (k: CompositeKind) => void;
  onComposeBandsChange: (b: [string, string, string]) => void;
  onComposeIndexChange: (i: CompositeIndex) => void;
  onComposeStretchChange: (low: number, high: number) => void;
  onComposeOpacityChange: (v: number) => void;
  onListComposeScenes: () => void;
  onApplyComposition: () => void;
  onClearComposition: () => void;
  onRun: () => void;
  onAnalyzeLULC: () => void;
  lulcRunning?: boolean;
  onCloseResult: () => void;
  /**
   * A request to open the board, bumped each time one arrives.
   *
   * A nonce rather than a boolean: the board's open state is this screen's, and
   * a flag would fire only on its first change -- opening the same studio
   * twice in a row has to work.
   */
  openBoardNonce?: number;
  /** Saved workflows, which the store keeps as studios. */
  studios?: Studio[];
  onOpenStudio?: (board: Studio) => void;
  onNewStudio?: (name: string) => void;
  /** Load a saved run as the live one, and hand it back. */
  onOpenReading?: (run: InferenceRun) => void | Promise<PredictResult | null>;
  /** A published boundary chosen in the catalogue card, to become an area. */
  onPickBoundary?: (name: string, geometry: GeoJSONGeometry) => void;
  /** Called when the list of workflows is about to be read, to refresh it. */
  /*
    Returns its promise, so a caller that needs the list BEFORE it draws again
    can wait for it. The menu that opens on hover does not and ignores it; the
    manage dialog does, since it shows the result of its own rename or delete.
  */
  onStudiosMenu?: () => void | Promise<void>;
  water?: WaterAnalysis | null;
  /** The AOI as GeoJSON text, for the research pack's manifest. */
  polygonGeoJSON?: string;
  /**
   * The mineral map: its result, its run and its progress. The runner is
   * absent where the product cannot be started, and the band then does not
   * offer it.
   */
  mineral?: MineralAnalysis | null;
  onRunMinerals?: () => void;
  /** The mineral map's passes compared and uncertainty draws; see the Passes card. */
  mineralOptions?: MineralRunOptions;
  onMineralOptionsChange?: (o: MineralRunOptions) => void;
  mineralBusy?: boolean;
  mineralProgress?: number;
  mineralProgressMsg?: string;
  onClearMineral?: () => void;
  onClearFields?: () => void;
  /**
   * The field delineation, as the mineral map's props are: absent runner, no
   * band entry. Adoption is asked for by the compositor's Make fields node,
   * with the run and the thresholds that reached it.
   */
  fields?: FieldsAnalysis | null;
  onRunFields?: () => void;
  fieldsBusy?: boolean;
  fieldsProgress?: number;
  fieldsProgressMsg?: string;
  onAdoptFields?: (runId: string, minHa: number, minCropland: number, replace: boolean) => Promise<boolean>;
  /**
   * The areas the next jobs are queued over (App.tsx, selectAreas), and the
   * queueing itself. While any is selected the band queues its product over
   * them rather than running it over the area in hand.
   */
  selectedAreaIds?: string[];
  onSelectAreas?: (ids: string[], mode: "toggle" | "add") => void;
  onClearSelection?: () => void;
  onQueueJobs?: (kind: JobKind) => void;
  waterIndex: WaterIndex;
  waterRunning: boolean;
  waterProgress: number;
  waterProgressMsg: string;
  showWaterOverlay: boolean;
  onWaterIndexChange: (i: WaterIndex) => void;
  onRunWater: () => void;
  onClearWater: () => void;
  onShowWaterOverlayChange: (v: boolean) => void;
  waterOpacity: number;
  onWaterOpacityChange: (v: number) => void;
}

/** The list with this run in it, once. */
const withRun = (
  list: readonly { run: InferenceRun; result: PredictResult }[],
  run: InferenceRun,
  result: PredictResult
) => (list.some((x) => x.run.id === run.id) ? [...list] : [...list, { run, result }])

/** The panel's width, and the tool column's, as the camera has to clear them. */
const PANEL_CLEARANCE_PX = 480
const WIDE_PANEL_CLEARANCE_PX = 768

/**
 * The application as a map with panels held up in front of it.
 *
 * App owns the parameters, the handlers and
 * the results; what is here is how they are drawn.
 *
 * THE STATE THAT IS HERE is the state of this surface: which panel is open, which
 * product it shows, how each mineral and field raster is set. The last two sit
 * here because nothing above draws them.
 */
export function MapShell(props: MapShellProps) {
  const { projects, prefs, savePrefs, runs: savedRuns } = useAuth()
  const app = useAppSurfaces()
  /*
    The surfaces the Options menu opens, by name as well: F3 lists them, and with no
    owner here it would list them as unavailable.
  */
  useOperators({
    SPLASH: { run: app.items.splash.onSelect },
    RELEASE_NOTES: { run: app.items.releaseNotes.onSelect },
    ENVIRONMENT: { run: app.items.environment.onSelect },
    STORAGE: {
      run: app.items.storage.onSelect,
      poll: () => (app.items.storage.disabled ? "Still measuring" : true),
    },
    ABOUT: { run: app.items.about.onSelect },
  })
  const pageRef = useRef<HTMLDivElement>(null)

  // Over the map at launch, and gone as soon as the reader begins something.
  const [startOpen, setStartOpen] = useState(false)
  const [destination, setDestination] = useState<"explore" | "analyses" | "compare" | "workflows">(
    "explore"
  )
  /*
    Each stays mounted once opened, hidden behind the map. The grid's choices survive
    a look at the ground that way, and a graph's Globe nodes go on drawing on it.
  */
  const [compareOpened, setCompareOpened] = useState(false)
  const [workflowsOpened, setWorkflowsOpened] = useState(false)
  const [analysesOpened, setAnalysesOpened] = useState(false)
  const goAnalyses = () => {
    setStartOpen(false)
    setAnalysesOpened(true)
    setDestination("analyses")
  }
  const goCompare = () => {
    setStartOpen(false)
    setCompareOpened(true)
    setDestination("compare")
  }
  const goWorkflows = () => {
    setStartOpen(false)
    setWorkflowsOpened(true)
    setDestination("workflows")
  }
  const [railOpen, setRailOpen] = useState(readRailOpen)
  /*
    How many reports had been read when the activity panel was last open, so the
    rail can say there is something new. A count and not a flag: the log only
    grows while a session lasts, and clearing it leaves nothing to announce.
  */
  const reports = useReports()
  const [seenReports, setSeenReports] = useState(0)
  const [panel, setPanel] = useState<ShellPanelId | null>(null)
  const [product, setProduct] = useState<BoardToolId | null>(null)
  const [frame, setFrame] = useState<{ key: number; bounds: Bounds } | null>(null)
  const [coords, setCoords] = useState(props.initialView ?? null)
  const [mineralLayerState, setMineralLayerState] = useState<Record<string, LayerPatch>>({})
  const [fieldLayerState, setFieldLayerState] = useState<Record<string, LayerPatch>>({})
  const [assetLayerState, setAssetLayerState] = useState<Record<string, LayerPatch>>({})
  const [spreadM, setSpreadM] = useState(0)
  /*
    A queued product's run, which App holds no state for: it reads a classification,
    water, a mineral map and a delineation.
  */
  const [job, setJob] = useState<JobReading | null>(null)
  const [resultView, setResultView] = useState<ClassificationView>("summary")
  const [resultFocus, setResultFocus] = useState<ResultProduct | null>(null)
  const [points, setPoints] = useState<Partial<Record<PointSlot, MapPoint>>>({})
  const [placing, setPlacing] = useState<PointSlot | null>(null)
  const [opening, setOpening] = useState(false)
  const [overlayMenu, setOverlayMenu] = useState<GlobeOverlayTarget | null>(null)
  /* The prediction with the majority filter applied, which decides where a class boundary is. */
  const [smoothed, setSmoothed] = useState<{ from: string; uri: string } | null>(null)

  const togglePanel = (id: ShellPanelId) => {
    setStartOpen(false)
    setPanel((p) => (p === id ? null : id))
  }

  const areas = useMemo<readonly Area[]>(() => props.areas ?? [], [props.areas])

  /** Choosing an area also goes to it, which a press on the map has no need to do. */
  const pickArea = (area: Area) => {
    props.onActivateArea?.(area.id)
    const b = geometryBounds(area.geometry)
    if (!b) return
    setFrame({
      key: Date.now(),
      bounds: { lon_min: b.lonMin, lat_min: b.latMin, lon_max: b.lonMax, lat_max: b.latMax },
    })
  }

  /*
    A saved run, opened. App loads it and hands it back, so its queued
    products can be read: one load, not a second one here for what the first
    already fetched and did not keep.
  */
  const openRun = async (run: InferenceRun) => {
    setStartOpen(false)
    // Before the load, since its raster is what the globe frames as it arrives.
    setOpening(true)
    setDestination("explore")
    const opened = await props.onOpenReading?.(run)
    setOpening(false)
    setAssetLayerState({})
    const reading = opened ? jobReadingOf(run.id, areaNameOf(run), opened) : null
    setJob(reading)
    // App keeps no state for these, so the session's list is what holds them.
    if (reading && opened) setExtraRuns((prev) => withRun(prev, run, opened))
    setResultFocus(null)
    setPanel("result")
  }
  const areaNameOf = (run: InferenceRun) =>
    areas.find((a) => a.id === run.area_id)?.name ?? "Run"

  const openRunIds = async (ids: readonly string[]) => {
    const id = ids[ids.length - 1]
    if (!id || !props.activeProjectId) return
    try {
      const runs = await ListProjectRuns(props.activeProjectId, 1000)
      const run = runs.find((r) => r.id === id)
      if (run) await openRun(run as InferenceRun)
    } catch (e) {
      notifyError("Could not open the run", e)
    }
  }
  /*
    Runs brought in by name, or by opening a saved workflow. A session's: they
    survive a look at the map and not a restart.
  */
  const [extraRuns, setExtraRuns] = useState<{ run: InferenceRun; result: PredictResult }[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const addRuns = useCallback(async (list: readonly InferenceRun[]) => {
    setLoadingRuns(true)
    try {
      for (const run of list) {
        try {
          const result = (await LoadAnalysis(run.id)) as unknown as PredictResult
          setExtraRuns((prev) => withRun(prev, run, result))
        } catch (e) {
          notifyError("Could not load that run", e)
        }
      }
    } finally {
      setLoadingRuns(false)
    }
  }, [])

  /*
    A queue that has run out opens the last thing it finished. Not each one as it
    finishes: fifty fields would drag the map across the area fifty times while the
    reader is working on something else, and every one of them is saved anyway.
  */
  const jobs = useJobs()
  useEffect(() => {
    const fresh = takeFinished(jobs)
    if (!fresh.length) return
    const { queued, running: going } = countJobs(jobs)
    // Not over a run the reader is watching, which opens its own result when it ends.
    if (queued + going === 0 && !busy) void openRunIds(fresh.map((j) => j.run_id))
    // Read once per change of the queue; the rest is only what opening needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs])

  const areaId = props.activeAreaId ?? "current"
  const areaName =
    areas.find((a) => a.id === props.activeAreaId)?.name ??
    (props.customPolygon ? props.areaLabel || "Drawn area" : "No area")

  const liveRunId =
    props.result?.run_id ||
    props.water?.run_id ||
    props.mineral?.run_id ||
    props.fields?.run_id ||
    "current"
  const session = useMemo<SessionRun[]>(() => {
    const anything = props.result || props.water || props.mineral || props.fields
    return sessionRuns({
      live: anything
        ? {
            id: liveRunId,
            label: areaName,
            model: props.modelKind,
            result: {
              ...props.result,
              water: props.water ?? props.result?.water,
              mineral: props.mineral ?? props.result?.mineral,
              fields: props.fields ?? props.result?.fields,
            } as PredictResult,
          }
        : null,
      retained: props.retainedRuns ?? [],
      extra: extraRuns,
      saved: savedRuns,
      areas,
    })
  }, [
    props.result,
    props.water,
    props.mineral,
    props.fields,
    props.modelKind,
    props.retainedRuns,
    liveRunId,
    areaName,
    extraRuns,
    savedRuns,
    areas,
  ])
  const dropRun = (run: SessionRun) => {
    const held = props.retainedRuns?.find((x) => (x.result.run_id || x.id) === run.id)
    if (held) props.onDropRetainedRun?.(held.id)
    setExtraRuns((prev) => prev.filter((x) => x.run.id !== run.id))
  }

  const sessionRunIds = session.map((r) => r.id)
  const fieldSets = useMemo(() => fieldSetsOf(areas, savedRuns), [areas, savedRuns])
  const fieldsTargetOf = (runId: string): FieldsTarget | null => {
    const areaOfRun = savedRuns.find((r) => r.id === runId)?.area_id
    const area = areas.find((a) => a.id === areaOfRun && !a.parent_id)
    if (!area) return null
    const adopted = areas.filter((a) => a.parent_id === area.id && a.source_run_id)
    return {
      name: area.name,
      adopted: adopted.length,
      adoptedWithRuns: adopted.filter((a) => a.run_count > 0).length,
    }
  }
  const runRecordOf = (runId: string): PdfReportRun | null => {
    const r = savedRuns.find((x) => x.id === runId) ?? extraRuns.find((x) => x.run.id === runId)?.run
    if (!r) return null
    return {
      id: r.id,
      kind: r.kind || "classification",
      title: r.label || r.id,
      modelKind: r.model_kind,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      created: r.created_at,
    }
  }

  /* ---- Workflows: the graph, and the name it is saved under ---------------- */

  const [compositor, setCompositorState] = useState<CompositorGraph | null>(() =>
    readBoardMemory<CompositorGraph | null>(COMPOSITOR, null)
  )
  const setCompositor = (next: CompositorGraph) => {
    writeBoardMemory(COMPOSITOR, next)
    markBoardDirty()
    setCompositorState(next)
  }
  const [compositorGlobe, setCompositorGlobe] = useState<CompositorGlobeOverlay[]>([])
  const [savedId, setSavedId] = useState<string | null>(() => readBoardMemory("savedId", null))
  const [savedName, setSavedName] = useState<string | null>(() => readBoardMemory("savedName", null))
  const [naming, setNaming] = useState<string | null>(null)
  const namingNew = useRef(false)
  const [pendingOpen, setPendingOpen] = useState<Studio | "new" | null>(null)
  const [managing, setManaging] = useState(false)
  const [dirty, setDirty] = useState(boardIsDirty)
  useEffect(() => onBoardDirtyChange(setDirty), [])

  /*
    A finished delineation's and mineral map's nodes are placed for it, once per run:
    what is done with them is graph work, and a run whose nodes had to be built by
    hand would leave those actions out of sight.
  */
  const placedRuns = useRef(new Set<string>())
  const mineralRunId = props.mineral?.run_id
  useEffect(() => {
    const m = props.mineral
    if (!m || !mineralRunId || placedRuns.current.has(mineralRunId)) return
    placedRuns.current.add(mineralRunId)
    setCompositor(
      withMineralNodes(compositor ?? EMPTY_GRAPH, mineralRunId, {
        cover: !!m.cover,
        bands: (m.positions ?? []).map((p) => p.key).filter((k): k is "fe3" | "aloh" => k === "fe3" || k === "aloh"),
        acid: (m.acid_sulfate ?? []).length > 0,
        agreement: (m.agreement ?? []).map((a) => a.group).filter((g): g is 1 | 2 => g === 1 || g === 2),
      })
    )
    // The run id is what decides; the graph is read as it stands then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineralRunId])
  const fieldsRunId = props.fields?.run_id
  useEffect(() => {
    if (!fieldsRunId || placedRuns.current.has(fieldsRunId)) return
    placedRuns.current.add(fieldsRunId)
    const classOutput = assets.some((a) => a.id === "fields-classes") ? "fields-classes" : null
    setCompositor(withFieldNodes(compositor ?? EMPTY_GRAPH, fieldsRunId, classOutput))
    // As above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsRunId])

  /*
    What opening a saved workflow left in the board's memory: its name, its graph and
    the runs it is made of. App wrote them; the nonce says when. A board saved with no
    graph was arranging rasters, which is what the grid is for now.
  */
  const takeOpened = () => {
    setSavedId(readBoardMemory<string | null>("savedId", null))
    setSavedName(readBoardMemory<string | null>("savedName", null))
    const graph = readBoardMemory<CompositorGraph | null>(COMPOSITOR, null)
    setCompositorState(graph)
    const ids = readBoardMemory<string[]>("pendingRunIds", [])
    writeBoardMemory("pendingRunIds", [])
    setExtraRuns([])
    setJob(null)
    void addRuns(ids.flatMap((id) => savedRuns.filter((r) => r.id === id)))
    return { graph, ids }
  }
  const seenNonce = useRef(props.openBoardNonce)
  useEffect(() => {
    if (props.openBoardNonce === seenNonce.current) return
    seenNonce.current = props.openBoardNonce
    const { graph, ids } = takeOpened()
    if (graph || !ids.length || destination === "workflows") goWorkflows()
    else goCompare()
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.openBoardNonce])
  // Runs sent here before this surface mounted.
  useEffect(() => {
    if (readBoardMemory<string[]>("pendingRunIds", []).length) takeOpened()
    // Once, on mount: the list is emptied as it is taken.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveWorkflow = async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (loadingRuns) {
      notifyError(
        "Still opening this workflow",
        new Error("its runs are still being fetched, and saving now would store it without them")
      )
      return
    }
    const members = session
      .filter((r) => r.record)
      .map((r) => ({
        runId: r.id,
        layerIds: (r.live ? assets : loadedRunAssets(r.result)).map((a) => a.sceneId),
      }))
    if (!members.length && !compositor?.nodes.length) {
      notifyError(
        "Nothing to save yet",
        new Error("a workflow is a graph and the saved runs it reads, and this has neither. Run a product, or add a saved run")
      )
      return
    }
    try {
      const board = await saveStudio(trimmed, snapshotBoard(members), savedId ?? undefined, props.activeProjectId)
      writeBoardMemory("savedId", board.id)
      writeBoardMemory("savedName", board.name)
      setSavedId(board.id)
      setSavedName(board.name)
      setNaming(null)
      clearBoardDirty()
      notifySuccess(`Workflow "${board.name}" saved.`)
      void props.onStudiosMenu?.()
      // The project's file too, or the two would say different things.
      if (pollOperator("PROJECT_SAVE") === true) runOperator("PROJECT_SAVE")
    } catch (e) {
      notifyError("Could not save this workflow", e)
    }
  }
  const confirmName = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (namingNew.current) {
      namingNew.current = false
      setNaming(null)
      void props.onNewStudio?.(trimmed)
      return
    }
    void saveWorkflow(trimmed)
  }
  const askName = (forNew: boolean, initial = "") => {
    goWorkflows()
    namingNew.current = forNew
    setNaming(initial)
  }
  const openWorkflow = (board: Studio) => {
    if (board.id === savedId) {
      goWorkflows()
      return
    }
    if (boardIsDirty()) setPendingOpen(board)
    else props.onOpenStudio?.(board)
  }
  const newWorkflow = () => {
    if (boardIsDirty()) setPendingOpen("new")
    else askName(true)
  }

  const extras = parsePreferenceExtras(prefs?.extras_json)
  const startAtLaunch = extras.start_screen !== false
  useEffect(() => {
    if (prefs && claimLaunchStart() && startAtLaunch) setStartOpen(true)
    // Once, on the first preferences: the claim makes any later run a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs])

  useOperators({
    WORKFLOW_SAVE: {
      run: () => {
        if (savedName) {
          void saveWorkflow(savedName)
          return
        }
        // Nothing to name, and a project file to write: the save is the file's.
        if (!session.some((r) => r.record) && !compositor?.nodes.length && pollOperator("PROJECT_SAVE") === true) {
          runOperator("PROJECT_SAVE")
          return
        }
        askName(false)
      },
    },
    WORKFLOW_RENAME: {
      run: () => askName(false, savedName ?? ""),
      poll: () => (savedName ? true : "This workflow has no name yet"),
    },
    WORKFLOW_NEW: { run: newWorkflow },
    WORKFLOW_MANAGE: { run: () => setManaging(true) },
    START: { run: () => setStartOpen(true) },
  })

  const assets = useMemo(
    () =>
      runAssets({
        result: props.result,
        composition: props.composition,
        compositionGallery: props.compositionGallery ?? [],
        areaId: props.activeAreaId,
        water: props.water,
        areaLabel: props.areaLabel,
        modelKind: props.modelKind,
        showCompositionOverlay: props.showCompositionOverlay,
        showWaterOverlay: props.showWaterOverlay,
        composeOpacity: props.composeOpacity,
        waterOpacity: props.waterOpacity,
        mineral: props.mineral,
        mineralLayers: mineralLayerState,
        fields: props.fields,
        fieldLayers: fieldLayerState,
        health: job?.health,
        overlap: job?.overlap,
        radar: job?.radar,
        zones: job?.zones,
      }),
    [
      props.result,
      props.composition,
      props.compositionGallery,
      props.activeAreaId,
      props.water,
      props.areaLabel,
      props.modelKind,
      props.showCompositionOverlay,
      props.showWaterOverlay,
      props.composeOpacity,
      props.waterOpacity,
      props.mineral,
      mineralLayerState,
      props.fields,
      fieldLayerState,
      job,
    ]
  )

  const stateLayers = useMemo(
    () =>
      rasterLayers({
        result: props.result,
        showPredictionOverlay: props.showPredictionOverlay,
        overlayOpacity: props.overlayOpacity,
        showConfidence: props.showConfidence,
        confidenceOnTop: props.confidenceOnTop,
        smoothOverlay: props.smoothOverlay,
        composition: props.composition,
        showCompositionOverlay: props.showCompositionOverlay,
        composeOpacity: props.composeOpacity,
        water: props.water,
        showWaterOverlay: props.showWaterOverlay,
        waterOpacity: props.waterOpacity,
        mineral: props.mineral,
        mineralLayers: mineralLayerState,
        fields: props.fields,
        fieldLayers: fieldLayerState,
      }),
    [
      props.result,
      props.showPredictionOverlay,
      props.overlayOpacity,
      props.showConfidence,
      props.confidenceOnTop,
      props.smoothOverlay,
      props.composition,
      props.showCompositionOverlay,
      props.composeOpacity,
      props.water,
      props.showWaterOverlay,
      props.waterOpacity,
      props.mineral,
      mineralLayerState,
      props.fields,
      fieldLayerState,
    ]
  )
  const layersBeforeGraph = useMemo(
    () => withAssetLayers(stateLayers, assets, assetLayerState),
    [stateLayers, assets, assetLayerState]
  )

  /*
    What a graph's Globe nodes draw, as rows of the same list. The node may have been
    removed since it sent them and the run may have left the session, so each is
    checked here, where both are known.
  */
  const graphLayers = useMemo<RasterLayer[]>(() => {
    const inHand = new Set(sessionRunIds)
    return compositorGlobe
      .filter(
        (o) =>
          !!compositor &&
          !!linkInto(compositor, o.nodeId, o.socket) &&
          o.runIds.every((id) => inHand.has(id))
      )
      .map((o) => ({
        ...o.layer,
        id: o.key,
        title: `${o.layer.title}, from the workflow`,
        visible: assetLayerState[o.key]?.visible ?? true,
        opacity: assetLayerState[o.key]?.opacity ?? o.layer.opacity,
      }))
    // sessionRunIds is rebuilt each render; its joined text says when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compositorGlobe, compositor, assetLayerState, sessionRunIds.join("|")])
  const layers = useMemo(
    () => [...layersBeforeGraph, ...graphLayers],
    [layersBeforeGraph, graphLayers]
  )

  /* The class rasters drawn now. A hidden one is not what a reader is looking at. */
  const classLayers = useMemo<ClassLayer[]>(() => {
    const out: ClassLayer[] = []
    for (const l of layers) {
      const legend = assets.find((a) => a.sceneId === l.id)?.classes?.legend
      if (l.visible && legend?.length) {
        out.push({ id: l.id, title: l.title, uri: l.uri, extent: l.extent, legend })
      }
    }
    return out
  }, [layers, assets])
  const pins = useMemo(
    () =>
      (["A", "B"] as const).flatMap((slot) => {
        const p = points[slot]
        return p ? [{ id: slot, label: slot, lon: p.lon, lat: p.lat }] : []
      }),
    [points]
  )
  const placePin =
    panel === "points" && placing
      ? (lon: number, lat: number) => {
          setPoints((held) => ({ ...held, [placing]: { lon, lat } }))
          setPlacing(null)
        }
      : null

  /** One partition of the zones on the map at a time; two would hide each other. */
  const showZones = (k: number) =>
    setAssetLayerState((held) => {
      let next = held
      for (const p of job?.zones?.partitions ?? []) {
        next = mergeLayerPatch(next, `zones-${p.k}`, { visible: p.k === k })
      }
      return next
    })

  const removeResult = (product: ResultProduct) => {
    switch (product) {
      case "classify":
        props.onCloseResult()
        break
      case "water":
        props.onClearWater()
        break
      case "mineral":
        props.onClearMineral?.()
        break
      case "fields":
        props.onClearFields?.()
        break
      default:
        setJob(null)
        setAssetLayerState({})
    }
  }

  const changeLayer = (id: string, patch: LayerPatch) =>
    applyLayerPatch(id, patch, {
      setCompositionVisible: props.onShowCompositionOverlayChange,
      setCompositionOpacity: props.onComposeOpacityChange,
      setWaterVisible: props.onShowWaterOverlayChange,
      setWaterOpacity: props.onWaterOpacityChange,
      setConfidenceVisible: props.onShowConfidenceChange,
      setPredictionVisible: props.onShowPredictionOverlayChange,
      setOverlayOpacity: props.onOpacityChange,
      patchFieldLayer: (l, p) => setFieldLayerState((held) => mergeLayerPatch(held, l, p)),
      patchMineralLayer: (l, p) => setMineralLayerState((held) => mergeLayerPatch(held, l, p)),
      patchAssetLayer: (l, p) => setAssetLayerState((held) => mergeLayerPatch(held, l, p)),
    })

  const smoothFrom = layers.find((l) => l.smooth)?.uri
  useEffect(() => {
    if (!smoothFrom) return
    let live = true
    majoritySmoothOverlay(smoothFrom)
      .then((uri) => live && setSmoothed({ from: smoothFrom, uri }))
      .catch(() => live && setSmoothed(null))
    return () => {
      live = false
    }
  }, [smoothFrom])

  const overlays = useMemo(() => {
    const sources = {
      result: props.result,
      water: props.water,
      composition: props.composition,
      mineral: props.mineral,
    }
    return layers
      .filter((l) => l.visible && !!l.uri)
      .map((l) => {
        // A ramp is drawn beside its raster. Class legends run long, so they are
        // read in the result panel instead.
        const legend = legendFor(l.id, sources)
        const caption: OverlayCaption | undefined =
          legend?.kind === "ramp" ? { legend, area: areaName, detail: null } : undefined
        const drawn = l.smooth && smoothed?.from === l.uri ? { ...l, uri: smoothed.uri } : l
        return { key: l.id, areaId, layer: drawn, caption }
      })
  }, [layers, props.result, props.water, props.composition, props.mineral, areaId, areaName, smoothed])

  const globeAreas = useMemo<GlobeArea[]>(() => {
    const selected = new Set(props.selectedAreaIds ?? [])
    return areas
      .map((a) => {
        const g = toGlobeArea(`aoi:${a.id}`, a.name, a.geometry, !!a.parent_id)
        return g && selected.has(a.id) ? { ...g, selected: true } : g
      })
      .filter((a): a is GlobeArea => a !== null)
  }, [areas, props.selectedAreaIds])

  // A delineation's polygons while they are only proposed.
  const fieldDrafts = useMemo<GeoJSON.FeatureCollection | null>(() => {
    const f = props.fields
    if (!f?.fields_geojson) return null
    if (f.run_id && areas.some((a) => a.source_run_id === f.run_id)) return null
    try {
      return JSON.parse(f.fields_geojson) as GeoJSON.FeatureCollection
    } catch {
      return null
    }
  }, [props.fields, areas])

  const running = activeRuns(props)
  const busy = running.length > 0
  const runLog = useRunLog({
    running: running[0]?.running ?? false,
    progress: running[0]?.progress ?? 0,
    message: running[0]?.progressMsg ?? "",
  })
  /*
    A run that finishes opens what it produced. Watched as an edge, so opening
    another panel while a result is on the map is not undone by the next render.
  */
  const wasBusy = useRef(false)
  const lastProduct = useRef<ResultProduct | null>(null)
  if (props.running) lastProduct.current = "classify"
  else if (props.waterRunning) lastProduct.current = "water"
  else if (props.mineralBusy) lastProduct.current = "mineral"
  else if (props.fieldsBusy) lastProduct.current = "fields"
  else if (props.lulcRunning) lastProduct.current = "classify"
  /*
    What was on the map when the run began. A run that fails has said why in its
    notification, and changing the panel under the reader would only hide the form
    they have to correct.
  */
  const before = useRef<readonly unknown[]>([])
  useEffect(() => {
    const now = [props.result, props.water, props.mineral, props.fields]
    if (!wasBusy.current && busy) before.current = now
    if (wasBusy.current && !busy && now.some((v, i) => v !== before.current[i])) {
      setResultFocus(lastProduct.current)
      setPanel("result")
    }
    wasBusy.current = busy
    // Read at the edge of the run; the results themselves say nothing about when.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy])
  /*
    What the camera has to clear. The ref is read here on purpose: a finishing
    run's raster arrives in the render before the effect above opens its panel,
    and that raster is what the globe frames, so waiting for the panel would put
    it behind one.
  */
  const rightInsetPx =
    panel === "result" && resultView !== "summary"
      ? WIDE_PANEL_CLEARANCE_PX
      : panel || busy || opening || wasBusy.current
        ? PANEL_CLEARANCE_PX
        : 80

  useEffect(() => {
    if (panel === "activity") setSeenReports(reports.length)
  }, [panel, reports.length])

  return (
    <div className="absolute inset-0 flex bg-app">
      {app.surfaces}
      <ShellRail
        place={
          destination === "analyses"
            ? "analyses"
            : destination === "compare" || destination === "workflows"
              ? destination
              : panel === "areas"
              ? "areas"
              : panel === "activity"
                ? "activity"
                : "explore"
        }
        open={railOpen}
        unseen={reports.length > seenReports}
        onExplore={() => {
          setDestination("explore")
          setPanel((p) => (p === "areas" || p === "activity" ? null : p))
        }}
        onAreas={() => {
          setDestination("explore")
          togglePanel("areas")
        }}
        onAnalyses={goAnalyses}
        onCompare={goCompare}
        onWorkflows={goWorkflows}
        onActivity={() => {
          setDestination("explore")
          togglePanel("activity")
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ShellTopBar
          projectName={props.activeProjectName ?? "No project"}
          projects={projects}
          activeProjectId={props.activeProjectId}
          onActivateProject={props.onActivateProject}
          areas={areas}
          areaName={areaName}
          activeAreaId={props.activeAreaId}
          onPickArea={pickArea}
          railOpen={railOpen}
          onToggleRail={() => {
            keepRailOpen(!railOpen)
            setRailOpen(!railOpen)
          }}
          app={app}
          recentFiles={extras.recent_project_files ?? []}
        />
        <main className="relative min-h-0 min-w-0 flex-1">
          <Suspense fallback={null}>
            <GlobeSurface
              className="h-full w-full"
              areas={globeAreas}
              onPickArea={(id, extend) => {
                const picked = id.slice(id.indexOf(":") + 1)
                if (extend && props.onSelectAreas) props.onSelectAreas([picked], "toggle")
                else props.onActivateArea?.(picked)
              }}
              onBoxArea={
                props.onSelectAreas
                  ? (ids) =>
                      props.onSelectAreas?.(
                        ids.map((id) => id.slice(id.indexOf(":") + 1)),
                        "add"
                      )
                  : undefined
              }
              onClearSelection={props.selectedAreaIds?.length ? props.onClearSelection : undefined}
              polygon={props.customPolygon}
              // Deleting the area also drops what was made over it, as clearing does.
              onPolygonDrawn={(g) => (g ? props.onPolygonDrawn(g) : props.onClearArea())}
              onOverlayContext={(hits, at) => {
                const entries = hits.flatMap(({ key, fit }) => {
                  const l = layers.find((x) => x.id === key)
                  return l ? [{ key, title: l.title, hasLegend: false, propertyOnMap: false, fit }] : []
                })
                if (entries.length) setOverlayMenu({ at, entries })
              }}
              onImportPolygon={props.onImportPolygon}
              overlays={overlays}
              fieldDrafts={fieldDrafts}
              spreadM={spreadM}
              onSpreadChange={setSpreadM}
              initialView={props.initialView}
              onViewChange={(v) => {
                setCoords(v)
                props.onViewChange(v)
              }}
              frame={frame}
              rightInsetPx={rightInsetPx}
              pins={pins}
              onPlacePin={placePin}
              leadingTools={
                <>
                  <MapButton
                    label="Products"
                    active={panel === "products"}
                    onClick={() => togglePanel("products")}
                  >
                    <Sparkle className="size-4" />
                  </MapButton>
                  <MapButton
                    label="Visualization"
                    active={panel === "visualization"}
                    onClick={() => togglePanel("visualization")}
                  >
                    <ImageGlyph className="size-4" />
                  </MapButton>
                  <MapButton
                    label="Result"
                    active={panel === "result"}
                    onClick={() => togglePanel("result")}
                  >
                    <ChartLine className="size-4" />
                  </MapButton>
                  <MapButton
                    label="Points"
                    active={panel === "points"}
                    onClick={() => togglePanel("points")}
                  >
                    <Crosshair className="size-4" />
                  </MapButton>
                  <MapButton
                    label="Layers"
                    active={panel === "layers"}
                    onClick={() => togglePanel("layers")}
                  >
                    <Stack className="size-4" />
                  </MapButton>
                </>
              }
            />
          </Suspense>

          {panel === "areas" && (
            <AreasPanel
              areas={areas}
              hasProject={!!props.activeProjectId}
              activeAreaId={props.activeAreaId}
              selectedAreaIds={props.selectedAreaIds}
              onActivate={pickArea}
              onRename={props.onRenameArea}
              onDelete={props.onDeleteArea}
              onSelect={props.onSelectAreas}
              onClearSelection={props.onClearSelection}
              onImport={props.onImportPolygon}
              onPickBoundary={
                props.onPickBoundary
                  ? (name, geometry) => {
                      props.onPickBoundary?.(name, geometry)
                      const b = geometryBounds(geometry)
                      if (b) {
                        setFrame({
                          key: Date.now(),
                          bounds: { lon_min: b.lonMin, lat_min: b.latMin, lon_max: b.lonMax, lat_max: b.latMax },
                        })
                      }
                    }
                  : undefined
              }
              onClose={() => setPanel(null)}
            />
          )}
          {panel === "products" && (
            <RunOnMapContext.Provider value={(id) => void openRunIds([id])}>
              <ProductsPanel
                {...props}
                mineralOptions={props.mineralOptions ?? DEFAULT_MINERAL_RUN_OPTIONS}
                runLog={runLog}
                product={product}
                onProductChange={setProduct}
                onClose={() => setPanel(null)}
              />
            </RunOnMapContext.Provider>
          )}
          {panel === "visualization" && (
            <VisualizationPanel
              hasArea={props.hasArea}
              start={props.start}
              end={props.end}
              scenes={props.composeScenes}
              scenesLoading={props.composeScenesLoading}
              scenesError={props.composeScenesError}
              selectedSceneId={props.selectedSceneId}
              onSelectScene={props.onSelectScene}
              onListScenes={props.onListComposeScenes}
              kind={props.composeKind}
              onKindChange={props.onComposeKindChange}
              bands={props.composeBands}
              onBandsChange={props.onComposeBandsChange}
              index={props.composeIndex}
              onIndexChange={props.onComposeIndexChange}
              stretchLow={props.composeStretchLow}
              stretchHigh={props.composeStretchHigh}
              onStretchChange={props.onComposeStretchChange}
              running={props.composeRunning}
              progress={props.composeProgress}
              progressMsg={props.composeProgressMsg}
              onApply={props.onApplyComposition}
              composition={props.composition}
              gallery={props.compositionGallery ?? []}
              assets={assets}
              onSelect={(id) => props.onSelectComposition?.(id)}
              onRemove={(id) => props.onRemoveComposition?.(id)}
              onClearAll={props.onClearComposition}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === "result" && (
            <Suspense fallback={null}>
              <ResultPanel
                result={props.result}
                water={props.water}
                mineral={props.mineral}
                fields={props.fields}
                job={job}
                focus={resultFocus}
                view={resultView}
                onViewChange={setResultView}
                areas={areas}
                projectId={props.activeProjectId}
                runLabel={areaName}
                modelKind={props.modelKind}
                polygonGeoJSON={props.polygonGeoJSON}
                onAdoptFields={props.onAdoptFields}
                onPickZones={showZones}
                onRemove={removeResult}
                onClose={() => setPanel(null)}
              />
            </Suspense>
          )}
          {panel === "points" && (
            <PointsPanel
              result={props.result}
              classLayers={classLayers}
              points={points}
              placing={placing}
              onPlacing={setPlacing}
              onClear={(slot) =>
                setPoints((held) => {
                  const next = { ...held }
                  delete next[slot]
                  return next
                })
              }
              onClose={() => setPanel(null)}
            />
          )}
          {panel === "layers" && (
            <LayersPanel
              layers={layers}
              assets={assets}
              smoothOverlay={props.smoothOverlay}
              onSmoothOverlayChange={props.onSmoothOverlayChange}
              confidenceOnTop={props.confidenceOnTop}
              onConfidenceOnTopChange={props.onConfidenceOnTopChange}
              onChange={changeLayer}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === "activity" && <ActivityPanel onClose={() => setPanel(null)} />}

          <GlobeOverlayMenu
            target={overlayMenu}
            surface={document.body}
            onClose={() => setOverlayMenu(null)}
            onToggleProperty={() => {}}
            onTakeOff={(key) => changeLayer(key, { visible: false })}
          />

          {coords && (
            <span className="telemetry pointer-events-none absolute bottom-3 right-[3.5rem] z-[410] rounded-sm bg-[rgb(var(--p-ink)/0.82)] px-2 py-1 text-label tabular-nums text-foreground">
              {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}
            </span>
          )}

          {/*
            What is running, wherever the reader has gone. A classification takes
            minutes, and the product panel it started from may be closed long
            before it ends.
          */}
          {busy && panel !== "products" && (
            <div
              role="status"
              className="panel app-no-drag absolute bottom-10 left-1/2 z-[440] w-[24rem] max-w-[60%] -translate-x-1/2 rounded-md px-3 py-2"
            >
              {running.map((r) => (
                <div key={r.label}>
                  <div className="flex items-baseline justify-between gap-3 text-label">
                    <span className="truncate text-foreground">{r.progressMsg || r.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {Math.round(r.progress)} %
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-sm bg-[rgb(var(--p-control))]">
                    <div
                      className="h-full bg-primary transition-[width] duration-300"
                      style={{ width: `${Math.min(100, Math.max(0, r.progress))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {compareOpened && (
            <Suspense fallback={null}>
              <CompareScreen
                hidden={destination !== "compare"}
                runs={session}
                loading={loadingRuns}
                onAddRun={(run) => void addRuns([run])}
                onDropRun={dropRun}
              />
            </Suspense>
          )}

          {workflowsOpened && (
            <Suspense fallback={null}>
              <WorkflowsScreen
                hidden={destination !== "workflows"}
                runs={session}
                liveAssets={assets}
                loading={loadingRuns}
                onAddRun={(run) => void addRuns([run])}
                graph={compositor}
                onChange={setCompositor}
                onGlobe={setCompositorGlobe}
                fieldSets={fieldSets}
                fieldsTargetOf={fieldsTargetOf}
                onAdoptFields={props.onAdoptFields}
                onNeedRuns={(ids) =>
                  void addRuns(ids.flatMap((id) => savedRuns.filter((r) => r.id === id)))
                }
                runRecordOf={runRecordOf}
                saved={!!savedId}
                savedName={savedName}
                studios={props.studios ?? []}
                dirty={dirty}
                naming={naming}
                onNamingChange={setNaming}
                onConfirmName={confirmName}
                onOpenStudio={openWorkflow}
              />
            </Suspense>
          )}

          {managing && (
            <WorkflowManager
              boards={props.studios ?? []}
              openId={savedId}
              onDismiss={() => setManaging(false)}
              onChanged={async () => {
                await props.onStudiosMenu?.()
              }}
              // The work on screen outlived its record, and is still worth keeping.
              onOpenDeleted={() => {
                writeBoardMemory("savedId", null)
                writeBoardMemory("savedName", null)
                setSavedId(null)
                setSavedName(null)
              }}
            />
          )}

          {/* A second destructive act does not get a second way of asking. */}
          {pendingOpen && (
            <ConfirmDelete
              eyebrow="UNSAVED CHANGES"
              title={pendingOpen === "new" ? "Start a new workflow?" : `Open "${pendingOpen.name}"?`}
              subtitle={`This workflow has changes that were never saved${savedName ? ` to "${savedName}"` : ""}. They cannot be brought back. Cancel and save to keep both.`}
              confirmLabel={pendingOpen === "new" ? "Discard and start" : "Discard and open"}
              onCancel={() => setPendingOpen(null)}
              onConfirm={() => {
                const next = pendingOpen
                setPendingOpen(null)
                if (next === "new") askName(true)
                else props.onOpenStudio?.(next)
              }}
            />
          )}

          {startOpen && (
            <StartScreen
              onClose={() => setStartOpen(false)}
              studios={props.studios ?? []}
              openStudioId={savedId}
              onOpenStudio={openWorkflow}
              onBrowse={goAnalyses}
              showAtLaunch={startAtLaunch}
              onShowAtLaunchChange={(show) => {
                if (!prefs) return
                void savePrefs(
                  { ...prefs, extras_json: mergePreferenceExtras(prefs.extras_json, { start_screen: show }) },
                  { silent: true }
                ).catch(() => {
                  /* best-effort, as the other preference writers are */
                })
              }}
              recentFiles={extras.recent_project_files ?? []}
              onOpenFile={openProjectFile}
            />
          )}

          {/* Mounted once visited, so returning finds the folder the reader left open. */}
          {analysesOpened && (
            <div
              ref={pageRef}
              className={cn(
                "app-no-drag absolute inset-0 z-[480] flex-col bg-app",
                destination === "analyses" ? "flex" : "hidden"
              )}
            >
              <div className="min-h-0 flex-1">
                <RunBrowser
                  surface={pageRef.current}
                  activeProjectId={props.activeProjectId ?? null}
                  onActivateProject={props.onActivateProject}
                  onOpenRun={(run) => void openRun(run)}
                  onOpenReading={(run) => void openRun(run)}
                />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
