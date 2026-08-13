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
import { useEffect, useMemo, useRef, useState } from "react"
import { motion } from "motion/react"
import { Save } from "lucide-react"
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
import { BoardCompareModal } from "@/components/whiteboard/BoardCompareModal"
import { BoardStatsBar } from "@/components/whiteboard/BoardStatsBar"
import {
  BoardSolarDetail,
  BOARD_RIGHT_REM,
  type BoardDetailFocus,
  type PredictionCompareSide,
} from "@/components/whiteboard/BoardSolarDetail"
import {
  compareClassMaps,
  sampleClassAtUv,
  type BrushRadiusPx,
  type ClassMapCompare,
  type ClassProbeSample,
} from "@/lib/boardProbe"
import type { ClassLegendEntry } from "@/lib/classMask"
import { legendFor, type LegendSources } from "@/lib/layerLegend"
import type { RunLogEntry } from "@/lib/runLog"
import type { AssetRun, RunAsset } from "@/lib/runAssets"
import { modelLabel, runAssets } from "@/lib/runAssets"
import type { CardGroup } from "@/lib/boardLayout"
import { layoutGroups } from "@/lib/boardLayout"
import { majoritySmoothOverlay } from "@/lib/smoothOverlay"
import { RunPicker } from "@/components/whiteboard/RunPicker"
import {
  CURRENT_AREA,
  keptObject,
  readBoardMemory,
  snapshotBoard,
  writeBoardMemory,
} from "@/components/whiteboard/boardMemory"
import { useAuth } from "@/lib/auth"
import { displayRunLabel } from "@/lib/aoiLabel"
import type { LonLat } from "@/lib/geometry"
import {
  geometryAreaHectares,
  polygonOuterRing,
  resolveProjectGeometry,
} from "@/lib/geometry"
import { notifyError, notifySuccess } from "@/lib/notify"
import { saveWhiteboard } from "@/lib/whiteboards"
import { LoadAnalysis } from "../../../wailsjs/go/main/App"
import type {
  GeoJSONGeometry,
  InferenceRun,
  ModelKind,
  PredictResult,
} from "@/lib/types"
import type { BoardHandle, PlaneState } from "@/components/whiteboard/boardScene"
import { createBoard, tokenColor } from "@/components/whiteboard/boardScene"

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
function useKept<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() =>
    readBoardMemory(
      key,
      typeof initial === "function" ? (initial as () => T)() : initial
    )
  )
  useEffect(() => {
    writeBoardMemory(key, value)
  }, [key, value])
  return [value, setValue] as const
}

export function BoardSurface({
  layers,
  legendSources,
  onUseArea,
  savedAois = [],
  activeAoiId,
  onActivateSavedAoi,
  onRenameSavedAoi,
  onDeleteSavedAoi,
  detailHeightRem,
  onDetailResize,
  detailCollapsed,
  onDetailToggleCollapsed,
  runLog,
  runRunning,
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
  runLog?: RunLogEntry[]
  runRunning?: boolean
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
  onClose: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<BoardHandle | null>(null)

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
    {}
  )
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
  const { runs, projects } = useAuth()

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

  /*
    Runs a whiteboard named that are not on the board yet.

    Opening a saved board restores the arrangement immediately -- it is plain
    data -- but its rasters have to be fetched, and fetching belongs here where
    LoadAnalysis already lives. The list is consumed rather than read, so a
    board reopened twice does not queue the same runs twice.
  */
  useEffect(() => {
    const pending = readBoardMemory<string[]>("pendingRunIds", [])
    if (!pending.length) return
    writeBoardMemory("pendingRunIds", [])
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
          runId: a.id === CURRENT_AREA ? runId : a.id,
          layerIds: a.layers.map((l) => l.id),
        }))
        .filter((m) => m.runId && m.runId !== "current")
      const board = await saveWhiteboard(
        trimmed,
        // The run the map's area belongs to, so its keys are rewritten to the
        // id that area will carry when the board is opened again.
        snapshotBoard(members, runId),
        savedId ?? undefined
      )
      setSavedId(board.id)
      setSavedName(board.name)
      setNaming(null)
      notifySuccess(`Whiteboard "${board.name}" saved.`)
    } catch (e) {
      notifyError("Could not save this whiteboard", e)
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

  const assetRuns: AssetRun[] = [
    ...(assets.length
      ? [
          {
            areaId: CURRENT_AREA,
            runId,
            title,
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
            assets,
          },
        ]
      : []),
    ...extraRuns.map(({ run, result }) => ({
      // The run's own id names its area: it is unique, it is stable across a
      // reopen, and it is what a saved arrangement will record.
      areaId: run.id,
      runId: run.id,
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
    () => new Set()
  )
  /** Scene ids added, per area, in the order they were added. */
  const [added, setAdded] = useKept<
    Readonly<Record<string, readonly string[]>>
  >("added", {})
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
  >("extraState", {})

  /**
   * Layers dropped to the base of their stack.
   *
   * Board-local for every layer, including the map's own: where a raster sits
   * in this stack is a fact about looking at it here, and the map has no
   * stack to have an opinion about.
   */
  const [flat, setFlat] = useKept<ReadonlySet<string>>("flat", () => new Set())

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
    {}
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

  const areas = [
    {
      id: CURRENT_AREA,
      // Renamed like every other stack. It was the one area reading its raw
      // title, so renaming it changed the tree and nothing else.
      title: names[stackRow(CURRENT_AREA)] ?? title,
      layers: applyOrder(CURRENT_AREA, [
        ...layers.filter((l) => !removed.has(sceneKey(CURRENT_AREA, l.id))),
        ...extrasFor(CURRENT_AREA, 1000),
      ]),
    },
    // Catalogued drawings that are not the active map AOI — so a second draw
    // stays visible and can be put back with Use.
    ...savedAois
      .filter((a) => a.id !== activeAoiId)
      .map((a) => ({
        id: a.id,
        title: names[stackRow(a.id)] ?? a.name,
        layers: applyOrder(a.id, extrasFor(a.id, 200)),
      })),
    ...assetRuns
      .filter((r) => r.areaId !== CURRENT_AREA)
      .map((r) => ({
        id: r.areaId,
        title: names[stackRow(r.areaId)] ?? r.title,
        layers: applyOrder(r.areaId, extrasFor(r.areaId, 400)),
      })),
  ].filter(
    (a) =>
      a.layers.length > 0 ||
      // The map's own area survives having nothing on it, so long as an area
      // has been drawn: it is the thing the work is about to be run on, and
      // the board is where that work is started.
      (a.id === CURRENT_AREA && !!aoiPolygon?.length) ||
      savedAois.some((s) => s.id === a.id)
  )

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
        .filter((l) => a.id !== CURRENT_AREA || !baseIds.has(l.id))
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

  const addToScene = (areaId: string, id: string) => {
    // Putting back one the board had taken out, rather than adding a copy.
    if (areaId === CURRENT_AREA && baseIds.has(id)) {
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
    if (areaId === CURRENT_AREA && baseIds.has(id)) {
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
  const dropRun = (runId: string) => {
    if ((added[runId] ?? []).length > 0) return
    setExtraRuns((prev) => prev.filter((x) => x.run.id !== runId))
    setAdded((prev) => {
      const next = { ...prev }
      delete next[runId]
      return next
    })
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
    ...(aoiPolygon?.length ? { [CURRENT_AREA]: aoiPolygon } : {}),
    ...Object.fromEntries(
      savedAois.flatMap((a) => {
        if (a.id === activeAoiId) return []
        const ring = polygonOuterRing(a.geometry)
        return ring ? [[a.id, ring] as const] : []
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
  const [comparing, setComparing] = useState<{
    from: { groupId: string; id: string }
    to: { groupId: string; id: string }
  } | null>(null)

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
      a.id === CURRENT_AREA
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
      current: a.id === CURRENT_AREA,
      saved: !!catalogId,
      catalogId,
    }
  })

  const legendByArea = new Map<string, LegendSources>([
    [CURRENT_AREA, legendSources ?? {}],
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
    new Set([stackRow(CURRENT_AREA)])
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


  const [mode, setMode] = useKept<OutlinerMode>("mode", "scene")
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

  const compareSides = useMemo(():
    | [PredictionCompareSide, PredictionCompareSide]
    | null => {
    if (predictionPicks.length < 2 || !groups) return null
    const lastTwo = predictionPicks.slice(-2)
    const sides: PredictionCompareSide[] = []
    for (const pick of lastTwo) {
      const sources = legendByArea.get(pick.areaId)
      const result = sources?.result
      const g = groups.find((x) => x.id === pick.areaId)
      const uri = g?.cards.find((c) => c.id === "prediction")?.uri
      if (!result || !uri) return null
      const run = assetRuns.find((r) => r.areaId === pick.areaId)
      sides.push({
        areaId: pick.areaId,
        label: areas.find((a) => a.id === pick.areaId)?.title ?? pick.areaId,
        model: run?.model,
        period: run?.period,
        result,
        uri,
      })
    }
    if (sides.length !== 2) return null
    return [sides[0], sides[1]]
  }, [predictionPicks, groups, legendByArea, assetRuns, areas])

  const [predCompare, setPredCompare] = useState<ClassMapCompare | null>(null)
  const [predCompareError, setPredCompareError] = useState<string | null>(null)
  useEffect(() => {
    if (!compareSides) {
      setPredCompare(null)
      setPredCompareError(null)
      return
    }
    const [a, b] = compareSides
    const legendA = (a.result.class_stats ?? []).map((c) => ({
      id: c.class_id,
      name: c.name,
      color: c.color,
    }))
    const legendB = (b.result.class_stats ?? []).map((c) => ({
      id: c.class_id,
      name: c.name,
      color: c.color,
    }))
    if (!legendA.length || !legendB.length) {
      setPredCompare(null)
      setPredCompareError("Both predictions need class legends to compare.")
      return
    }
    let cancelled = false
    setPredCompareError(null)
    void compareClassMaps(a.uri, legendA, b.uri, legendB)
      .then((c) => {
        if (!cancelled) setPredCompare(c)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPredCompare(null)
        setPredCompareError(
          err instanceof Error ? err.message : "Could not compare these rasters."
        )
      })
    return () => {
      cancelled = true
    }
  }, [compareSides])

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
        groups,
        background: tokenColor("--p-ink", "#171717"),
        line: tokenColor("--p-line", "#404040"),
        accent: tokenColor("--p-accent", "#f25623"),
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
        // The arrow between two planes is a question -- how do these compare --
        // and pressing it is the only place on the board that asks it.
        onLinkPick: (a, b) => setComparing({ from: a, to: b }),
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
    // Lens diameter on the plane: S/M/L as fraction of the shorter side.
    const frac = brushRadius === 0 ? 0.08 : brushRadius === 2 ? 0.14 : 0.22
    boardRef.current?.setProbeLensScale(frac)
  }, [brushRadius, groups])


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
      className="app-no-drag absolute inset-0 z-[500] overflow-hidden"
      style={{ background: "rgb(var(--p-ink))" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    >
      <div ref={hostRef} className="absolute inset-0" />

      {/*
        The names, over the canvas and out of the way of it.

        HTML rather than sprites: the text is the application's own, it stays
        crisp at any zoom, and renaming a layer costs nothing where a sprite
        would cost a regenerated texture. Nothing here takes the pointer --
        pressing a raster through its own name must still press the raster.
      */}
      {labels && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
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
        The right column describes ONE plane: identity, classes, hectares,
        confidence, and its agreement against MapBiomas. The foot band is for
        what relates TWO -- the A to B difference -- and does not exist while a
        single plane is selected.
      */}
      <BoardStatsBar
        runLog={runLog}
        running={runRunning}
        brushOn={brushOn}
        onBrushOnChange={setBrushOn}
        // Only where there is a prediction plane for it to read.
        brushable={!!detailPrediction}
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

      {/*
        The band exists for the relation between TWO planes, so it is mounted
        only when there is one. With a single selection it had nothing to
        relate and still reserved 8rem: the reader saw a strip of ink holding
        one sentence -- the empty space that sat beside a scrolling column.

        `compareSides` is that predicate already: non-null only where two
        prediction planes are picked and both carry a result and a drawn
        raster. The foot RESERVATION is untouched -- --map-band, --map-stats
        and --map-foot keep their values, because boardScene parses --map-foot
        to lift the axis gizmo and MapScreen derives it from FOOT_REM. What
        goes away is the painted box, not the space it was measured in.
      */}
      {compareSides && (
      <BoardSolarDetail
        placement="band"
        leftOffset="15rem"
        rightOffset={`${BOARD_RIGHT_REM}rem`}
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
        compareSides={compareSides}
        compare={predCompare}
        compareError={predCompareError}
      />
      )}

      {comparing && (() => {
        /*
          Built from what is DRAWN, so the swipe shows the pixels the arrow was
          pointing at: with the majority filter on, a card's uri is the smoothed
          one and the raw raster has different frontiers.
        */
        const side = (t: { groupId: string; id: string }) => {
          const card = groups
            ?.find((g) => g.id === t.groupId)
            ?.cards.find((c) => c.id === t.id)
          const area = areas.find((a) => a.id === t.groupId)
          const layer = area?.layers.find((l) => l.id === t.id)
          if (!card || !layer) return null
          return {
            areaTitle: areas.length > 1 ? area?.title : undefined,
            layerTitle: names[layerRow(t.groupId, t.id)] ?? layer.title,
            model: assetRuns.find((r) => r.areaId === t.groupId)?.model,
            uri: card.uri,
            pixelated: layer.pixelated,
            legend: legendFor(t.id, legendByArea.get(t.groupId) ?? {}),
            // Same ground is the precondition for counting agreement, and the
            // extent is what says so -- two areas can be rastered alike.
            extentKey: JSON.stringify(layer.extent),
            /*
              The run behind the raster, for the domain-shift comparison: it
              reads the feature fingerprint the run carries, which the image
              itself does not have. Undefined for a layer with no run behind
              it, and the section withholds itself there.
            */
            result: legendByArea.get(t.groupId)?.result,
            // Only the prediction plane is measured against MapBiomas; a
            // confidence or composition raster has no reference to agree with.
            agreement:
              t.id === "prediction"
                ? legendByArea.get(t.groupId)?.result?.lulc?.agreement
                : undefined,
          }
        }
        const from = side(comparing.from)
        const to = side(comparing.to)
        if (!from || !to) return null
        return (
          <BoardCompareModal
            from={from}
            to={to}
            onClose={() => setComparing(null)}
          />
        )
      })()}

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
        onDeleteSavedAoi={onDeleteSavedAoi}
        areas={areas}
        areaId={CURRENT_AREA}
        assetRuns={assetRuns}
        addRun={
          <RunPicker
            runs={runs}
            projects={projects}
            excludeRunIds={new Set(assetRuns.map((r) => r.runId))}
            busy={loadingRun}
            onPick={(r) => void addRun(r)}
          />
        }
        sceneIds={sceneIds}
        onAddToScene={addToScene}
        onRemoveFromScene={removeFromScene}
        names={names}
        onRename={renameRow}
        mode={mode}
        onModeChange={setMode}
        activeAsset={activeAsset}
        onActivateAsset={setActiveAsset}
        onSelectComposition={onSelectComposition}
        onRemoveComposition={onRemoveComposition}
        activeRow={active}
        selection={selection}
        expanded={expanded}
        gap={gap}
        gapMax={GAP_MAX}
        smooth={smooth}
        onActivate={chooseRow}
        onToggleExpanded={toggleExpanded}
        onGapChange={setGap}
        onLayerChange={changeLayer}
        onDropRun={dropRun}
        flat={flat}
        onToggleFlat={toggleFlat}
        onReorder={reorderArea}
        links={links}
        onLinksChange={setLinks}
        labels={labels}
        onLabelsChange={setLabels}
        // Nothing to join until some area holds more than one raster.
        canLink={areas.some((a) => a.layers.length > 1)}
        onSmoothChange={onSmoothChange}
      />

      {/*
        Left, and clear of the top-right corner where the search bar sits.

        No close button, and the rule that used to put one here is the reason.
        It read: the X appears only where the toggle that opened the board is
        hidden behind it. That was the island in one layout and Leaflet's
        control stack in the other, and only the stack goes under this surface.

        The toggle now sits in the title bar, which is the first child of a
        full-height flex column while this surface is inset within the screen
        below it -- so it is hidden in neither layout, and the rule yields no X
        in either. It stays pressable for as long as the board is up (MapScreen
        gates its `disabled` on boardOpen precisely so the exit cannot go dead),
        and its tooltip carries the Escape shortcut this button used to name.
      */}
      <div className="absolute left-[16rem] top-3 flex min-w-0 max-w-[30rem] items-start gap-2">
        <div className="min-w-0">
          <p className="eyebrow !text-foreground">
            {savedName ?? "Whiteboard"}
          </p>
          <p className="mt-0.5 truncate text-emphasis text-muted-foreground">
            {title}
          </p>
        </div>
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
            disabled={saving}
            title={
              savedName
                ? `Save over "${savedName}"`
                : "Save this whiteboard under a name"
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
            placeholder="Name this whiteboard"
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
    </motion.div>
  )
}
