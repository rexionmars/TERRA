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
  COLLECTION_ROW,
  rowLayerId,
} from "@/components/isolate/BoardSidebar"
import type { RunAsset } from "@/lib/runAssets"
import type { CardGroup } from "@/lib/isolateCards"
import { layoutGroups } from "@/lib/isolateCards"
import { majoritySmoothOverlay } from "@/lib/smoothOverlay"
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
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set())
  const [added, setAdded] = useState<readonly string[]>([])
  /**
   * Opacity and visibility for the assets the board added.
   *
   * Board-local, and that is the honest place for it: these rasters are not on
   * the map, so there is no map state for them to share. The base layers keep
   * sharing theirs, which is what stops the two surfaces disagreeing about
   * what is on screen.
   */
  const [extraState, setExtraState] = useState<
    Readonly<Record<string, { opacity: number; visible: boolean }>>
  >({})

  const baseIds = new Set(layers.map((l) => l.id))
  const extraLayers: RasterLayer[] = added
    // Matched on the id the asset carries IN THE SCENE, not its own. The two
    // differ for the water raster and for the active composition, and those
    // are base layers -- so today they never reach this list. Matching on the
    // scene id anyway means a later asset whose two ids differ cannot slip
    // through as a plane that nothing can find again.
    .map((id) => assets.find((a) => a.sceneId === id))
    .filter((a): a is RunAsset => !!a && !!a.extent && !baseIds.has(a.sceneId))
    .map((a, n) => ({
      id: a.sceneId,
      title: a.title,
      uri: a.previewUri,
      extent: a.extent!,
      opacity: extraState[a.id]?.opacity ?? 1,
      // Above everything the map put there: an asset was added to be looked
      // at, and burying it under the stack it was added to would be a strange
      // reading of the request.
      order: 1000 + n,
      pixelated: a.pixelated,
      // No majority filter: it is the classification's, and these are not it.
      smooth: false,
      visible: extraState[a.id]?.visible ?? true,
    }))

  const stackLayers = [...layers.filter((l) => !removed.has(l.id)), ...extraLayers]
  const extraIds = new Set(extraLayers.map((l) => l.id))
  /** Which assets are planes on the board right now, for the data list. */
  const sceneIds = new Set(stackLayers.map((l) => l.id))

  const changeLayer = (id: string, patch: LayerPatch) => {
    // An added asset answers to this component; a base layer answers to the
    // map, which is where its switch has always lived.
    if (extraIds.has(id)) {
      setExtraState((prev) => ({
        ...prev,
        [id]: {
          opacity: patch.opacity ?? prev[id]?.opacity ?? 1,
          visible: patch.visible ?? prev[id]?.visible ?? true,
        },
      }))
      return
    }
    onLayerChange(id, patch)
  }

  const addToScene = (id: string) => {
    // Putting back one the board had taken out, rather than adding a copy.
    if (baseIds.has(id)) {
      setRemoved((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      return
    }
    setAdded((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  const removeFromScene = (id: string) => {
    if (baseIds.has(id)) {
      setRemoved((prev) => new Set(prev).add(id))
      return
    }
    setAdded((prev) => prev.filter((x) => x !== id))
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
  const appearanceRef = useRef<PlaneState[]>([])
  appearanceRef.current = stackLayers.map((l) => ({
    groupId: CURRENT_AREA,
    id: l.id,
    opacity: l.opacity,
    visible: l.visible,
  }))
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
  const rowIsLive =
    activeRow === COLLECTION_ROW ||
    (!!activeRow && stackLayers.some((l) => l.id === rowLayerId(activeRow)))
  const active = rowIsLive
    ? activeRow
    : (stackLayers[stackLayers.length - 1]?.id ?? null)
  // A modifier's row points at the plane it acts on; the stack's points at no
  // single one.
  const selected = rowLayerId(active)

  /**
   * Which rows are open. The stack starts open, or the tree would present a
   * single collapsed row and the layers would have to be found before they
   * could be used.
   */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set([COLLECTION_ROW])
  )

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
      stackLayers.map(async (l) =>
        l.smooth
          ? { ...l, uri: await majoritySmoothOverlay(l.uri).catch(() => l.uri) }
          : l
      )
    ).then((resolved) => {
      if (cancelled) return
      const next = layoutGroups(
        [
          {
            id: CURRENT_AREA,
            title,
            layers: resolved,
            at: placesRef.current[CURRENT_AREA],
          },
        ],
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
  }, [stackLayers])

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
  useEffect(() => {
    boardRef.current?.setGap(gap)
  }, [gap, groups])

  /*
    The same for what the eye toggles and the opacity sliders change.

    Keyed on the values rather than on the array, which is new on every render
    of the map screen; the layers themselves are read through a ref so that
    identity does not drag the effect along with it.
  */
  const appearanceKey = stackLayers
    .map((l) => `${l.id}:${l.visible ? 1 : 0}:${l.opacity}`)
    .join("|")
  useEffect(() => {
    boardRef.current?.setAppearance(appearanceRef.current)
  }, [appearanceKey, groups])

  // Re-applied when the scene is rebuilt as well as when the selection moves:
  // a fresh scene has no outline shown until it is told which one.
  useEffect(() => {
    boardRef.current?.setSelected(selected ? CURRENT_AREA : null, selected)
  }, [selected, groups])

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
        layers={stackLayers}
        assets={assets}
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
        areaLabel={title}
        activeRow={active}
        expanded={expanded}
        gap={gap}
        gapMax={GAP_MAX}
        smooth={smooth}
        onActivate={setActiveRow}
        onToggleExpanded={toggleExpanded}
        onGapChange={setGap}
        onLayerChange={changeLayer}
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
