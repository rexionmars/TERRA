/**
 * The isolate board: the analysis lifted off its coordinates.
 *
 * On a cartographic map two AOI analyses cannot be placed side by side --
 * they are at different points on Earth. Freeing the rasters from their
 * coordinates is what makes the comparison possible at all, which is why this
 * surface exists rather than another map mode.
 *
 * Loaded lazily. It is the only route to `three`, and the map screen must not
 * pay for it until the board is opened; see IsolateBoardButton for the other
 * half of that boundary.
 */
import { useEffect, useRef, useState } from "react"
import { motion } from "motion/react"
import { X } from "lucide-react"
import type { RasterLayer } from "@/lib/mapLayers"
import type { LayerPatch } from "@/components/isolate/BoardSidebar"
import type { OutlinerMode } from "@/components/isolate/BoardSidebar"
import {
  BoardSidebar,
  rowTarget,
  sceneKey,
  stackRow,
} from "@/components/isolate/BoardSidebar"
import type { AssetRun, RunAsset } from "@/lib/runAssets"
import { runAssets } from "@/lib/runAssets"
import type { CardGroup } from "@/lib/isolateCards"
import { layoutGroups } from "@/lib/isolateCards"
import { majoritySmoothOverlay } from "@/lib/smoothOverlay"
import { RunPicker } from "@/components/isolate/RunPicker"
import { useAuth } from "@/lib/auth"
import { displayRunLabel } from "@/lib/aoiLabel"
import { notifyError } from "@/lib/notify"
import { LoadAnalysis } from "../../../wailsjs/go/main/App"
import type { InferenceRun, PredictResult } from "@/lib/types"
import type { BoardHandle, PlaneState } from "@/components/isolate/boardScene"
import { createBoard, tokenColor } from "@/components/isolate/boardScene"

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
function sameStructure(a: CardGroup[], b: CardGroup[]): boolean {
  if (a.length !== b.length) return false
  return a.every((g, i) => {
    const h = b[i]
    if (g.id !== h.id || g.cards.length !== h.cards.length) return false
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
const CURRENT_AREA = "current"

export function IsolateBoard({
  layers,
  assets,
  runId,
  runPeriod,
  onLayerChange,
  onSelectComposition,
  onRemoveComposition,
  smooth,
  onSmoothChange,
  title,
  showClose,
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
   * Everything the run produced, drawn or not.
   *
   * Separate from `layers` because they answer different questions: a layer is
   * something the board is stacking, an asset is something the run made. NDVI
   * mean and the true-colour scene are assets and never layers.
   */
  assets: RunAsset[]
  /**
   * The run's id and the period it covers, for the branch that carries its
   * assets. Two runs of one area differ by when they looked, not by where.
   */
  runId: string
  runPeriod: string
  onLayerChange: (id: string, patch: LayerPatch) => void
  onSelectComposition?: (id: string) => void
  onRemoveComposition?: (id: string) => void
  /** The map's majority filter, carried across so the board can change it. */
  smooth: boolean
  onSmoothChange: (v: boolean) => void
  title: string
  /**
   * Whether this surface draws its own way out.
   *
   * False where the toggle that opened the board stays visible over it -- the
   * dock layout's island -- because one control that turns a thing on and off
   * is one control. True where the toggle is in Leaflet's stack, which this
   * surface covers: there the button cannot be pressed again and its absence
   * would leave Escape as the only exit.
   */
  showClose: boolean
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
  const [names, setNames] = useState<Readonly<Record<string, string>>>({})
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
  const [extraRuns, setExtraRuns] = useState<
    readonly { run: InferenceRun; result: PredictResult }[]
  >([])
  const [loadingRun, setLoadingRun] = useState(false)
  const { runs, projects } = useAuth()

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
  const assetRuns: AssetRun[] = [
    ...(assets.length
      ? [{ areaId: CURRENT_AREA, runId, title, period: runPeriod, assets }]
      : []),
    ...extraRuns.map(({ run, result }) => ({
      // The run's own id names its area: it is unique, it is stable across a
      // reopen, and it is what a saved arrangement will record.
      areaId: run.id,
      runId: run.id,
      title: displayRunLabel(run.label) || run.model_kind,
      period:
        result.date_range?.length === 2
          ? `${result.date_range[0]} → ${result.date_range[1]}`
          : `${run.period_start} → ${run.period_end}`,
      assets: runAssets({
        result,
        composition: null,
        compositionGallery: [],
        water: null,
        // A loaded run brings its own rasters and none of the map's state:
        // nothing here is drawn on the map, so nothing here has a switch there.
        showCompositionOverlay: false,
        showWaterOverlay: false,
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
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set())
  /** Scene ids added, per area, in the order they were added. */
  const [added, setAdded] = useState<
    Readonly<Record<string, readonly string[]>>
  >({})
  /**
   * Opacity and visibility for rasters the board added.
   *
   * Board-local, and that is the honest place for it: these are not on the
   * map, so there is no map state for them to share. The current area's base
   * layers keep sharing theirs, which is what stops the two surfaces
   * disagreeing about what is on screen.
   */
  const [extraState, setExtraState] = useState<
    Readonly<Record<string, { opacity: number; visible: boolean }>>
  >({})

  /**
   * Layers dropped to the base of their stack.
   *
   * Board-local for every layer, including the map's own: where a raster sits
   * in this stack is a fact about looking at it here, and the map has no
   * stack to have an opinion about.
   */
  const [flat, setFlat] = useState<ReadonlySet<string>>(() => new Set())
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
  const areas = [
    {
      id: CURRENT_AREA,
      title,
      layers: [
        ...layers.filter(
          (l) => !removed.has(sceneKey(CURRENT_AREA, l.id))
        ),
        ...extrasFor(CURRENT_AREA, 1000),
      ],
    },
    ...assetRuns
      .filter((r) => r.areaId !== CURRENT_AREA)
      .map((r) => ({
        id: r.areaId,
        title: names[stackRow(r.areaId)] ?? r.title,
        layers: extrasFor(r.areaId, 400),
      })),
  ].filter((a) => a.layers.length > 0)

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
   * Where each area was left.
   *
   * A ref rather than state, because nothing renders from it: the scene owns
   * the position while the board is open, and this is the copy that outlives a
   * rebuild -- without it, changing a raster would send an area the user had
   * dragged back to where the layout first put it.
   */
  const placesRef = useRef<Record<string, { x: number; z: number }>>({})
  /** The spread, for the build, which must not depend on it to run again. */
  const gapRef = useRef(STACK_GAP)
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
  const [gap, setGap] = useState(STACK_GAP)

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
  const [activeRow, setActiveRow] = useState<string | null>(null)
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set([stackRow(CURRENT_AREA)])
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


  const [mode, setMode] = useState<OutlinerMode>("scene")
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
        // Read through refs for the same reason `onClose` is: an inline
        // closure here is new on every render and would rebuild the scene.
        onSelect: (_groupId, id) => setActiveRow(id),
        onMove: (groupId, x, z) => {
          placesRef.current = { ...placesRef.current, [groupId]: { x, z } }
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
  gapRef.current = gap
  useEffect(() => {
    boardRef.current?.setGap(gap)
  }, [gap, groups])

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
  useEffect(() => {
    boardRef.current?.setSelected(selectedArea, selected)
  }, [selectedArea, selected, groups])

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

      <BoardSidebar
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
        expanded={expanded}
        gap={gap}
        gapMax={GAP_MAX}
        smooth={smooth}
        onActivate={setActiveRow}
        onToggleExpanded={toggleExpanded}
        onGapChange={setGap}
        onLayerChange={changeLayer}
        onDropRun={dropRun}
        flat={flat}
        onToggleFlat={toggleFlat}
        onSmoothChange={onSmoothChange}
      />

      {/*
        Left, and clear of the top-right corner where the search bar sits.

        The close button appears only where the toggle that opened the board is
        hidden behind it. In the dock layout the toggle sits on the island,
        which stays above this surface and turns it off again -- a second exit
        there would be a second answer. In the sidebar layout the toggle is in
        Leaflet's control stack, which this covers, so without an X the only
        way out would be Escape, a key nobody is told about.
      */}
      <div className="absolute left-[16rem] top-3 flex min-w-0 max-w-[24rem] items-start gap-2">
        <div className="min-w-0">
          <p className="eyebrow !text-foreground">Isolated</p>
          <p className="mt-0.5 truncate text-emphasis text-muted-foreground">
            {title}
          </p>
        </div>
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-raised/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </motion.div>
  )
}
