/**
 * The whiteboard: areas lifted off their coordinates.
 *
 * On a cartographic map two AOI analyses cannot be placed side by side --
 * they are at different points on Earth. Freeing the rasters from their
 * coordinates is what makes the comparison possible at all, which is why this
 * surface exists rather than another map mode.
 *
 * Loaded lazily. It is the only route to `three`, and the map screen must not
 * pay for it until the board is opened; see BoardButton for the other
 * half of that boundary.
 */
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { motion } from "motion/react"
import { Copy, Save, Settings2 } from "lucide-react"
import type { RasterLayer } from "@/lib/mapLayers"
import type { LayerPatch } from "@/components/whiteboard/BoardSidebar"
import type { OutlinerMode } from "@/components/whiteboard/BoardSidebar"
import {
  BoardSidebar,
  type AreaInfo,
  layerRow,
  rowTarget,
  sceneKey,
  stackRow,
} from "@/components/whiteboard/BoardSidebar"
import { BoardStatsBar } from "@/components/whiteboard/BoardStatsBar"
import {
  BoardSolarDetail,

  type BoardDetailFocus,
  type PredictionCompareSide,
} from "@/components/whiteboard/BoardSolarDetail"
import { ConfirmDelete } from "@/components/ui/ConfirmDelete"
import {
  ErrorBoundary,
  PanelErrorFallback,
} from "@/components/ErrorBoundary"
import { ConfusionMatrix } from "@/components/whiteboard/AgreementCharts"
import {
  CompareSlots,
  SourceSlot,
  resolveComparePair,
} from "@/components/whiteboard/CompareSlots"
import {
  DomainShiftEditor,
  type DomainShiftMode,
} from "@/components/whiteboard/DomainShiftEditor"
import {
  compareClassMaps,
  sampleClassAtUv,
  type BrushRadiusPx,
  type ClassMapCompare,
  type ClassProbeSample,
} from "@/lib/boardProbe"
import type { ClassLegendEntry } from "@/lib/classMask"
import { legendFor, type LegendSources } from "@/lib/layerLegend"
import type { AssetRun, RunAsset } from "@/lib/runAssets"
import { modelLabel, runAssets } from "@/lib/runAssets"
import type { CardGroup } from "@/lib/boardLayout"
import { layoutGroups } from "@/lib/boardLayout"
import { majoritySmoothOverlay } from "@/lib/smoothOverlay"
import { RunPicker } from "@/components/whiteboard/RunPicker"
import {
  CURRENT_AREA,
  boardIsDirty,
  clearBoardDirty,
  liveAreaId,
  keptObject,
  markBoardDirty,
  readBoardMemory,
  renameBoardArea,
  snapshotBoard,
  writeBoardMemory,
} from "@/components/whiteboard/boardMemory"
import { useAuth } from "@/lib/auth"
import { isSavedAoiId } from "@/lib/savedAois"
import { displayRunLabel } from "@/lib/aoiLabel"
import type { LonLat } from "@/lib/geometry"
import {
  geometryAreaHectares,
  polygonOuterRing,
  resolveProjectGeometry,
  sameGround,
} from "@/lib/geometry"
import { notifyError, notifySuccess } from "@/lib/notify"
import { tableToCSV, type DataTable } from "@/lib/analysisTables"
import {
  compareAccuracyDeltaTable,
  compareBlockAgreementTable,
  compareOverallDeltaTable,
  compareShareDeltaTable,
} from "@/lib/compareTables"
import { saveWhiteboard, type Whiteboard } from "@/lib/whiteboards"
import { StudioManager } from "@/components/whiteboard/StudioManager"
import { DeleteAnalysis, LoadAnalysis } from "../../../wailsjs/go/main/App"
import type {
  GeoJSONGeometry,
  InferenceRun,
  ModelKind,
  PredictResult,
} from "@/lib/types"
import type { BoardHandle, PlaneState } from "@/components/whiteboard/boardScene"
import {
  createBoard,
  tokenColor,
  type BoardStats,
} from "@/components/whiteboard/boardScene"
import { cn } from "@/lib/utils"
import { remToPx } from "@/lib/boardPartition"
import {
  areaLeaves,
  areaRects,
  joinArea,
  maximizeArea,
  moveSplit,
  retypeArea,
  splitArea,
  type AreaId,
} from "@/lib/boardAreas"
import { STUDIO_EDITORS, studioEditor, type EditorId } from "@/lib/studioEditors"
import { toGlobeArea, type GlobeArea } from "@/components/globe/globeArea"
import type { LucideIcon } from "lucide-react"
import {
  DEFAULT_WORKSPACE,
  studioWorkspace,
  type StudioTree,
} from "@/lib/studioWorkspaces"

/** The tab strip's height; the areas divide what is left below it. */
/*
  Lazy, for the reason MapScreen loads this file lazily: the surface imports
  MapLibre and its stylesheet, which is 945 kB. Statically imported it would
  land in the studio's chunk for every board, whether or not an area is ever
  set to the globe. `toGlobeArea` above is pure and stays static, which is why
  it lives in its own module.
*/
const GlobeSurface = lazy(() =>
  import("@/components/globe/GlobeSurface").then((m) => ({
    default: m.GlobeSurface,
  }))
)

const WORKSPACE_BAR_PX = 28
import {
  AREA_HEADER_PX,
  StudioArea,
  type AreaHeaderSlots,
  type StudioEditorMode,
} from "@/components/whiteboard/StudioArea"
import {
  StudioMenuGroup,
  StudioMenuItem,
  StudioMenuRule,
  StudioPopover,
} from "@/components/whiteboard/StudioPopover"
import {
  StudioHeaderMenu,
  StudioHeaderPopoverButton,
  StudioHeaderRule,
  StudioHeaderToggle,
} from "@/components/whiteboard/StudioHeaderControls"
import { NumberField } from "@/components/ui/NumberField"
import {
  Box,
  Blend,
  BoxSelect,
  ChevronDown,
  Eraser,
  EyeOff,
  Filter,
  GitCompareArrows,
  Ruler,
  Split,
  Image as ImageIcon,
  Layers,
  LineChart as LineChartIcon,
  Layers2,
  Pentagon,
  Sun,
  TreePine,
  Waves,
  Link2,
  Paintbrush,
  RotateCcw,
  Tag,
  X,
} from "lucide-react"
import { StudioAreaTree } from "@/components/whiteboard/StudioAreaTree"
import { STUDIO_WORKSPACES } from "@/lib/studioWorkspaces"
import {
  CanopyEditor,
  type CanopyMode,
} from "@/components/whiteboard/CanopyEditor"
import { CanopyRunBar } from "@/components/whiteboard/CanopyRunBar"
import { CanopyWorkflowProvider } from "@/components/whiteboard/canopyWorkflow"
import { BrushEditor } from "@/components/whiteboard/BrushEditor"
import {
  LibraryLimitEditor,
  type LibraryLimitMode,
} from "@/components/whiteboard/LibraryLimitEditor"
import { SpectraEditor } from "@/components/whiteboard/SpectraEditor"
import { SeparabilityEditor } from "@/components/whiteboard/SeparabilityEditor"
import { StudioTables } from "@/components/whiteboard/StudioTables"
import { StudioLoading } from "@/components/whiteboard/StudioLoading"
import {
  PlaneContextMenu,
  type PlaneContextTarget,
} from "@/components/whiteboard/PlaneContextMenu"
import {
  mergePreferenceExtras,
  parsePreferenceExtras,
} from "@/lib/preferenceExtras"
import {
  parseStudioLayout,
  serializeStudioLayout,
} from "@/lib/studioLayout"
import {
  STATUS_BAR_PX,
  StudioStatusBar,
} from "@/components/whiteboard/StudioStatusBar"
import { DomainShiftSection } from "@/components/DomainShiftSection"

/**
 * Separation between stacked layers, in world units where the AOI's longest
 * side is 1.
 *
 * A tenth of the AOI: far enough that orbiting pulls the layers visibly apart,
 * close enough that they still read as one place seen in section rather than
 * as unrelated sheets.
 */
const STACK_GAP = 0.1
const GAP_MAX = 0.35

/**
 * Whether two layouts describe the same set of planes.
 *
 * Everything the SCENE is built from, and nothing that can be changed on a
 * plane once it exists -- opacity and visibility are deliberately absent.
 *
 * This decides whether the board is rebuilt. The layer array arrives fresh on
 * every render of the map screen, so without this the resolve effect produced
 * a new card array each time, the scene effect saw new identity, and the whole
 * GL context was disposed and recreated: dragging one opacity slider tore down
 * and rebuilt the board on every input event, snapping the camera back to its
 * opening angle each time.
 *
 * `uri` holds a data URI of some megabytes, so the comparison looks costly and
 * is not: the strings are the same object across renders, and identity is the
 * first thing string equality tests. The full compare runs only when a raster
 * has genuinely been replaced, which is when a rebuild is wanted anyway.
 */
/** Two area outlines, by their points; either may be absent. */
function sameOutline(
  a: { x: number; z: number }[] | undefined,
  b: { x: number; z: number }[] | undefined
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((p, i) => p.x === b[i].x && p.z === b[i].z)
}

function sameStructure(a: CardGroup[], b: CardGroup[]): boolean {
  if (a.length !== b.length) return false
  return a.every((g, i) => {
    const h = b[i]
    if (g.id !== h.id || g.cards.length !== h.cards.length) return false
    /*
      The OUTLINE counts, and leaving it out had a symptom: an area drawn on
      the board's own map appeared to do nothing. Its shape was in hand -- the
      run button enabled on it -- but an area that gains a polygon and no
      rasters has zero cards before and zero after, so this called it unchanged
      and the previous groups were kept. Nothing reached the scene until a
      raster arrived and changed the card count for it.

      Compared by its points rather than its identity: the ring is rebuilt on
      every render, so identity is always new and would rebuild the scene
      constantly. Length first, which settles the common case without walking
      anything.
    */
    if (!sameOutline(g.outline, h.outline)) return false
    // An area's PLACE is deliberately absent. Where it sits is changed by
    // dragging it and by restoring an arrangement, and neither is a reason to
    // rebuild the scene -- setGroupPosition moves what is already there.
    return g.cards.every((c, n) => {
      const d = h.cards[n]
      return (
        c.id === d.id &&
        c.uri === d.uri &&
        c.width === d.width &&
        c.height === d.height &&
        c.x === d.x &&
        c.z === d.z &&
        c.pixelated === d.pixelated
      )
    })
  })
}

/**
 * The area a board opened from a run always has.
 *
 * A constant while the board holds one area. It is threaded through as an id
 * rather than assumed, because every key that reaches the scene is an area and
 * a layer together -- two areas both have a layer called `prediction`, and a
 * key that was the layer alone would address both.
 */
/**
 * State that outlives a close.
 *
 * A drop-in for useState whose value is read from the board's memory on mount
 * and written back on every change. A hook rather than lifting every piece
 * into a parent, because the parent would not have been enough: the map screen
 * remounts when another screen is visited, and the arrangement would be lost
 * by the same gesture in a longer form.
 */
function useKept<T>(
  key: string,
  initial: T | (() => T),
  /**
   * Whether changing this is a change to the BOARD, as opposed to the studio.
   *
   * A saved board carries what is on it and how it is arranged; the workspace
   * and its area tree are a preference and travel elsewhere. Only the first
   * kind makes a board unsaved, and only that kind is worth stopping a reader
   * over when they open another one.
   */
  partOfBoard = false
) {
  const [value, setValue] = useState<T>(() =>
    readBoardMemory(
      key,
      typeof initial === "function" ? (initial as () => T)() : initial
    )
  )
  const seeded = useRef(false)
  useEffect(() => {
    writeBoardMemory(key, value)
    // The first write is the seed, not an edit.
    if (!seeded.current) {
      seeded.current = true
      return
    }
    if (partOfBoard) markBoardDirty()
  }, [key, value, partOfBoard])
  return [value, setValue] as const
}

/**
 * Whether this plane is the only visible one on the whole board.
 *
 * ONE definition, read by the menu's label and by the action behind it. Two
 * copies of this rule is how an entry comes to say "Show every plane" and then
 * hide them, which is the class of defect this file has already had with a
 * palette and with a set of table columns.
 */
function isSoloed(
  areas: ReadonlyArray<{
    id: string
    layers: ReadonlyArray<{ id: string; visible: boolean }>
  }>,
  areaId: string,
  layerId: string
): boolean {
  return areas.every((a) =>
    a.layers.every(
      (l) => (a.id === areaId && l.id === layerId) || !l.visible
    )
  )
}

export function BoardSurface({
  layers,
  retainedRuns = [],
  onDropRetainedRun,
  legendSources,
  onUseArea,
  customPolygon = null,
  onPolygonDrawn,
  savedAois = [],
  activeAoiId,
  onActivateSavedAoi,
  onRenameSavedAoi,
  onDeleteSavedAoi,
  detailHeightRem,
  onDetailResize,
  detailCollapsed,
  onDetailToggleCollapsed,
  runBar,
  runBarHeader,
  assets,
  runId,
  runPeriod,
  aoiPolygon,
  onLayerChange,
  onSelectComposition,
  onRemoveComposition,
  smooth,
  onSmoothChange,
  title,
  whiteboards = [],
  onOpenWhiteboard,
  onWhiteboardsMenu,
  onClose,
}: {
  /**
   * Every layer the run could draw, drawn or not.
   *
   * Including the hidden ones is what lets the sidebar offer the switch that
   * turns one back on. The scene builds them all and hides the ones marked so,
   * rather than building only the visible set -- visibility reaches it through
   * setAppearance, which is the one path a plane's state takes.
   */
  layers: RasterLayer[]
  /**
   * Runs the map has finished with, still on the board.
   *
   * Full results rather than ids because one may never have been saved: a run
   * made while logged out has no record to reload from.
   */
  retainedRuns?: readonly { id: string; result: PredictResult }[]
  /**
   * Let go of a retained run. Owned by the map screen, because the list is.
   *
   * Without it the X below could drop a run added from the picker and not one
   * that arrived by being what the map was showing -- the same control, doing
   * nothing on half the rows it was drawn on.
   */
  onDropRetainedRun?: (id: string) => void
  /**
   * What the CURRENT area's colours mean, for the legend.
   *
   * The board holds the run's rasters but not the run: class_stats, the water
   * index and the solar scale all live on the payload the map screen has, and
   * none of them travels on a RasterLayer -- a layer is what is drawn, not what
   * it means. Fetched areas carry their own inside `extraRuns`.
   */
  legendSources?: LegendSources
  /**
   * Put a geometry from the Areas tab back onto the map as the active AOI.
   * Saved catalog entries go through onActivateSavedAoi instead.
   */
  onUseArea?: (geom: GeoJSONGeometry) => void
  /**
   * The area in hand, so the globe can show it and edit it.
   *
   * Distinct from the catalog in `savedAois`: that is what has been kept, this
   * is what is being worked on, and the globe draws them differently for the
   * same reason the work map does.
   */
  customPolygon?: GeoJSONGeometry | null
  /**
   * A shape was drawn on, edited on or cleared from the globe.
   *
   * Takes a null, which is what separates it from `onUseArea`: that one adopts
   * an existing geometry and cannot mean "there is no area now". Drawing can.
   */
  onPolygonDrawn?: (geom: GeoJSONGeometry | null) => void
  /** Drawn / imported AOIs kept in the catalog (not only the active one). */
  savedAois?: import("@/lib/savedAois").SavedAoi[]
  activeAoiId?: string
  onActivateSavedAoi?: (id: string) => void
  onRenameSavedAoi?: (id: string, name: string) => void
  onDeleteSavedAoi?: (id: string) => void
  /** The detail band's height in rem, and where a drag on its edge reports. */
  detailHeightRem?: number
  onDetailResize?: (rem: number) => void
  /** The band folded to its grip; the studio keeps the height it gives back. */
  detailCollapsed?: boolean
  onDetailToggleCollapsed?: () => void
  /**
   * The run controls, handed in rather than rebuilt.
   *
   * They belong to the map screen -- which owns the parameters, the handlers
   * and the progress -- and threading twenty props through here to reassemble
   * them would put that state in a second place. As a node, the studio decides
   * only WHERE they are drawn, which is the one thing the area tree is for.
   */
  runBar?: React.ReactNode
  /**
   * The run editor's own header contents, built where its props are.
   *
   * The tool tabs and the mode belong in a header's left zone -- they decide
   * what the editor is ABOUT -- but the state behind them is the map screen's.
   * Handed in for the same reason the band itself is.
   */
  runBarHeader?: AreaHeaderSlots
  assets: RunAsset[]
  runId: string
  runPeriod: string
  aoiPolygon?: LonLat[] | null
  onLayerChange: (id: string, patch: LayerPatch) => void
  onSelectComposition?: (id: string) => void
  onRemoveComposition?: (id: string) => void
  smooth: boolean
  onSmoothChange: (v: boolean) => void
  title: string
  /**
   * The saved boards, and the way into one.
   *
   * The studio's title block names the board that is loaded; without these it
   * could only ever name it. Absent where the caller offers no catalog, in
   * which case the block stays a readout.
   */
  whiteboards?: readonly Whiteboard[]
  onOpenWhiteboard?: (board: Whiteboard) => void
  /** Refreshes the list as the menu opens, so it is not a stale catalog. */
  onWhiteboardsMenu?: () => void | Promise<void>
  onClose: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<BoardHandle | null>(null)
  /*
    What the board costs, polled rather than pushed.

    Twice a second, which is as fast as a figure is worth reading and slow
    enough that displaying it is not itself the load. Pushing from the scene
    would ask React to re-render at the frame rate in order to show the frame
    rate, and the stall being looked for would be partly this.

    Null until the scene reports: on a board with nothing on it there is no
    frame to have taken any time.
  */
  const [boardStats, setBoardStats] = useState<BoardStats | null>(null)
  useEffect(() => {
    const id = window.setInterval(() => {
      setBoardStats(boardRef.current?.stats() ?? null)
    }, 500)
    return () => window.clearInterval(id)
  }, [])

  /**
   * What the column is listing, and which asset it is describing.
   *
   * Opens on the scene, because the board is the reason this surface exists
   * and the tree is what governs it. The data list is where the run's output
   * is read and exported, which is a thing you go looking for.
   */
  /**
   * Names given to rows, over the ones the products carry.
   *
   * Board-local and not persisted, like everything else about this surface.
   * It matters for what comes next rather than for what is here: with one
   * area on the board "Classification" is unambiguous, and with two it names
   * two different rasters.
   */
  const [names, setNames] = useKept<Readonly<Record<string, string>>>(
    "names",
    {},
    true
  )

  /*
    THE ARRANGEMENT, and which named one it started from.

    Through useKept, so it survives a glance at the map and does not survive a
    restart -- the position boardMemory states for itself. A workspace is a
    preset; the live tree is what the reader has done to it since, and keeping
    one tree per workspace is what lets switching tabs be reversible.
  */
  /*
    Seeded from preferences, kept in board memory while the studio is open, and
    written back when it settles. The three tiers are deliberate: the
    preference is what a restart restores, board memory is what survives a
    glance at the map, and component state is what a render sees.
  */
  const { prefs, savePrefs } = useAuth()
  const storedLayout = useMemo(
    () => parseStudioLayout(parsePreferenceExtras(prefs?.extras_json).studio_layout),
    [prefs?.extras_json]
  )
  const [workspaceId, setWorkspaceId] = useKept(
    "workspace",
    storedLayout.workspace ?? DEFAULT_WORKSPACE
  )
  const [trees, setTrees] = useKept<Readonly<Record<string, StudioTree>>>(
    "trees",
    storedLayout.trees ?? {}
  )

  /*
    THE OUTLINER'S PANE, PER AREA.

    It was one value for the whole studio, so two outliners could not differ:
    putting one on Scene and the other on Data set both to Data. An editor's
    state belongs to the AREA that holds it -- Blender keeps exactly this, a
    per-area record of every editor that has occupied the space, which is also
    why retyping away and back returns to the pane you left.

    Keyed by area and editor for that second reason: an area that becomes a
    properties column and later an outliner again finds its own pane, not the
    one some other area was last left on.
  */
  /*
    Values are plain strings, which is what `parseStudioLayout` already stores
    and accepts -- it takes any string and leaves the editor that reads one to
    fall back on a value it does not recognise. The record was typed to the
    outliner's own union while the key was already namespaced by editor, so a
    second editor with panes could not use it without widening this first.
  */
  const [areaModes, setAreaModes] = useKept<Readonly<Record<string, string>>>(
    "areaModes",
    storedLayout.modes ?? {}
  )
  const modeKey = (areaId: AreaId) => `${areaId}:outliner`
  const modeOf = (areaId: AreaId): OutlinerMode =>
    (areaModes[modeKey(areaId)] as OutlinerMode) ?? "scene"
  const setModeOf = (areaId: AreaId, m: OutlinerMode) =>
    setAreaModes((prev) => ({ ...prev, [modeKey(areaId)]: m }))

  /*
    The domain-shift editor's two readings, per area, in the same record.

    A pair and a cohort answer different questions over the same data: the pair
    carries the histogram, the projection and the feature-shift table, none of
    which are defined for N subjects; the cohort carries the figure the
    transferability study resolves to, which the pair cannot express at all.
    Neither replaces the other, so this is a pane selector and not a migration.
  */
  const shiftModeKey = (areaId: AreaId) => `${areaId}:domainShift`
  const shiftModeOf = (areaId: AreaId): DomainShiftMode =>
    areaModes[shiftModeKey(areaId)] === "cohort" ? "cohort" : "pair"
  const setShiftModeOf = (areaId: AreaId, m: DomainShiftMode) =>
    setAreaModes((prev) => ({ ...prev, [shiftModeKey(areaId)]: m }))

  /*
    Which question the AOI canopy area is asking.

    Three panes rather than one scrolling body, for the reason the outliner has
    three: the season is a curve, the light is a grid of scalars and the two
    ages are a second curve on a different axis. Stacked, each gets a third of
    the height and none can be read.

    Per area like the others, so one can hold the season beside another holding
    the light -- which is the comparison the reader actually wants, since the
    light is what the season is FOR.
  */
  const canopyModeKey = (areaId: AreaId) => `${areaId}:canopy`
  const canopyModeOf = (areaId: AreaId): CanopyMode => {
    const m = areaModes[canopyModeKey(areaId)]
    return m === "season" || m === "light" || m === "ages" ? m : "stand"
  }
  const setCanopyModeOf = (areaId: AreaId, m: CanopyMode) =>
    setAreaModes((prev) => ({ ...prev, [canopyModeKey(areaId)]: m }))

  /*
    The library check's two readings, per area.

    They answer different questions and neither contains the other. The
    distance is a ranking over every class at once and is what a reader comes
    for; why it survives is one class at a time, band by band, and is what
    stops the ranking being read as an identification. Stacked in one body the
    ranking pushed the mechanism below the fold, which is where an argument
    goes to be skipped.
  */
  const libraryModeKey = (areaId: AreaId) => `${areaId}:libraryLimit`
  const libraryModeOf = (areaId: AreaId): LibraryLimitMode =>
    areaModes[libraryModeKey(areaId)] === "mechanism" ? "mechanism" : "distance"
  const setLibraryModeOf = (areaId: AreaId, m: LibraryLimitMode) =>
    setAreaModes((prev) => ({ ...prev, [libraryModeKey(areaId)]: m }))

  /*
    Which board area is the source of the star, per pane.

    Session-level for the same reason `comparePins` is: it names a board area
    that exists only while those runs are on the board, so restoring it into a
    fresh session would point at nothing.
  */
  const [cohortSources, setCohortSources] = useKept<Record<string, string>>(
    "cohortSources",
    {}
  )
  const setCohortSource = (paneId: AreaId, boardAreaId?: string) =>
    setCohortSources((prev) => {
      const next = { ...prev }
      if (boardAreaId) next[paneId] = boardAreaId
      else delete next[paneId]
      return next
    })

  /*
    Written on a delay, because a division is dragged continuously and each
    frame would otherwise be a round trip to the store. Long enough that a drag
    writes once when it stops, short enough that closing the window a moment
    later still keeps it.
  */
  const layoutRef = useRef({ workspaceId, trees, areaModes })
  layoutRef.current = { workspaceId, trees, areaModes }
  useEffect(() => {
    if (!prefs) return
    const t = window.setTimeout(() => {
      const { workspaceId: w, trees: ts, areaModes: ms } = layoutRef.current
      void savePrefs(
        {
          ...prefs,
          extras_json: mergePreferenceExtras(prefs.extras_json, {
            studio_layout: serializeStudioLayout(w, ts, ms),
          }),
        },
        // Silent: an arrangement is not an action a reader took by name, and a
        // toast for every column drag would be the loudest thing in the studio.
        { silent: true }
      ).catch(() => {
        /* best-effort, as the other preference writers are */
      })
    }, 800)
    return () => window.clearTimeout(t)
  }, [workspaceId, trees, areaModes, prefs, savePrefs])
  /*
    The arrangement a maximise replaced, so the same keystroke puts it back.
    Without it, maximising would be a join that destroyed the workspace.
  */
  const [restoreTree, setRestoreTree] = useKept<
    Readonly<Record<string, StudioTree | null>>
  >("restore", {})
  const tree: StudioTree =
    trees[workspaceId] ?? studioWorkspace(workspaceId).build()
  const setTree = useCallback(
    (next: StudioTree) => setTrees((prev) => ({ ...prev, [workspaceId]: next })),
    [setTrees, workspaceId]
  )

  /*
    The surface's own rectangle, measured rather than assumed.

    The areas are placed in pixels from one walk of the tree, so the walk needs
    a real box to divide. An observer rather than a read at mount: the window
    resizes, and a snapshot would leave every area where it was when the studio
    opened.
  */
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const [surface, setSurface] = useState({ x: 0, y: 0, w: 0, h: 0 })
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const read = () =>
      setSurface({
        x: 0,
        // Below the workspace tabs, which are outside the partition for the
        // same reason Blender keeps its topbar outside the splittable area:
        // the thing that chooses an arrangement cannot be part of it.
        y: WORKSPACE_BAR_PX,
        w: el.clientWidth,
        h: Math.max(0, el.clientHeight - WORKSPACE_BAR_PX - STATUS_BAR_PX),
      })
    read()
    const obs = new ResizeObserver(read)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const rootPx = remToPx(1)
  const leaves = areaLeaves(tree)
  /*
    Where the canvas goes: the viewport area's rectangle, or nowhere.

    Read from the same walk that places the areas, so the canvas cannot end up
    somewhere the viewport area is not -- the class of mismatch that had the
    axis gizmo clearing one column's width on the other column's side.
  */
  const viewportRect = useMemo(() => {
    const { leaves: rects } = areaRects(tree, surface)
    return rects.find((r) => r.editor === "viewport") ?? null
  }, [tree, surface])
  // The viewport owns the one GL context, so it may be in one area at a time.
  const takenUnique = useMemo(() => {
    const taken = new Set<EditorId>()
    for (const l of leaves) {
      if (STUDIO_EDITORS.find((e) => e.id === l.editor)?.unique) taken.add(l.editor)
    }
    return taken
  }, [leaves])
  const renameRow = (rowId: string, name: string) =>
    setNames((prev) => {
      const next = { ...prev }
      const trimmed = name.trim()
      // Cleared rather than stored empty: a row with no name at all is not a
      // state worth being able to reach, and giving back the product's own
      // name is what emptying the field is asking for.
      if (trimmed) next[rowId] = trimmed
      else delete next[rowId]
      return next
    })

  /**
   * Runs fetched to sit beside the one the board opened from.
   *
   * Loaded through LoadAnalysis directly rather than through the map screen's
   * openSavedAnalysis, and that is the point: openSavedAnalysis REPLACES the
   * analysis on screen, which is the opposite of what a comparison needs. The
   * board holds these itself and the map never learns about them.
   */
  const [extraRuns, setExtraRuns] = useKept<
    readonly { run: InferenceRun; result: PredictResult }[]
  >("extraRuns", [])
  const [loadingRun, setLoadingRun] = useState(false)
  const { runs, projects, refreshRuns } = useAuth()

  /**
   * The board's own identity, once it has been saved under a name.
   *
   * Kept with the arrangement, so a board saved, closed and reopened saves
   * again over itself rather than making a second copy of the same work.
   */
  const [savedId, setSavedId] = useKept<string | null>("savedId", null)
  const [savedName, setSavedName] = useKept<string | null>("savedName", null)
  const [naming, setNaming] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** Whether the title block's catalog is open. */
  const [boardMenu, setBoardMenu] = useState(false)
  /** Whether the rename-and-remove dialog is up. */
  const [managing, setManaging] = useState(false)
  /**
   * A board chosen while this one has changes that were never saved.
   *
   * Opening one replaces everything the board is holding -- `restoreBoard`
   * clears the store before it writes -- so a switch is where unsaved work
   * goes silently. Held here until the reader has said what to do with it.
   */
  const [pendingOpen, setPendingOpen] = useState<Whiteboard | null>(null)
  const openBoard = (board: Whiteboard) => {
    if (board.id === savedId) return
    if (boardIsDirty()) setPendingOpen(board)
    else onOpenWhiteboard?.(board)
  }

  /*
    Runs a whiteboard named that are not on the board yet.

    Opening a saved board restores the arrangement immediately -- it is plain
    data -- but its rasters have to be fetched, and fetching belongs here where
    LoadAnalysis already lives. The list is consumed rather than read, so a
    board reopened twice does not queue the same runs twice.
  */
  /*
    The workspace a caller asked this opening to land on.

    Consumed rather than read, exactly as `pendingRunIds` is, and for the same
    reason: a preset asked for once must not be re-imposed every time the board
    reopens, or a reader who retyped an area would lose it on their next glance
    at the map.

    Separate from the run list because the two are independent -- opening a
    saved board sends runs and no workspace, since that board carries its own
    arrangement, and a caller may one day want the reverse.
  */
  useEffect(() => {
    const wanted = readBoardMemory<string>("pendingWorkspace", "")
    if (!wanted) return
    writeBoardMemory("pendingWorkspace", "")
    setWorkspaceId(wanted)
    // Once, on mount, for the reason the run list below is taken once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const pending = readBoardMemory<string[]>("pendingRunIds", [])
    if (!pending.length) return
    writeBoardMemory("pendingRunIds", [])
    /*
      The live area's keys, brought back to the id it carries here.

      A board is stored as runs, so what the live area held was written under
      the run it reopens as. If the map is on that same ground now, the live
      area is the AREA (see `liveAreaId`) and those keys name a run instead --
      and a raster taken off the board comes back, silently, because the key
      that says it was removed no longer matches any area.
    */
    renameBoardArea(runId || CURRENT_AREA, live)
    void (async () => {
      for (const runId of pending) {
        const run = runs.find((r) => r.id === runId)
        if (!run) continue
        await addRun(run)
      }
    })()
    // Once, on mount: the list is emptied as it is taken, and re-running on a
    // change to `runs` would fetch nothing and cost a pass over the array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doSave = async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    /*
      A BOARD WITH NOTHING ON IT IS NOT A SAVE, IT IS A DELETION.

      Saving writes the membership whole, so a save made before a board has
      finished fetching its runs replaces the list of what is on it with
      nothing -- and reported success while doing it. Two boards in this
      author's own store are at zero members for exactly that reason: opened,
      saved a moment later, emptied. The save is refused while runs are still
      arriving, and refused when there is nothing to record.
    */
    if (loadingRun) {
      notifyError(
        "Still opening this studio",
        new Error(
          "its runs are still being fetched, and saving now would store the board without them"
        )
      )
      return
    }
    setSaving(true)
    try {
      /*
        Each area by the RUN it will reopen as, with the rasters on it.

        The map's own area reopens as its run like any other: a board is a set
        of runs arranged, and which of them the map happened to be showing when
        it was saved is not part of that. An area whose run was never saved has
        no id to record and is left out rather than saved as a hole.
      */
      const members = areas
        .map((a) => ({
          runId: a.id === live ? runId : a.id,
          layerIds: a.layers.map((l) => l.id),
        }))
        // A member is a RUN. The live area answers with the run it is showing;
        // a catalogued drawing with nothing on it answers with its own id,
        // which is an area and not a run, and would be stored as a member that
        // reopens as nothing.
        .filter(
          (m) => m.runId && m.runId !== "current" && !isSavedAoiId(m.runId)
        )
      if (!members.length) {
        notifyError(
          "Nothing to save in this studio",
          new Error(
            "a board is the runs arranged on it, and none of these areas is a saved run yet — run something, or add a run from the outliner, before saving"
          )
        )
        return
      }
      const board = await saveWhiteboard(
        trimmed,
        // The run the map's area belongs to, so its keys are rewritten to the
        // id that area will carry when the board is opened again.
        snapshotBoard(members, runId, live),
        savedId ?? undefined
      )
      setSavedId(board.id)
      setSavedName(board.name)
      setNaming(null)
      // What is on disk is what is on screen again, so a switch has nothing
      // left to warn about.
      clearBoardDirty()
      notifySuccess(`Studio "${board.name}" saved.`)
    } catch (e) {
      notifyError("Could not save this studio", e)
    } finally {
      setSaving(false)
    }
  }

  const addRun = async (run: InferenceRun) => {
    setLoadingRun(true)
    try {
      const result = (await LoadAnalysis(run.id)) as unknown as PredictResult
      setExtraRuns((prev) =>
        prev.some((x) => x.run.id === run.id) ? prev : [...prev, { run, result }]
      )
    } catch (e) {
      notifyError("Could not load that run", e)
    } finally {
      setLoadingRun(false)
    }
  }

  /**
   * The data tree's branches: one run each.
   *
   * A list of one while the board opens from a single run, and a list because
   * the next thing it holds is another run's output -- which is what a second
   * area on the board is made from.
   */
  /** What a run was made by, or nothing where no record says. */
  const runModel = (id: string): string | undefined => {
    const kind = runs.find((r) => r.id === id)?.model_kind
    return kind ? modelLabel(kind as ModelKind) : undefined
  }

  /*
    WHICH CATALOGUED AREA EACH RUN IS OF.

    A run records it since `InferenceRun.aoi_id`; a run written before that
    column existed does not, and is matched by its polygon instead -- it was
    sent the drawing's exact ring, so ring equality is the honest test and
    `sameGround` says why it is not a spatial predicate.

    Memoised because the fallback parses a polygon per run, and this is read
    from three places in a render that runs on every drag of a division.
  */
  const aoiOfRun = useMemo(() => {
    const out = new Map<string, string>()
    for (const r of runs) {
      const linked = (r.aoi_id ?? "").trim()
      if (linked) {
        out.set(r.id, linked)
        continue
      }
      if (!savedAois.length || !r.polygon_geojson) continue
      let geom: GeoJSONGeometry | null = null
      try {
        geom = JSON.parse(r.polygon_geojson) as GeoJSONGeometry
      } catch {
        continue
      }
      const match = savedAois.find((a) => sameGround(a.geometry, geom))
      if (match) out.set(r.id, match.id)
    }
    return out
  }, [runs, savedAois])

  /*
    Which subject the map's area IS, rather than the slot it sits in.

    Every `CURRENT_AREA` below became this. The literal survives only where
    there is genuinely no subject -- no run and no catalogued AOI -- which is
    what `liveAreaId` falls back to.

    The ground of the SHOWN run decides it, and the active drawing only stands
    in where no run is shown. Read from the run's own record where the list
    knows it: activating another area while a result is on screen must not
    rename the result's own ground. A run the list has not caught up with --
    one saved a moment ago -- was made over the area that is active now, which
    is the only case where the two can disagree and the newer answer is right.
  */
  const live = liveAreaId(
    runId,
    activeAoiId,
    runs.some((r) => r.id === runId) ? aoiOfRun.get(runId) : activeAoiId
  )

  /*
    What the live area is CALLED, derived once.

    It was resolved in two places -- the scene tree's area and the data tree's
    run -- which is how they came to disagree: the scene said "Campo IFPI"
    while the data said "drawn 2", and after the title prop stopped falling
    back to a literal the data row said nothing at all.

    The run's own name first, since a saved run has one; then whatever the map
    is calling the area; and a generic last, because a row with no name cannot
    be told from a row that failed to load.
  */
  const liveTitle =
    displayRunLabel(runs.find((r) => r.id === runId)?.label ?? "") ||
    title ||
    "Unnamed area"

  const assetRuns: AssetRun[] = [
    ...(assets.length
      ? [
          {
            areaId: live,
            runId,
            title: liveTitle,
            period: runPeriod,
            /*
              From the RUN RECORD, not from the model control.

              The control says what the next run will use; this label has to say
              what THIS raster was made by, and the two part company the moment
              the estimator is changed after a run -- which is the whole gesture
              being compared here. It is the same defect the legend had, where
              the panel described a map the plane was not drawing.

              PredictResult carries no model_kind, so the run record is the only
              place it exists. An unsaved run has no record and gets no label,
              which is the honest answer rather than the live control's.
            */
            model: runModel(runId),
            // A saved run is one the list knows; the map's live result
            // before its first save is not, and has nothing to delete.
            deletable: runs.some((r) => r.id === runId),
            assets,
          },
        ]
      : []),
    /*
      Runs the map has finished with, as areas of their own.

      They are the same shape as a picker-loaded run on purpose: there is one
      kind of "run on the board", whether it arrived by being chosen or by
      being what the map was showing a moment ago. A run the picker has since
      loaded wins, since that one carries its full record; these carry only
      what the live result had.

      Skipped where the live area still is them -- the map has not moved on --
      and where the picker already holds the same id, so nothing is listed
      twice.
    */
    ...retainedRuns
      .filter(
        (r) =>
          /*
            NOT AGAINST `live`, AND THAT WAS A REAL COST.

            Excluding the ground the map is on looks right -- the live area is
            already listed -- and it took the retained entry away exactly when
            it was the only thing left. Returning to a ground the map had moved
            on from clears its products, because the aoiSignature effects drop
            what belongs to the area being left; the retained copy is then the
            only account of the run, and this filter dropped it. The area a
            reader selected came back empty while the one they had left kept
            its raster.

            Nothing lists twice without it. The live entry above is added ONLY
            when it has assets of its own, and it is added FIRST, so `assetOf`
            prefers it whenever there is a live run to prefer; `areas` filters
            `r.areaId !== live` on its own account, so no second row appears.
          */
          r.id !== runId && !extraRuns.some((x) => x.run.id === r.id)
      )
      .map((r) => ({
        areaId: r.id,
        runId: r.id,
        /*
          THERE IS A ROW TO DELETE, asked of the run list rather than of the id.

          This tested `!id.startsWith("unsaved:")`, which was a proxy for the
          same question while every retained entry was keyed by a run. Keying
          them by the GROUND broke the proxy: an area id does not start with
          that prefix, so the bin was drawn on rows with no record behind them
          and deleting one asked the store to end a run that does not exist.
          The live entry above has always asked the list; so does this one now.
        */
        deletable: runs.some((x) => x.id === r.id),
        /*
          THE RUN'S NAME, AND THE GROUND'S WHERE NO RUN ROW ANSWERS.

          This tree lists runs, so a run label is right here -- unlike the
          scene tree beside it, which lists ground. What was wrong is who was
          asked: `runs.find` is given an AREA id since retained runs began
          being filed under the ground, finds nothing, and `displayRunLabel`
          answers an empty label with "run-untitled". Every retained run was
          therefore called the same thing, and two of them could not be told
          apart.

          The ground's name is the honest second answer, and
          `displayRunLabel` already knows how to make a run name out of one --
          its own legacy branch does exactly this, turning an area name into
          `run-<name>`. So a solar run over "drawn 2" reads "run-drawn-2"
          rather than sharing a placeholder with every other.

          It matters most for the products that carry no row of their own:
          only water records a run_id on its payload, so solar and flood would
          otherwise be permanently anonymous.
        */
        title:
          displayRunLabel(
            runs.find((x) => x.id === r.id)?.label ??
              savedAois.find((a) => a.id === r.id)?.name ??
              ""
          ) || "Previous run",
        model: runModel(r.id),
        period:
          r.result.date_range?.length === 2
            ? `${r.result.date_range[0]} → ${r.result.date_range[1]}`
            : "",
        // Same call the picker-loaded runs make: the run's own water and solar
        // travel in its payload, and none of the map's overlay switches apply
        // to a run the map is no longer showing.
        assets: runAssets({
          result: r.result,
          composition: null,
          compositionGallery: [],
          water: r.result.water,
          solarTerrain: r.result.solar_terrain,
          solarSiting: r.result.solar_siting,
          showCompositionOverlay: false,
          showWaterOverlay: false,
          showSolarTerrain: false,
          showSolarSiting: false,
          composeOpacity: 1,
          waterOpacity: 1,
        }),
      })),
    ...extraRuns.map(({ run, result }) => ({
      // The run's own id names its area: it is unique, it is stable across a
      // reopen, and it is what a saved arrangement will record.
      areaId: run.id,
      runId: run.id,
      deletable: true,
      title: displayRunLabel(run.label) || run.model_kind,
      model: runModel(run.id),
      period:
        result.date_range?.length === 2
          ? `${result.date_range[0]} → ${result.date_range[1]}`
          : `${run.period_start} → ${run.period_end}`,
      assets: runAssets({
        result,
        composition: null,
        compositionGallery: [],
        /*
          The run's OWN water and solar, which travel in its payload when those
          products were made over the same AOI (PredictResult.water,
          .solar_terrain, .solar_siting). They were being dropped here while
          the map screen's identical call kept them, so a second area on the
          board listed a classification and nothing else -- the rasters existed
          in hand and the tree did not mention them.
        */
        water: result.water,
        solarTerrain: result.solar_terrain,
        solarSiting: result.solar_siting,
        // A loaded run brings its own rasters and none of the map's state:
        // nothing here is drawn on the map, so nothing here has a switch there.
        showCompositionOverlay: false,
        showWaterOverlay: false,
        showSolarTerrain: false,
        showSolarSiting: false,
        composeOpacity: 1,
        waterOpacity: 1,
      }),
    })),
  ]

  /**
   * What the board is stacking, as opposed to what the map is drawing.
   *
   * The two are not the same set and never were: NDVI mean and the true-colour
   * scene are produced by every run and the map has no control for either, so
   * they existed only as entries in a gallery. Putting one on the board is
   * what this state records.
   *
   * Two sets rather than one list of members, so that products appearing and
   * disappearing under it need no reconciling: a run that finishes adds its
   * rasters to the base set and they are in the stack because nothing removed
   * them, not because something remembered to add them.
   */
  /**
   * Which of the current run's rasters the board has taken off its stack.
   *
   * Only the current area has any: its layers arrive from the map, so taking
   * one off is recorded as a subtraction. Every other area is made ENTIRELY of
   * additions -- nothing put a loaded run on the board except someone asking
   * for it -- so for those, membership is the added list and nothing else.
   */
  const [removed, setRemoved] = useKept<ReadonlySet<string>>(
    "removed",
    () => new Set(),
    true
  )
  /** Scene ids added, per area, in the order they were added. */
  /*
    Areas the reader has taken off the board.

    A catalogued AOI survives the filter below whether or not it carries a
    raster -- it is the ground a run is about to be made on, and dropping it
    the moment its rasters come off would take the subject away with them.
    That left no way to be FINISHED with one: the row stayed, and the only
    control that would remove it was the one in the Areas pane that deletes the
    geometry outright, which is a far larger act than clearing the board.

    Dismissal is a board fact and not a catalogue one, so it lives here and the
    entry is untouched. Putting a raster back on the area brings it back, and a
    run over it makes it live again.
  */
  const [dismissedAreas, setDismissedAreas] = useKept<readonly string[]>(
    "dismissedAreas",
    [],
    true
  )
  const removeArea = (areaId: string) => {
    const area = areas.find((a) => a.id === areaId)
    area?.layers.forEach((l) => removeFromScene(areaId, l.id))
    setDismissedAreas((prev) =>
      prev.includes(areaId) ? prev : [...prev, areaId]
    )
  }

  const [added, setAdded] = useKept<
    Readonly<Record<string, readonly string[]>>
  >("added", {}, true)

  /*
    HANDING THE OUTGOING RUN ITS OWN MEMBERSHIP.

    The map's area ADDS nothing: its rasters arrive as the `layers` prop and
    were never recorded in `added`. That is fine while it is the live area and
    fatal the moment it stops being one -- a retained run would appear in the
    data tree, list its rasters, and put none of them on the scene, because
    `extrasFor` reads `added` and there was nothing under its id.

    `snapshotBoard` states the same thing for the save path: the map's own area
    has to have its membership materialised at the moment it stops being the
    map's. This is that moment for the live board rather than for a saved one.

    KEYED ON THE AREA LEAVING, NOT ON THE RUN ID. It watched `runId`, which is
    `result.run_id || "current"` -- so a run that produced only a standalone
    product never moved it off the sentinel and this never fired, and even for
    a classification the id it compared was not the one the board files areas
    under. `live` IS that id: `liveAreaId` answers with the ground whenever the
    ground is known, which is what the retained entry is now keyed by too.
    Three names for one area was why a retained run arrived on the board with
    nothing on it.

    Only ever fills an empty entry, so a reader who has since removed a plane
    by hand does not have it put back.
  */
  const lastLiveRun = useRef<string | null>(null)
  // Read through a ref, because by the time the area changes the `layers`
  // prop has ALREADY been emptied -- the whole defect being fixed here.
  const layersRef = useRef(layers)
  if (layers.length) layersRef.current = layers
  /*
    HELD UNTIL THE RETAINED ENTRY ARRIVES, because it arrives a render late.

    Retention happens in an effect in App and this is an effect in a child of
    it, and React runs a child's effects before its parent's. So on the render
    where the area changes, this ran first and `retainedRuns` did not yet hold
    the ground being left: the guard below sent it home, and it had already
    forgotten which area to carry from. By the next render the area it wanted
    was no longer the previous one and the window was gone -- the retained run
    reached the board with nothing on it, which is what a reader saw as the
    rasters not staying in the viewport.

    So the carry is REMEMBERED at the moment of the change, when the outgoing
    layers are still readable, and spent whenever the entry turns up. Cleared
    on use, so it happens once.
  */
  const pendingCarry = useRef<{ id: string; ids: string[] } | null>(null)
  useEffect(() => {
    const previous = lastLiveRun.current
    if (previous !== live) {
      lastLiveRun.current = live
      if (previous && previous !== CURRENT_AREA) {
        const ids = layersRef.current.map((l) => l.id)
        pendingCarry.current = ids.length ? { id: previous, ids } : null
      }
    }
    const pending = pendingCarry.current
    if (!pending) return
    if (!retainedRuns.some((r) => r.id === pending.id)) return
    pendingCarry.current = null
    setAdded((prev) =>
      prev[pending.id]?.length ? prev : { ...prev, [pending.id]: pending.ids }
    )
  }, [live, retainedRuns, setAdded])
  /*
    THE LIVE AREA RE-RESOLVED, not replaced.

    Its id answers with the ground when the ground is known, and the ground can
    become known a moment after the board is up: the run record arrives, or a
    catalogued drawing is matched by geometry. That is the same subject under a
    better name, so what the board remembers about it moves with it -- without
    this, removing a plane and then having the run list arrive would put the
    plane back, since the key that recorded the removal named an id nothing is
    called any more.

    Only for the same subject. The live area also changes id when the map moves
    to another field, and carrying one field's removals onto the next would be
    the very defect `liveAreaId` was rewritten to end.
  */
  const previousLive = useRef(live)
  useEffect(() => {
    const before = previousLive.current
    previousLive.current = live
    if (before === live) return
    if (before === (runId || CURRENT_AREA) || before === CURRENT_AREA) {
      renameBoardArea(before, live)
    }
  }, [live, runId])

  /**
   * Opacity and visibility for rasters the board added.
   *
   * Board-local, and that is the honest place for it: these are not on the
   * map, so there is no map state for them to share. The current area's base
   * layers keep sharing theirs, which is what stops the two surfaces
   * disagreeing about what is on screen.
   */
  const [extraState, setExtraState] = useKept<
    Readonly<Record<string, { opacity: number; visible: boolean }>>
  >("extraState", {}, true)

  /**
   * Layers dropped to the base of their stack.
   *
   * Board-local for every layer, including the map's own: where a raster sits
   * in this stack is a fact about looking at it here, and the map has no
   * stack to have an opinion about.
   */
  const [flat, setFlat] = useKept<ReadonlySet<string>>(
    "flat",
    () => new Set(),
    true
  )

  /**
   * A stack order the user has set, per area, bottom first.
   *
   * The default comes from each product's own ordering number -- a
   * classification reads over surface water, confidence reads over the
   * classification -- which is a sensible answer and not the only one. With
   * rasters the order decides what can be seen at all, so it has to be
   * something the person looking can change.
   *
   * Absent for an area nobody has reordered. A product appearing after an
   * order was set is not in that list, so it goes on top rather than being
   * dropped: something new is worth seeing, and burying it under a list
   * written before it existed would hide it with no way to tell why.
   */
  const [order, setOrder] = useKept<Readonly<Record<string, string[]>>>(
    "order",
    {},
    true
  )
  const reorderArea = (areaId: string, topFirst: string[]) =>
    // Stored bottom first, which is how a stack is built and how layoutGroups
    // reads it; the tree hands it over top first, which is how it reads.
    setOrder((prev) => ({ ...prev, [areaId]: [...topFirst].reverse() }))

  /**
   * Whether each area's rasters are joined to one another by a line.
   *
   * Off by default: an area whose planes are still stacked needs no line to
   * say they belong together, and a board that does not need them is only
   * made busier.
   */
  const [links, setLinks] = useKept("links", false)

  /**
   * Whether each raster carries its name on the board.
   *
   * The elements are React's -- they say a layer's name, which the outliner
   * owns and someone can rename -- and their POSITIONS come from the scene
   * after every frame. Written straight onto the nodes rather than held as
   * state: a drag reports a position per frame, and re-rendering this whole
   * surface sixty times a second to move some text is work for nothing.
   */
  const [labels, setLabels] = useKept("labels", false)
  const labelRefs = useRef(new Map<string, HTMLElement>())
  const placeLabels = (
    spots: {
      groupId: string
      id: string
      x: number
      y: number
      onScreen: boolean
    }[]
  ) => {
    const seen = new Set<string>()
    for (const spot of spots) {
      const key = sceneKey(spot.groupId, spot.id)
      seen.add(key)
      const el = labelRefs.current.get(key)
      if (!el) continue
      el.style.transform = `translate(${spot.x}px, ${spot.y}px) translate(-50%, -50%)`
      el.style.opacity = spot.onScreen ? "1" : "0"
    }
    // A label with no spot this frame belongs to a plane that is not drawn.
    for (const [key, el] of labelRefs.current) {
      if (!seen.has(key)) el.style.opacity = "0"
    }
  }
  const placeLabelsRef = useRef(placeLabels)
  placeLabelsRef.current = placeLabels
  const toggleFlat = (areaId: string, layerId: string) =>
    setFlat((prev) => {
      const next = new Set(prev)
      const k = sceneKey(areaId, layerId)
      if (!next.delete(k)) next.add(k)
      return next
    })

  /** The current run's own layers, which are the map's and answer to it. */
  const baseIds = new Set(layers.map((l) => l.id))

  const assetOf = (areaId: string, sceneId: string) =>
    assetRuns
      .find((r) => r.areaId === areaId)
      ?.assets.find((a) => a.sceneId === sceneId)

  /*
    Rasters the board added to an area, as layers.

    Matched on the id the asset carries IN THE SCENE, not its own. The two
    differ for the water raster and for the active composition, and an asset
    whose two ids differ would otherwise slip through as a plane that nothing
    could find again.
  */
  const extrasFor = (areaId: string, startOrder: number): RasterLayer[] =>
    (added[areaId] ?? [])
      .map((sid) => assetOf(areaId, sid))
      .filter((a): a is RunAsset => !!a && !!a.extent)
      .map((a, n) => {
        const st = extraState[sceneKey(areaId, a.sceneId)]
        return {
          id: a.sceneId,
          title: a.title,
          uri: a.previewUri,
          extent: a.extent!,
          opacity: st?.opacity ?? 1,
          // Above whatever the map put there: an asset was added to be looked
          // at, and burying it under the stack it joined would be a strange
          // reading of the request.
          order: startOrder + n,
          pixelated: a.pixelated,
          // No majority filter: it is the classification's, and these are not.
          smooth: false,
          visible: st?.visible ?? true,
        }
      })

  /**
   * Every area on the board, each with its own stack.
   *
   * The current run is one of them and the runs loaded beside it are the rest.
   * An area with nothing on it is not an area: adding the first raster from a
   * loaded run is what brings its area into being, and taking the last one off
   * is what ends it.
   */
  /**
   * The area's layers in the order the board should stack them.
   *
   * Default is each product's own ordering number, which encodes a decision
   * worth keeping: a classification reads over surface water, and confidence
   * reads over the classification. A stored order replaces it for the layers
   * it names.
   */
  const applyOrder = (areaId: string, ls: RasterLayer[]): RasterLayer[] => {
    const want = order[areaId]
    if (!want) return ls
    const rank = new Map(want.map((id, i) => [id, i]))
    const known = ls
      .filter((l) => rank.has(l.id))
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
    return [...known, ...ls.filter((l) => !rank.has(l.id))]
  }

  /*
    THE GROUND ALREADY DRAWN BY A RUN, so it is not drawn a second time empty.

    A catalogued drawing is offered as an area of its own -- that is how a
    second draw stays visible and can be put back with Use -- but once a run
    over that same ground is on the board, the drawing has nothing to add: the
    run's plane IS that ground, and the outline beside it was the second area
    per field the reader was counting. Two AOIs and two runs made four areas.

    The empty outline is kept in the one case it says something: a drawing with
    no run yet, which is where the next one will happen.
  */
  const groundOnBoard = new Set(
    assetRuns.flatMap((r) => {
      /*
        A RUN NAMES ITS GROUND; AN AREA FILED UNDER ITS GROUND IS ONE ALREADY.

        `aoiOfRun` answers run id -> area id, and asking it about an area id
        returns nothing. That was harmless while every entry here was keyed by
        a run, and became this set's blind spot the moment retained runs began
        being keyed by the GROUND they were over: the lookup failed, the ground
        never entered the set, and the filter below therefore listed the
        catalogued drawing AS WELL as the area already holding it. One ground,
        two rows, for every retained run on the board.
      */
      const ground =
        aoiOfRun.get(r.runId) ?? (isSavedAoiId(r.areaId) ? r.areaId : null)
      return ground ? [ground] : []
    })
  )

  const areas = [
    {
      id: live,
      // Renamed like every other stack. It was the one area reading its raw
      // title, so renaming it changed the tree and nothing else.
      /*
        The subject's own name, and a generic one only where there is no
        subject.

        The prop used to fall back to the literal "Analysis", which is what a
        reader saw whenever the AOI label was empty: a row named after no
        ground, indistinguishable from a saved run and impossible to place. A
        run that has been saved carries a name, so it is asked first; the map's
        label is what remains for an area not yet run.
      */
      /*
        A rename outranks the derivation; otherwise both trees say the same.

        The DRAWING'S name where this area is one, and the run's only where it
        is not. The scene tree lists ground and the data tree lists runs, so an
        area that is a catalogued drawing reads "drawn 2" here and its run
        reads "run-drawn-…" there -- one name per thing, instead of the same
        field appearing under a drawing name, a run name and a placeholder.
      */
      title:
        names[stackRow(live)] ??
        savedAois.find((a) => a.id === live)?.name ??
        liveTitle,
      layers: applyOrder(live, [
        ...layers.filter((l) => !removed.has(sceneKey(live, l.id))),
        ...extrasFor(live, 1000),
      ]),
    },
    /*
      Catalogued drawings, and only where something has been put on one.

      They used to be areas whether or not they carried anything, so a reader
      with five drawings opened any board and found five empty outlines over
      it -- in the scene, in the tree and in the layout -- none of which was
      part of that board: a drawing belongs to the catalog, and a board is the
      runs arranged on it. The catalog has a pane of its own, and the Areas tab
      lists every drawing with its footprint, its hectares and Use whether or
      not it is on the board.

      The live one keeps its outline. That is the ground the next run happens
      on, which is the one drawing this surface is about.
    */
    ...savedAois
      /*
        The active drawing is no longer excluded here.

        It was, on the assumption that it is the live area and already listed
        as such. `liveAreaId` follows the SHOWN RUN, so drawing a new area while
        a classification is up leaves the two apart -- and the new drawing then
        fell through both filters, appearing neither as the live area nor as a
        catalogued one. It was invisible in the scene and in the tree until a
        run over it existed, which is when the live area finally became it.

        `a.id !== live` alone says what this filter meant: do not list twice
        what is already listed.
      */
      .filter((a) => a.id !== live && !groundOnBoard.has(a.id))
      .map((a) => ({
        id: a.id,
        title: names[stackRow(a.id)] ?? a.name,
        layers: applyOrder(a.id, extrasFor(a.id, 200)),
      })),
    ...assetRuns
      .filter((r) => r.areaId !== live)
      .map((r) => ({
        id: r.areaId,
        /*
          THE GROUND'S NAME, and the run's only where there is no ground.

          This tree lists ground and the data tree lists runs -- the live area
          above resolves its title exactly this way, and `resolveAoiDisplayLabel`
          states the rule outright: never use a run-* label for an area.

          It read `r.title`, which for a retained entry is
          `displayRunLabel(runs.find(...)?.label)`. Since retained runs began
          being filed under the GROUND, that lookup asks the run list about an
          area id and finds nothing -- and `displayRunLabel` answers an empty
          label with the placeholder "run-untitled", which is not empty, so the
          "Previous run" fallback beside it never ran. Every area the map had
          moved on from was therefore renamed "run-untitled", however many
          there were and whatever they had been called.
        */
        title:
          names[stackRow(r.areaId)] ??
          savedAois.find((a) => a.id === r.areaId)?.name ??
          r.title,
        layers: applyOrder(r.areaId, extrasFor(r.areaId, 400)),
      })),
  ].filter(
    (a) =>
      a.layers.length > 0 ||
      // The map's own area survives having nothing on it, so long as an area
      // has been drawn: it is the thing the work is about to be run on, and
      // the board is where that work is started. Unless a run of that same
      // ground is already on the board, in which case the outline would stand
      // empty beside the plane that is the same field.
      (a.id === live && !!aoiPolygon?.length && !groundOnBoard.has(live)) ||
      /*
        And the drawing the map is ACTIVE on, when that is not the live area.

        Same reason as the line above, which is the one that matters: this is
        the ground the next run happens on, and the board is where that run is
        started. The two are usually the same area and this adds nothing; they
        part company the moment a reader draws while a result is still up, and
        that is exactly when the new drawing has to be visible -- it is what
        they are about to aim at.
      */
      (!!activeAoiId &&
        a.id === activeAoiId &&
        activeAoiId !== live &&
        !groundOnBoard.has(a.id)) ||
      // Nothing else earns a place. A drawing with no raster on it is a
      // catalog entry, and the Areas tab is where a catalog is read.
      false
  )
    // Last, so a dismissal outranks every reason an area would otherwise stay.
    .filter((a) => !dismissedAreas.includes(a.id))
    /*
      ORDERED BY WHEN THE GROUND WAS DRAWN, not by which one is live.

      The list above is assembled live-area-first, then the catalog, then the
      retained runs -- an order that says something true about how it is BUILT
      and nothing a reader wants. Selecting another area made it the live one
      and lifted it to the top, so every row below it moved: the tree
      rearranged itself as an answer to a question nobody asked, and picking
      between two areas meant re-finding both each time.

      The catalog's own order is the stable one, because it is the order the
      grounds were made in and nothing a selection can change. An area with no
      catalogued ground -- a run loaded from the picker, an adopted geometry --
      sorts after them, keeping the relative order it was assembled in.
    */
    .map((a, i) => {
      const rank = savedAois.findIndex((s) => s.id === a.id)
      return { a, key: rank === -1 ? savedAois.length + i : rank }
    })
    .sort((x, y) => x.key - y.key)
    .map(({ a }) => a)

  /*
    Which rasters are planes on the board, keyed by area and scene id together.
    Two runs each produce a `prediction`, so the layer id alone would report
    one run's raster as being on the board because the other's was.
  */
  const sceneIds = new Set(
    areas.flatMap((a) => a.layers.map((l) => sceneKey(a.id, l.id)))
  )
  /** Layers the board owns the state of, as opposed to the map. */
  const localKeys = new Set(
    areas.flatMap((a) =>
      a.layers
        .filter((l) => a.id !== live || !baseIds.has(l.id))
        .map((l) => sceneKey(a.id, l.id))
    )
  )

  const changeLayer = (areaId: string, id: string, patch: LayerPatch) => {
    // A raster the board added answers to this component; one of the current
    // run's own answers to the map, which is where its switch has always been.
    const key = sceneKey(areaId, id)
    if (localKeys.has(key)) {
      setExtraState((prev) => ({
        ...prev,
        [key]: {
          opacity: patch.opacity ?? prev[key]?.opacity ?? 1,
          visible: patch.visible ?? prev[key]?.visible ?? true,
        },
      }))
      return
    }
    onLayerChange(id, patch)
  }

  /**
   * Leave one plane visible, or bring the whole board back.
   *
   * A toggle rather than a one-way action. Hiding eleven planes to read one,
   * then restoring them by hand, is eleven gestures to undo one -- and the
   * outliner can only do this a row at a time, which is where the reader was
   * doing it before.
   *
   * Restoring shows everything rather than what was visible before. Keeping a
   * memory of the previous state would be right if solo were the only thing
   * that changed visibility, and it is not: the outliner's eyes, the run's own
   * switches and this menu all write the same flags, so a remembered set would
   * be stale in every case but the one where nothing else was touched.
   */
  const soloLayer = (areaId: string, id: string) => {
    const soloed = isSoloed(areas, areaId, id)
    for (const a of areas) {
      for (const l of a.layers) {
        const keep = soloed || (a.id === areaId && l.id === id)
        if (l.visible !== keep) changeLayer(a.id, l.id, { visible: keep })
      }
    }
  }

  const addToScene = (areaId: string, id: string) => {
    // Putting a raster on a dismissed area is the reader asking for it back.
    setDismissedAreas((prev) => prev.filter((a) => a !== areaId))
    // Putting back one the board had taken out, rather than adding a copy.
    if (areaId === live && baseIds.has(id)) {
      setRemoved((prev) => {
        const next = new Set(prev)
        next.delete(sceneKey(areaId, id))
        return next
      })
      return
    }
    setAdded((prev) => {
      const list = prev[areaId] ?? []
      return list.includes(id) ? prev : { ...prev, [areaId]: [...list, id] }
    })
  }

  const removeFromScene = (areaId: string, id: string) => {
    if (areaId === live && baseIds.has(id)) {
      setRemoved((prev) => new Set(prev).add(sceneKey(areaId, id)))
      return
    }
    setAdded((prev) => ({
      ...prev,
      [areaId]: (prev[areaId] ?? []).filter((x) => x !== id),
    }))
  }

  /**
   * Drops a loaded run from the data tree.
   *
   * Refused while any of its rasters is on the board. Removing it then would
   * take planes off the board through a control that says nothing about them,
   * and the user would be left looking for what had gone.
   */
  /*
    Drop a run the board fetched, and take whatever it has on the board with it.

    This used to return early while any of the run's rasters were planes, which
    made the control in the data tree a dead end: it refused, named the remedy,
    and left the reader to perform it in another tab. The objection that guard
    was written for -- planes vanishing through a control that says nothing
    about them -- is answered by the control saying so, which it now does.

    `added` is the record of what this run put on the board, so clearing it is
    what takes the planes off; the scene is rebuilt from it.
  */
  const dropRun = (runId: string) => {
    setExtraRuns((prev) => prev.filter((x) => x.run.id !== runId))
    // A retained run is held by the map screen, so dropping one is a request
    // rather than a local edit. Harmless for a row that is not retained.
    onDropRetainedRun?.(runId)
    setAdded((prev) => {
      const next = { ...prev }
      delete next[runId]
      return next
    })
  }

  /**
   * Delete a run from disk, which the data tree could list and not remove.
   *
   * The tree's other control DROPS a run: it leaves the board and stays on
   * disk, a press to undo by adding it again. This one ends it everywhere --
   * the analysis list, its project, the exports. Two acts that read alike and
   * differ in whether they can be taken back, so they do not look alike: the
   * drop is a thin X and this is a bin, and only this one asks.
   *
   * Wording follows the analysis page's own deletion, since a reader who has
   * seen one should recognise the other.
   */
  /**
   * What a destructive control has asked for, until it is confirmed.
   *
   * One state for both kinds, so the studio asks in one voice and a third
   * destructive act does not become a third dialog.
   */
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "run"; id: string; title: string }
    | { kind: "area"; id: string; title: string }
    | null
  >(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const { kind, id, title } = pendingDelete
    setDeleteBusy(true)
    try {
      if (kind === "run") {
        await DeleteAnalysis(id)
        dropRun(id)
        await refreshRuns()
      } else {
        onDeleteSavedAoi?.(id)
      }
      notifySuccess(`“${title}” deleted`)
      setPendingDelete(null)
    } catch (e) {
      notifyError(
        kind === "run" ? "Could not delete that run" : "Could not delete that area",
        e
      )
    } finally {
      setDeleteBusy(false)
    }
  }

  /*
    Read through refs by the effect that builds the scene, so neither can put
    the scene in that effect's dependencies.

    `onClose` was in them, and it is written inline at the call site -- a new
    function on every render of the map screen. So the GL context was disposed
    and recreated on EVERY RENDER, which defeated the structural comparison
    below entirely and, worse, rebuilt each plane from a card that no longer
    described the current state. Toggling a layer hid it and then immediately
    restored it from the rebuild, which read as the eye not working at all.
  */
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  /**
   * Where things were left: areas by their id, planes by their scene key.
   *
   * A ref rather than state, because nothing renders from it: the scene owns
   * the positions while the board is open, and this is the copy that outlives
   * a rebuild -- without it, changing a raster would send everything the user
   * had dragged back to where the layout first put it.
   *
   * Two maps because they are two facts: an area's place on the board, and a
   * plane's place inside its area. A rebuild restores planes from their cards,
   * which know only the layout's first answer, so the moved ones are
   * re-applied afterwards.
   */
  /*
    Objects from the board's memory rather than fresh ones, so where things
    were dragged survives a close. Mutated in place -- the ref points AT the
    kept object, so a write is remembered without a copy.
  */
  const placesRef = useRef(
    keptObject<Record<string, { x: number; z: number }>>("places", () => ({}))
  )
  const planePlacesRef = useRef(
    keptObject<Record<string, { x: number; z: number }>>(
      "planePlaces",
      () => ({})
    )
  )
  /** The spread, for the build, which must not depend on it to run again. */
  const gapRef = useRef(STACK_GAP)
  /**
   * Each area's own shape, by area id.
   *
   * The current run's comes from the map screen, which knows what was drawn;
   * a loaded run's is stored with it. Read through a ref for the same reason
   * everything else here is -- the build must not run again because a prop's
   * identity changed.
   */
  const polygonsRef = useRef<Record<string, LonLat[]>>({})
  polygonsRef.current = {
    /*
      EVERY CATALOGUED DRAWING SUPPLIES ITS OWN, the active one included.

      The active one used to be skipped, on the assumption that it is the live
      area and that `aoiPolygon` therefore already describes it. `liveAreaId`
      breaks that assumption whenever a result is on screen: the live area
      follows the SHOWN RUN, so drawing a new area while a classification is up
      leaves the two apart. The new drawing was then skipped here and had no
      shape at all, while `aoiPolygon` -- which is that new drawing's ring --
      was filed under the old run's id, outlining one field with another's edge.
    */
    ...Object.fromEntries(
      savedAois.flatMap((a) => {
        const ring = polygonOuterRing(a.geometry)
        return ring ? [[a.id, ring] as const] : []
      })
    ),
    /*
      The map's own shape, for a ground the catalog does not hold: an example
      area, an adopted geometry, a studio opened on nothing. Where the live
      area IS catalogued, the entry above is the same ring from a source that
      cannot drift.
    */
    ...(aoiPolygon?.length && !savedAois.some((a) => a.id === live)
      ? { [live]: aoiPolygon }
      : {}),
    /*
      A retained run's outline, from the run record where there is one.

      Without it the area falls back to its raster's rectangle, so a run the
      map has moved on from is outlined as a box while every other area shows
      its real shape.
    */
    ...Object.fromEntries(
      retainedRuns.flatMap(({ id }) => {
        const rec = runs.find((r) => r.id === id)
        if (!rec) return []
        const geom = resolveProjectGeometry(
          { polygon_geojson: rec.polygon_geojson },
          []
        )
        const ring = geom ? polygonOuterRing(geom) : null
        return ring ? [[id, ring] as const] : []
      })
    ),
    ...Object.fromEntries(
      extraRuns.flatMap(({ run }) => {
        // The run stores the polygon it was asked for; there is no area
        // catalogue to fall back to here, and a run without a stored shape
        // simply keeps the rectangle.
        const geom = resolveProjectGeometry(
          { polygon_geojson: run.polygon_geojson },
          []
        )
        const ring = geom ? polygonOuterRing(geom) : null
        return ring ? [[run.id, ring] as const] : []
      })
    ),
  }
  const appearanceRef = useRef<PlaneState[]>([])
  appearanceRef.current = areas.flatMap((a) =>
    a.layers.map((l) => ({
      groupId: a.id,
      id: l.id,
      opacity: l.opacity,
      visible: l.visible,
      flat: flat.has(sceneKey(a.id, l.id)),
    }))
  )
  const [gap, setGap] = useKept("gap", STACK_GAP)

  /**
   * The active row of the outliner, and through it the plane the board
   * outlines.
   *
   * Corrected as it is read rather than repaired by an effect. The set of
   * layers changes under it -- a run finishes, a composition is cleared -- and
   * an effect that noticed afterwards would leave one render showing a panel
   * for a raster that is no longer on the board.
   *
   * Falls back to the last layer, which is the top of the stack and so the
   * first row under the collection -- the confidence raster where there is
   * one, the classification otherwise. The tree opens on its own first row
   * rather than on a particular product.
   */
  const [activeRow, setActiveRow] = useKept<string | null>("activeRow", null)
  /**
   * Rows chosen, in the order they were chosen.
   *
   * An ORDER, not a set: picking three rasters one after another is someone
   * saying "read this, then this, then this", and the board draws that as an
   * arrowed path. Keeping only which ones were picked would throw the
   * statement away and leave three highlighted planes with nothing between
   * them.
   */
  const [selection, setSelection] = useKept<string[]>("selection", [])
  const chooseRow = (rowId: string, additive?: boolean) => {
    setActiveRow(rowId)
    setSelection((prev) => {
      if (!additive) return [rowId]
      // Shift on a row already in the path takes it out, so a sequence built
      // by hand can be corrected without starting it again.
      return prev.includes(rowId)
        ? prev.filter((r) => r !== rowId)
        : [...prev, rowId]
    })
  }
  /*
    Read through a ref for the same reason `onClose` is: the scene is built once
    and an inline closure here is new on every render, which would rebuild it.
  */
  const chooseRowRef = useRef(chooseRow)
  chooseRowRef.current = chooseRow

  /** The pair an arrowhead was pressed for, or null. */
  /*
    The legend material per area. The current one is handed in; a fetched one
    travels in its own payload, which is where its classes and scales already
    are -- so a second area explains itself without the map screen knowing it
    is on the board.
  */
  /*
    The geometries on the board, for the Areas tab.

    Measured from the ring the board already holds per area rather than from a
    second source: the same points that draw the footprint report the figures,
    so the tab cannot describe a shape the surface is not drawing.
  */
  const areaInfo: AreaInfo[] = areas.map((a) => {
    const ring = polygonsRef.current[a.id]
    const geom = ring?.length
      ? ({ type: "Polygon", coordinates: [ring] } as GeoJSONGeometry)
      : null
    const saved = savedAois.find((s) => s.id === a.id)
    const catalogId =
      a.id === live
        ? activeAoiId
        : saved
          ? a.id
          : undefined
    return {
      id: a.id,
      title: a.title,
      geometry: geom,
      hectares: geom ? geometryAreaHectares(geom) : null,
      // The closing point repeats the first, and reporting it would count a
      // corner twice.
      vertices: ring?.length ? ring.length - 1 : null,
      layers: a.layers.length,
      current: a.id === live,
      saved: !!catalogId,
      catalogId,
    }
  })

  /*
    THE CATALOG, WHICH IS LONGER THAN THE BOARD.

    A drawing stops being an area once it has nothing on it -- see the note in
    `areas` -- and this pane is where it did not stop being anything. It lists
    the ground a reader has drawn, on the board or not, which is what makes Use
    a way back to a field rather than a way back to whatever happens to be
    arranged right now.

    Measured from the catalog's own geometry rather than from the ring the
    board holds, because the board holds none for an area it is not drawing.
  */
  for (const a of savedAois) {
    if (areaInfo.some((x) => x.id === a.id || x.catalogId === a.id)) continue
    const ring = polygonOuterRing(a.geometry)
    areaInfo.push({
      id: a.id,
      title: names[stackRow(a.id)] ?? a.name,
      geometry: a.geometry,
      hectares: geometryAreaHectares(a.geometry),
      vertices: ring?.length ? ring.length - 1 : null,
      layers: 0,
      current: false,
      saved: true,
      catalogId: a.id,
    })
  }

  /*
    A retained run has to appear HERE too, not only in `assetRuns`.

    `sideOf` asks this map for the result behind an area, and every reading
    built on a pair goes through it -- the compare editor, the domain-shift
    pair, the cohort. A run that was listed in the data tree and absent from
    this map could be selected, drawn, and then refused by both editors with
    "pick two prediction planes" while two were plainly picked.
  */
  const legendByArea = new Map<string, LegendSources>([
    [live, legendSources ?? {}],
    ...retainedRuns.map(
      ({ id, result }) =>
        [
          id,
          {
            result,
            water: result.water,
            solarTerrain: result.solar_terrain,
            solarSiting: result.solar_siting,
          },
        ] as [string, LegendSources]
    ),
    // After the retained ones, so a run the picker has since loaded wins: it
    // carries the full record where a retained entry carries only the result.
    ...extraRuns.map(
      ({ run, result }) =>
        [
          run.id,
          {
            result,
            water: result.water,
            solarTerrain: result.solar_terrain,
            solarSiting: result.solar_siting,
          },
        ] as [string, LegendSources]
    ),
  ])

  /*
    Last prediction or solar plane in the selection path drives the right
    column. Two prediction planes → difference readout instead.
  */
  const predictionPicks: { areaId: string; layerId: string }[] = []
  for (const row of selection) {
    const t = rowTarget(row)
    if (t?.layerId === "prediction") {
      predictionPicks.push({ areaId: t.areaId, layerId: t.layerId })
    }
  }
  let detailFocus: {
    areaId: string
    focus: BoardDetailFocus
  } | null = null
  for (let i = selection.length - 1; i >= 0; i--) {
    const t = rowTarget(selection[i])
    if (!t?.layerId) continue
    if (t.layerId === "prediction") {
      detailFocus = { areaId: t.areaId, focus: "prediction" }
      break
    }
    if (t.layerId === "solar:terrain") {
      detailFocus = { areaId: t.areaId, focus: "terrain" }
      break
    }
    if (t.layerId === "solar:siting") {
      detailFocus = { areaId: t.areaId, focus: "siting" }
      break
    }
  }
  const detailSources = detailFocus
    ? legendByArea.get(detailFocus.areaId)
    : undefined
  const detailTerrain =
    detailSources?.solarTerrain ?? legendSources?.solarTerrain ?? null
  const detailSiting =
    detailSources?.solarSiting ?? legendSources?.solarSiting ?? null
  const detailPrediction: PredictResult | null =
    detailFocus?.focus === "prediction"
      ? (detailSources?.result ?? legendSources?.result ?? null)
      : null
  const detailPeriod =
    detailFocus &&
    assetRuns.find((r) => r.areaId === detailFocus.areaId)?.period
  const detailModel =
    detailFocus &&
    assetRuns.find((r) => r.areaId === detailFocus.areaId)?.model

  const [brushOn, setBrushOn] = useState(false)
  /*
    Which plane was right-pressed, and where. Held rather than derived because
    the menu outlives the press: the ray already found the plane, and asking
    the scene again on every render would raycast for a menu that is standing
    still.
  */
  const [planeMenu, setPlaneMenu] = useState<PlaneContextTarget | null>(null)
  /*
    Read through refs, because createBoard runs once and its callback would
    otherwise close over the areas as they were when the board was built.
  */
  const areasRef = useRef(areas)
  areasRef.current = areas
  const flatRef = useRef(flat)
  flatRef.current = flat
  /*
    What the board is still waiting for. Reported by the scene as each texture
    lands, including the ones that fail -- a board with one unreadable raster
    must not wait for it forever.
  */
  const [cards, setCards] = useState({ loaded: 0, total: 0 })
  // Which header popover is open. One at a time, as a menu bar behaves.
  const [viewMenu, setViewMenu] = useState(false)
  const [overlayMenu, setOverlayMenu] = useState(false)
  const [opacityMenu, setOpacityMenu] = useState(false)
  /*
    Where the pointer last was, in surface coordinates.

    Ctrl-Space maximises the area UNDER THE POINTER, which is what Blender
    binds and what the area menu already promised in writing. Tracked here
    rather than as hover state on each area: the rects are computed from the
    tree anyway, so the area is a lookup rather than a second thing to keep in
    step with the first.
  */
  const pointerRef = useRef({ x: 0, y: 0 })
  // Read through refs, so the keydown handler is bound once and still sees the
  // current arrangement rather than the one it closed over.
  const treeRef = useRef(tree)
  const workspaceIdRef = useRef(workspaceId)
  const restoreTreeRef = useRef(restoreTree)
  const surfaceRef2 = useRef(surface)
  treeRef.current = tree
  workspaceIdRef.current = workspaceId
  restoreTreeRef.current = restoreTree
  surfaceRef2.current = surface
  const [appMenu, setAppMenu] = useState(false)
  const [filterMenu, setFilterMenu] = useState(false)
  /*
    Which compare slot has its menu open, as `${paneId}:${slot}` rather than a
    boolean. Two compare editors carry four slots between them, and a boolean
    per slot would open all of them at once.
  */
  const [compareSlotMenu, setCompareSlotMenu] = useState<string | null>(null)
  /*
    The outliner's filter, owned here because the header that carries it is
    built here. Blender filters its Outliner this way -- by state rather than
    by name first -- and this tree had no filter of any kind: what a reader
    hid stayed in the list taking a row.
  */
  const [hideInvisible, setHideInvisible] = useKept("hideInvisible", false)
  const [brushRadius, setBrushRadius] = useState<BrushRadiusPx>(2)
  const [probeUv, setProbeUv] = useState<{
    groupId: string
    id: string
    u: number
    v: number
  } | null>(null)
  const [probeSample, setProbeSample] = useState<ClassProbeSample | null>(null)
  const probeRef = useRef(setProbeUv)
  probeRef.current = setProbeUv

  // Brush only makes sense on a single prediction focus.
  useEffect(() => {
    if (detailFocus?.focus !== "prediction" || predictionPicks.length >= 2) {
      setBrushOn(false)
      setProbeUv(null)
      setProbeSample(null)
    }
  }, [detailFocus?.focus, predictionPicks.length])

  const predictionLegend: ClassLegendEntry[] = useMemo(() => {
    const stats = detailPrediction?.class_stats
    if (!stats?.length) return []
    return stats.map((c) => ({
      id: c.class_id,
      name: c.name,
      color: c.color,
    }))
  }, [detailPrediction])

  const target = rowTarget(activeRow)
  const targetArea = areas.find((a) => a.id === target?.areaId)
  const rowIsLive =
    !!targetArea &&
    (!target?.layerId || targetArea.layers.some((l) => l.id === target.layerId))
  const first = areas[0]
  const active = rowIsLive
    ? activeRow
    : first
      ? // The first area's topmost layer, which is the tree's first layer row.
        `layer::${first.id}::${first.layers[first.layers.length - 1]?.id}`
      : null
  const activeTarget = rowTarget(active)
  // A modifier's row points at the plane it acts on; an area's row points at
  // no single one.
  const selected = activeTarget?.layerId ?? null
  const selectedArea = activeTarget?.areaId ?? null

  /**
   * Which rows are open. The stack starts open, or the tree would present a
   * single collapsed row and the layers would have to be found before they
   * could be used.
   */
  /*
    Areas start open. A tree of collapsed collections shows the board's areas
    and none of its rasters, which is the wrong half to show first; and an area
    that has just been created by adding a raster must show the raster.
  */
  const [expanded, setExpanded] = useKept<ReadonlySet<string>>("expanded", () =>
    new Set([stackRow(live)])
  )
  useEffect(() => {
    setExpanded((prev) => {
      const missing = areas.filter((a) => !prev.has(stackRow(a.id)))
      if (!missing.length) return prev
      const next = new Set(prev)
      for (const a of missing) next.add(stackRow(a.id))
      return next
    })
  }, [areas.map((a) => a.id).join("|")])


  const [activeAsset, setActiveAsset] = useState<string | null>(null)
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  /**
   * The layers with the majority filter already applied where the table asks
   * for it, so the board draws the same class boundaries the map does.
   *
   * Resolved before the scene is built rather than swapped in afterwards: a
   * board that opened on the raw raster and then re-cut every boundary a
   * second later would show the user two different answers in sequence. The
   * transform is memoised on the source URI, so when the map has already
   * computed it -- which it has, whenever the control is on -- this resolves
   * without recomputing.
   */
  const [groups, setGroups] = useState<CardGroup[] | null>(null)

  const predictionUri = useMemo(() => {
    if (!detailFocus || detailFocus.focus !== "prediction" || !groups) {
      return null
    }
    const g = groups.find((x) => x.id === detailFocus.areaId)
    return g?.cards.find((c) => c.id === "prediction")?.uri ?? null
  }, [groups, detailFocus?.areaId, detailFocus?.focus])

  /**
   * Every prediction plane that could stand on one side of a comparison.
   *
   * Built once over the board rather than over the selection, because a slot
   * that can only be filled from what is selected is not pinned to anything --
   * it is the selection under another name.
   */
  const sideOf = useCallback(
    (boardAreaId: string): PredictionCompareSide | null => {
      const result = legendByArea.get(boardAreaId)?.result
      const uri = groups
        ?.find((x) => x.id === boardAreaId)
        ?.cards.find((c) => c.id === "prediction")?.uri
      if (!result || !uri) return null
      const run = assetRuns.find((r) => r.areaId === boardAreaId)
      // From the area's own layer, not the scene card: the card carries what
      // is DRAWN and the layer carries how it is to be sampled.
      const layer = areas
        .find((a) => a.id === boardAreaId)
        ?.layers.find((l) => l.id === "prediction")
      return {
        areaId: boardAreaId,
        label: areas.find((a) => a.id === boardAreaId)?.title ?? boardAreaId,
        model: run?.model,
        period: run?.period,
        result,
        uri,
        pixelated: layer?.pixelated,
      }
    },
    [legendByArea, groups, assetRuns, areas]
  )

  const availableSides = useMemo(
    () =>
      areas
        .map((a) => sideOf(a.id))
        .filter((s): s is PredictionCompareSide => !!s),
    [areas, sideOf]
  )

  /*
    WHICH TWO, SAID RATHER THAN TAKEN.

    This was `predictionPicks.slice(-2)`: with three prediction planes selected
    the editor compared two of them and never said which, and the reader had no
    way to choose the third. The arity rule was well defined at two and silent
    above it, which is the defect the design record names.

    A slot may be PINNED to a plane, and a pinned slot holds while the selection
    moves elsewhere -- the mechanism Blender uses to let one surface stop
    following the active object. Unpinned, it falls back to the selection as
    before, so the gesture that used to work still does; what changes is that
    the choice is now visible in the header and can be overridden.

    Per studio area, beside `areaModes`, for the reason that module already
    gives: one owner per area rather than one for the studio, so two compare
    editors can hold two different pairs.

    In `boardMemory` and NOT in `StudioLayout`, which is where `areaModes`
    goes. The distinction is not oversight: a mode is part of an arrangement
    and an arrangement is worth restoring, while a pin names a board area that
    exists only while those runs are on the board. Restored into a fresh
    session it would point at nothing, and boardMemory's own position -- it
    survives a close and not a restart -- is the level this belongs at.
  */
  const [comparePins, setComparePins] = useKept<
    Record<string, { a?: string; b?: string }>
  >("comparePins", {})

  const sidesFor = useCallback(
    (paneId: AreaId): [PredictionCompareSide, PredictionCompareSide] | null => {
      // The rule, and its case table, live beside the control that exposes it.
      const pair = resolveComparePair(predictionPicks, comparePins[paneId])
      if (!pair) return null
      const a = sideOf(pair[0])
      const b = sideOf(pair[1])
      if (!a || !b) return null
      return [a, b]
    },
    // predictionPicks is rebuilt each render from `selection`; depending on
    // `selection` rather than on it keeps this callback from changing identity
    // on every render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comparePins, selection, sideOf]
  )

  /** The pair's figures as tables, in the order the editor draws them. */
  const compareTablesFor = (paneId: AreaId): DataTable[] => {
    const sides = sidesFor(paneId)
    if (!sides) return []
    const [a, b] = sides
    const agreementA = a.result.lulc?.agreement
    const agreementB = b.result.lulc?.agreement
    return [
      agreementA && agreementB
        ? compareOverallDeltaTable(agreementA, agreementB)
        : null,
      agreementA && agreementB
        ? compareAccuracyDeltaTable(agreementA, agreementB)
        : null,
      compareShareDeltaTable(a.result.class_stats ?? [], b.result.class_stats ?? []),
      agreementA && agreementB
        ? compareBlockAgreementTable(agreementA, agreementB, a.label, b.label)
        : null,
    ].filter((t): t is DataTable => !!t)
  }

  const copyCompareTables = async (paneId: AreaId) => {
    const tables = compareTablesFor(paneId)
    if (!tables.length) return
    // Each block named by the file it would have been, so a pasted buffer
    // carrying three tables still says which is which.
    const text = tables
      .map((t) => `# ${t.csvName}\n${tableToCSV(t)}`)
      .join("\n\n")
    try {
      await navigator.clipboard.writeText(text)
      notifySuccess(
        `${tables.length} tables copied`,
        tables.map((t) => t.csvName).join(", ")
      )
    } catch (err) {
      notifyError("Could not copy the deltas", err)
    }
  }

  const setPin = (paneId: AreaId, slot: "a" | "b", boardAreaId?: string) =>
    setComparePins((prev) => {
      const next = { ...prev }
      const here = { ...(next[paneId] ?? {}) }
      if (boardAreaId) here[slot] = boardAreaId
      else delete here[slot]
      if (here.a || here.b) next[paneId] = here
      else delete next[paneId]
      return next
    })

  /*
    The pixel comparison, keyed by the pair rather than held as one.

    It used to be a single result, which was sound while one editor could hold
    one pair. Two compare editors pinned to two different pairs would have
    fought over it, each overwriting the other's answer -- so the cache is keyed
    and the work is shared: two editors reading the same pair decode the rasters
    once.
  */
  const [predCompares, setPredCompares] = useState<
    Record<string, { compare: ClassMapCompare | null; error: string | null }>
  >({})
  const comparePairsStarted = useRef(new Set<string>())

  const comparePaneIds = useMemo(
    () => leaves.filter((l) => l.editor === "compare").map((l) => l.id),
    [leaves]
  )
  const neededPairs = useMemo(() => {
    const out = new Map<string, [PredictionCompareSide, PredictionCompareSide]>()
    for (const paneId of comparePaneIds) {
      const sides = sidesFor(paneId)
      if (sides) out.set(`${sides[0].areaId}|${sides[1].areaId}`, sides)
    }
    return out
  }, [comparePaneIds, sidesFor])

  useEffect(() => {
    let cancelled = false

    // What no editor asks for any more is dropped, so a pair that comes back
    // is recomputed against the rasters as they are rather than as they were.
    for (const key of [...comparePairsStarted.current])
      if (!neededPairs.has(key)) comparePairsStarted.current.delete(key)
    setPredCompares((prev) => {
      const keys = Object.keys(prev)
      if (keys.every((k) => neededPairs.has(k))) return prev
      const next: typeof prev = {}
      for (const k of keys) if (neededPairs.has(k)) next[k] = prev[k]
      return next
    })

    const legendOf = (side: PredictionCompareSide) =>
      (side.result.class_stats ?? []).map((c) => ({
        id: c.class_id,
        name: c.name,
        color: c.color,
      }))

    for (const [key, [a, b]] of neededPairs) {
      if (comparePairsStarted.current.has(key)) continue
      comparePairsStarted.current.add(key)
      const legendA = legendOf(a)
      const legendB = legendOf(b)
      if (!legendA.length || !legendB.length) {
        setPredCompares((prev) => ({
          ...prev,
          [key]: {
            compare: null,
            error: "Both predictions need class legends to compare.",
          },
        }))
        continue
      }
      void compareClassMaps(a.uri, legendA, b.uri, legendB)
        .then((c) => {
          if (cancelled) return
          setPredCompares((prev) => ({
            ...prev,
            [key]: { compare: c, error: null },
          }))
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setPredCompares((prev) => ({
            ...prev,
            [key]: {
              compare: null,
              error:
                err instanceof Error
                  ? err.message
                  : "Could not compare these rasters.",
            },
          }))
        })
    }
    return () => {
      cancelled = true
    }
  }, [neededPairs])

  useEffect(() => {
    if (!brushOn || !probeUv || !predictionUri || !predictionLegend.length) {
      setProbeSample(null)
      return
    }
    let cancelled = false
    void sampleClassAtUv(
      predictionUri,
      predictionLegend,
      probeUv.u,
      probeUv.v,
      brushRadius
    ).then((s) => {
      if (!cancelled) setProbeSample(s)
    })
    return () => {
      cancelled = true
    }
  }, [brushOn, probeUv, predictionUri, predictionLegend, brushRadius])

  useEffect(() => {
    let cancelled = false
    Promise.all(
      // Every layer, hidden ones included: the scene builds them all so that
      // hiding one is a flag on an existing plane rather than a different
      // scene, which would reset the camera on every eye toggle.
      areas.map(async (a) => ({
        ...a,
        layers: await Promise.all(
          a.layers.map(async (l) =>
            l.smooth
              ? {
                  ...l,
                  uri: await majoritySmoothOverlay(l.uri).catch(() => l.uri),
                }
              : l
          )
        ),
      }))
    ).then((resolved) => {
      if (cancelled) return
      const next = layoutGroups(
        resolved.map((a) => ({
          id: a.id,
          title: a.title,
          layers: a.layers,
          polygon: polygonsRef.current[a.id],
          at: placesRef.current[a.id],
        })),
        STACK_GAP
      )
      setGroups((prev) => (prev && sameStructure(prev, next) ? prev : next))
    })
    return () => {
      cancelled = true
    }
    /*
      The array, not a digest of it. A key cheap enough to build on every
      render cannot include the uris -- they are data URIs of some megabytes --
      and leaving them out has a hole with a name: switching to another
      composition keeps the layer's id and can keep its extent while changing
      only the raster, so a digest of ids and extents would miss it and the
      board would keep drawing the previous one. The array is new on every
      render, so this runs often; sameStructure below is what makes that cheap,
      and majoritySmoothOverlay is memoised on its source.
    */
  }, [areas])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !groups) return
    let board: BoardHandle | null = null
    try {
      // Read from the computed style rather than hardcoded, so the board
      // follows the theme the rest of the application is painted in.
      board = createBoard(host, {
        onPlaneContext: (groupId, id, at) => {
          const a = areasRef.current.find((x) => x.id === groupId)
          const l = a?.layers.find((x) => x.id === id)
          if (!a || !l) return
          setPlaneMenu({
            areaId: groupId,
            layerId: id,
            title: l.title,
            at,
            visible: l.visible,
            // The base is the level; it has nothing below to descend to.
            isBase: a.layers.findIndex((x) => x.id === id) === 0,
            flat: flatRef.current.has(sceneKey(groupId, id)),
            removable: true,
            // Read at open time, so the entry names the direction it will go.
            // The same predicate the action uses: two copies of this rule
            // would let the label say one thing and the press do the other.
            soloed: isSoloed(areasRef.current, groupId, id),
          })
        },
        onCardsLoaded: (loaded, total) => setCards({ loaded, total }),
        groups,
        // --v-*, not --p-*: the studio is a room the rasters hang in and the
        // panels around it are a reading surface. See index.css.
        background: tokenColor("--v-ink", "#333333"),
        line: tokenColor("--v-line", "#F6F6F6"),
        accent: tokenColor("--p-accent", "#ED8744"),
        // The separation in force at the moment of the build, so a plane lands
        // at its true height rather than at the base for a frame.
        gap: gapRef.current,
        // Current at the moment of the build, whatever the cards were created
        // with -- the cards are kept stable on purpose and are older than this.
        appearance: appearanceRef.current,
        /*
          Where planes were left, given at the build rather than applied after
          it. Applied after, the call landed while the textures were still
          decoding and found nothing to move -- so adding one raster to an
          arranged board sent every other raster back to the layout's first
          answer.
        */
        positions: Object.entries(planePlacesRef.current).map(([key, at]) => {
          const [groupId, id] = key.split("\u0000")
          return { groupId, id, x: at.x, z: at.z }
        }),
        /*
          A ROW id, not a layer id.

          Rows carry the area they belong to -- two areas both have a layer
          called `prediction` -- and this handed the tree a bare layer id,
          which rowTarget cannot parse. The tree then read the active row as
          dead and fell back to its default: the topmost layer of the first
          area. So pressing any plane selected the confidence raster, whatever
          had been pressed, and the outline followed it.

          Read through refs for the same reason `onClose` is: an inline closure
          here is new on every render and would rebuild the scene.
        */
        /*
          Through chooseRow, not setActiveRow. This path set the active row and
          left `selection` alone, so picking a plane on the board never entered
          the selection at all: the tree highlighted one row, the statistics
          band saw an empty list, and Shift on a plane could not add a second.
          The tree's own rows have always gone through chooseRow.
        */
        onSelect: (groupId, id, additive) =>
          chooseRowRef.current(layerRow(groupId, id), additive),
        onProbe: (sample) => probeRef.current(sample),
        /*
          The arrow between two planes is a question -- how do these compare --
          and pressing it is the only place on the board that asks it.

          IT USED TO ANSWER WITH A DIALOG OVER THE BOARD, which is the one
          structural contradiction the workspaces were built to end: the
          gesture is performed ON two planes and its result covered the two
          planes it was about. The answer is now the Compare workspace, where
          the board keeps the upper half and the reading takes the lower -- so
          what is being compared stays visible above what the comparison says.

          The two planes are put in the selection rather than pinned. Pinning
          is a deliberate act with its own control, and a gesture that silently
          froze a pair would leave the reader with an editor that stops
          following them for a reason they never chose. Unpinned slots take the
          last two picks, which is exactly this pair.
        */
        onLinkPick: (a, b) => {
          setSelection([layerRow(a.groupId, a.id), layerRow(b.groupId, b.id)])
          setWorkspaceId("compare")
        },
        // An area's outline is the only thing on the board that IS that area
        // while it has no rasters, so pressing it chooses the area's own row.
        onAreaPick: (groupId) => chooseRowRef.current(stackRow(groupId)),
        onLabels: (spots) => placeLabelsRef.current(spots),
        onMove: (groupId, layerId, x, z) => {
          // Into the kept object rather than replacing the ref: replacing it
          // would leave the memory pointing at the object from before the drag.
          if (layerId === null) placesRef.current[groupId] = { x, z }
          else planePlacesRef.current[sceneKey(groupId, layerId)] = { x, z }
        },
      })
    } catch {
      // A context can fail to be created even where the capability exists --
      // too many live contexts, or a driver reset. The board closes rather
      // than sitting blank, because a blank surface says nothing.
      closeRef.current()
      return
    }
    boardRef.current = board
    return () => {
      boardRef.current = null
      board?.dispose()
    }
    // `cards` alone: everything else the build needs is read through a ref,
    // because the scene must outlive a render that changed none of its shape.
  }, [groups])

  // Moves the existing planes rather than rebuilding the scene, so the camera
  // stays where the user put it while they adjust the separation.
  /*
    Which area reads as chosen on the board. The tree's row and the outline are
    two views of one fact, so picking either lights the other.
  */
  useEffect(() => {
    boardRef.current?.setActiveArea(rowTarget(activeRow)?.areaId ?? null)
  }, [activeRow, groups])

  gapRef.current = gap
  useEffect(() => {
    boardRef.current?.setGap(gap)
  }, [gap, groups])

  useEffect(() => {
    boardRef.current?.setProbeTarget(
      brushOn && detailFocus?.focus === "prediction" && predictionPicks.length < 2
        ? { groupId: detailFocus.areaId, id: "prediction" }
        : null
    )
  }, [
    brushOn,
    detailFocus?.areaId,
    detailFocus?.focus,
    predictionPicks.length,
    groups,
  ])

  useEffect(() => {
    /*
      The lens is the disc that was read, not a decoration near the pointer.

      It used to be a fraction of the plane's shorter side, hand-tuned per
      radius, which disagreed with the sample by whatever the raster's aspect
      ratio was and had no case for a radius the list did not yet offer -- so
      adding the 30 m step drew it at the size of the 90 m one. The span in
      texels over the raster's shorter side is the same disc the majority is
      taken over.
    */
    const span = 2 * brushRadius + 1
    const shorter = probeSample
      ? Math.min(probeSample.mapWidth, probeSample.mapHeight)
      : 0
    boardRef.current?.setProbeLensScale(
      shorter > 0 ? span / shorter : 0.02 * span
    )
  }, [brushRadius, groups, probeSample])


  /*
    The same for what the eye toggles and the opacity sliders change.

    Keyed on the values rather than on the array, which is new on every render
    of the map screen; the layers themselves are read through a ref so that
    identity does not drag the effect along with it.
  */
  const appearanceKey = areas
    .flatMap((a) =>
      a.layers.map(
        (l) =>
          `${a.id}/${l.id}:${l.visible ? 1 : 0}:${l.opacity}:${
            flat.has(sceneKey(a.id, l.id)) ? 1 : 0
          }`
      )
    )
    .join("|")
  useEffect(() => {
    boardRef.current?.setAppearance(appearanceRef.current)
  }, [appearanceKey, groups])

  // Re-applied when the scene is rebuilt as well as when the selection moves:
  // a fresh scene has no outline shown until it is told which one.
  /*
    The path the scene draws, in the order it was picked.

    Only rows that are a plane: an area's row and a modifier's have no raster
    to run a line to, so they take part in the selection without taking part
    in the path.
  */
  const selectedPlanes = selection
    .map(rowTarget)
    .filter(
      (t): t is { areaId: string; layerId: string } => !!t?.layerId
    )
    .map((t) => ({ groupId: t.areaId, id: t.layerId }))
  const selectionKey = selectedPlanes
    .map((p) => `${p.groupId}/${p.id}`)
    .join("|")
  const selectedPlanesRef = useRef(selectedPlanes)
  selectedPlanesRef.current = selectedPlanes
  useEffect(() => {
    boardRef.current?.setSelection(selectedPlanesRef.current)
  }, [selectionKey, groups])

  useEffect(() => {
    boardRef.current?.setLinks(links)
  }, [links, groups])

  useEffect(() => {
    boardRef.current?.setLabels(labels)
  }, [labels, groups])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  /*
    Ctrl-Space maximises the area under the pointer, and restores it.

    The area menu named this shortcut in writing before anything bound it,
    which is a promise the interface was not keeping. Bound here rather than
    in StudioArea because the area under the pointer is not the area a
    keystroke is delivered to -- there is no focus on a region -- so the
    surface resolves it from the rects it already computes.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const kept = restoreTreeRef.current[workspaceIdRef.current]
      if (kept) {
        setTree(kept)
        setRestoreTree((p) => ({ ...p, [workspaceIdRef.current]: null }))
        return
      }
      const { x, y } = pointerRef.current
      const hit = areaRects(treeRef.current, surfaceRef2.current).leaves.find(
        (l) => x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h
      )
      if (!hit) return
      setRestoreTree((p) => ({ ...p, [workspaceIdRef.current]: treeRef.current }))
      setTree(maximizeArea(treeRef.current, hit.id))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setTree, setRestoreTree])

  /*
    The runs behind the selected planes, deduplicated by area.

    Selection is per plane and several planes come from one run, so listing
    them straight would offer the same tables three times under three names.
  */
  const selectedRuns = useMemo(() => {
    const out: Array<{ id: string; label: string; result: PredictResult }> = []
    for (const t of selection) {
      const target = rowTarget(t)
      if (!target?.areaId) continue
      if (out.some((r) => r.id === target.areaId)) continue
      const result = legendByArea.get(target.areaId)?.result
      if (!result) continue
      out.push({
        id: target.areaId,
        label: areas.find((a) => a.id === target.areaId)?.title ?? target.areaId,
        result,
      })
    }
    return out
  }, [selection, legendByArea, areas])

  /*
    Every run on the board, and not only the ones a plane is selected on.

    `selectedRuns` above is the right source for the table and the comparison,
    which are views OF a selection. The canopy is not: its subject is a season,
    and asking a reader to select a plane in the outliner before a picker will
    list anything is a step with nothing behind it -- the first version did that
    and the picker simply read as broken.
  */
  const boardRuns = useMemo(() => {
    const out: Array<{ id: string; label: string; result: PredictResult }> = []
    for (const a of areas) {
      const result = legendByArea.get(a.id)?.result
      if (!result) continue
      out.push({ id: a.id, label: a.title ?? a.id, result })
    }
    return out
  }, [areas, legendByArea])

  /*
    THE HEADERS, one per editor.

    This is where the density comes from, and its absence is what made the
    first version of the area system "Blender's regions with none of their
    contents". A header is a control surface: the viewport's carries what is
    SHOWN, which until now lived in the outliner's footer three levels away
    from the thing it acts on.

    Built here rather than in a registry for the reason studioEditors states
    for keeping renderers out of itself -- only this component holds the state
    these controls read and write.
  */
  /* The picked planes, with what a view control needs to act on them. */
  const pickedPlanes = selection
    .map(rowTarget)
    .filter((t): t is { areaId: string; layerId: string } => !!t?.layerId)
    .map((t) => {
      const l = areas
        .find((a) => a.id === t.areaId)
        ?.layers.find((x) => x.id === t.layerId)
      return l
        ? { areaId: t.areaId, layerId: t.layerId, opacity: l.opacity, pixelated: l.pixelated }
        : null
    })
    .filter((x): x is NonNullable<typeof x> => !!x)

  const planeCount = areas.reduce((n, a) => n + a.layers.length, 0)
  const visibleCount = areas.reduce(
    (n, a) => n + a.layers.filter((l) => l.visible).length,
    0
  )

  /*
    The sub-modes the type menu offers under each editor.

    Only where an editor genuinely has more than one subject. Choosing one
    retypes the area AND sets the mode, which is the point: reaching the Areas
    pane used to be two gestures -- become an outliner, then find the tab --
    and a reader knows which pane they want when they pick the editor.

    Bound to the area that opened the menu, so the pane's own tablist and this
    entry write the same value for THAT area and no other. One owner per area
    rather than one owner for the studio, which is what let two outliners
    disagree about their panes -- and what stopped them being able to.
  */
  /*
    What the rover is pointing at, for the figures that read one class.

    NOT NEW STATE. The probe sample already carries the class under the
    pointer and detailFocus already carries the plane it came from; this only
    names the pair so the spectral and library editors can follow it. A second
    piece of state would be a second answer to a question the board already
    answers, and the two could disagree by a frame.

    The area travels with it because the editors read a selection that may hold
    more than one run: without it, pointing at a pixel of one run would light a
    class in another run's figure, which is the same class id meaning a
    different measurement.
  */
  const roverClass = useMemo(
    () =>
      brushOn && probeSample?.entry && detailFocus?.areaId
        ? { areaId: detailFocus.areaId, classId: probeSample.entry.id }
        : null,
    [brushOn, probeSample, detailFocus?.areaId]
  )

  const editorModesFor = (
    areaId: AreaId
  ): Partial<Record<EditorId, StudioEditorMode[]>> => {
    const here = modeOf(areaId)
    const pane = (id: OutlinerMode, label: string, icon: LucideIcon) => ({
      id,
      label,
      icon,
      active: here === id,
      // Bound to THIS area, so choosing a pane in one outliner leaves the
      // other where it was.
      select: () => setModeOf(areaId, id),
    })
    const canopyHere = canopyModeOf(areaId)
    const canopyPane = (id: CanopyMode, label: string, icon: LucideIcon) => ({
      id,
      label,
      icon,
      active: canopyHere === id,
      select: () => setCanopyModeOf(areaId, id),
    })
    const shiftHere = shiftModeOf(areaId)
    const shiftPane = (
      id: DomainShiftMode,
      label: string,
      icon: LucideIcon
    ) => ({
      id,
      label,
      icon,
      active: shiftHere === id,
      select: () => setShiftModeOf(areaId, id),
    })
    const libraryHere = libraryModeOf(areaId)
    const libraryPane = (
      id: LibraryLimitMode,
      label: string,
      icon: LucideIcon
    ) => ({
      id,
      label,
      icon,
      active: libraryHere === id,
      select: () => setLibraryModeOf(areaId, id),
    })
    return {
      outliner: [
        pane("scene", "Scene", Layers),
        pane("data", "Data", ImageIcon),
        pane("areas", "Areas", Pentagon),
      ],
      /*
        Two readings of the same runs, not two versions of one. The pair holds
        the histogram, the projection and the feature-shift table, which say
        WHERE two domains differ and are undefined for N subjects; the cohort
        holds divergence against agreement over every target, which is the
        figure the study resolves to and which no number of pair invocations
        assembles.
      */
      domainShift: [
        shiftPane("pair", "Pair", GitCompareArrows),
        shiftPane("cohort", "Cohort", Waves),
      ],
      /*
        The result, then the reason. Distance is the ranking a reader comes
        for; mechanism is the band-by-band ratio that stops the ranking being
        read as an identification, and it is one class at a time rather than
        five, so it cannot share a body with the ranking.
      */
      libraryLimit: [
        libraryPane("distance", "Distance", Ruler),
        libraryPane("mechanism", "Why it survives", Split),
      ],
      /*
        Three questions about one season, and each wants the whole width. The
        season is what the ground was; the light is what that canopy does with
        the sun the cell received; the ages are whether the plant model applies
        to this sowing at all -- which is the one that says whether to believe
        the other two.
      */
      canopy: [
        canopyPane("stand", "Stand", TreePine),
        canopyPane("season", "Season", LineChartIcon),
        canopyPane("light", "Light", Sun),
        canopyPane("ages", "Ages", GitCompareArrows),
      ],
    }
  }

  /*
    A function of the area for the same reason `renderEditor` and
    `editorModesFor` are: the compare editor's slots name ITS pair, and a record
    shared across areas would have made two compare editors show one pair's
    labels over both bodies.
  */
  const headerSlotsFor = (
    areaId: AreaId
  ): Partial<Record<EditorId, AreaHeaderSlots>> => ({
    runParams: runBarHeader ?? {},
    /*
      The source, only where there is a star to have a centre of. In the pair
      reading the two subjects come from the selection or the compare pins, and
      a control for something that reading does not use is a control that
      teaches the reader the wrong model of the editor.
    */
    domainShift:
      shiftModeOf(areaId) === "cohort"
        ? {
            centre: (
              <SourceSlot
                paneId={areaId}
                source={
                  availableSides.find(
                    (s) => s.areaId === cohortSources[areaId]
                  ) ?? null
                }
                available={availableSides}
                surface={surfaceRef.current}
                openFor={compareSlotMenu}
                onOpenChange={setCompareSlotMenu}
                onPick={setCohortSource}
              />
            ),
          }
        : {},
    compare: {
      centre: (
        <CompareSlots
          paneId={areaId}
          sides={sidesFor(areaId)}
          pins={comparePins[areaId]}
          available={availableSides}
          surface={surfaceRef.current}
          openFor={compareSlotMenu}
          onOpenChange={setCompareSlotMenu}
          onPin={setPin}
        />
      ),
      /*
        The deltas, out of the editor and into the clipboard.

        A figure a reader can only read on screen is a figure they have to
        retype to cite, and retyping is where a transcription error enters a
        result. The research pack cannot carry these -- it is built from one
        run and a delta is about two -- so the clipboard is the route, which is
        the one `DataTableView` already offers everywhere else.
      */
      options: (
        <StudioHeaderToggle
          icon={Copy}
          label="Copy deltas"
          on={false}
          disabled={!compareTablesFor(areaId).length}
          title="Copy the accuracy and share deltas as CSV"
          onToggle={() => void copyCompareTables(areaId)}
        />
      ),
    },
    properties: {
      options: selection.length ? (
        <span className="telemetry px-1 text-[9px] text-muted-foreground">
          {selection.length} picked
        </span>
      ) : null,
    },
    outliner: {
      options: (
        <StudioPopover
          open={filterMenu}
          onOpenChange={setFilterMenu}
          surface={surfaceRef.current}
          align="end"
          widthRem={14}
          trigger={(p) => (
            <StudioHeaderPopoverButton
              {...p}
              icon={Filter}
              // The count is the label, which is what the tree used to carry
              // as a bare badge with no way to act on it.
              label={`${visibleCount}/${planeCount}`}
              showLabel
              open={filterMenu}
              active={hideInvisible}
              title="Filter what the tree lists"
            />
          )}
        >
          <StudioMenuItem
            icon={EyeOff}
            label="Hide the hidden"
            note={`${planeCount - visibleCount}`}
            checked={hideInvisible}
            title="Leave out the planes whose eye is off"
            onSelect={() => setHideInvisible((v) => !v)}
          />
        </StudioPopover>
      ),
    },
    viewport: {
      menus: (
        <>
          <StudioPopover
            open={viewMenu}
            onOpenChange={setViewMenu}
            surface={surfaceRef.current}
            widthRem={14}
            trigger={(p) => (
              <StudioHeaderMenu
                label="Select"
                ref={p.ref}
                onClick={p.onClick}
                aria-expanded={p["aria-expanded"]}
                aria-haspopup="menu"
              />
            )}
          >
            <StudioMenuItem
              icon={BoxSelect}
              label="Select all planes"
              onSelect={() => {
                setSelection(
                  areas.flatMap((a) =>
                    a.layers.map((l) => layerRow(a.id, l.id))
                  )
                )
                setViewMenu(false)
              }}
            />
            <StudioMenuItem
              icon={Eraser}
              label="Clear selection"
              note="Esc"
              disabled={!selection.length}
              onSelect={() => {
                setSelection([])
                setViewMenu(false)
              }}
            />
          </StudioPopover>
        </>
      ),
      options: (
        <>
          {/*
            OVERLAYS. Blender's own name for the popover that carries what is
            drawn over the scene without being of it -- names, links, guides.
            These three were in the outliner's VIEW footer, which is a panel
            for the scene's structure and not for how it is drawn.
          */}
          <StudioPopover
            open={overlayMenu}
            onOpenChange={setOverlayMenu}
            surface={surfaceRef.current}
            align="end"
            widthRem={15}
            trigger={(p) => (
              <StudioHeaderPopoverButton
                {...p}
                icon={Layers2}
                label="Overlays"
                open={overlayMenu}
                title="What is drawn over the board"
              />
            )}
          >
            <StudioMenuItem
              icon={Tag}
              label="Plane names"
              checked={labels}
              onSelect={() => setLabels((v) => !v)}
            />
            <StudioMenuItem
              icon={Link2}
              label="Link each area's rasters"
              checked={links}
              onSelect={() => setLinks((v) => !v)}
            />
            <StudioMenuRule />
            <div className="px-2 py-1">
              <NumberField
                label="Spread"
                value={gap}
                min={0}
                max={GAP_MAX}
                step={0.01}
                // World units where the AOI's longest side is 1, so the figure
                // reads the same whatever the area covers on the ground.
                format={(v) => v.toFixed(3)}
                parse={(t) => {
                  const v = parseFloat(t)
                  return Number.isFinite(v) ? v : null
                }}
                onChange={setGap}
              />
            </div>
          </StudioPopover>

          {/*
            The selected planes' opacity, beside the brush because it is the
            same kind of control: a view property of what is picked, acted on
            from the surface it is seen in.

            It was three rows in the outliner's footer under a heading -- a
            number, a word and a title -- which is a great deal of the studio's
            scarcest column for one value. A popover spends a glyph on it.

            Applied to every picked plane rather than to an "active" one:
            selection here is a set, and fading one of three while the other
            two stay is a question nobody asked.
          */}
          <StudioPopover
            open={opacityMenu}
            onOpenChange={setOpacityMenu}
            surface={surfaceRef.current}
            align="end"
            widthRem={13}
            trigger={(p) => (
              <StudioHeaderPopoverButton
                {...p}
                icon={Blend}
                label="Opacity"
                open={opacityMenu}
                title={
                  pickedPlanes.length
                    ? "Opacity of the picked planes"
                    : "Pick a plane to fade it"
                }
                disabled={!pickedPlanes.length}
              />
            )}
          >
            {pickedPlanes.length ? (
              <div className="px-2 py-1">
                <NumberField
                  label="Opacity"
                  value={pickedPlanes[0].opacity}
                  min={0}
                  max={1}
                  step={0.05}
                  // Stored as a fraction, read as a percentage: the studio
                  // speaks the unit the rest of the application prints.
                  format={(v) => `${Math.round(v * 100)}%`}
                  parse={(t) => {
                    const v = parseFloat(t.replace("%", "").trim())
                    return Number.isFinite(v) ? v / 100 : null
                  }}
                  onChange={(v) =>
                    pickedPlanes.forEach((pl) =>
                      changeLayer(pl.areaId, pl.layerId, { opacity: v })
                    )
                  }
                />
                {/*
                  Not a control. A class raster is drawn without interpolation
                  because a bilinear sample between two classes is a colour
                  that belongs to neither and the legend stops matching the
                  pixels -- the same rule as .overlay-crisp. Said because it is
                  the reason one raster looks blocky beside another.
                */}
                <p className="mt-1.5 flex items-baseline justify-between text-meta text-muted-foreground">
                  Sampling
                  <span className="telemetry">
                    {pickedPlanes[0].pixelated ? "Nearest" : "Linear"}
                  </span>
                </p>
              </div>
            ) : null}
          </StudioPopover>
          <StudioHeaderRule />
          <StudioHeaderToggle
            icon={Paintbrush}
            label="Brush"
            on={brushOn}
            disabled={!detailPrediction}
            onToggle={() => setBrushOn((v) => !v)}
            title={
              detailPrediction
                ? "Read the class under the lens"
                : "Select a prediction plane to brush it"
            }
          />
        </>
      ),
    },
  })

  /*
    THE EDITORS, one expression each.

    They used to be four surfaces positioned by hand in the render tree below,
    which is why each of them had to know where it went. Naming them here makes
    them values an area can hold: what decides where the outliner appears is
    the tree, not the outliner.

    Not a registry of render functions -- lib/studioEditors carries the labels,
    the icons and the floors, and the props live here because only this
    component has them. A registry wide enough to pass them all would be a
    second copy of this component's state.
  */
  /*
    A FUNCTION OF THE AREA, not a table.

    It was one node per editor, reused in every area that held it -- so the
    outliner's props came from one place and two of them could not show
    different panes. An editor's props depend on WHICH area is drawing it,
    which is what the argument is for.
  */
  /*
    The catalog as shapes on a planet. Only the saved areas: a board is about
    one area's work and the catalog it was drawn from, and the hub's projects
    are not in scope on this screen.
  */
  const globeAreas = useMemo<GlobeArea[]>(
    () =>
      savedAois
        .map((a) => toGlobeArea(`aoi:${a.id}`, a.name, a.geometry))
        .filter((a): a is GlobeArea => a !== null),
    [savedAois]
  )

  const renderEditor = (
    areaId: AreaId
  ): Partial<Record<EditorId, React.ReactNode>> => {
    // Resolved once per area, so the header's slots and the body below them
    // name the same two planes rather than each deciding for itself.
    const sides = sidesFor(areaId)
    /*
      The one selected prediction plane that carries an agreement, where there
      is exactly one. A pair is the editor's subject; this is what it can still
      answer with half of one.
    */
    const soleAgreement = (() => {
      if (sides || predictionPicks.length !== 1) return null
      const only = sideOf(predictionPicks[0].areaId)
      const agreement = only?.result.lulc?.agreement
      return only && agreement ? { label: only.label, agreement } : null
    })()
    const pair = sides ? predCompares[`${sides[0].areaId}|${sides[1].areaId}`] : null
    return {
    /*
      The catalog on the planet, inside the board.

      The same surface the globe screen mounts, with the projects left out: a
      board is about one area's work and its catalog, and the hub's projects
      are not in scope here. Pressing one activates it exactly as the
      outliner's own list does -- one behaviour for "use this area", not two.

      AND THE AREA IS DRAWN HERE, which is what the board's own drawing modal
      used to be for. That modal existed because the only place to draw was the
      work map and reaching it meant closing the board the area was being drawn
      for -- a round trip through the surface you are trying to add to. It
      answered that with a second map inside a dialog, over the board, which
      was a second map to explain and a dialog to dismiss. This is a planet
      already in the arrangement, and the drawing is the same `useAreaDrawing`
      the work map uses, so there is no second answer to what an area is.
    */
    globe: (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-meta text-muted-foreground">
            Loading the globe
          </div>
        }
      >
        <GlobeSurface
          className="h-full w-full"
          areas={globeAreas}
          onPickArea={(id) => onActivateSavedAoi?.(id.slice(id.indexOf(":") + 1))}
          polygon={customPolygon}
          onPolygonDrawn={onPolygonDrawn}
        />
      </Suspense>
    ),
    outliner: (
          <BoardSidebar
            areaInfo={areaInfo}
            /*
              The ring the board is already drawing, handed back as a geometry.
              Taken from the same source the footprint and the figures come from, so
              the shape that is worked on is the shape that was on screen.
            */
            onUseArea={(id) => {
              if (savedAois.some((a) => a.id === id)) {
                onActivateSavedAoi?.(id)
                return
              }
              const ring = polygonsRef.current[id]
              if (!ring?.length || !onUseArea) return
              onUseArea({
                type: "Polygon",
                coordinates: [ring],
              } as GeoJSONGeometry)
            }}
            onRenameSavedAoi={onRenameSavedAoi}
            onDeleteSavedAoi={(id, title) =>
              setPendingDelete({ kind: "area", id, title })
            }
            areas={areas}
            areaId={live}
            assetRuns={assetRuns}
            addRun={
              <RunPicker
                runs={runs}
                projects={projects}
                excludeRunIds={new Set(assetRuns.map((r) => r.runId))}
                surface={surfaceRef.current}
                busy={loadingRun}
                onPick={(r) => void addRun(r)}
              />
            }
            sceneIds={sceneIds}
            onAddToScene={addToScene}
            onRemoveFromScene={removeFromScene}
            names={names}
            onRename={renameRow}
            mode={modeOf(areaId)}
            onModeChange={(m) => setModeOf(areaId, m)}
            activeAsset={activeAsset}
            onActivateAsset={setActiveAsset}
            onSelectComposition={onSelectComposition}
            onRemoveComposition={onRemoveComposition}
            activeRow={active}
            selection={selection}
            expanded={expanded}
            smooth={smooth}
            onActivate={chooseRow}
            onToggleExpanded={toggleExpanded}
            onLayerChange={changeLayer}
            onDropRun={dropRun}
            onRemoveArea={removeArea}
            // Both destructive controls only ASK here; the studio owns the
            // dialog and the act, so neither tree has to carry a confirmation
            // of its own.
            onDeleteRun={(id, title) =>
              setPendingDelete({ kind: "run", id, title })
            }
            flat={flat}
            onReorder={reorderArea}
            // Nothing to join until some area holds more than one raster.
            canLink={areas.some((a) => a.layers.length > 1)}
            onSmoothChange={onSmoothChange}
            hideInvisible={hideInvisible}
          />
    ),
    properties: (
          <BoardStatsBar
            entries={selection
              .map(rowTarget)
              .filter((t): t is { areaId: string; layerId: string } => !!t?.layerId)
              .map((t) => {
                const area = areas.find((a) => a.id === t.areaId)
                const info = areaInfo.find((a) => a.id === t.areaId)
                const catalogId = info?.catalogId
                return {
                  key: sceneKey(t.areaId, t.layerId),
                  legend: legendFor(t.layerId, legendByArea.get(t.areaId) ?? {}),
                  area: area?.title,
                  period: assetRuns.find((r) => r.areaId === t.areaId)?.period,
                  model: assetRuns.find((r) => r.areaId === t.areaId)?.model,
                  /*
                    Only on the layer it describes. A run's agreement is about its
                    CLASSIFICATION, so hanging it on the confidence or true-colour
                    plane of the same run would attach a measurement to a raster it
                    did not measure.
                  */
                  agreement:
                    t.layerId === "prediction"
                      ? legendByArea.get(t.areaId)?.result?.lulc?.agreement
                      : undefined,
                  onRenameArea:
                    catalogId && onRenameSavedAoi
                      ? (name: string) => onRenameSavedAoi(catalogId, name)
                      : undefined,
                }
              })}
          />
    ),
    runParams: runBar ?? null,
    domainShift: (
      <DomainShiftEditor
        mode={shiftModeOf(areaId)}
        sides={sides}
        available={availableSides}
        sourceId={cohortSources[areaId]}
        // A point in the figure names its area; selecting it is what carries
        // the reader from the aggregate back to the raster it stands for.
        onPickTarget={(boardAreaId: string) => {
          const layer = areas
            .find((a) => a.id === boardAreaId)
            ?.layers.find((l) => l.id === "prediction")
          if (layer) setSelection([layerRow(boardAreaId, layer.id)])
        }}
      />
    ),
    /*
      A view of the selection, like the table beside it: which run is read
      follows the selected planes rather than the board.
    */
    /*
      The rover reads the plane the selection points at, which is the same
      plane detailFocus already walks the selection for -- so it is handed the
      board's own sample rather than taking a second one.
    */
    brush: (
      <BrushEditor
        on={brushOn}
        onOnChange={setBrushOn}
        radius={brushRadius}
        onRadiusChange={setBrushRadius}
        result={detailPrediction}
        sample={probeSample}
        uv={probeUv}
        blockedBy={
          predictionPicks.length >= 2
            ? "Two predictions are selected, so the board is comparing them and there is no single plane to read. Select one."
            : null
        }
      />
    ),
    spectra: <SpectraEditor runs={selectedRuns} rover={roverClass} />,
    separability: <SeparabilityEditor runs={selectedRuns} />,
    libraryLimit: (
      <LibraryLimitEditor
        runs={selectedRuns}
        mode={libraryModeOf(areaId)}
        surface={surfaceRef.current}
        rover={roverClass}
      />
    ),
    table: <StudioTables runs={selectedRuns} />,
    /*
      Four readings of one canopy, and the canopy is the workflow's rather than
      the panel's: what is grown and which area is read are set once in the
      canopy band, which is why this takes only which reading to show. Two
      canopy areas are two questions about one stand -- a Stand beside its
      season is the comparison the editor exists for -- so it is not unique,
      and neither area carries a control the other could disagree with.
    */
    canopy: <CanopyEditor mode={canopyModeOf(areaId)} />,
    /*
      The simulation workflow's own band, the canopy's half of what the run
      band is for the classification products.
    */
    canopyParams: <CanopyRunBar />,
    /*
      No longer `sides ? ... : null`. An editor that renders nothing at all
      when it cannot answer is indistinguishable from one that is broken, and
      the domain-shift editor beside it has said what it needs all along.
    */
    compare: sides ? (
          <BoardSolarDetail
            placement="area"
            leftOffset="var(--board-left)"
            rightOffset="var(--board-right)"
            focus={detailFocus?.focus ?? null}
            terrain={detailTerrain}
            siting={detailSiting}
            prediction={detailPrediction}
            modelKind={detailModel}
            period={detailPeriod}
            brushOn={brushOn}
            onBrushOnChange={setBrushOn}
            brushRadius={brushRadius}
            onBrushRadiusChange={setBrushRadius}
            probe={brushOn ? probeSample : null}
            probeIdle={brushOn && !probeUv}
            heightRem={detailHeightRem}
            onResize={onDetailResize}
            collapsed={detailCollapsed}
            onToggleCollapsed={onDetailToggleCollapsed}
            compareSides={sides}
            compare={pair?.compare ?? null}
            compareError={pair?.error ?? null}
          />
    ) : soleAgreement ? (
      /*
        ONE PLANE, AND ITS OWN CONFUSION AGAINST THE REFERENCE.

        The properties column dropped the k x k grid deliberately: it spent k²
        cells to say what producer's against user's says in k rows, and its
        cell-by-cell reading needs width that column does not have. The comment
        there sent it to the compare modal, which no longer exists -- so
        retiring the modal would have taken this reading with it.

        It lands here because this editor has the width, and because a reader
        who has selected one plane and opened Compare is already asking about
        that plane's errors. Selecting a second turns it into the pair.
      */
      <div className="panel-scroll h-full w-full overflow-auto px-2 py-1.5">
        <ConfusionMatrix a={soleAgreement.agreement} title={soleAgreement.label} />
        <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
          Pick a second prediction plane to read this against another run.
        </p>
      </div>
    ) : (
      <p className="flex h-full items-center justify-center px-4 text-center text-meta text-muted-foreground">
        {availableSides.length < 2
          ? "Add a second run to the board to read one classification against another."
          : "Pick two prediction planes, or pin them to the A and B slots above."}
      </p>
    ),
    }
  }


  return (
    <motion.div
      /*
        Above the map, which sits at z-0, and below every piece of chrome: the
        foot track at 900, the island and the panels at 1000, the drawers at
        1100. What this excludes is the MAP, not the application -- the board
        is a working surface, so the controls have to stay within reach of it.
        Covering them turned it into a modal takeover, which is not what a
        whiteboard is.

        Opaque, because the map keeps rendering underneath as a sibling and a
        translucent scrim would leave tiles moving behind the rasters.
      */
      ref={surfaceRef}
      // Where the pointer is, for the shortcut that acts on the area under it.
      onPointerMove={(e) => {
        const r = surfaceRef.current?.getBoundingClientRect()
        if (r) pointerRef.current = { x: e.clientX - r.left, y: e.clientY - r.top }
      }}
      className="app-no-drag absolute inset-0 z-[500] overflow-hidden"
      style={{ background: "rgb(var(--p-ink))" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    >
      {/*
        The canvas, at the viewport area's rectangle and never unmounted.

        Kept OUTSIDE the tree deliberately. It carries the one WebGL context,
        and React would tear it down and rebuild it whenever the tree changed
        shape -- losing the camera, the arrangement and, on this webview, one
        context per rebuild until it refuses to give another. Positioning it
        from the same rectangle the viewport area occupies gets the same
        result without ever remounting: boardScene already watches its host
        with a ResizeObserver, so it follows.

        Hidden rather than removed when no area holds a viewport, for the same
        reason.
      */}
      <div
        ref={hostRef}
        className="absolute"
        style={
          viewportRect
            ? {
                left: viewportRect.x,
                top: viewportRect.y + AREA_HEADER_PX,
                width: viewportRect.w,
                height: Math.max(0, viewportRect.h - AREA_HEADER_PX),
              }
            : { left: 0, top: 0, width: 0, height: 0, visibility: "hidden" }
        }
      />

      {/*
        The names, over the canvas and out of the way of it.

        HTML rather than sprites: the text is the application's own, it stays
        crisp at any zoom, and renaming a layer costs nothing where a sprite
        would cost a regenerated texture. Nothing here takes the pointer --
        pressing a raster through its own name must still press the raster.
      */}
      {labels && (
        /*
          At the CANVAS's rectangle, not the surface's.

          boardScene places each label in canvas pixels, from the renderer's
          own clientWidth and clientHeight. While the canvas filled the studio
          the two frames agreed; now the canvas is the viewport area's body and
          an overlay at inset-0 would put every name off by the area's origin.
        */
        <div
          className="pointer-events-none absolute overflow-hidden"
          style={
            viewportRect
              ? {
                  left: viewportRect.x,
                  top: viewportRect.y + AREA_HEADER_PX,
                  width: viewportRect.w,
                  height: Math.max(0, viewportRect.h - AREA_HEADER_PX),
                }
              : { display: "none" }
          }
        >
          {areas.flatMap((a) =>
            a.layers
              .filter((l) => l.visible)
              .map((l) => {
                const key = sceneKey(a.id, l.id)
                return (
                  <span
                    key={key}
                    ref={(el) => {
                      if (el) labelRefs.current.set(key, el)
                      else labelRefs.current.delete(key)
                    }}
                    // Placed by the scene after each frame; until the first
                    // one arrives it has nowhere to be.
                    style={{ opacity: 0 }}
                    className="absolute left-0 top-0 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-meta text-foreground"
                  >
                    <span
                      className="absolute inset-0 rounded-sm"
                      style={{ background: "rgb(var(--p-ink) / 0.72)" }}
                    />
                    {/*
                      The layer over the AREA it belongs to, because the layer
                      alone is not an identity. A board holding two AOIs draws
                      two planes both saying "Prediction", and which ground each
                      one covers -- the thing the board exists to compare -- was
                      the one fact its labels did not carry.

                      Second line rather than a dot-joined string: the area name
                      is the slower read of the two and pushing it under keeps
                      the layer name where the eye already lands.
                    */}
                    <span className="relative flex flex-col leading-tight">
                      <span>{names[layerRow(a.id, l.id)] ?? l.title}</span>
                      <span className="text-[9px] text-muted-foreground">
                        {a.title}
                      </span>
                    </span>
                  </span>
                )
              })
          )}
        </div>
      )}


      {/*
        THE ONE PLACE THE STUDIO ASKS BEFORE DESTROYING SOMETHING.

        Both trees only request; the act and the asking live here, so the two
        destructive controls cannot drift into asking in two different ways --
        which is exactly what had happened across the application, one act
        opening a modal and the other calling `window.confirm`.
      */}
      {pendingDelete && (
        <ConfirmDelete
          eyebrow={pendingDelete.kind === "run" ? "DELETE RUN" : "DELETE AREA"}
          title={<>Delete “{pendingDelete.title}”?</>}
          subtitle={
            pendingDelete.kind === "run"
              ? "This cannot be undone. The run leaves the analysis list, its project and the exports, and its rasters come off the board."
              : "This cannot be undone. The geometry is not stored anywhere else, and a shape redrawn by hand is a different shape — runs made over it cannot be compared with runs made over this one."
          }
          confirmLabel={
            pendingDelete.kind === "run" ? "Delete run" : "Delete area"
          }
          busy={deleteBusy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}

      {/*
        The other thing this studio asks before destroying, and it asks in the
        same way for the reason ConfirmDelete's own docblock gives: a second
        destructive act must not become a second way of asking. What is
        destroyed here is not a run but the arrangement -- which planes were
        taken off, what was renamed, what was reordered -- and it is gone the
        moment another board is restored over it.
      */}
      {pendingOpen && (
        <ConfirmDelete
          eyebrow="UNSAVED CHANGES"
          title={<>Open “{pendingOpen.name}”?</>}
          subtitle={`This board has changes that were never saved${savedName ? ` to “${savedName}”` : ""} — planes taken off, renames, the order they sit in. Opening another one replaces them and they cannot be brought back. Cancel, press Save, and open it again to keep both.`}
          confirmLabel="Discard and open"
          onCancel={() => setPendingOpen(null)}
          onConfirm={() => {
            const board = pendingOpen
            setPendingOpen(null)
            onOpenWhiteboard?.(board)
          }}
        />
      )}

      {managing && (
        <StudioManager
          boards={whiteboards}
          openId={savedId}
          onDismiss={() => setManaging(false)}
          /*
            The caller owns the list, so it is asked to re-read it rather than
            the dialog keeping a copy that the surface would then disagree
            with. Awaited, so the dialog shows the result of its own act.
          */
          onChanged={async () => {
            await onWhiteboardsMenu?.()
          }}
          /*
            THE BOARD ON SCREEN OUTLIVED ITS RECORD.

            Its arrangement is still here and still worth keeping -- that is
            the reader's work -- so nothing is torn down. What goes is the
            claim to be a saved board: the name in the title block named a row
            that no longer exists, and pressing Save would have written over an
            id the store would refuse. Forgetting both turns this back into an
            unsaved board, which is exactly what it now is, and the next Save
            asks for a name.
          */
          onOpenDeleted={() => {
            setSavedId(null)
            setSavedName(null)
            markBoardDirty()
          }}
        />
      )}

      {/*
        THE WORKSPACE TABS.

        Named arrangements, one per kind of work, switched here -- which is
        what Blender's topbar carries and what makes density a matter of the
        task rather than of one compromise that has to serve them all.

        Outside the partition: a tab strip that could be divided or retyped
        would be an arrangement that can delete the way back to the others.
      */}
      <div
        className="absolute inset-x-0 top-0 z-[35] flex items-stretch gap-0.5 border-b px-1"
        style={{
          height: WORKSPACE_BAR_PX,
          background: "rgb(var(--p-ink))",
          borderColor: "rgb(var(--p-line) / 0.28)",
        }}
      >
        {/*
          The application menu, at the left end where Blender puts File/Edit.
          One entrance rather than five words, because this studio has fewer
          verbs than a 3D suite and a row of near-empty menus reads as an
          imitation rather than as a tool.
        */}
        <StudioPopover
          open={appMenu}
          onOpenChange={setAppMenu}
          surface={surfaceRef.current}
          widthRem={14}
          trigger={(p) => (
            <button
              ref={p.ref as React.Ref<HTMLButtonElement>}
              type="button"
              onClick={p.onClick}
              aria-expanded={p["aria-expanded"]}
              aria-haspopup="menu"
              title="Studio"
              className="flex h-full items-center gap-1 px-2 text-meta text-muted-foreground transition-colors hover:text-foreground"
            >
              <Box className="size-3.5" strokeWidth={1.75} />
              Studio
            </button>
          )}
        >
          <StudioMenuItem
            icon={Save}
            label={savedName ? `Save over "${savedName}"` : "Save studio"}
            disabled={saving}
            onSelect={() => {
              savedName ? void doSave(savedName) : setNaming("")
              setAppMenu(false)
            }}
          />
          <StudioMenuRule />
          <StudioMenuItem
            icon={RotateCcw}
            label="Reset this workspace"
            title="Put the arrangement back the way it ships"
            onSelect={() => {
              setTrees((prev) => {
                const next = { ...prev }
                delete next[workspaceId]
                return next
              })
              setRestoreTree((p) => ({ ...p, [workspaceId]: null }))
              setAppMenu(false)
            }}
          />
          <StudioMenuRule />
          <StudioMenuItem
            icon={X}
            label="Close the studio"
            note="Esc"
            onSelect={onClose}
          />
        </StudioPopover>

        <span
          className="mx-1 h-4 w-px self-center"
          style={{ background: "rgb(var(--p-line) / 0.45)" }}
          aria-hidden
        />

        {STUDIO_WORKSPACES.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => setWorkspaceId(w.id)}
            title={w.hint}
            aria-current={w.id === workspaceId}
            className={cn(
              /*
                A tab, not a button: the current one carries the ground it
                sits on, which is how Blender's workspace tabs read as a row
                of destinations rather than as four switches.
              */
              "relative -mb-px flex h-full items-center gap-1.5 px-2.5 text-meta transition-colors",
              w.id === workspaceId
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            style={
              w.id === workspaceId
                ? {
                    background: "rgb(var(--p-surface-raised))",
                    borderTopLeftRadius: 3,
                    borderTopRightRadius: 3,
                  }
                : undefined
            }
          >
            {/*
              The glyph of the editor the preset is built around, which the
              type menu already uses for that editor. The name stays: a tab
              strip of five glyphs would be five destinations a reader has to
              learn before they can be chosen between.
            */}
            <w.icon className="size-3 shrink-0" strokeWidth={1.75} />
            {w.label}
          </button>
        ))}

        <span className="flex-1" />

        {/*
          The board's data-block, at the right end -- which is where Blender
          keeps the Scene and ViewLayer selectors. It used to float over the
          board at `absolute top-3`, positioned for a layout with nothing
          above the canvas, and after the areas arrived it was drawn across
          two of their headers at once.
        */}
        <div
          className="flex min-w-0 max-w-[26rem] items-center gap-1.5"
        >
          {/*
            One line, like Blender's Scene and ViewLayer blocks.

            It was a name stacked over a subtitle, which is a shape for a
            heading and not for a 28px strip: the two lines were clipped to
            about a line and a half and read as broken text. What a data-block
            shows is WHICH one is loaded; the rest is the title attribute.

            AND IT IS A SELECTOR, which is the other half of what a data-block
            is. It named the board that was loaded and offered no way to load
            another: the catalog was in the project menu, on a screen the
            studio covers. A name shown where it cannot be changed is a readout
            wearing a control's clothes.
          */}
          <StudioPopover
            open={boardMenu}
            onOpenChange={(next) => {
              // Refreshed as it opens: a board saved from another window, or
              // one saved here a moment ago, should be in the list rather than
              // in the list next time.
              if (next) onWhiteboardsMenu?.()
              setBoardMenu(next)
            }}
            surface={surfaceRef.current}
            align="end"
            widthRem={17}
            trigger={(p) => (
              <button
                {...p}
                ref={p.ref as React.Ref<HTMLButtonElement>}
                type="button"
                disabled={!onOpenWhiteboard}
                className="app-no-drag flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-meta transition-colors hover:brightness-125 disabled:cursor-default"
                style={{ background: "rgb(var(--p-surface-raised))" }}
                title={
                  onOpenWhiteboard
                    ? `${savedName ?? title} — open another studio`
                    : savedName
                      ? `${savedName} — ${title}`
                      : title
                }
              >
                <Layers
                  className="size-3 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <span className="truncate text-foreground">
                  {savedName ?? title}
                </span>
                {onOpenWhiteboard ? (
                  <ChevronDown
                    className="size-2.5 shrink-0 opacity-60"
                    strokeWidth={2}
                  />
                ) : null}
              </button>
            )}
          >
            <StudioMenuGroup label="Studios">
              {whiteboards.length ? (
                whiteboards.map((b) => (
                  <StudioMenuItem
                    key={b.id}
                    icon={Layers}
                    label={b.name}
                    // How many runs are arranged on it, which is the only
                    // thing about a board that says how much is there.
                    note={String(b.member_count ?? 0)}
                    checked={b.id === savedId}
                    title={
                      b.id === savedId
                        ? "Already open"
                        : `Open "${b.name}" — this arrangement is replaced by it`
                    }
                    onSelect={() => {
                      setBoardMenu(false)
                      openBoard(b)
                    }}
                  />
                ))
              ) : (
                <StudioMenuItem
                  icon={Save}
                  label="No studios saved yet"
                  disabled
                  title="Save this one under a name and it is listed here"
                  onSelect={() => {}}
                />
              )}
            </StudioMenuGroup>
            <StudioMenuRule />
            {/*
              Renaming is a save under another name over the same board, which
              is what the store already does with an id and a name. Offered
              here rather than beside the button, because the name being
              changed is the one this block shows.
            */}
            <StudioMenuItem
              icon={Save}
              label={savedName ? "Save under another name…" : "Save studio…"}
              onSelect={() => {
                setBoardMenu(false)
                setNaming(savedName ?? "")
              }}
            />
            {/*
              Renaming a board that is NOT open, and removing one, are the two
              things the list above cannot offer: its rows are buttons whose
              whole job is a single press, and a rename needs a field while a
              delete needs a confirmation. Only offered where there is
              something to manage.
            */}
            {whiteboards.length > 0 && (
              <StudioMenuItem
                icon={Settings2}
                label="Manage studios…"
                onSelect={() => {
                  setBoardMenu(false)
                  setManaging(true)
                }}
              />
            )}
          </StudioPopover>
          {/*
            Saving names the board. Unnamed it asks for one; named it writes over
            itself, because a second copy of the same work under the same name is
            not what pressing save again means.
          */}
          {naming === null ? (
            <button
              type="button"
              onClick={() =>
                savedName ? void doSave(savedName) : setNaming("")
              }
              disabled={saving || loadingRun}
              title={
                loadingRun
                  ? "Still fetching this board's runs; saving now would store it without them"
                  : savedName
                    ? `Save over "${savedName}"`
                    : "Save this studio under a name"
              }
              className="app-no-drag flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2 text-meta text-muted-foreground transition-colors hover:bg-surface-raised/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="size-3.5" strokeWidth={1.75} />
              {saving ? "Saving…" : "Save"}
            </button>
          ) : (
            <input
              autoFocus
              value={naming}
              placeholder="Name this studio"
              onChange={(e) => setNaming(e.target.value)}
              onBlur={() => setNaming(null)}
              onKeyDown={(e) => {
                // Escape closes the board from a listener on the window, so a
                // name abandoned here must not leave the board with it.
                e.stopPropagation()
                if (e.key === "Enter") void doSave(naming)
                else if (e.key === "Escape") setNaming(null)
              }}
              className="app-no-drag h-7 w-48 shrink-0 rounded-sm border-0 bg-surface-raised px-2 text-meta text-foreground outline-none inset-ring-1 inset-ring-ring"
            />
          )}
        </div>
      </div>

      {/*
        THE SECOND WAIT: the rasters.

        The chunk has arrived by now -- Suspense answered that one -- but every
        plane is a data URI still being decoded into a texture, and an empty
        board with chrome around it reads as a studio that opened onto nothing.
        Withdrawn the moment the last one lands, including any that failed.

        Over the areas rather than under them, so the arrangement is not seen
        assembling itself piece by piece; and not over the topbar, so the way
        out is reachable throughout.
      */}
      {cards.total > 0 && cards.loaded < cards.total && (
        <div
          className="absolute inset-x-0 z-[45]"
          style={{ top: WORKSPACE_BAR_PX, bottom: STATUS_BAR_PX }}
        >
          <StudioLoading loaded={cards.loaded} total={cards.total} />
        </div>
      )}

      {/*
        The status bar, and the run's progress with it.

        It used to replace the properties column's whole body for as long as a
        run lasted, so a reader watching a classification could not read the
        legend of anything. Twenty-two pixels at the foot buys that back.
      */}
      <StudioStatusBar
        stats={boardStats}
        selected={selection.length}
        total={areas.reduce((n, a) => n + a.layers.length, 0)}
        areas={areas.length}
      />

      {/*
        The plane's own menu, on the plane.

        Reachable because the navigation moved to the middle button: the right
        one used to pan and had nothing left over. What it carries acts on this
        plane and nothing else -- its opacity is not here, since a number field
        in a menu that closes on the first press is a control that cannot be
        adjusted, and it is a value to be read against the legend beside it.
      */}
      <PlaneContextMenu
        target={planeMenu}
        surface={surfaceRef.current}
        onClose={() => setPlaneMenu(null)}
        onToggleFlat={() =>
          planeMenu && toggleFlat(planeMenu.areaId, planeMenu.layerId)
        }
        onToggleVisible={() =>
          planeMenu &&
          changeLayer(planeMenu.areaId, planeMenu.layerId, {
            visible: !planeMenu.visible,
          })
        }
        onSolo={() => planeMenu && soloLayer(planeMenu.areaId, planeMenu.layerId)}
        onFit={() =>
          planeMenu &&
          boardRef.current?.focusPlane(planeMenu.areaId, planeMenu.layerId)
        }
        onRemove={() =>
          planeMenu && removeFromScene(planeMenu.areaId, planeMenu.layerId)
        }
      />

      {/*
        THE ARRANGEMENT, drawn.

        Every leaf becomes an area with a header naming its editor, and every
        division becomes a draggable edge. What used to be four surfaces that
        each knew where they went is now one walk of a tree -- so which surface
        sits where is a choice the reader makes, which is the whole point.
      */}
      {/*
        THE SIMULATION WORKFLOW'S STATE, above every area that reads it.

        The canopy band sets a stand and an area to read; the canopy panels
        draw what came of it. Both are leaves of this tree, and neither is the
        other's parent, so the state they share sits over the walk rather than
        inside either -- the same relation the board's runs already have to the
        viewport and the tables.
      */}
      <CanopyWorkflowProvider runs={boardRuns}>
      <StudioAreaTree
        tree={tree}
        viewport={surface}
        surface={surfaceRef.current}
        onMoveSplit={(id, at) => setTree(moveSplit(tree, id, at))}
        renderArea={({ id, editor, rect }) => (
          <StudioArea
            editor={editor}
            rect={rect}
            rootPx={rootPx}
            surface={surfaceRef.current}
            takenUnique={takenUnique}
            canClose={leaves.length > 1}
            transparent={editor === "viewport"}
            maximized={!!restoreTree[workspaceId]}
            slots={headerSlotsFor(id)[editor]}
            modes={editorModesFor(id)}
            onRetype={(next) => setTree(retypeArea(tree, id, next))}
            onSplit={(dir) => setTree(splitArea(tree, id, dir, "properties"))}
            onClose={() => setTree(joinArea(tree, id))}
            onMaximize={() => {
              const kept = restoreTree[workspaceId]
              if (kept) {
                setTree(kept)
                setRestoreTree((p) => ({ ...p, [workspaceId]: null }))
              } else {
                setRestoreTree((p) => ({ ...p, [workspaceId]: tree }))
                setTree(maximizeArea(tree, id))
              }
            }}
          >
            {/*
              A THROWN PANEL COSTS ITS OWN AREA AND NOTHING ELSE.

              This is the only seam every panel passes through. An area holds
              whichever editor the tree names, so there is no per-panel
              component to guard instead -- the panels are values one walk of
              the tree produces, and this is where the walk hands one over.

              Placed inside the area rather than around it so the header
              survives: retype and close live there, and a fallback that took
              the header with it would leave the reader an area they could not
              change out of.

              A BUILDER, not a node, and the distinction is the whole point.
              `renderEditor` assembles every editor's props for this area and
              is called BY the tree walk, above this boundary -- so a throw
              while building them would land where nothing is catching and take
              the board down with it. Handed over as a function, that work runs
              inside the boundary's own subtree.

              Keyed by editor because retyping the area is a different panel: a
              fallback that outlived the editor that threw would report the
              wrong one as broken and never clear.
            */}
            <ErrorBoundary
              key={editor}
              fallback={(state) => (
                <PanelErrorFallback
                  {...state}
                  panel={studioEditor(editor).label}
                />
              )}
            >
              {() => renderEditor(id)[editor] ?? null}
            </ErrorBoundary>
          </StudioArea>
        )}
      />
      </CanopyWorkflowProvider>

    </motion.div>
  )
}
