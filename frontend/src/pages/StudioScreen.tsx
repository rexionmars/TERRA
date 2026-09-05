import {
  Suspense,
  lazy,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
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
  GridStoreReport,
  GridCongestionAnalysis,
  GridCurtailmentAnalysis,
  GridFigureAnalysis,
} from "@/lib/types";
import {
  panelSelection,
  selectPanel,
  subscribePanelSelection,
} from "@/lib/panelSelection";
import type { AoiContourSchemeId } from "@/lib/aoiStyle";
import {
  ENERGY_PRODUCTS,
  energyFamily,
  energyMember,
  isMapTool,
  type BoardToolId,
  type EnergyProductId,
} from "@/lib/mapTools";
import type {
  SolarParams,
  SolarProductId,
  SolarResults,
  WindParams,
} from "@/lib/energyState";
import { solarProduct as solarProductEntry } from "@/components/energy/solarProducts";
import {
  FLOOD_DEM_PRODUCTS,
  FLOOD_LEAST_DEMS,
  type FloodParams,
} from "@/components/flood/floodSetup";
import { cn } from "@/lib/utils";
import { CaretDown } from "@phosphor-icons/react";
import { BoardRunGraph, TOOL_ICON } from "@/components/studio/BoardRunGraph";
import {
  StudioMenuItem,
  StudioPopover,
} from "@/components/studio/StudioPopover";
import { StudioLoading } from "@/components/studio/StudioLoading";
import { STUDIO_GROUPS, type EditorId } from "@/lib/studioEditors"
import type { GridProductId } from "@/lib/gridOptions";
import { BOARD_TOOLS } from "@/lib/mapTools";
import {
  BOARD_DETAIL_REM,
  BOARD_LEFT_REM,
  BOARD_RIGHT_REM,
  boardPartition,
  clampDetail,
  partitionVars,
} from "@/lib/boardPartition";
import { rasterLayers } from "@/lib/mapLayers";
import { solarOverlayList } from "@/lib/solarLayers";
import { runAssets } from "@/lib/runAssets";
import { useRunLog } from "@/lib/runLog";
import { polygonOuterRing } from "@/lib/geometry";
import type { BasemapKind } from "@/lib/basemaps";

/*
  Lazy, and reached only from here. BoardSurface imports the scene, which
  imports three; a static import would put the whole library in the chunk that
  loads with the map screen.
*/
const BoardSurface = lazy(() =>
  import("@/components/studio/BoardSurface").then((m) => ({
    default: m.BoardSurface,
  })),
);

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
import { DataCubeModal } from "@/components/DataCubeModal";
import {} from "@/components/OverlayToolsPanel";

export interface StudioScreenProps {
  /** Where the map was left last session; null starts at the default view. */
  initialView?: { lat: number; lon: number; zoom: number } | null;
  /** Open tool tab, owned by the caller so it survives this screen unmounting. */
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
  onBoardOpenChange?: (open: boolean) => void;
  customPolygon: GeoJSONGeometry | null;
  flyTo: { lat: number; lon: number; key: number } | null;
  result: PredictResult | null;
  /** Results the map finished with, still placeable on the board. */
  retainedRuns: readonly { id: string; result: PredictResult }[];
  /** Let go of one, which the board lists and cannot remove on its own. */
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
  swipeCompare: boolean;
  swipeRatio: number;
  areaLabel?: string;
  onAreaLabelChange: (label: string) => void;
  aoiContourScheme: AoiContourSchemeId;
  onAoiContourSchemeChange: (id: AoiContourSchemeId) => void;
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
  /** Which basemap is showing, for the credit in the title bar. */
  onCreditChange?: (c: { kind: BasemapKind; date: string | null }) => void;
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void;
  /** Adopt a run polygon as the active AOI without adding a catalog entry. */
  onAdoptAreaGeometry?: (geom: GeoJSONGeometry | null) => void;
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
  onLocationSelect: (lat: number, lon: number) => void;
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
  onSwipeCompareChange: (v: boolean) => void;
  onSwipeRatioChange: (v: number) => void;
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
  /** Saved studios, for the studio's own title block. */
  studios?: import("@/lib/studios").Studio[];
  onOpenStudio?: (board: import("@/lib/studios").Studio) => void;
  onNewStudio?: () => void;
  /** Called when the studio's board menu opens, to refresh the list. */
  /*
    Returns its promise, so a caller that needs the list BEFORE it draws again
    can wait for it. The menu that opens on hover does not and ignores it; the
    manage dialog does, since it shows the result of its own rename or delete.
  */
  onStudiosMenu?: () => void | Promise<void>;
  onNewClassification: () => void;
  onViewDataCube: () => void;
  dataCubeLoading?: boolean;
  dataCubeOpen?: boolean;
  dataCubeError?: string | null;
  dataCubeResult?: DataCubeResult | null;
  onCloseDataCube: () => void;
  water?: WaterAnalysis | null;
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
  solarTerrain?: SolarTerrainAnalysis | null;
  solarSiting?: SolarSitingAnalysis | null;
  showSolarTerrain?: boolean;
  showSolarSiting?: boolean;
  solarTerrainOpacity?: number;
  solarSitingOpacity?: number;
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
    patch: { visible?: boolean; opacity?: number },
  ) => void;
  /**
   * The solar inputs, so the board can START a solar run and not only draw one.
   *
   * The whole flat set is passed rather than the four the two raster products
   * read, because it is one store and slicing it here would be this screen
   * deciding which parameters exist. The band shows the four that reach a
   * request; the rest are the energy screen's business.
   */
  solarParams?: SolarParams;
  onSolarParamsChange?: (patch: Partial<SolarParams>) => void;
  /** Absent where solar cannot be run; the band then does not offer it. */
  /**
   * The last run of this session, and the values it was made from.
   *
   * Held by the map screen because this one comes and goes. The board draws it
   * on the wires: which inputs the answer on screen was computed from, and
   * whether that run ended.
   */
  lastRun?: { ok: boolean; inputs: Readonly<Record<string, string>> } | null;
  /** What the board's cards supply, reported as it changes, for the above. */
  onBoardInputs?: (inputs: Record<string, string>) => void;

  onRunSolar?: (product: SolarProductId) => void;
  /** What each product has produced, for the reading editor and the stale note. */
  solarResults?: SolarResults;
  onSolarLossChange?: (
    group: "declared" | "optional",
    key: string,
    pct: number,
  ) => void;
  onClearSolar?: (product: SolarProductId) => void;
  solarBusy?: boolean;
  solarProgress?: number;
  solarProgressMsg?: string;
  /*
    Wind and flood, in the shape solar already established: the whole parameter
    store plus a patch, and a runner that is absent where the product cannot be
    started. Both were screens of their own until the band grew cards for them.
  */
  windParams?: WindParams;
  onWindParamsChange?: (patch: Partial<WindParams>) => void;
  onRunWind?: () => void;
  windBusy?: boolean;
  windProgress?: number;
  windProgressMsg?: string;
  /** The AOI as GeoJSON text, for the research pack's manifest. */
  polygonGeoJSON?: string;
  /** What the screening found, for the editor that reads it. */
  windResult?: WindAnalysis | null;
  onClearWind?: () => void;
  floodParams?: FloodParams;
  onFloodParamsChange?: (patch: Partial<FloodParams>) => void;
  onRunFlood?: () => void;
  floodBusy?: boolean;
  floodProgress?: number;
  floodProgressMsg?: string;
  floodResult?: FloodAnalysis | null;
  /** What the local grid store holds, or why it cannot be reached. */
  gridStore?: GridStoreReport | null;
  gridProduct?: GridProductId;
  onGridProductChange?: (p: GridProductId) => void;
  gridWindow?: { start: string; end: string };
  onGridWindowChange?: (start: string, end: string) => void;
  onCheckGridStore?: () => void
  gridCurtailment?: GridCurtailmentAnalysis | null
  gridCongestion?: GridCongestionAnalysis | null
  onRunGridConnection?: () => void
  gridFigure?: GridFigureAnalysis | null
  gridFigureNumber?: number
  onGridFigureChange?: (n: number) => void
  onRunGridFigure?: () => void
  gridBusy?: boolean
  onRunGridCurtailment?: () => void;
  reveal?: EditorId | null;
  onRevealed?: () => void;
  onClearFlood?: () => void;
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
    panelSelection,
  );
  const onLeftPanelChange = selectPanel;
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
  const [boardTool, setBoardTool] = useState<BoardToolId | null>(null);
  /*
    Which subject's menu is down, by id rather than a boolean per group: the
    band carries one entrance per subject and only one of them may be open at
    a time, which a boolean each would not enforce.
  */
  const [bandMenu, setBandMenu] = useState<string | null>(null);
  /**
   * Which photovoltaic product the band will run.
   *
   * All four the table declares, not the two that draw a raster. The other two
   * report figures, and the studio reads figures now: the Solar result editor
   * carries what the energy screen's reading column did.
   */
  const [solarProduct, setSolarProduct] = useState<SolarProductId>("terrain");
  /*
    Which energy product the band is on, across all three families.

    ONE SELECTOR, AND THE FAMILY FALLS OUT OF IT. Solar, wind and grid were
    three band entries and are one; the family is still what decides which
    slice answers, so it is read from the product rather than chosen before it.

    solarProduct is kept and synchronised rather than replaced: it is what the
    solar parameter cards and the run verb are written against, and rewriting
    those to a prefixed id would be a second spelling of the same choice.
  */
  const [energyProduct, setEnergyProduct] =
    useState<EnergyProductId>("solar:terrain");
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
  const [statsRem, setStatsRem] = useState(BOARD_DETAIL_REM);
  /*
    Collapsed is remembered SEPARATELY from the height, so unfolding restores
    the height that was dragged rather than resetting it to the default. The
    two are different questions: how tall, and whether shown.
  */
  const [statsCollapsed, setStatsCollapsed] = useState(false);
  /*
    The columns' widths, which the reader owns rather than the source.

    Held here with the band's height because --map-foot and the two recesses
    are derived from the same partition, and a divided owner is how the seams
    drifted apart in the first place.
  */
  /*
    Fixed. These were state because the map screen's columns could be dragged;
    the studio resizes its areas at their own seams, so nothing ever wrote
    them. Kept as the partition's inputs rather than inlined, because
    boardPartition is what reconciles the two edges against the detail band.
  */
  const leftRem = BOARD_LEFT_REM;
  const rightRem = BOARD_RIGHT_REM;
  const partition = boardPartition({
    leftRem,
    rightRem,
    detailRem: statsRem,
    detailCollapsed: statsCollapsed,
  });
  /**
   * Whether the studio was asked for by name rather than toggled onto what is
   * on screen.
   *
   * A saved studio and the opening-surface preference both arrive as the
   * nonce, and both mean the same thing: this reader wants the studio, not the
   * studio OF something. Zero is the resting value, not a request.
   */
  const nonce = props.openBoardNonce ?? 0;
  const setLeftPanel = onLeftPanelChange;

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
  });

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
  });

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
  const reportBoardOpen = props.onBoardOpenChange;
  useEffect(() => {
    reportBoardOpen?.(true);
    // Leaving the screen closes it as far as the title bar is concerned:
    // otherwise a true outlives the surface that justified it, and the map's
    // readings stay hidden on a screen that has a map.
    return () => reportBoardOpen?.(false);
  }, [reportBoardOpen]);

  /*
    The same table the overlay tools panel lists, so the board's data mode and
    that panel cannot come to disagree about what the run produced.
  */
  /**
   * The id the live area will reopen as, from whichever product recorded one.
   *
   * "current" is the sentinel for a ground whose run was never saved -- a run
   * made while logged out has no row -- and the board keeps it only so the
   * area has a stable key while it is open. It is not a member of a saved
   * studio, which is why resolving a real id here is what lets one be saved.
   */
  const liveRunId =
    props.result?.run_id ||
    props.solarResults?.terrain?.run_id ||
    props.solarResults?.siting?.run_id ||
    props.solarResults?.resource?.run_id ||
    props.solarResults?.energy?.run_id ||
    props.water?.run_id ||
    props.windResult?.run_id ||
    props.floodResult?.run_id ||
    "current";

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
  });

  const changeBoardLayer = (
    id: string,
    patch: { visible?: boolean; opacity?: number },
  ) => {
    if (id === "composition") {
      if (patch.visible !== undefined)
        props.onShowCompositionOverlayChange(patch.visible);
      if (patch.opacity !== undefined)
        props.onComposeOpacityChange(patch.opacity);
      return;
    }
    if (id === "water") {
      if (patch.visible !== undefined)
        props.onShowWaterOverlayChange(patch.visible);
      if (patch.opacity !== undefined)
        props.onWaterOpacityChange(patch.opacity);
      return;
    }
    if (id === "confidence") {
      if (patch.visible !== undefined)
        props.onShowConfidenceChange(patch.visible);
      if (patch.opacity !== undefined) props.onOpacityChange(patch.opacity);
      return;
    }
    if (id === "prediction") {
      if (patch.visible !== undefined)
        props.onShowPredictionOverlayChange(patch.visible);
      if (patch.opacity !== undefined) props.onOpacityChange(patch.opacity);
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
        patch,
      );
    }
  };

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
          };

  /*
    The band's run, which is the island's for the three map tools and its own
    for solar. Kept apart from `run` above rather than adding a branch to it:
    that object also feeds the workspace bar, which belongs to the map and has
    no solar to start.
  */
  const bandTool: BoardToolId | null = boardTool ?? leftPanel;
  /*
    Which slice answers what the band is showing.

    The comparisons below were against the tool, when the tool WAS the family.
    They are against this now, so the Energy entry dispatches on its product and
    every other entry keeps answering for itself.
  */
  /*
    Whether this installation can answer a family at all.

    Read from the same props the band's own filter reads, so the entry being
    offered and the product being runnable cannot disagree.
  */
  const familyReady = (f: "solar" | "wind" | "grid") =>
    f === "solar"
      ? !!props.solarParams
      : f === "wind"
        ? !!props.windParams
        : !!props.gridStore;

  /*
    THE CHOSEN PRODUCT, OR THE FIRST ONE THAT CAN RUN.

    The band opens on a solar product, and an installation with a grid store
    and no solar parameters would open Energy onto a graph with no family to
    dispatch on -- which the surface renders as "pick a product above" over a
    card that is already showing one picked. Falling back here rather than
    choosing a default at mount, because availability arrives with the props
    and can change after: a store probed a second later must not leave the
    reader on a dead entry.
  */
  const effectiveEnergyProduct: EnergyProductId = familyReady(
    energyFamily(energyProduct),
  )
    ? energyProduct
    : (ENERGY_PRODUCTS.find((p) => familyReady(p.family))?.id ?? energyProduct);

  const bandFamily =
    bandTool === "energy" ? energyFamily(effectiveEnergyProduct) : bandTool;
  const solarRunnable = !!props.solarParams && !!props.onRunSolar;
  const windRunnable = !!props.windParams && !!props.onRunWind;
  const floodRunnable = !!props.floodParams && !!props.onRunFlood;
  const boardRun =
    bandFamily === "wind" && windRunnable
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
              (props.floodParams?.demIds.length ?? 0) >= FLOOD_LEAST_DEMS,
            onRun: () => props.onRunFlood?.(),
          }
        : bandFamily === "solar" && solarRunnable
          ? {
              running: props.solarBusy ?? false,
              progress: props.solarProgress ?? 0,
              progressMsg: props.solarProgressMsg ?? "",
              /* The table's own verb, so a product added there arrives with its
             label rather than with a fifth branch written here. */
              label: props.solarBusy
                ? `${solarProductEntry(solarProduct).runningLabel}`
                : solarProductEntry(solarProduct).runVerb,
              // One sidecar run at a time, which solar already enforces across its
              // own products; the board must not be a second way past it.
              canRun: props.hasArea && !props.solarBusy,
              onRun: () => props.onRunSolar?.(solarProduct),
            }
          : bandFamily === "grid" && !!props.gridStore
            ? /*
          THE RECORD, AND WHY THIS BRANCH HAD TO EXIST AT ALL.

          The chain below used to end at `run`, which is the classification's.
          A tool with no branch of its own therefore inherited classify's
          label, its enablement AND ITS ACTION -- so the grid tab drew a button
          reading "Classify" that would have started a classification over
          whatever area was drawn. The same shape as runGraph's unguarded final
          return, in a place where the consequence is a run rather than a
          drawing.
        */
              props.gridProduct === "figure"
        ? {
            running: props.gridBusy ?? false,
            progress: 0,
            progressMsg: "",
            label: props.gridBusy ? "Reading" : "Read the figure",
            /*
              No area to check. Fig. 1 is about the SIN, and the sidecar
              refuses a polygon for a system-scoped figure rather than dropping
              it -- a national quantity answered over one polygon is a
              different quantity under the same name.
            */
            canRun: !!props.gridStore?.reachable && !props.gridBusy,
            onRun: () => props.onRunGridFigure?.(),
          }
        : props.gridProduct === "connection"
              ? {
                  running: props.gridBusy ?? false,
                  progress: 0,
                  progressMsg: "",
                  label: props.gridBusy ? "Reading" : "Read the connection",
                  /*
                    ITS OWN BRANCH, and the comment above this chain says why
                    it had to have one: a product with no branch inherits the
                    label, the enablement AND THE ACTION of whatever the chain
                    falls through to. Connection fell through to curtailment,
                    so selecting it drew a button reading "Read the
                    curtailment" that ran one -- and an area chosen precisely
                    because it holds no plant came back with the curtailment
                    refusal instead of the proximity answer this product
                    exists to give.
                  */
                  canRun:
                    !!props.gridStore?.reachable &&
                    props.hasArea &&
                    !props.gridBusy,
                  onRun: () => props.onRunGridConnection?.(),
                }
              : props.gridProduct === "record"
              ? {
                  running: false,
                  progress: 0,
                  progressMsg: "",
                  label: "Read the record",
                  // No area, and nothing to refuse on: asking what this
                  // installation holds is answerable whether or not the store is
                  // reachable, and the unreachable answer is the useful one.
                  canRun: true,
                  onRun: () => props.onCheckGridStore?.(),
                }
              : {
                  running: props.gridBusy ?? false,
                  progress: 0,
                  progressMsg: "",
                  label: props.gridBusy ? "Reading" : "Read the curtailment",
                  /*
                    No progress ramp. The sidecar answers this from indexed
                    tables in about a second, so a bar would appear and vanish;
                    the button's own busy state is the whole of what there is
                    to say.
                  */
                  canRun:
                    !!props.gridStore?.reachable &&
                    props.hasArea &&
                    !props.gridBusy,
                  onRun: () => props.onRunGridCurtailment?.(),
                }
            : run;

  /*
    What the run in progress has said. Built from the SAME resolved run the band
    reports, so the log cannot come from one product while the button reports
    another.
  */
  const runLog = useRunLog({
    running: boardRun.running,
    progress: boardRun.progress,
    message: boardRun.progressMsg,
  });

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
        {(() => {
          /*
            ENERGY IS OFFERED IF ANY OF ITS THREE FAMILIES CAN ANSWER, which is
            weaker than what the three separate entries required and is the
            right weakening. A reader with the store probed and no solar
            parameters used to see a Grid tab and no Solar tab; they now see
            Energy, and the product card inside it is where the difference
            belongs -- a product that cannot run is one entry to grey out, not
            a whole surface to withhold.

            The store is offered whenever it has been PROBED, reachable or not,
            unlike the other two which are gated on having parameters to send.
            An unreachable store is the case this most needs to explain: the
            reader has psycopg installed and no database, or a database and no
            schema, and hiding it leaves them with no surface that says so.
          */
          const offered = BOARD_TOOLS.filter((t) =>
            t.id === "energy"
              ? !!props.solarParams || !!props.windParams || !!props.gridStore
              : t.id === "flood"
                ? !!props.floodParams
                : true,
          );
          /*
            ONE ENTRANCE PER SUBJECT, WHICH IS THE SHAPE THE OTHER TWO BARS
            ALREADY HAVE.

            A row of five with a rule between the groups was tried first, on
            the argument that four entrances cost a press on a row that fits.
            That argument weighs a press against a bar's width and misses what
            actually costs a reader more: three bars in one application, each
            saying "these things belong together" in a different way. The
            workspace bar and the editor menu both name their subjects and open
            them; a third that grouped by hairline would make the grouping
            itself something to learn twice.

            EVERY GROUP IS A MENU, including the ones holding one product. A
            menu of one is a press for nothing, and a bar where some names open
            and others act is a bar whose affordance cannot be predicted --
            which costs on every entry rather than on the short ones. The
            groups also have room to grow: the app has editors for solar
            readings, wind screening and flood envelopes that no product starts
            yet.

            `document.body` as the surface is the popover's own documented
            path for a panel with no studio to sit inside: this row is built
            here and rendered into an area header, so it never holds the
            surface the areas are clamped in. Detached, it positions fixed at
            the layer this band's other floating panels already use.
          */
          return STUDIO_GROUPS.map((g) => {
            const members = offered.filter((t) => t.group === g.id);
            if (!members.length) return null;
            const active = members.find((t) => t.id === bandTool) ?? null;
            const ActiveIcon = active ? TOOL_ICON[active.id] : null;
            return (
              <StudioPopover
                key={g.id}
                open={bandMenu === g.id}
                onOpenChange={(open) => setBandMenu(open ? g.id : null)}
                surface={document.body}
                widthRem={13}
                trigger={(p) => (
                  <button
                    ref={p.ref as React.Ref<HTMLButtonElement>}
                    type="button"
                    onClick={p.onClick}
                    aria-expanded={p["aria-expanded"]}
                    aria-haspopup="menu"
                    title={
                      active
                        ? `${g.label}: ${active.label}`
                        : `${g.label}: ${members.map((t) => t.label).join(", ")}`
                    }
                    className={cn(
                      "flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-meta transition-colors",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-hover hover:text-foreground",
                    )}
                  >
                    {ActiveIcon && <ActiveIcon className="size-3 shrink-0" />}
                    {g.label}
                    {/*
                      WHICH product, beside which subject, so the band still
                      says what it is showing without being opened -- the same
                      relation the workspace bar's entrance carries. It
                      withdraws first when the header runs out of room, because
                      between the two the subject is the one that says where a
                      reader is.
                    */}
                    {active && (
                      <span className="header-label text-accent-foreground/70">
                        {active.label}
                      </span>
                    )}
                    <CaretDown className="size-2.5 shrink-0 opacity-70" />
                  </button>
                )}
              >
                {members.map((t) => (
                  <StudioMenuItem
                    key={t.id}
                    icon={TOOL_ICON[t.id]}
                    label={t.label}
                    checked={t.id === bandTool}
                    onSelect={() => {
                      setBoardTool(t.id);
                      if (isMapTool(t.id)) setLeftPanel(t.id);
                      setBandMenu(null);
                    }}
                  />
                ))}
              </StudioPopover>
            );
          });
        })()}
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
  };

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
      energyProduct={effectiveEnergyProduct}
      /*
        ONE PICK, ROUTED TO WHICHEVER FAMILY OWNS IT.

        The product state is unified and the family states are not: the solar
        parameter cards and the run verb read `solarProduct`, and the grid
        window and figure cards read the `grid.product` the parent holds. So
        this sets the band's own choice and forwards the member to whichever of
        the two is behind it, rather than rewriting both to a prefixed id that
        neither of their tables uses.
      */
      onEnergyProduct={(id) => {
        setEnergyProduct(id);
        const member = energyMember(id);
        if (energyFamily(id) === "solar") {
          setSolarProduct(member as SolarProductId);
        } else if (energyFamily(id) === "grid") {
          props.onGridProductChange?.(member as GridProductId);
        }
      }}
      /*
        Greyed with a reason rather than hidden. A product this installation
        cannot run is a setup step the reader can act on; an absent one is a
        feature they will conclude does not exist.
      */
      blockedFamilies={{
        solar: props.solarParams ? undefined : "no solar parameters in this run",
        wind: props.windParams ? undefined : "no wind parameters in this run",
        grid: props.gridStore ? undefined : "the grid store has not answered",
      }}
      grid={
        props.gridStore
          ? {
              product: props.gridProduct ?? "record",
              onProductChange: (p) => props.onGridProductChange?.(p),
              dsn: props.gridStore.dsn,
              dsnSource: props.gridStore.dsn_source,
              reachable: props.gridStore.reachable,
              unreachable: props.gridStore.unreachable,
              /*
                The span the store actually holds, taken from the first record
                it reports. Both photovoltaic records are published over the
                same months, so one span describes the window a run can ask
                for; a store holding several with different spans would need
                this per record, and would say so rather than pick one.
              */
              recordFrom: props.gridStore.coverage?.datasets[0]?.from ?? null,
              recordTo: props.gridStore.coverage?.datasets[0]?.to ?? null,
              start: props.gridWindow?.start ?? "",
              end: props.gridWindow?.end ?? "",
              onWindowChange: (start, end) =>
                props.onGridWindowChange?.(start, end),
              onCheckStore: () => props.onCheckGridStore?.(),
              figure: props.gridFigureNumber ?? 1,
              onFigureChange: (n) => props.onGridFigureChange?.(n),
            }
          : undefined
      }
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
              /*
                The rest of what the energy model sends, passed straight
                through the way the three above are. One patch callback rather
                than one per field, so a write cannot reach the store by a path
                the others do not take.
              */
              climatologyYears: props.solarParams.climatologyYears,
              surfaceAzimuth: props.solarParams.surfaceAzimuth,
              performanceRatio: props.solarParams.performanceRatio,
              reportingBasis: props.solarParams.reportingBasis,
              degradationPct: props.solarParams.degradationPct,
              analysisPeriodYears: props.solarParams.analysisPeriodYears,
              densityBasis: props.solarParams.densityBasis,
              buildableFraction: props.solarParams.buildableFraction,
              gcrFixed: props.solarParams.gcrFixed,
              gcrTracker: props.solarParams.gcrTracker,
              trackerMaxAngleDeg: props.solarParams.trackerMaxAngleDeg,
              utcOffset: props.solarParams.utcOffset,
              applyShading: props.solarParams.applyShading,
              declaredLoss: props.solarParams.declaredLoss,
              optionalLoss: props.solarParams.optionalLoss,
              onParamsChange: (patch) => props.onSolarParamsChange?.(patch),
              onLossChange: (group, key, pct) =>
                props.onSolarLossChange?.(group, key, pct),
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
        /*
          THE RECORD IS ASKED BEFORE THE AREA, so the chain cannot open on one.

          Every other product here is about a piece of ground, and "draw an
          area" was therefore a safe first branch. Asking what this
          installation holds is not, and the grid tab reached this chain with
          no branch of its own -- so a reader who had drawn nothing was told to
          draw something the run does not read, and one who had drawn something
          was told the wrong reason the curtailment button was dark. A reason
          that is wrong is worse than none: it sends someone to fix what is not
          broken.
        */
        bandFamily === "grid"
          ? props.gridProduct === "record"
            ? undefined
            : props.gridProduct === "figure"
              ? !props.gridStore?.reachable
                ? "The grid store is not reachable. Settings > System says why."
                : undefined
              : !props.gridStore?.reachable
              ? "The grid store is not reachable. Settings > System says why."
              : !props.hasArea
                ? "Draw an area on the globe: the curtailment is read at the plants inside it."
                : props.gridBusy
                  ? "The sidecar runs one analysis at a time."
                  : undefined
          : !props.hasArea
            ? "Draw an area on the globe, or bring one in from the Areas tab."
            : (bandFamily === "solar" && props.solarBusy) ||
                (bandFamily === "wind" && props.windBusy) ||
                (bandTool === "flood" && props.floodBusy)
              ? "The sidecar runs one analysis at a time."
              : bandTool === "flood" &&
                  (props.floodParams?.demIds.length ?? 0) < FLOOD_LEAST_DEMS
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
      /*
        The last run and the values it read, both the map screen's: this screen
        is unmounted whenever the reader leaves it and the results the wires
        are about are not. See `lastRun` on BoardRunGraphProps.
      */
      lastRun={props.lastRun}
      onInputs={props.onBoardInputs}
    />
  );

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
          // The same handler the run graph's area card uses, so importing a
          // shape means one thing wherever it is offered.
          onImportPolygon={props.onImportPolygon}
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

              FROM WHICHEVER PRODUCT MADE ONE, not from the classification
              alone. This read `props.result?.run_id`, and `props.result` holds
              a classification -- App sets it to null for every other product.
              So an area carrying a finished solar, water, wind or flood run
              reported the sentinel, the save filtered it out, and the studio
              refused with "none of these areas carries one yet" over a run
              that was on screen.

              All six stamp their row now; see the `run_id` docblocks in
              lib/types.ts. Any of them identifies the ground equally well, so
              the order is only a preference: the classification first because
              it is the one whose rasters a reopened board is mostly made of.
            */
          runId={liveRunId}
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
                ({ type: "Polygon", coordinates: [] } as GeoJSONGeometry),
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
          solarResults={props.solarResults}
          onClearSolar={props.onClearSolar}
          windResult={props.windResult}
          onClearWind={props.onClearWind}
          floodResult={props.floodResult}
          gridStore={props.gridStore}
          gridCurtailment={props.gridCurtailment}
          gridCongestion={props.gridCongestion}
          gridFigure={props.gridFigure}
          reveal={props.reveal}
          onRevealed={props.onRevealed}
          onClearFlood={props.onClearFlood}
          /*
              WHERE A FAILED SURFACE GOES, which used to be the map underneath.

              BoardSurface calls this when a WebGL context cannot be created --
              too many live contexts, or a driver reset -- because a blank board
              says nothing. With the studio as the screen there is nothing
              underneath, so it has to be a destination: the analysis list,
              which needs no GL and is somewhere a reader can work from.
            */
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
  );
}
