import {
} from "lucide-react"
import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from "react"
import type {
  CompositionOverlay,
  CompositeIndex,
  CompositeKind,
  DataCubeResult,
  DataCubeScene,
  FloodAnalysis,
  GeoJSONGeometry,
  ModelKind,
  PredictResult,
  SolarSitingAnalysis,
  SolarTerrainAnalysis,
  WaterAnalysis,
  WaterIndex,
  WindAnalysis,
} from "@/lib/types"
import {
  panelSelection,
  selectPanel,
  subscribePanelSelection,
} from "@/lib/panelSelection"
import type { AoiContourSchemeId } from "@/lib/aoiStyle"
/*
  MapLibre, not Leaflet. The three screens that mount the work map share one
  component, so they moved together; the studio's own drawing map is the last
  Leaflet map left. See components/map/MapSurface.tsx.
*/
import {
  isMapTool,
  type BoardToolId,
} from "@/lib/mapTools"
import type { SolarParams, WindParams } from "@/lib/energyState"
import {
  FLOOD_DEM_PRODUCTS,
  type FloodParams,
} from "@/components/flood/floodSetup"
import { cn } from "@/lib/utils"
import { BoardRunGraph, TOOL_ICON } from "@/components/studio/BoardRunGraph"
import { StudioLoading } from "@/components/studio/StudioLoading"
import { BOARD_TOOLS } from "@/lib/mapTools"
import {
  BOARD_DETAIL_REM,
  BOARD_LEFT_REM,
  BOARD_RIGHT_REM,
  boardPartition,
  clampDetail,
  partitionVars,
} from "@/lib/boardPartition"
import { rasterLayers } from "@/lib/mapLayers"
import { solarOverlayList } from "@/lib/solarLayers"
import { runAssets } from "@/lib/runAssets"
import { useRunLog } from "@/lib/runLog"
import { polygonOuterRing } from "@/lib/geometry"
import type { LayoutMode } from "@/lib/types"
import type { BasemapKind } from "@/lib/basemaps"

/*
  Lazy, and reached only from here. BoardSurface imports the scene, which
  imports three; a static import would put the whole library in the chunk that
  loads with the map screen.
*/
const BoardSurface = lazy(() =>
  import("@/components/studio/BoardSurface").then((m) => ({
    default: m.BoardSurface,
  }))
)
const prefetchBoard = () => void import("@/components/studio/BoardSurface")

/**
 * The run band's height, in rem.
 *
 * Measured rather than chosen: a 9px eyebrow on a ~14px line, the 4px gap under
 * it, and the tallest control at 1.375rem come to 40px, plus the scroller's
 * py-1. What is left is the air the one-line band did not have.
 */
/*
  The studio's geometry comes from lib/boardPartition, which is the one place
  that describes it. It used to be declared here and repeated as literals in
  six other files, and each repetition was a promise that two numbers written
  apart would stay equal -- a promise that broke four times.
*/
import { DataCubeModal } from "@/components/DataCubeModal"
import {
} from "@/components/OverlayToolsPanel"

export interface StudioScreenProps {
  /** Where the map was left last session; null starts at the default view. */
  initialView?: { lat: number; lon: number; zoom: number } | null
  /** Open tool tab, owned by the caller so it survives this screen unmounting. */
  /** Which layout draws this screen. See lib/types LayoutMode. */
  layoutMode?: LayoutMode
  /**
   * Switch the shell layout. Used when the studio opens: Sidebar and
   * column leaves the navigation column beside the board's own column, so the
   * board forces Dock (workspace) for as long as it is up.
   */
  onLayoutModeChange?: (
    mode: LayoutMode,
    opts?: { persist?: boolean }
  ) => void
  /**
   * The title bar's host for this screen's studio toggle.
   *
   * An element rather than a callback, because the button has to be DRAWN up
   * there while the state it reads stays down here. `board` is local to this
   * screen on purpose (see below), so handing the shell a node to render would
   * have meant handing it the state too, and returning to the map would stop
   * giving the map. Null until the bar mounts, and on every screen without one.
   */
  /**
   * Reported upward so the title bar can withhold the map's telemetry.
   *
   * The state stays here -- it must not survive leaving the screen -- and this
   * is a report of it, not a lift.
   */
  onBoardOpenChange?: (open: boolean) => void
  /** Go to another destination, for the dock layout's bar. */
  onNavigate: (groupId: string, itemId?: string) => void
  customPolygon: GeoJSONGeometry | null
  flyTo: { lat: number; lon: number; key: number } | null
  result: PredictResult | null
  /** Results the map finished with, still placeable on the board. */
  retainedRuns: readonly { id: string; result: PredictResult }[]
  /** Let go of one, which the board lists and cannot remove on its own. */
  onDropRetainedRun?: (id: string) => void
  overlayOpacity: number
  showConfidence: boolean
  confidenceOnTop: boolean
  smoothOverlay: boolean
  showPredictionOverlay: boolean
  showCompositionOverlay: boolean
  composition: CompositionOverlay | null
  /** Session gallery of applied compositions (newest first). */
  compositionGallery?: CompositionOverlay[]
  onSelectComposition?: (id: string) => void
  onRemoveComposition?: (id: string) => void
  swipeCompare: boolean
  swipeRatio: number
  areaLabel?: string
  onAreaLabelChange: (label: string) => void
  aoiContourScheme: AoiContourSchemeId
  onAoiContourSchemeChange: (id: AoiContourSchemeId) => void
  hasArea: boolean
  start: string
  end: string
  maxCloud: number
  monthlyBest: boolean
  mode: "single" | "temporal"
  modelKind: ModelKind
  prithviMode: "pixel" | "patch"
  running: boolean
  progress: number
  progressMsg: string
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
  onViewChange: (v: { lat: number; lon: number; zoom: number }) => void
  /** Which basemap is showing, for the credit in the title bar. */
  onCreditChange?: (c: { kind: BasemapKind; date: string | null }) => void
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void
  /** Adopt a run polygon as the active AOI without adding a catalog entry. */
  onAdoptAreaGeometry?: (geom: GeoJSONGeometry | null) => void
  /** Catalog of drawn/imported AOIs kept beside the active shape. */
  areas?: import("@/lib/areas").Area[]
  activeAreaId?: string
  activeProjectId?: string | null
  /** File new runs under another project, offered by the browser per project. */
  onActivateProject?: (id: string) => void
  activeProjectName?: string | null
  onActivateArea?: (id: string) => void
  onRenameArea?: (id: string, name: string) => void
  onDeleteArea?: (id: string) => void
  onLocationSelect: (lat: number, lon: number) => void
  onClearArea: () => void
  onImportPolygon: () => void
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
  onMaxCloudChange: (v: number) => void
  onMonthlyBestChange: (v: boolean) => void
  onModeChange: (m: "single" | "temporal") => void
  onModelKindChange: (m: ModelKind) => void
  onPrithviModeChange: (m: "pixel" | "patch") => void
  onOpacityChange: (v: number) => void
  onShowConfidenceChange: (v: boolean) => void
  onConfidenceOnTopChange: (v: boolean) => void
  onSmoothOverlayChange: (v: boolean) => void
  onShowPredictionOverlayChange: (v: boolean) => void
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
  onSwipeCompareChange: (v: boolean) => void
  onSwipeRatioChange: (v: number) => void
  onRun: () => void
  onAnalyzeLULC: () => void
  lulcRunning?: boolean
  onCloseResult: () => void
  /**
   * A request to open the board, bumped each time one arrives.
   *
   * A nonce rather than a boolean: the board's open state is this screen's, and
   * a flag would fire only on its first change -- opening the same studio
   * twice in a row has to work.
   */
  openBoardNonce?: number
  /** Saved studios, for the studio's own title block. */
  studios?: import("@/lib/studios").Studio[]
  onOpenStudio?: (board: import("@/lib/studios").Studio) => void
  onNewStudio?: () => void
  /** Called when the studio's board menu opens, to refresh the list. */
  /*
    Returns its promise, so a caller that needs the list BEFORE it draws again
    can wait for it. The menu that opens on hover does not and ignores it; the
    manage dialog does, since it shows the result of its own rename or delete.
  */
  onStudiosMenu?: () => void | Promise<void>
  onNewClassification: () => void
  onViewDataCube: () => void
  dataCubeLoading?: boolean
  dataCubeOpen?: boolean
  dataCubeError?: string | null
  dataCubeResult?: DataCubeResult | null
  onCloseDataCube: () => void
  water?: WaterAnalysis | null
  /**
   * The two solar products that produce a raster, and the state that draws them.
   *
   * This screen used to know nothing about solar: its rasters were drawn on the
   * energy screen, which names and clears them beside the run that produced
   * them (see the note above the board's layer table). The board is now a
   * second surface that can do exactly that -- name a raster, set its opacity,
   * remove it -- so the precondition is met and the rasters can come here.
   *
   * Optional throughout: solar is one product among several, and a screen with
   * no solar in hand should not have to say so six times.
   */
  solarTerrain?: SolarTerrainAnalysis | null
  solarSiting?: SolarSitingAnalysis | null
  showSolarTerrain?: boolean
  showSolarSiting?: boolean
  solarTerrainOpacity?: number
  solarSitingOpacity?: number
  /**
   * Where the board's eye and opacity for a solar row land.
   *
   * A callback rather than the store, because the solar store is a reducer that
   * belongs to the energy screen. This screen states WHICH raster changed and
   * how; translating that into a dispatch is the owner's business, the same
   * shape the composition and water rows already use.
   */
  onSolarLayerChange?: (
    id: "terrain" | "siting",
    patch: { visible?: boolean; opacity?: number }
  ) => void
  /**
   * The solar inputs, so the board can START a solar run and not only draw one.
   *
   * The whole flat set is passed rather than the four the two raster products
   * read, because it is one store and slicing it here would be this screen
   * deciding which parameters exist. The band shows the four that reach a
   * request; the rest are the energy screen's business.
   */
  solarParams?: SolarParams
  onSolarParamsChange?: (patch: Partial<SolarParams>) => void
  /** Absent where solar cannot be run; the band then does not offer it. */
  onRunSolar?: (product: "terrain" | "siting") => void
  solarBusy?: boolean
  solarProgress?: number
  solarProgressMsg?: string
  /*
    Wind and flood, in the shape solar already established: the whole parameter
    store plus a patch, and a runner that is absent where the product cannot be
    started. Both were screens of their own until the band grew cards for them.
  */
  windParams?: WindParams
  onWindParamsChange?: (patch: Partial<WindParams>) => void
  onRunWind?: () => void
  windBusy?: boolean
  windProgress?: number
  windProgressMsg?: string
  /** The AOI as GeoJSON text, for the research pack's manifest. */
  polygonGeoJSON?: string
  /** What the screening found, for the editor that reads it. */
  windResult?: WindAnalysis | null
  onClearWind?: () => void
  floodParams?: FloodParams
  onFloodParamsChange?: (patch: Partial<FloodParams>) => void
  onRunFlood?: () => void
  floodBusy?: boolean
  floodProgress?: number
  floodProgressMsg?: string
  floodResult?: FloodAnalysis | null
  onClearFlood?: () => void
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

export function StudioScreen(props: StudioScreenProps) {
  // Held by the caller, not here. This screen is unmounted whenever the user
  // goes to another one, so local state put the dock back on "classify" on
  // every return -- including a return from a water run, which left a water
  // raster on the map with the classification panel open beside it.
  /*
    Subscribed rather than received. It was a prop because this screen remounts
    on every return to it and a useState here forgot the choice -- a module
    outlives the remount for free, and App stops re-rendering for a collapse.
    See lib/panelSelection.ts.
  */
  const leftPanel = useSyncExternalStore(
    subscribePanelSelection,
    panelSelection
  )
  const onLeftPanelChange = selectPanel
  /**
   * Which right-edge drawer is open, at most one.
   *
   * The two occupy the same slot -- same anchor, same width, same layer -- and
   * a user reading run parameters is not simultaneously adjusting overlay
   * opacity, so they exclude each other rather than being stacked or offset.
   * A boolean per drawer would let both open onto the same rectangle.
   *
   * The docked layout never sets "config", so its behaviour is unchanged.
   */
  const [rightDrawer, setRightDrawer] = useState<"config" | "overlays" | null>(
    null
  )
  /**
   * The workspace island's measured width, so the period track can retract past
   * it the way it already retracts past the docked column.
   *
   * Measured rather than declared: the island sizes to its contents, and the
   * run button's label changes with the product and with whether it is running.
   */
  const [barWidthPx, setBarWidthPx] = useState(0)
  const workspace = props.layoutMode === "workspace"
  /**
   * The band's own tool, which is the map's plus solar.
   *
   * Not `leftPanel`, and the difference is the point: `leftPanel` is a
   * MapToolId, read by the navigation column and by this screen's dock, and a
   * fourth id would put solar back on a screen that removed it deliberately.
   * Choosing a MAP tool here still writes leftPanel, so the two agree about the
   * three they share; choosing solar leaves it alone.
   *
   * Null until the band is used, so it opens on whatever the map was showing.
   */
  const [boardTool, setBoardTool] = useState<BoardToolId | null>(null)
  /** Which of the two raster-producing solar products the band will run. */
  const [solarProduct, setSolarProduct] = useState<"terrain" | "siting">(
    "terrain"
  )
  /**
   * Whether the board is showing a map to draw an area on.
   *
   * Only from the board: on the map the drawing tool is already there, and a
   * modal over it would be a second map over the one that has one.
   */
  /**
   * The detail band's height, in rem, which the reader can drag.
   *
   * Kept here rather than inside the band because the foot RESERVATION is
   * derived from it: --map-foot is what the result panel, the drawers and the
   * scene's axis gizmo measure from, so a band that grew without telling this
   * level would slide under all three.
   */
  const [statsRem, setStatsRem] = useState(BOARD_DETAIL_REM)
  /*
    Collapsed is remembered SEPARATELY from the height, so unfolding restores
    the height that was dragged rather than resetting it to the default. The
    two are different questions: how tall, and whether shown.
  */
  const [statsCollapsed, setStatsCollapsed] = useState(false)
  /*
    The columns' widths, which the reader owns rather than the source.

    Held here with the band's height because --map-foot and the two recesses
    are derived from the same partition, and a divided owner is how the seams
    drifted apart in the first place.
  */
  const [leftRem, setLeftRem] = useState(BOARD_LEFT_REM)
  const [rightRem, setRightRem] = useState(BOARD_RIGHT_REM)
  const partition = boardPartition({
    leftRem,
    rightRem,
    detailRem: statsRem,
    detailCollapsed: statsCollapsed,
  })
  /**
   * Whether the studio was asked for by name rather than toggled onto what is
   * on screen.
   *
   * A saved studio and the opening-surface preference both arrive as the
   * nonce, and both mean the same thing: this reader wants the studio, not the
   * studio OF something.
   */
  const nonce = props.openBoardNonce ?? 0
  useEffect(() => {
    // Zero is the resting value, not a request.
    if (nonce > 0) {
      setRightDrawer(null)
    }
  }, [nonce])
  const setLeftPanel = onLeftPanelChange

  // The three status panels share one slot at the bottom of the map, so only
  // the one matching the open tool is shown. Water keeps its own rule: with no
  // classification to compete for the slot it takes it whatever tab is open,
  // because this screen is remounted on every return from the analysis page,
  // which resets the tab to classify and would otherwise leave a restored water
  // raster on the map with nothing naming it and no way to clear it.
  //
  // The solar chain used to sit above water here and to gate the two below it.
  // Its rasters are now drawn on the energy screen, which names and clears them
  // beside the run that produced them, so nothing on this map can be a solar
  // layer and the gate had no case left to exclude.
  const showWaterStatus =
    (leftPanel === "water" || !props.result) && !!props.water
  const showCompositionStatus =
    !showWaterStatus &&
    (leftPanel === "compose" || (!props.result && !!props.composition))
  const showPredictionStatus =
    !showWaterStatus && !showCompositionStatus && !!props.result

  /*
    What the board draws, from the same table the map reads. Every control in
    overlay tools -- what is shown, how solid, whether the prediction sits
    under the confidence -- therefore governs both, and neither can drift into
    disagreeing with the other about what is on screen.
  */
  const solarOverlays = solarOverlayList({
    terrain: props.solarTerrain,
    siting: props.solarSiting,
    showTerrain: props.showSolarTerrain ?? true,
    showSiting: props.showSolarSiting ?? true,
    terrainOpacity: props.solarTerrainOpacity ?? 1,
    sitingOpacity: props.solarSitingOpacity ?? 1,
  })

  const boardLayers = rasterLayers({
    result: props.result,
    showPredictionOverlay: props.showPredictionOverlay,
    overlayOpacity: props.overlayOpacity,
    showConfidence: props.showConfidence,
    /*
      Always, on the board, whatever the map is set to.

      On one plane that switch is a workaround: confidence is drawn over the
      classification, so reading confidence alone means WITHHOLDING the
      classification. The board separates the two along Y, where both can be
      read at once -- the occlusion it works around does not happen here.

      Honouring the map's setting left a dead control. With confidence on and
      the switch off, rasterLayers marks the classification not-visible, so its
      row showed a struck-through eye; clicking it called
      onShowPredictionOverlayChange(true) on a flag that was already true, and
      nothing moved. A control that cannot be operated is worse than an absent
      one, because the user spends time deciding it is their mistake.
    */
    confidenceOnTop: true,
    smoothOverlay: props.smoothOverlay,
    composition: props.composition,
    showCompositionOverlay: props.showCompositionOverlay,
    composeOpacity: props.composeOpacity,
    water: props.water,
    showWaterOverlay: props.showWaterOverlay,
    waterOpacity: props.waterOpacity,
    solarOverlays,
  })

  /**
   * Turns a row of the board's layer list back into the state it came from.
   *
   * The table describes what exists; the switches that govern it live here,
   * one per product. Routing through this rather than giving each layer its
   * own callback keeps the table free of behaviour -- it names rasters, and
   * whose state a raster answers to is this screen's business.
   *
   * Prediction and confidence share overlayOpacity, so moving either moves
   * both. That is the existing model rather than something introduced here:
   * the map's own panel has one slider for the pair.
   */
  /*
    Reported to the title bar, which withholds the map's latitude, longitude,
    zoom and imagery credit while the studio covers the map. Coerced, because
    the expression above is an `&&` chain that yields undefined rather than
    false when `board` is unset.
  */
  const reportBoardOpen = props.onBoardOpenChange
  useEffect(() => {
    reportBoardOpen?.(true)
    // Leaving the screen closes it as far as the title bar is concerned:
    // otherwise a true outlives the surface that justified it, and the map's
    // readings stay hidden on a screen that has a map.
    return () => reportBoardOpen?.(false)
  }, [reportBoardOpen])

  /*
    The studio and "Sidebar and column" fight for the left edge: the shell
    keeps AppNav while the board draws its own 15rem column. Dock (workspace)
    already clears the navigation column, which is the arrangement the board
    was drawn for. Remember the mode we left so closing the board puts it back
    rather than silently rewriting the user's preference.
  */
  const layoutBeforeBoardRef = useRef<LayoutMode | null>(null)
  const onLayoutModeChange = props.onLayoutModeChange
  const layoutMode = props.layoutMode ?? "docked"
  useEffect(() => {
    if (!onLayoutModeChange) return
    if (layoutMode !== "workspace") {
      if (layoutBeforeBoardRef.current == null) {
        layoutBeforeBoardRef.current = layoutMode
      }
      // Not persisted: this is what the surface requires, not what the reader
      // chose, and storing it edits their layout setting behind their back --
      // every launch, since this screen is where a session opens.
      onLayoutModeChange("workspace", { persist: false })
    }
  }, [layoutMode, onLayoutModeChange])

  /*
    And put it back on the way out, which used to happen when the board closed.
    A ref rather than the effect above, so leaving the screen restores the mode
    without the restore re-running every time the mode changes under it.
  */
  const restoreLayout = useRef<(() => void) | null>(null)
  restoreLayout.current = () => {
    const prev = layoutBeforeBoardRef.current
    if (prev == null || !onLayoutModeChange) return
    layoutBeforeBoardRef.current = null
    onLayoutModeChange(prev, { persist: false })
  }
  useEffect(() => () => restoreLayout.current?.(), [])

  /*
    The same table the overlay tools panel lists, so the board's data mode and
    that panel cannot come to disagree about what the run produced.
  */
  const boardAssets = runAssets({
    result: props.result,
    composition: props.composition,
    compositionGallery: props.compositionGallery ?? [],
    water: props.water,
    areaLabel: props.areaLabel,
    modelKind: props.modelKind,
    composeSceneDate:
      props.composeScenes.find((s) => s.id === props.selectedSceneId)?.date ??
      null,
    showCompositionOverlay: props.showCompositionOverlay,
    showWaterOverlay: props.showWaterOverlay,
    composeOpacity: props.composeOpacity,
    waterOpacity: props.waterOpacity,
    solarTerrain: props.solarTerrain,
    solarSiting: props.solarSiting,
    showSolarTerrain: props.showSolarTerrain,
    showSolarSiting: props.showSolarSiting,
    solarTerrainOpacity: props.solarTerrainOpacity,
    solarSitingOpacity: props.solarSitingOpacity,
  })

  const changeBoardLayer = (id: string, patch: { visible?: boolean; opacity?: number }) => {
    if (id === "composition") {
      if (patch.visible !== undefined) props.onShowCompositionOverlayChange(patch.visible)
      if (patch.opacity !== undefined) props.onComposeOpacityChange(patch.opacity)
      return
    }
    if (id === "water") {
      if (patch.visible !== undefined) props.onShowWaterOverlayChange(patch.visible)
      if (patch.opacity !== undefined) props.onWaterOpacityChange(patch.opacity)
      return
    }
    if (id === "confidence") {
      if (patch.visible !== undefined) props.onShowConfidenceChange(patch.visible)
      if (patch.opacity !== undefined) props.onOpacityChange(patch.opacity)
      return
    }
    if (id === "prediction") {
      if (patch.visible !== undefined) props.onShowPredictionOverlayChange(patch.visible)
      if (patch.opacity !== undefined) props.onOpacityChange(patch.opacity)
    }
    /*
      lib/mapLayers.ts names these `solar:terrain` and `solar:siting`, and they
      are the only layer ids carrying a colon -- which is why the sidebar's row
      parser splits on the LAST one.

      This used to read that solar rasters carry no switch. They do: the solar
      store holds showTerrain/terrainOpacity for each. What was missing was a
      route from here to that store, so the eye and the opacity field were
      drawn and inoperative -- the dead control this screen argues against a
      few lines above.
    */
    if (id === "solar:terrain" || id === "solar:siting") {
      props.onSolarLayerChange?.(
        id === "solar:terrain" ? "terrain" : "siting",
        patch
      )
    }
  }

  const selectedSceneDate =
    props.composeScenes.find((s) => s.id === props.selectedSceneId)?.date ??
    null

  /**
   * The run action for whichever product is in view.
   *
   * The three panels each own a run button with its own label, its own progress
   * state and its own enabling rule, and the rules genuinely differ:
   * classification additionally requires both dates, and a composition
   * additionally requires a selected scene. The workspace bar carries one
   * button, so the differences are gathered here rather than being flattened
   * into a single condition that would be wrong for two of the three.
   *
   * Composition is the one this fixes rather than moves: its Apply button sits
   * inside a section called "Display", under the stretch inputs, where a reader
   * looking for the action does not pass.
   */
  const run =
    leftPanel === "water"
      ? {
          running: props.waterRunning,
          progress: props.waterProgress,
          progressMsg: props.waterProgressMsg,
          label: props.waterRunning ? "Mapping" : "Map water",
          canRun: props.hasArea,
          onRun: props.onRunWater,
        }
      : leftPanel === "compose"
        ? {
            running: props.composeRunning,
            progress: props.composeProgress,
            progressMsg: props.composeProgressMsg,
            label: props.composeRunning ? "Applying" : "Apply",
            canRun: props.hasArea && !!props.selectedSceneId,
            onRun: props.onApplyComposition,
          }
        : {
            running: props.running,
            progress: props.progress,
            progressMsg: props.progressMsg,
            label: props.running ? "Classifying" : "Classify",
            canRun: props.hasArea && !!props.start && !!props.end,
            onRun: props.onRun,
          }

  /*
    The band's run, which is the island's for the three map tools and its own
    for solar. Kept apart from `run` above rather than adding a branch to it:
    that object also feeds the workspace bar, which belongs to the map and has
    no solar to start.
  */
  const bandTool: BoardToolId | null = boardTool ?? leftPanel
  const solarRunnable = !!props.solarParams && !!props.onRunSolar
  const windRunnable = !!props.windParams && !!props.onRunWind
  const floodRunnable = !!props.floodParams && !!props.onRunFlood
  const boardRun =
    bandTool === "wind" && windRunnable
      ? {
          running: props.windBusy ?? false,
          progress: props.windProgress ?? 0,
          progressMsg: props.windProgressMsg ?? "",
          label: props.windBusy ? "Running" : "Screen the wind",
          canRun: props.hasArea && !props.windBusy,
          onRun: () => props.onRunWind?.(),
        }
      : bandTool === "flood" && floodRunnable
      ? {
          running: props.floodBusy ?? false,
          progress: props.floodProgress ?? 0,
          progressMsg: props.floodProgressMsg ?? "",
          label: props.floodBusy ? "Running" : "Map the envelope",
          // Two products or nothing, which the sidecar enforces and the card
          // refuses to unpick; this is the same rule reported before the run.
          canRun:
            props.hasArea &&
            !props.floodBusy &&
            (props.floodParams?.demIds.length ?? 0) >= 2,
          onRun: () => props.onRunFlood?.(),
        }
      : bandTool === "solar" && solarRunnable
      ? {
          running: props.solarBusy ?? false,
          progress: props.solarProgress ?? 0,
          progressMsg: props.solarProgressMsg ?? "",
          label: props.solarBusy
            ? "Running"
            : solarProduct === "terrain"
              ? "Map irradiation"
              : "Map siting",
          // One sidecar run at a time, which solar already enforces across its
          // own products; the board must not be a second way past it.
          canRun: props.hasArea && !props.solarBusy,
          onRun: () => props.onRunSolar?.(solarProduct),
        }
      : run

  /*
    What the run in progress has said. Built from the SAME resolved run the band
    reports, so the log cannot come from one product while the button reports
    another.
  */
  const runLog = useRunLog({
    running: boardRun.running,
    progress: boardRun.progress,
    message: boardRun.progressMsg,
  })

  /**
   * The studio's Run tab: which product, and its own parameters.
   *
   * The SAME panels the map screen docks, in a third container. They were kept
   * off the board to avoid a second place to set a period -- which was right
   * about the danger and wrong about the fix. One component with one state
   * behind it cannot disagree with itself, and the board is where the work is
   * now started, so sending someone to the map to choose a model was sending
   * them away from the subject.
   *
   * The tool selection is shared with the map for the same reason: `leftPanel`
   * is the answer to "which product", and a board with its own would be two
   * answers.
   */

  /*
    The run editor's header: what the run is ABOUT, and how it is run.

    The tool tabs used to open the band's own left end and the mode sat at its
    far right, both inside a strip that ran past two thousand pixels and
    scrolled. A header's left zone is for exactly the first of those -- which
    subject the editor is showing -- and the guidelines expand a glyphable
    enum into icon buttons, which the two modes are and the three models are
    not.
  */
  const runBarHeader = {
    menus: (
      <>
        {BOARD_TOOLS.filter((t) =>
          t.id === "solar"
            ? !!props.solarParams
            : t.id === "wind"
              ? !!props.windParams
              : t.id === "flood"
                ? !!props.floodParams
                : true
        ).map(
          (t) => {
            const on = bandTool === t.id
            const Icon = TOOL_ICON[t.id]
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => {
                  setBoardTool(t.id)
                  if (isMapTool(t.id)) setLeftPanel(t.id)
                }}
                title={t.label}
                className={cn(
                  "flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-meta transition-colors",
                  on
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
                )}
              >
                <Icon className="size-3 shrink-0" strokeWidth={1.75} />
                {/*
                  Every tab named, not only the chosen one. Naming the active
                  tab alone tells a reader what they already know -- they just
                  pressed it -- and leaves the three they have not tried as
                  bare glyphs, which is the half of the choice that actually
                  needs saying. `header-label` withdraws them together when the
                  area is too narrow to carry four names.
                */}
                <span className={cn(!on && "header-label")}>{t.label}</span>
              </button>
            )
          }
        )}
      </>
    ),
    /*
      THE MODE MOVED INTO THE GRAPH and is not offered twice.

      It was a header radio beside the tool tabs, which put a run's INPUT in
      the row that chooses which product is in view -- and the two are
      different questions. Every other input the run reads is a card now, so
      the mode being the one left in the header made the header look like part
      of the form.

      The correction it carries is the reason it could not simply be restyled.
      `modeBlockedBy` refuses the temporal mode under a model that cannot
      produce it, and `StudioHeaderRadio` has no refused state -- it draws a
      chosen half and an unchosen half and nothing else -- so the studio was
      offering a mode the run would not honour. A card can say why.
    */
    options: null,
  }

  /*
    The run controls, handed to the studio as a node.

    They used to stand in the foot beside the detail band, which is where a
    band goes; inside the area tree they are an editor like any other and the
    tree decides where. The props stay here because the parameters, handlers
    and progress are the map screen's.
  */
  const runBarNode = (
    <BoardRunGraph
      /*
        The tool is READ here and changed in the header above, which is the
        only place it was ever changed from. The band declared an
        `onToolChange` and never called it: its tab strip had already moved to
        `runBarHeader`, where the handler also syncs `leftPanel` for the map's
        dock. A prop nothing calls is a second way in that does not exist.
      */
      tool={bandTool}
      wind={
        props.windParams && props.onRunWind
          ? {
              recordYears: props.windParams.recordYears,
              onRecordYearsChange: (v) =>
                props.onWindParamsChange?.({ recordYears: v }),
              hubHeightM: props.windParams.hubHeightM,
              onHubHeightChange: (v) =>
                props.onWindParamsChange?.({ hubHeightM: v }),
              calmThresholdMS: props.windParams.calmThresholdMS,
              onCalmThresholdChange: (v) =>
                props.onWindParamsChange?.({ calmThresholdMS: v }),
              roughnessLowM: props.windParams.roughnessLowM,
              roughnessHighM: props.windParams.roughnessHighM,
              onRoughnessChange: (low, high) =>
                props.onWindParamsChange?.({
                  roughnessLowM: low,
                  roughnessHighM: high,
                }),
            }
          : undefined
      }
      flood={
        props.floodParams && props.onRunFlood
          ? {
              demIds: props.floodParams.demIds,
              onDemIdsChange: (ids) =>
                props.onFloodParamsChange?.({ demIds: ids }),
              demOptions: FLOOD_DEM_PRODUCTS,
              referenceThresholdM: props.floodParams.referenceThresholdM,
              onReferenceThresholdChange: (v) =>
                props.onFloodParamsChange?.({ referenceThresholdM: v }),
              drainageKm2: props.floodParams.drainageKm2,
              onDrainageChange: (v) =>
                props.onFloodParamsChange?.({ drainageKm2: v }),
            }
          : undefined
      }
      solar={
        props.solarParams && props.onRunSolar
          ? {
              product: solarProduct,
              onProductChange: setSolarProduct,
              hourlyYears: props.solarParams.hourlyYears,
              onHourlyYearsChange: (v) =>
                props.onSolarParamsChange?.({ hourlyYears: v }),
              season: props.solarParams.season,
              onSeasonChange: (season) =>
                props.onSolarParamsChange?.({ season }),
              slopeAcceptableDeg: props.solarParams.slopeAcceptableDeg,
              slopeRestrictiveDeg: props.solarParams.slopeRestrictiveDeg,
              onSlopeChange: (acceptable, restrictive) =>
                props.onSolarParamsChange?.({
                  slopeAcceptableDeg: acceptable,
                  slopeRestrictiveDeg: restrictive,
                }),
            }
          : undefined
      }
      /*
        The composition's own parameters, handed over as one object for the
        reason the solar bundle is: they arrive together, and a graph offered
        no way to apply a composition must not draw cards for one. Every value
        is the map screen's own state passed straight through, so the panel and
        the graph cannot come to disagree about what the next composite is.
      */
      compose={{
        scenes: props.composeScenes,
        scenesLoading: props.composeScenesLoading,
        scenesError: props.composeScenesError,
        selectedSceneId: props.selectedSceneId,
        onSelectScene: props.onSelectScene,
        onListScenes: props.onListComposeScenes,
        kind: props.composeKind,
        onKindChange: props.onComposeKindChange,
        bands: props.composeBands,
        onBandsChange: props.onComposeBandsChange,
        index: props.composeIndex,
        onIndexChange: props.onComposeIndexChange,
        stretchLow: props.composeStretchLow,
        stretchHigh: props.composeStretchHigh,
        onStretchChange: props.onComposeStretchChange,
      }}
      water={{
        index: props.waterIndex,
        onIndexChange: props.onWaterIndexChange,
      }}
      hasArea={props.hasArea}
      areaLabel={props.areaLabel}
      onImportPolygon={props.onImportPolygon}
      onClearArea={props.onClearArea}
      start={props.start}
      end={props.end}
      onStartChange={props.onStartChange}
      onEndChange={props.onEndChange}
      maxCloud={props.maxCloud}
      onMaxCloudChange={props.onMaxCloudChange}
      monthlyBest={props.monthlyBest}
      onMonthlyBestChange={props.onMonthlyBestChange}
      modelKind={props.modelKind}
      onModelKindChange={props.onModelKindChange}
      mode={props.mode}
      onModeChange={props.onModeChange}
      /*
        The chosen tool's own run, resolved once above for both the island
        and this graph. Two resolutions of "can this go" would be two
        answers.
      */
      runLabel={boardRun.label}
      running={boardRun.running}
      progress={boardRun.progress}
      progressMsg={boardRun.progressMsg}
      canRun={boardRun.canRun}
      blockedBy={
        !props.hasArea
          ? "Draw an area on the globe, or bring one in from the Areas tab."
          : (bandTool === "solar" && props.solarBusy) ||
              (bandTool === "wind" && props.windBusy) ||
              (bandTool === "flood" && props.floodBusy)
            ? "The sidecar runs one analysis at a time."
            : bandTool === "flood" &&
                (props.floodParams?.demIds.length ?? 0) < 2
              ? "Pick at least two elevation models: the envelope is what they disagree about."
              : bandTool === "compose" && !props.selectedSceneId
                ? "List the scenes for this period and choose one."
                : undefined
      }
      onRun={boardRun.onRun}
      onAnalyzeLULC={props.onAnalyzeLULC}
      lulcRunning={props.lulcRunning}
      /*
        The same log the stats column draws, from the same resolved run. The
        run card's method panel reads it after the run as well as during, which
        is when most of its questions are asked.
      */
      runLog={runLog}
    />
  )

  return (
    <div
      className="relative h-full min-h-0 w-full"
      /*
        The height of whatever holds the foot, which surfaces anchored to the
        bottom clear by measuring from here.

        Two values because two surfaces hold it. On the map it is the period
        track, a row of dates and a slider. On the board it is the run band,
        which carries a product's whole parameter set and stacks each group's
        label above its controls -- on one line the label sat in front of its
        own values and read as part of them.

        Raised HERE rather than given to the band alone, because everything
        that already clears the foot then clears the taller one for free: the
        result panel, the drawers, and the scene's own axis helper, which reads
        this variable to lift itself off the band. A private height for the band
        would have left all three overlapping it.

        The workspace bar does NOT enter this: it is an island at the left, and
        raising the reservation to clear it lifted the tile attribution at the
        opposite edge by four rem it had no reason to move, tearing it off the
        track it is meant to sit flush against.
      */
      style={
        {
/*
            Published by the partition, not written here. Everything anchored
            to the bottom measures from --map-foot -- the result panel, the
            drawers, the status panels and the scene's axis helper -- and the
            columns publish their widths too, so the scene can read them
            instead of holding a copy of a number it cannot import.
          */
          ...partitionVars(partition, true),
        } as React.CSSProperties
      }
    >
      {/*
        A real surface, not null.

        The studio is a lazy chunk carrying three.js, so the first paint of a
        session downloads and parses it before anything of the studio exists. A
        blank frame there reads as an application that did not start.
      */}
      <Suspense
          fallback={
            <div className="app-no-drag absolute inset-0 z-[500]">
              <StudioLoading />
            </div>
          }
        >
          <BoardSurface
            /*
              REMOUNTED WHEN A BOARD IS OPENED, which is what makes opening
              one from inside the studio work at all.

              Everything the surface holds is seeded from `boardMemory` on
              mount -- that is how a restored board arrives -- so a restore
              into a surface already up would write the memory and change
              nothing on screen. The nonce is the same request that opens the
              studio in the first place; keying by it turns a second request
              into the mount the restore path already expects.
            */
            key={`studio-${nonce}`}
            /*
              The band's height, and the two gestures that change it. Clamped
              here rather than in the band: the reservation --map-foot is
              derived from this number, so the bound belongs with the value
              the layout is computed from.
            */
            detailHeightRem={statsRem}
            // Bounded by the partition, which owns them: the reservation is
            // derived from this number, so the bound belongs with the value.
            onDetailResize={(rem) => setStatsRem(clampDetail(rem))}
            detailCollapsed={statsCollapsed}
            onDetailToggleCollapsed={() => setStatsCollapsed((v) => !v)}
            runBar={runBarNode}
            runBarHeader={runBarHeader}
            layers={boardLayers}
            assets={boardAssets}
            retainedRuns={props.retainedRuns}
            onDropRetainedRun={props.onDropRetainedRun}
            /*
              What this run's colours mean. Not derivable from the layers:
              a layer is what is drawn, and class_stats, the water index and
              the solar scale are what it means -- they live on the payload
              and stop here otherwise.
            */
            /*
              Straight to the same handler the drawing map and the map itself
              use. Reusing a shape and drawing one land in one place, so the
              application cannot come to hold two ideas of what the area is.
            */
            onUseArea={props.onAdoptAreaGeometry ?? props.onPolygonDrawn}
            /*
              And the same handler again for the globe, which DRAWS rather
              than adopts. `onUseArea` cannot carry a removal -- it takes a
              geometry, not a geometry or nothing -- and clearing the shape is
              half of what a drawing tool does.
            */
            customPolygon={props.customPolygon}
            onPolygonDrawn={props.onPolygonDrawn}
            catalogAreas={props.areas}
            initialView={props.initialView}
            onViewChange={props.onViewChange}
            activeProjectId={props.activeProjectId}
            onActivateProject={props.onActivateProject}
            activeProjectName={props.activeProjectName}
            activeAreaId={props.activeAreaId}
            onActivateArea={props.onActivateArea}
            onRenameArea={props.onRenameArea}
            onDeleteArea={props.onDeleteArea}
            legendSources={{
              result: props.result,
              water: props.water,
              solarTerrain: props.solarTerrain,
              solarSiting: props.solarSiting,
              composition: props.composition,
            }}
            /*
              The run on screen may never have been saved, so it has no id of
              its own to give. The board only needs one that is stable while
              it is open, and distinct from the ids of runs loaded beside it.
            */
            runId={props.result?.run_id || "current"}
            /*
              The period the run covered, which is what tells two runs of one
              area apart. The result's own range where the sidecar reported
              one, since it names the scenes actually used rather than the
              window that was asked for.
            */
            /*
              What was actually drawn. The board outlines the AREA rather
              than the raster's box, and a box around an area claims ground
              the analysis never saw.
            */
            aoiPolygon={
              polygonOuterRing(
                props.customPolygon ??
                  ({ type: "Polygon", coordinates: [] } as GeoJSONGeometry)
              ) ?? undefined
            }
            runPeriod={
              props.result?.date_range?.length === 2
                ? `${props.result.date_range[0]} → ${props.result.date_range[1]}`
                : `${props.start} → ${props.end}`
            }
            onLayerChange={changeBoardLayer}
            onSelectComposition={props.onSelectComposition}
            onRemoveComposition={props.onRemoveComposition}
            smooth={props.smoothOverlay}
            onSmoothChange={props.onSmoothOverlayChange}
            /*
              The subject's own name, and only a generic one when there is
              genuinely no subject.

              This read `props.areaLabel || "Analysis"`, and "Analysis" is
              what a reader saw whenever the AOI label was empty -- a row in
              the tree named after no ground, indistinguishable from a saved
              run and impossible to place. The label is the last resort now
              rather than the only source: the run's own name first, then the
              active AOI's, then the map's label.
            */
            title={
              props.areas?.find((a) => a.id === props.activeAreaId)?.name ||
              props.areaLabel ||
              ""
            }
            studios={props.studios}
            onOpenStudio={props.onOpenStudio}
            onNewStudio={props.onNewStudio}
            onStudiosMenu={props.onStudiosMenu}
            polygonGeoJSON={props.polygonGeoJSON}
            windResult={props.windResult}
            onClearWind={props.onClearWind}
            floodResult={props.floodResult}
            onClearFlood={props.onClearFlood}
            /*
              WHERE A FAILED SURFACE GOES, which used to be the map underneath.

              BoardSurface calls this when a WebGL context cannot be created --
              too many live contexts, or a driver reset -- because a blank board
              says nothing. With the studio as the screen there is nothing
              underneath, so it has to be a destination: the analysis list,
              which needs no GL and is somewhere a reader can work from.
            */
            onClose={() => props.onNavigate("analysis")}
          />
        </Suspense>

      <DataCubeModal
        open={!!props.dataCubeOpen}
        loading={!!props.dataCubeLoading}
        error={props.dataCubeError ?? null}
        result={props.dataCubeResult ?? null}
        onClose={props.onCloseDataCube}
      />
    </div>
  )
}
