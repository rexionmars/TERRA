import {
  Droplet,
  Grid2x2,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react"
import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence } from "motion/react"
import type {
  CompositionOverlay,
  CompositeIndex,
  CompositeKind,
  DataCubeResult,
  DataCubeScene,
  GeoJSONGeometry,
  ModelKind,
  PredictResult,
  SolarSitingAnalysis,
  SolarTerrainAnalysis,
  WaterAnalysis,
  WaterIndex,
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
import { MapSurface } from "@/components/map/MapSurface"
import { SearchBar } from "@/components/SearchBar"
import { PeriodTimeline } from "@/components/PeriodTimeline"
import { ControlPanel } from "@/components/ControlPanel"
import { CompositionPanel } from "@/components/CompositionPanel"
import { WaterPanel } from "@/components/WaterPanel"
import { WaterStatusPanel } from "@/components/WaterStatusPanel"
import {
  MAP_TOOLS,
  isMapTool,
  type BoardToolId,
  type MapToolId,
} from "@/lib/mapTools"
import type { SolarParams } from "@/lib/energyState"
import { cn } from "@/lib/utils"
import { BoardRunGraph, TOOL_ICON } from "@/components/studio/BoardRunGraph"
import { StudioLoading } from "@/components/studio/StudioLoading"
import { BOARD_TOOLS } from "@/lib/mapTools"
import {
  BOARD_DETAIL_REM,
  BOARD_LEFT_REM,
  BOARD_RIGHT_REM,
  boardPartition,
  clampColumn,
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
import { WorkspaceBar } from "@/components/WorkspaceBar"
import { BoardButton } from "@/components/studio/BoardButton"

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
import type { PanelPlacement } from "@/components/ui/PanelShell"
import { ResultsPanel } from "@/components/ResultsPanel"
import { CompositionStatusPanel } from "@/components/CompositionStatusPanel"
import { DataCubeModal } from "@/components/DataCubeModal"
import { ConfidenceLegend } from "@/components/ConfidenceLegend"
import { statusPanelInset } from "@/components/analysisPrimitives"
import {
  OverlayToolsButton,
  OverlayToolsPanel,
} from "@/components/OverlayToolsPanel"

export interface MapScreenProps {
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
  titleBarSlot?: HTMLElement | null
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

export function MapScreen(props: MapScreenProps) {
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
   * Whether the analysis is lifted off the map onto the board.
   *
   * Local, and deliberately not persisted -- the opposite of the reasoning
   * that holds leftPanel in the caller. This screen remounts on every return,
   * and coming back to the map should give the map, not a board left open
   * twenty minutes ago.
   */
  const [board, setBoard] = useState(false)
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
      setBoard(true)
      // What the two toggle handlers do inline. This path skipped it, and with
      // the island withheld there is no longer a button on screen to shut a
      // drawer that opened before the board did.
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
  /**
   * Whether the board is actually up. The state, and nothing else.
   *
   * IT USED TO REQUIRE SOMETHING TO SHOW: a visible raster, or another area
   * the board had fetched, or an AOI on the map, or the nonce that opens a
   * studio by name. The rule existed because an empty board was a dead end --
   * a surface that could only ARRANGE runs, mounted over a map, with nothing
   * on it and no way to put anything there.
   *
   * That stopped being true when the studio gained a globe to draw on and a
   * run graph to run from. An empty studio is now where work starts, not a
   * screen you have to back out of, and the nonce exception -- which existed
   * precisely because "a studio opened by name stands with nothing on it" --
   * was the rule already admitting its own case.
   *
   * The dead end the old rule was itself written to close is closed by this
   * too: the sidebar's eye can hide every layer, and under the old condition
   * that unmounted the surface holding the control, taking the search field,
   * the overlay tools and the button back in with it.
   */
  const boardOpen = board

  /*
    Reported to the title bar, which withholds the map's latitude, longitude,
    zoom and imagery credit while the studio covers the map. Coerced, because
    the expression above is an `&&` chain that yields undefined rather than
    false when `board` is unset.
  */
  const reportBoardOpen = props.onBoardOpenChange
  useEffect(() => {
    reportBoardOpen?.(!!boardOpen)
    // Leaving the screen closes it as far as the title bar is concerned:
    // otherwise a true outlives the surface that justified it, and the map's
    // readings stay hidden on a screen that has a map.
    return () => reportBoardOpen?.(false)
  }, [boardOpen, reportBoardOpen])

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
    if (boardOpen) {
      if (layoutMode !== "workspace") {
        if (layoutBeforeBoardRef.current == null) {
          layoutBeforeBoardRef.current = layoutMode
        }
        // Not persisted: this is what the surface requires, not what the
        // reader chose, and storing it edits the Map layout setting behind
        // their back -- every launch, for a session that opens on the studio.
        onLayoutModeChange("workspace", { persist: false })
      }
      return
    }
    const prev = layoutBeforeBoardRef.current
    if (prev == null) return
    layoutBeforeBoardRef.current = null
    if (layoutMode !== prev) onLayoutModeChange(prev, { persist: false })
  }, [boardOpen, layoutMode, onLayoutModeChange])

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
  const boardRun =
    bandTool === "solar" && solarRunnable
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
   * The three products' controls, in whichever container the layout gives
   * them. One switch, called from two places: the docked column below, and
   * the workspace layout's right drawer. Writing it twice would let the two
   * layouts drift in which props each panel receives.
   */
  const renderPanel = (placement: PanelPlacement, show: boolean) => {
    /*
      Dismissing means different things in the two containers. Closing the
      docked column clears the open tool, because the column IS the tool
      selection -- there is nothing left selected once it is gone. In the
      workspace layout the bar keeps the selection, so closing the drawer must
      close only the drawer; clearing the tool there would empty the segmented
      control and leave the run button acting on nothing.
    */
    const dismiss =
      placement === "drawer"
        ? () => setRightDrawer(null)
        : () => setLeftPanel(null)
    return (
      <AnimatePresence mode="wait" initial={false}>
        {!show ? null : leftPanel === "classify" ? (
          <ControlPanel
            key="classify"
            placement={placement}
            customPolygon={props.customPolygon}
            hasArea={props.hasArea}
            onClearArea={props.onClearArea}
            onImportPolygon={props.onImportPolygon}
            start={props.start}
            end={props.end}
            onStartChange={props.onStartChange}
            onEndChange={props.onEndChange}
            maxCloud={props.maxCloud}
            onMaxCloudChange={props.onMaxCloudChange}
            monthlyBest={props.monthlyBest}
            onMonthlyBestChange={props.onMonthlyBestChange}
            mode={props.mode}
            onModeChange={props.onModeChange}
            modelKind={props.modelKind}
            onModelKindChange={props.onModelKindChange}
            prithviMode={props.prithviMode}
            onPrithviModeChange={props.onPrithviModeChange}
            running={props.running}
            progress={props.progress}
            progressMsg={props.progressMsg}
            onRun={props.onRun}
            onAnalyzeLULC={props.onAnalyzeLULC}
            lulcRunning={props.lulcRunning}
            onCollapse={dismiss}
          />
        ) : leftPanel === "water" ? (
          <WaterPanel
            key="water"
            placement={placement}
            hasArea={props.hasArea}
            start={props.start}
            end={props.end}
            onStartChange={props.onStartChange}
            onEndChange={props.onEndChange}
            maxCloud={props.maxCloud}
            onMaxCloudChange={props.onMaxCloudChange}
            monthlyBest={props.monthlyBest}
            onMonthlyBestChange={props.onMonthlyBestChange}
            index={props.waterIndex}
            onIndexChange={props.onWaterIndexChange}
            running={props.waterRunning}
            progress={props.waterProgress}
            progressMsg={props.waterProgressMsg}
            hasResult={!!props.water}
            onRun={props.onRunWater}
            onClear={props.onClearWater}
            onCollapse={dismiss}
          />
        ) : leftPanel === "compose" ? (
          <CompositionPanel
            key="compose"
            placement={placement}
            hasArea={props.hasArea}
            start={props.start}
            end={props.end}
            onStartChange={props.onStartChange}
            onEndChange={props.onEndChange}
            maxCloud={props.maxCloud}
            onMaxCloudChange={props.onMaxCloudChange}
            monthlyBest={props.monthlyBest}
            onMonthlyBestChange={props.onMonthlyBestChange}
            scenes={props.composeScenes}
            scenesLoading={props.composeScenesLoading}
            scenesError={props.composeScenesError}
            selectedSceneId={props.selectedSceneId}
            onSelectScene={props.onSelectScene}
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
            hasOverlay={!!props.composition}
            onApply={props.onApplyComposition}
            onClear={props.onClearComposition}
            onCollapse={dismiss}
          />
        ) : null}
      </AnimatePresence>
    )
  }

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
        {BOARD_TOOLS.filter((t) => t.id !== "solar" || !!props.solarParams).map(
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
          ? "Draw an area on the map first."
          : bandTool === "solar" && props.solarBusy
            ? "The sidecar runs one analysis at a time."
            : bandTool === "compose" && !props.selectedSceneId
              ? "Choose a scene under Compositions on the map."
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
          ...partitionVars(partition, !!boardOpen),
        } as React.CSSProperties
      }
    >
      {/*
        The studio toggle, drawn into the title bar.

        Portalled rather than passed up because of where the state is: `board`
        below is this screen's, and the bar belongs to the shell. This keeps the
        two facts apart -- the shell owns WHERE the button goes, this screen
        owns WHAT it does. Rendered here beside the board's other chrome, since
        that is what it is, whatever DOM it lands in.
      */}
      {props.titleBarSlot &&
        createPortal(
          <BoardButton
            active={boardOpen}
            onClick={() =>
              setBoard((o) => {
                // Closing the overlay drawer on the way in: the sidebar carries
                // what governs the board, and a drawer left open from the map
                // would be a second surface for the same controls, floating
                // over a surface that already has them.
                if (!o) setRightDrawer(null)
                return !o
              })
            }
            onPrefetch={prefetchBoard}
          />,
          props.titleBarSlot
        )}

      <MapSurface
        initialView={props.initialView}
        customPolygon={props.customPolygon}
        onPolygonDrawn={props.onPolygonDrawn}
        flyTo={props.flyTo}
        result={props.result}
        overlayOpacity={props.overlayOpacity}
        showConfidence={props.showConfidence}
        confidenceOnTop={props.confidenceOnTop}
        smoothOverlay={props.smoothOverlay}
        showPredictionOverlay={props.showPredictionOverlay}
        showCompositionOverlay={props.showCompositionOverlay}
        composition={props.composition}
        waterOverlay={
          props.water && props.showWaterOverlay
            ? {
                uri: props.water.occurrence_uri,
                extent: props.water.extent,
                opacity: props.waterOpacity,
              }
            : null
        }
        swipeCompare={props.swipeCompare}
        swipeRatio={props.swipeRatio}
        onSwipeRatioChange={props.onSwipeRatioChange}
        areaLabel={props.areaLabel}
        onAreaLabelChange={props.onAreaLabelChange}
        aoiContourScheme={props.aoiContourScheme}
        onAoiContourSchemeChange={props.onAoiContourSchemeChange}
        onClearArea={props.onClearArea}
        onViewChange={props.onViewChange}
        onCreditChange={props.onCreditChange}
        // Placed in the surface's own bottom-right stack, above the zoom and
        // draw controls, so a panel opening no longer reads as something this
        // button produced.
        bottomRightSlot={
          <>
            {/*
              Not while the board is open: it takes the top instead, and this
              one would be a second mount of the same control sitting unclickable
              under the board.
            */}
            {!boardOpen && (
              <OverlayToolsButton
                active={rightDrawer === "overlays"}
                onClick={() =>
                  setRightDrawer((d) => (d === "overlays" ? null : "overlays"))
                }
              />
            )}
          </>
        }
      />

      {/*
        The search field finds a place on Earth. The board has no Earth on it:
        the rasters are lifted off their coordinates, which is the point, so
        there is nowhere for a result to fly to.
      */}
      {!boardOpen && <SearchBar onSelectLocation={props.onLocationSelect} />}

      {/*
        Overlay tools have no button while the board is open. What governs the
        board is in its sidebar: the visibility and opacity of each raster as a
        row per plane, and the majority filter, which is the one control in
        that panel that changes what the board DRAWS.

        What stays behind is map vocabulary with nothing to act on here -- the
        swipe compares an overlay against the basemap, and the palette colours
        an AOI contour the board does not draw. The generated-overlay gallery
        is the exception, and it is deliberate: choosing what to bring onto the
        board is the multi-AOI step, and it needs a surface of its own rather
        than a panel borrowed from the map.
      */}

      {/*
        The foot carries the period on the map and the run on the board.

        The timeline is a control ABOUT THE MAP -- a window dragged over the
        scenes that fall in it, read against the view. With the map covered
        there is nothing to read it against, and the band is the widest space
        this application has: exactly what nine small choices need and what a
        15rem column cannot give them.
      */}
      {!boardOpen && (
      <PeriodTimeline
        start={props.start}
        end={props.end}
        onStartChange={props.onStartChange}
        onEndChange={props.onEndChange}
        scenes={props.composeScenes}
        scenesLoading={props.composeScenesLoading}
        onListScenes={props.onListComposeScenes}
        onOpenListing={props.onViewDataCube}
        disabled={props.running || props.composeRunning}
        /*
          Retracted past whatever occupies the foot's left end: the docked
          column at its fixed 19rem plus its two 0.75rem gutters, or the
          workspace island, which is flush into the corner and so needs only
          the gap between the two segments added to its measured width.
        */
        flushLeft={workspace}
        leftOffset={
          workspace
            ? barWidthPx
              ? `calc(${barWidthPx}px + 0.75rem)`
              : undefined
            : leftPanel
              ? "20.5rem"
              : undefined
        }
      />
      )}

      <AnimatePresence>
        {boardOpen && (
          /*
            A real surface, not null.

            The studio is a lazy chunk carrying three.js, so the first open of
            a session downloads and parses it before anything of the studio
            exists. A blank frame between the press and the board reads as a
            button that did not work, and a reader who sees no change presses
            again.
          */
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
              onStudiosMenu={props.onStudiosMenu}
              onClose={() => setBoard(false)}
            />
          </Suspense>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {/*
          Withheld while the board is up, like the search field above and the
          overlay-tools button beside it. What it carried that the board also
          carries is now said once, on the band; what it carried that the board
          does not -- the destinations outside this screen, and the parameter
          drawer -- comes back the moment the board closes.

          The child is what comes and goes, not the AnimatePresence: gating the
          presence itself unmounts the thing that was supposed to animate the
          exit, which this file already learned once further down.
        */}
        {workspace && !boardOpen && (
          <WorkspaceBar
            key="workspace-bar"
            groupId="map"
            activeId={leftPanel}
            onNavigate={props.onNavigate}
            running={run.running}
            progress={run.progress}
            progressMsg={run.progressMsg}
            runLabel={run.label}
            canRun={run.canRun}
            onRun={run.onRun}
            onWidthChange={setBarWidthPx}
            configOpen={rightDrawer === "config"}
            onConfigToggle={() =>
              setRightDrawer((d) => (d === "config" ? null : "config"))
            }
          />
        )}
      </AnimatePresence>

      {/*
        Pushed clear of the board's right column rather than withheld: this is a
        TOOL drawer, not a readout, so hiding it would remove function instead
        of removing duplication -- the trade the two status panels above make
        because the column repeats them.
      */}
      <OverlayToolsPanel
        /*
          The studio has no fixed right column any more -- the properties area
          is a fraction of the area tree and moves with a drag. Withheld
          entirely instead, like every other map readout while the studio is up.
        */
        insetRight={undefined}
        open={rightDrawer === "overlays"}
        onClose={() => setRightDrawer(null)}
        result={props.result}
        composition={props.composition}
        compositionGallery={props.compositionGallery ?? []}
        onSelectComposition={props.onSelectComposition}
        onRemoveComposition={props.onRemoveComposition}
        areaLabel={props.areaLabel}
        modelKind={props.modelKind}
        composeSceneDate={
          props.composeScenes.find((s) => s.id === props.selectedSceneId)
            ?.date ?? null
        }
        showPredictionOverlay={props.showPredictionOverlay}
        onShowPredictionOverlayChange={props.onShowPredictionOverlayChange}
        showCompositionOverlay={props.showCompositionOverlay}
        onShowCompositionOverlayChange={props.onShowCompositionOverlayChange}
        water={props.water}
        showWaterOverlay={props.showWaterOverlay}
        onShowWaterOverlayChange={props.onShowWaterOverlayChange}
        waterOpacity={props.waterOpacity}
        onWaterOpacityChange={props.onWaterOpacityChange}
        showConfidence={props.showConfidence}
        onShowConfidenceChange={props.onShowConfidenceChange}
        confidenceOnTop={props.confidenceOnTop}
        onConfidenceOnTopChange={props.onConfidenceOnTopChange}
        smoothOverlay={props.smoothOverlay}
        onSmoothOverlayChange={props.onSmoothOverlayChange}
        swipeCompare={props.swipeCompare}
        onSwipeCompareChange={props.onSwipeCompareChange}
        overlayOpacity={props.overlayOpacity}
        onOverlayOpacityChange={props.onOpacityChange}
        composeOpacity={props.composeOpacity}
        onComposeOpacityChange={props.onComposeOpacityChange}
        aoiContourScheme={props.aoiContourScheme}
        onAoiContourSchemeChange={props.onAoiContourSchemeChange}
      />

      <ConfidenceLegend
        visible={
          // Withheld while the studio is up, like every sibling readout on
          // this screen. It was the one without the gate, so it painted over
          // the studio's right column at z-1100.
          !boardOpen &&
          !!props.showConfidence &&
          !!props.result?.confidence_uri &&
          (props.result.n_dates ?? 0) > 0
        }
      />

      {/*
        The docked column. The workspace layout has no column to dock to -- its
        parameters open in a drawer from the bar instead, which is the same
        switch in the other container.
      */}
      {renderPanel("docked", !workspace)}
      {/*
        The presence stays mounted and its child is what comes and goes. Gating
        the AnimatePresence itself removed the exit animation: closing the
        drawer unmounted the thing that was supposed to be animating it out.
      */}
      {renderPanel("drawer", workspace && rightDrawer === "config")}

      <AnimatePresence mode="wait" initial={false}>
        {/*
          Each gated on the board being closed, the water and composition ones
          newly so. They paint at right-16 z-[1000], which lands inside the
          board's 15rem right column and a layer above it -- and the column
          already carries the same figures for whichever plane is selected. The
          prediction arm below had the gate and the reasoning; its two siblings
          did not, and being earlier in this chain they won over it.
        */}
        {showWaterStatus && !boardOpen ? (
          <WaterStatusPanel
            leftOffsetClass={statusPanelInset(workspace)}
            key="water-status"
            water={props.water ?? null}
            onClear={props.onClearWater}
          />
        ) : showCompositionStatus && !boardOpen ? (
          <CompositionStatusPanel
            leftOffsetClass={statusPanelInset(workspace)}
            key="composition-status"
            composition={props.composition}
            sceneDate={selectedSceneDate}
            composeOpacity={props.composeOpacity}
            onClear={props.onClearComposition}
          />
        ) : showPredictionStatus && !boardOpen ? (
          /*
            Withheld while the board is up. Its statistics band carries the same
            composition, and the panel's header repeats even the subject line,
            so collapsing it only shrank the repetition rather than ending it.
            Analysis, New and Close moved to that band with the figures.

            Gated here rather than in the predicate above: `boardOpen` is
            derived from the board's layer list, which is built further down.
          */
          <ResultsPanel
            leftOffsetClass={statusPanelInset(workspace)}
            key="prediction-status"
            result={props.result!}
            onClose={props.onCloseResult}
            onNewClassification={props.onNewClassification}
          />
        ) : null}
      </AnimatePresence>

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
