/**
 * The board's outliner and the properties of whatever is active in it.
 *
 * Built on the split every editor with a scene arrives at, because the
 * alternative does not survive contact with a second raster: the first version
 * of this column carried a slider on every row and a section for the one
 * filter that happened to exist, so its height and its complexity grew with
 * the number of layers, and a second per-layer property would have doubled it
 * rather than added a line. Four solar products and a composition would have
 * been six sliders in a scroll.
 *
 * Selecting makes the cost of a control independent of how many layers there
 * are. The tree says what is on the board and carries only the toggles that
 * are binary and worth reading at a glance, aligned in a column on the right;
 * everything with a value attached is edited in one panel below, for whichever
 * row is active.
 *
 * The tree is a tree rather than a list because the things on the board are
 * nested: a run holds rasters, and a raster can hold a transform that changes
 * what it draws. The majority filter is exactly that -- a modifier on the
 * classification, with its own toggle in the same column as everything else's,
 * which is what makes a second one a row instead of a new section.
 *
 * Read top to bottom as the stack is seen: the topmost layer is the topmost
 * row.
 */
import { type ReactNode, useRef, useState } from "react"
import {
  AlignVerticalJustifyEnd,
  ChevronDown,
  ChevronRight,
  Download,
  Droplet,
  Eye,
  EyeOff,
  Gauge,
  Grid2x2,
  Image as ImageIcon,
  Layers,
  type LucideIcon,
  Minus,
  Pentagon,
  Plus,
  Sun,
  Trash2,
  Wrench,
  X,
} from "lucide-react"
import { AoiFootprint } from "@/components/AoiFootprint"
import type { GeoJSONGeometry } from "@/lib/types"
import type { RasterLayer } from "@/lib/mapLayers"
import type { AssetRun, RunAsset } from "@/lib/runAssets"
import { exportPng, exportTif } from "@/lib/runAssets"
import { datesByMonth } from "@/lib/runSummary"
import { NumberField } from "@/components/ui/NumberField"
import { cn } from "@/lib/utils"
import { BOARD_LEFT_REM } from "@/lib/boardPartition"

/**
 * What the column is listing.
 *
 * The outliner in the editor this follows has the same switch, and for the
 * same reason: a scene and the data behind it are two different questions, and
 * a column that answered both at once would answer neither at the width it
 * has. "Scene" is what is on the board and can be arranged; "Data" is what the
 * run produced, drawn or not, and what can be exported or dropped.
 */
/*
  Two modes, not three.

  A `tasks` mode held the run controls until the foot took them: one product's
  parameters already filled this column, and with solar and wind still to come
  it would have become a scroll with no end. The band along the foot is wider
  and was carrying a period timeline the board cannot read -- see BoardRunBar.
*/
export type OutlinerMode = "scene" | "data" | "areas"

/**
 * One geometry the board is working on.
 *
 * The tree lists what is DRAWN and the data tab lists what a run PRODUCED;
 * neither answers "which pieces of ground are on this board". An area with no
 * rasters yet appears in neither, and it is the one you are about to run on.
 */
export interface AreaInfo {
  id: string
  title: string
  /** Null where the run stored no shape and the rectangle stands in. */
  hectares: number | null
  vertices: number | null
  /**
   * The shape itself, drawn instead of an icon.
   *
   * A geometry is recognised by its outline, and a row of identical pentagons
   * over names like `run-custom-aoi-20260811-092507` says nothing about which
   * ground is which. Normalised to its own bounds by AoiFootprint, so it
   * carries shape and not size -- which is why the hectares run beside it.
   */
  geometry: GeoJSONGeometry | null
  /** How many of its rasters are on the board. */
  layers: number
  /** The map's own area, as opposed to a run fetched beside it. */
  current: boolean
  /** Drawn / imported catalog entry (can be renamed or removed). */
  saved?: boolean
  /** Catalog id to rename/delete when this row is the active map AOI. */
  catalogId?: string
}


export interface LayerPatch {
  visible?: boolean
  opacity?: number
}

/**
 * The row identifiers that are not a layer's own.
 *
 * Layer ids never contain a double colon -- the only one carrying a colon at
 * all is `solar:<n>` -- so a row id splits back into a layer id unambiguously,
 * and the board can outline the plane a modifier belongs to.
 */
/*
  Row keys.

  Every one names the AREA it belongs to. The board holds more than one, and
  both have a layer called `prediction` -- a key that was the layer alone
  selected two rows at once, and folding one folded the other. The prefixes
  keep the three kinds of row apart from each other and from the data tree's.
*/
export const stackRow = (areaId: string) => `stack::${areaId}`
export const layerRow = (areaId: string, layerId: string) =>
  `layer::${areaId}::${layerId}`
const modifierRow = (areaId: string, layerId: string) =>
  `mod::${areaId}::${layerId}`

/** What a scene row acts on, or null for a row that acts on a whole area. */
export function rowTarget(
  rowId: string | null
): { areaId: string; layerId: string | null } | null {
  if (!rowId) return null
  const [kind, areaId, layerId] = rowId.split("::")
  if (kind === "stack") return { areaId, layerId: null }
  if (kind === "layer" || kind === "mod") return { areaId, layerId }
  return null
}

/*
  The data tree's own keys, kept apart from the scene tree's.

  Both trees share one expansion set and one active-row idea, and both are
  keyed by strings someone else chose -- layer ids, area ids. A prefix is what
  stops a run called `prediction` folding the classification.
*/
const runRowKey = (areaId: string) => `run::${areaId}`
const assetRowKey = (areaId: string, assetId: string) =>
  `asset::${areaId}::${assetId}`
/** An asset's place in the scene, in the key space setAppearance uses. */
export const sceneKey = (areaId: string, sceneId: string) =>
  `${areaId}\u0000${sceneId}`

/**
 * A glyph per kind of raster.
 *
 * With one or two rows a name is enough. With six the eye scans shapes before
 * it reads words, and the icon is what keeps the tree legible at the size this
 * column can reach.
 */
function layerIcon(id: string): LucideIcon {
  if (id.startsWith("solar:")) return Sun
  if (id === "water") return Droplet
  if (id === "composition") return ImageIcon
  if (id === "confidence") return Gauge
  return Grid2x2
}


/**
 * The ground the board is working on.
 *
 * Neither other tab answers this. The tree lists what is DRAWN and the data tab
 * what a run PRODUCED, so an area with no rasters yet -- the one you are about
 * to run on -- appears in neither, and neither offers a shape back.
 *
 * Offering it back is the point: every run stored the polygon it was asked for,
 * so any of them can become the area again without drawing it a second time.
 * A shape redrawn by hand is a DIFFERENT shape, and two runs over two different
 * shapes cannot be compared -- the same reason the compare modal refuses two
 * places.
 */
function AreasPane({
  areas,
  activeRow,
  onActivate,
  onUseArea,
  onRenameSavedAoi,
  onDeleteSavedAoi,
}: {
  areas: AreaInfo[]
  activeRow: string | null
  onActivate: (rowId: string, additive?: boolean) => void
  onUseArea?: (id: string) => void
  onRenameSavedAoi?: (id: string, name: string) => void
  onDeleteSavedAoi?: (id: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState("")

  return (
    <ul
      className="panel-scroll min-h-0 flex-1 overflow-y-auto py-1"
      aria-label="Geometries on the board"
    >
      {areas.length === 0 && (
        <li className="px-2 py-3 text-meta text-muted-foreground">
          No geometry yet. Draw one from the Area group on the band below.
        </li>
      )}
      {areas.map((a) => (
        <li
          key={a.id}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1.5 transition-colors",
            activeRow === stackRow(a.id)
              ? "bg-surface-raised"
              : "hover:bg-surface-raised/40"
          )}
        >
          {a.geometry ? (
            <AoiFootprint
              geometry={a.geometry}
              title={a.title}
              className={cn(
                "size-5 shrink-0",
                a.current ? "text-primary" : "text-muted-foreground"
              )}
            />
          ) : (
            <Pentagon
              className="size-5 shrink-0 text-muted-foreground/50"
              strokeWidth={1.5}
            />
          )}
          {editing === a.id ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                setEditing(null)
                if (a.catalogId) onRenameSavedAoi?.(a.catalogId, draft)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  setEditing(null)
                  if (a.catalogId) onRenameSavedAoi?.(a.catalogId, draft)
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  setEditing(null)
                }
              }}
              className="min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 py-0.5 text-meta text-foreground outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => onActivate(stackRow(a.id))}
              onDoubleClick={() => {
                if (!a.catalogId || !onRenameSavedAoi) return
                setEditing(a.id)
                setDraft(a.title)
              }}
              className="flex min-w-0 flex-1 flex-col text-left"
              title={a.catalogId ? "Double-click to rename" : undefined}
            >
              <span className="truncate text-meta text-foreground">
                {a.title}
              </span>
              <span className="telemetry truncate text-[9px] text-muted-foreground">
                {a.hectares !== null && a.vertices !== null
                  ? `${a.vertices} vertices · ${a.hectares.toFixed(1)} ha`
                  : "shape not stored"}
              </span>
            </button>
          )}
          {onUseArea && !a.current && a.vertices !== null && (
            <button
              type="button"
              onClick={() => onUseArea(a.id)}
              title="Work on this geometry"
              className="shrink-0 rounded-sm px-1.5 py-0.5 text-meta text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              Use
            </button>
          )}
          {a.catalogId && !a.current && onDeleteSavedAoi && (
            <button
              type="button"
              onClick={() => onDeleteSavedAoi(a.catalogId!)}
              title="Remove from catalog"
              className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

interface Row {
  id: string
  /** Which area the row belongs to, and which of its layers where there is one. */
  areaId: string
  layerId: string | null
  title: string
  icon: LucideIcon
  /** Indent level: the stack at 0, its rasters at 1, their modifiers at 2. */
  depth: number
  /**
   * Position among siblings, one-based, and how many there are.
   *
   * The tree is flattened -- rows are siblings in the DOM whatever their depth
   * -- so nothing in the markup says how many children a row has. Without
   * these a screen reader can place a row at a level but not within it, and
   * announces no count at all.
   */
  posinset: number
  setsize: number
  /** What the eye in the right-hand column reads and sets. */
  visible: boolean
  toggle: () => void
  /** Present only where there is something under the row. */
  expandable: boolean
  /** Greyed, for a row whose own layer is hidden. */
  dimmed: boolean
  /**
   * Whether the row's name is the user's to set.
   *
   * The stack and its planes, not a modifier: a modifier's name IS what it
   * does, and one called something else is a row that no longer says which
   * transform it is. The others are names for things, and a thing on a board
   * that will hold two areas at once needs a name that says which.
   */
  renamable: boolean
  /**
   * The id to take out of the stack, for rows that are a plane.
   *
   * Beside the eye rather than only in the data list: hiding and removing are
   * the two things you do to something in a scene, and sending one of them to
   * another tab means changing tabs to undo what you just looked at.
   */
  removeId: string | null
}

export function BoardSidebar({
  areas,
  assetRuns,
  sceneIds,
  areaId,
  addRun,
  mode,
  areaInfo = [],
  onUseArea,
  onRenameSavedAoi,
  onDeleteSavedAoi,
  activeRow,
  selection,
  activeAsset,
  expanded,
  gap,
  gapMax,
  smooth,
  onModeChange,
  onActivate,
  onActivateAsset,
  onAddToScene,
  onRemoveFromScene,
  names,
  onRename,
  onDropRun,
  flat,
  onToggleFlat,
  onReorder,
  links,
  onLinksChange,
  canLink,
  labels,
  onLabelsChange,
  onToggleExpanded,
  onGapChange,
  onLayerChange,
  onSmoothChange,
  onSelectComposition,
  onRemoveComposition,
}: {
  /**
   * The areas on the board, each with its own stack, bottom first.
   *
   * More than one is the point of the surface: a map cannot show two analyses
   * of areas hundreds of kilometres apart side by side, because it puts them
   * where they are.
   */
  areas: { id: string; title: string; layers: RasterLayer[] }[]
  /**
   * The runs whose output can be put on the board, each with its own assets.
   *
   * A tree rather than a list, because the board holds more than one run and
   * two runs each have an asset called `prediction`: a flat list would put
   * them side by side with nothing saying which came from where.
   */
  assetRuns: AssetRun[]
  /**
   * Which assets are planes on the board right now.
   *
   * Not the same as an asset being DRAWN. The eye hides a plane that is still
   * in the stack; this is whether it is in the stack at all, which is the
   * distinction the data list exists to let someone change.
   */
  sceneIds: ReadonlySet<string>
  /**
   * Both take the area and the id the asset carries in the scene.
   *
   * The area is part of it because two runs each produce a `prediction`, and
   * an instruction naming only the layer would be an instruction about both.
   */
  onAddToScene: (areaId: string, sceneId: string) => void
  onRemoveFromScene: (areaId: string, sceneId: string) => void
  /**
   * Names the board has been given, over the ones the products carry.
   *
   * Keyed by row id, and absent for a row that has not been renamed -- so a
   * product whose own title changes is still followed until someone has said
   * otherwise, and clearing a name gives that back rather than leaving a row
   * with no name at all.
   */
  names: Readonly<Record<string, string>>
  onRename: (rowId: string, name: string) => void
  /**
   * Take a loaded run off the data tree.
   *
   * Absent for the run the board opened from: that one is not a thing the
   * board fetched, and dropping it would mean closing the board.
   */
  onDropRun?: (runId: string) => void
  /**
   * Layers dropped to the base of their stack, by scene key.
   *
   * The base layer of an area is never in it: it IS the level, so there is
   * nothing for it to descend to.
   */
  flat: ReadonlySet<string>
  onToggleFlat: (areaId: string, layerId: string) => void
  /**
   * A new stack order for one area, given TOP FIRST -- as the tree reads.
   *
   * The tree is the only place the order is visible, so it is the place to
   * change it; and it lists an area from the top down, so that is the order it
   * hands back rather than making the caller reverse what it just showed.
   */
  onReorder: (areaId: string, layerIdsTopFirst: string[]) => void
  /** Lines joining each area's rasters to one another. */
  links: boolean
  onLinksChange: (v: boolean) => void
  /** False until some area holds more than one raster. */
  canLink: boolean
  /** Each raster's name, shown over it on the board. */
  labels: boolean
  onLabelsChange: (v: boolean) => void
  mode: OutlinerMode
  /** The geometries on the board, for the Areas tab. */
  areaInfo?: AreaInfo[]
  /**
   * Takes a geometry already on the board as the area to work on.
   *
   * The point of the tab. A run stored the shape it was asked for, so the
   * ground of any run beside this one can be worked on again without drawing
   * it a second time -- and a shape redrawn by hand is a different shape,
   * which makes the two runs incomparable for the reason the compare modal
   * refuses two places.
   */
  onUseArea?: (id: string) => void
  onRenameSavedAoi?: (id: string, name: string) => void
  onDeleteSavedAoi?: (id: string) => void
  /** The asset the panel is describing, in data mode. */
  activeAsset: string | null
  onModeChange: (m: OutlinerMode) => void
  onActivateAsset: (id: string) => void
  /** Switches the board to a composition from the gallery. */
  onSelectComposition?: (id: string) => void
  onRemoveComposition?: (id: string) => void
  /**
   * The area the map's own run occupies.
   *
   * Named because it is the only one whose layers answer to the map: its
   * classification carries the majority filter, and it cannot be dropped --
   * closing the board is what dropping it would mean.
   */
  areaId: string
  /**
   * The control that puts another run's output on the board.
   *
   * Passed in rather than built here, because choosing a run needs the saved
   * runs and the projects they belong to -- neither of which this column has
   * any other use for, and both of which would have to be threaded through it
   * to reach a picker it merely contains.
   */
  addRun?: ReactNode
  /** The row the panel below is editing, and the last one chosen. */
  activeRow: string | null
  /**
   * Every chosen row, in the order it was chosen.
   *
   * Shown as an order rather than as a set: the number beside a row is its
   * place in the path the board draws, and a highlight alone would say which
   * rows were picked without saying in what order -- which is the only thing
   * the path is for.
   */
  selection: string[]
  expanded: ReadonlySet<string>
  gap: number
  gapMax: number
  /** The map's majority filter, which decides where a class boundary falls. */
  smooth: boolean
  /** Additive where the modifier was held: shift builds an order. */
  onActivate: (rowId: string, additive?: boolean) => void
  onToggleExpanded: (rowId: string) => void
  onGapChange: (v: number) => void
  onLayerChange: (areaId: string, id: string, patch: LayerPatch) => void
  onSmoothChange: (v: boolean) => void
}) {
  /*
    Every row the scene tree has, open or not, for every area on the board.

    What is DRAWN is filtered from this below; the properties panel reads from
    the full set, because collapsing a parent hides a row without stopping it
    being the active one -- and a panel that emptied when an area was folded
    would lose the thing being edited to a gesture about layout.
  */
  const allRows: Row[] = []
  for (const area of areas) {
    // Topmost first, so each area reads in the order the eye meets its planes.
    const stack = [...area.layers].reverse()
    const allVisible =
      area.layers.length > 0 && area.layers.every((l) => l.visible)
    allRows.push({
      id: stackRow(area.id),
      areaId: area.id,
      layerId: null,
      title: names[stackRow(area.id)] ?? area.title,
      icon: Layers,
      depth: 0,
      visible: allVisible,
      /*
        Sets every layer to one state rather than inverting each. Inverting
        would turn a mixed stack inside out, which is not what pressing the
        parent's eye means anywhere it exists.
      */
      toggle: () =>
        area.layers.forEach((l) =>
          onLayerChange(area.id, l.id, { visible: !allVisible })
        ),
      expandable: true,
      dimmed: false,
      renamable: true,
      /*
        No remove on an area's own row. An area exists because rasters are on
        it, so it is ended by taking the last one off -- and the run behind it
        is dropped from the data tree, where the control says what it drops.
        A second way to make an area vanish would be a second answer.
      */
      removeId: null,
      posinset: areas.indexOf(area) + 1,
      setsize: areas.length,
    })

    for (const l of stack) {
      // Only the current run's classification carries a transform: the
      // majority filter is the map's switch, and a loaded run does not answer
      // to the map.
      const hasModifier = area.id === areaId && l.id === "prediction"
      allRows.push({
        id: layerRow(area.id, l.id),
        areaId: area.id,
        layerId: l.id,
        title: names[layerRow(area.id, l.id)] ?? l.title,
        icon: layerIcon(l.id),
        depth: 1,
        visible: l.visible,
        toggle: () => onLayerChange(area.id, l.id, { visible: !l.visible }),
        expandable: hasModifier,
        dimmed: !l.visible,
        renamable: true,
        removeId: l.id,
        posinset: stack.indexOf(l) + 1,
        setsize: stack.length,
      })
      if (hasModifier) {
        allRows.push({
          id: modifierRow(area.id, l.id),
          areaId: area.id,
          layerId: l.id,
          title: "Majority filter",
          icon: Wrench,
          depth: 2,
          visible: smooth,
          toggle: () => onSmoothChange(!smooth),
          expandable: false,
          dimmed: !l.visible,
          renamable: false,
          // A transform is not a plane; it leaves with the raster it acts on.
          removeId: null,
          posinset: 1,
          setsize: 1,
        })
      }
    }
  }

  // Shown only where every ancestor is open. Depth is enough to decide it,
  // because a row's parent is the nearest shallower row above it.
  const rows = allRows.filter((r) => {
    if (r.depth === 0) return true
    if (!expanded.has(stackRow(r.areaId))) return false
    return r.depth === 1 || expanded.has(layerRow(r.areaId, r.layerId!))
  })

  const active = allRows.find((r) => r.id === activeRow) ?? null
  const activeTarget = rowTarget(activeRow)
  /*
    Whether the active layer is the bottom of its own stack. Null where no
    layer is active, which is a different thing from "it is not the base".
  */
  const activeArea = areas.find((a) => a.id === activeTarget?.areaId) ?? null
  const activeIsBase = activeTarget?.layerId
    ? activeArea?.layers[0]?.id === activeTarget.layerId
    : null
  const isFlat = !!(
    activeTarget?.layerId &&
    flat.has(sceneKey(activeTarget.areaId, activeTarget.layerId))
  )
  const activeLayer =
    (activeTarget?.layerId
      ? areas
          .find((a) => a.id === activeTarget.areaId)
          ?.layers.find((l) => l.id === activeTarget.layerId)
      : null) ?? null

  /*
    The data tree, flattened: a run, then its assets. Same shape as the scene
    tree above and for the same reason -- one array is what arrow keys walk and
    what a roving tabindex indexes into.
  */
  interface AssetRow {
    key: string
    run: AssetRun
    asset: RunAsset | null
  }
  const assetRows: AssetRow[] = []
  for (const r of assetRuns) {
    assetRows.push({ key: runRowKey(r.areaId), run: r, asset: null })
    if (!expanded.has(runRowKey(r.areaId))) continue
    for (const a of r.assets) {
      assetRows.push({ key: assetRowKey(r.areaId, a.id), run: r, asset: a })
    }
  }
  /*
    Every asset row of every run, open or not, for the panel below -- collapsing
    a run must not empty the panel that is describing one of its assets, for the
    same reason folding the stack must not.
  */
  const allAssetRows: AssetRow[] = assetRuns.flatMap((r) =>
    r.assets.map((a) => ({ key: assetRowKey(r.areaId, a.id), run: r, asset: a }))
  )
  const activeAssetRow =
    allAssetRows.find((x) => x.key === activeAsset) ?? allAssetRows[0] ?? null
  const asset = activeAssetRow?.asset ?? null

  const rowRefs = useRef(new Map<string, HTMLElement>())

  /*
    Reordering by dragging a row.

    The transient part is a ref and only the insertion mark is state: a drag
    reports every pixel, and re-rendering a tree on each of them to move a line
    two pixels is work for nothing.

    A threshold separates it from a click, because the same press does both --
    below it the row is being selected, above it the stack is being reordered.
  */
  const DRAG_SLOP_PX = 4
  const dragRef = useRef<{
    areaId: string
    layerId: string
    startY: number
    moved: boolean
  } | null>(null)
  const [dropAt, setDropAt] = useState<{ areaId: string; index: number } | null>(
    null
  )

  /** The area's layer rows, top first, as the tree lists them. */
  const layerRowsOf = (areaId: string) =>
    allRows.filter((r) => r.areaId === areaId && r.depth === 1)

  /**
   * Where a pointer at this height would insert, in the area's tree order.
   *
   * Measured against each row's midpoint rather than its edges, so the mark
   * follows the pointer without the row it is over having to be left first.
   */
  const insertionAt = (areaId: string, clientY: number) => {
    const rows = layerRowsOf(areaId)
    for (const [i, r] of rows.entries()) {
      const el = rowRefs.current.get(r.id)
      if (!el) continue
      const box = el.getBoundingClientRect()
      if (clientY < box.top + box.height / 2) return i
    }
    return rows.length
  }

  const beginRowDrag = (e: React.PointerEvent, row: Row) => {
    if (e.button !== 0 || row.depth !== 1 || !row.layerId) return
    /*
      Not when the press landed on a control inside the row.

      setPointerCapture on the row retargets every later pointer event to the
      row, including the pointerup -- so the button under the finger never
      completes its click. Capturing indiscriminately stopped the eye, the
      minus and the rename field from working at all, which is a high price
      for a gesture the row can still offer from its own surface.
    */
    if ((e.target as HTMLElement).closest("button, input, [role='button']")) {
      return
    }
    dragRef.current = {
      areaId: row.areaId,
      layerId: row.layerId,
      startY: e.clientY,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const moveRowDrag = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (!d.moved && Math.abs(e.clientY - d.startY) < DRAG_SLOP_PX) return
    d.moved = true
    setDropAt({ areaId: d.areaId, index: insertionAt(d.areaId, e.clientY) })
  }

  const endRowDrag = (e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    setDropAt(null)
    if (!d) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d.moved) return
    const ids = layerRowsOf(d.areaId).map((r) => r.layerId!)
    const from = ids.indexOf(d.layerId)
    let to = insertionAt(d.areaId, e.clientY)
    // The mark sits between rows, so an item moving DOWN passes its own slot
    // and the index it was counted in has to come back off.
    if (to > from) to -= 1
    if (from < 0 || to === from) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    onReorder(d.areaId, ids)
  }

  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState("")

  const commitName = (rowId: string) => {
    setEditing(null)
    onRename(rowId, draft)
    // Focus returns to the row, or the next arrow press would start from
    // whatever the browser fell back to when the field went away.
    rowRefs.current.get(rowId)?.focus()
  }

  /**
   * The tree's keys, as they behave in one: up and down walk the rows that are
   * showing, right opens a row, left closes it or steps to the parent.
   *
   * Paired with a roving tabindex, so tabbing past this column is one stop
   * rather than one per raster -- the same reason the sliders left the rows.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = rows.findIndex((r) => r.id === activeRow)
    if (i < 0) return
    const row = rows[i]
    const go = (to: Row | undefined) => {
      if (!to) return
      e.preventDefault()
      onActivate(to.id)
      // Focus follows, or the next press would resume from the row the browser
      // still considers focused.
      rowRefs.current.get(to.id)?.focus()
    }
    // The other way every tree of this shape offers a rename.
    if (e.key === "F2" && row.renamable) {
      e.preventDefault()
      setEditing(row.id)
      setDraft(row.title)
      return
    }
    if (e.key === "ArrowDown") return go(rows[i + 1])
    if (e.key === "ArrowUp") return go(rows[i - 1])
    if (e.key === "ArrowRight") {
      if (row.expandable && !expanded.has(row.id)) {
        e.preventDefault()
        onToggleExpanded(row.id)
      } else go(rows[i + 1])
      return
    }
    if (e.key === "ArrowLeft") {
      if (row.expandable && expanded.has(row.id)) {
        e.preventDefault()
        onToggleExpanded(row.id)
      } else {
        // The nearest row above that is shallower: this row's parent.
        for (let j = i - 1; j >= 0; j--) {
          if (rows[j].depth < row.depth) return go(rows[j])
        }
      }
    }
  }

  return (
    <div
      /*
        All the way down. It used to stop at the foot's reservation because the
        workspace island and the period track stood in that band on the left,
        and a column running under them was a column with its last rows hidden.
        Neither is there any more -- the island is withheld while the board is
        up, and the run band starts where this column ends rather than passing
        beneath it -- so the last rows are reachable and the two surfaces meet
        edge to edge instead of one crossing the other.
      */
      className="app-no-drag absolute bottom-0 left-0 top-0 z-[10] flex flex-col border-r"
      style={{
        /*
          Width from the partition. It was a literal here while the foot bands
          recessed by a constant declared elsewhere, which is the pairing that
          let the two drift apart.
        */
        width: `${BOARD_LEFT_REM}rem`,
        /*
          The board's own ink, not --p-surface: that token is a warm, lighter
          plate meant to sit above the background, and against a board painted
          in ink it read as a brown panel laid over a black one.

          Flat ink is not invisible here, because the surface beside it is not
          flat: the board draws a grid, and a region without one reads as a
          panel. The border does the rest.

          Not `.panel` either -- that rule carries a backdrop blur, and blurring
          a live WebGL canvas behind a full-height column is a composite this
          webview pays for on every frame.
        */
        background: "rgb(var(--p-ink))",
        borderColor: "rgb(var(--p-line) / 0.28)",
      }}
    >
      <div
        className="flex items-center justify-between gap-2 border-b px-2 py-1.5"
        style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
      >
        {/*
          Two buttons rather than a dropdown. There are exactly two modes and
          both fit; a menu would hide one of them behind a click and make the
          column's own state something you have to open something to read.
        */}
        <div
          role="tablist"
          aria-label="What the outliner lists"
          className="flex gap-0.5"
        >
          {(
            [
              ["scene", "Scene", Layers],
              ["data", "Data", ImageIcon],
              ["areas", "Areas", Pentagon],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => onModeChange(id)}
              className={cn(
                "flex items-center gap-1 rounded-sm px-1.5 py-1 text-meta transition-colors",
                "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
                mode === id
                  ? "bg-surface-raised text-foreground"
                  : "text-muted-foreground hover:bg-surface-raised/40"
              )}
            >
              <Icon className="size-3" strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </div>
        <span className="telemetry shrink-0 text-meta text-muted-foreground">
          {mode === "scene"
            ? allRows.some((r) => r.depth === 1)
              ? `${allRows.filter((r) => r.depth === 1 && r.visible).length}/${allRows.filter((r) => r.depth === 1).length}`
              : null
            : mode === "data"
              ? allAssetRows.length || null
              : areaInfo.length || null}
        </span>
      </div>

      {/*
        The tree takes the height that is left and the panels keep the foot, so
        the space that grows is the space rasters are added to.
      */}
      {/*
        Three panes, chosen exhaustively. This was `scene ? tree : data`, so a
        third mode fell into the data tree -- the Areas tab listed every run's
        rasters, which is what the tab beside it is for.
      */}
      {mode === "areas" ? (
        <AreasPane
          areas={areaInfo}
          activeRow={activeRow}
          onActivate={onActivate}
          onUseArea={onUseArea}
          onRenameSavedAoi={onRenameSavedAoi}
          onDeleteSavedAoi={onDeleteSavedAoi}
        />
      ) : mode === "scene" ? (
        <div
          role="tree"
          aria-label="Layers on the board"
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {rows.map((row) => {
            const order = selection.indexOf(row.id)
            const isActive = row.id === activeRow || order >= 0
            const isOpen = expanded.has(row.id)
            return (
              <div
                key={row.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(row.id, el)
                  else rowRefs.current.delete(row.id)
                }}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-posinset={row.posinset}
                aria-setsize={row.setsize}
                aria-selected={isActive}
                aria-expanded={row.expandable ? isOpen : undefined}
                tabIndex={isActive ? 0 : -1}
                onPointerDown={(e) => beginRowDrag(e, row)}
                onPointerMove={moveRowDrag}
                onPointerUp={endRowDrag}
                onPointerCancel={() => {
                  dragRef.current = null
                  setDropAt(null)
                }}
                onClick={(e) => {
                  // A press that travelled was a reorder, not a choice.
                  if (dragRef.current?.moved) return
                  onActivate(row.id, e.shiftKey)
                }}
                onKeyDown={(e) => {
                  /*
                    Only when the row itself has focus. A press on the eye bubbles
                    to here, and calling preventDefault on it would cancel the
                    button's own activation -- so Space on the eye would select
                    the row instead of toggling the layer.
                  */
                  if (e.target !== e.currentTarget) return
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onActivate(row.id, e.shiftKey)
                  }
                }}
                className={cn(
                  "relative flex cursor-default select-none items-center gap-1.5 py-[3px] pr-2 transition-colors",
                  "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
                  isActive ? "bg-surface-raised" : "hover:bg-surface-raised/40",
                  row.dimmed && !isActive && "opacity-50",
                  /*
                    Where the row would land. Drawn on the row the mark sits
                    ABOVE, and on the last row's underside for the end of the
                    list, which has no row after it to draw on.
                  */
                  dropAt?.areaId === row.areaId &&
                    row.depth === 1 &&
                    dropAt.index === layerRowsOf(row.areaId).indexOf(row) &&
                    "before:absolute before:inset-x-1 before:top-0 before:h-px before:bg-accent",
                  dropAt?.areaId === row.areaId &&
                    row.depth === 1 &&
                    dropAt.index === layerRowsOf(row.areaId).length &&
                    layerRowsOf(row.areaId).at(-1) === row &&
                    "after:absolute after:inset-x-1 after:bottom-0 after:h-px after:bg-accent"
                )}
                // Indent by depth, from a fixed gutter. Inline because the depth
                // is data: a Tailwind class per level would be a class per level.
                style={{ paddingLeft: `${0.375 + row.depth * 0.75}rem` }}
              >
                {/*
                  The disclosure keeps its width on every row, expandable or not,
                  so the icons and names below a parent line up with each other
                  instead of stepping in and out with the shape of the tree.
                */}
                {row.expandable ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleExpanded(row.id)
                    }}
                    tabIndex={-1}
                    aria-hidden
                    className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {isOpen ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                  </button>
                ) : (
                  <span className="size-3 shrink-0" />
                )}

                <row.icon
                  className={cn(
                    "size-3.5 shrink-0",
                    isActive ? "text-accent" : "text-muted-foreground"
                  )}
                  strokeWidth={1.75}
                />

                {editing === row.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={() => commitName(row.id)}
                    onKeyDown={(e) => {
                      /*
                        Stopped here, all of it. The tree walks on the arrow
                        keys and the board closes on Escape from a listener on
                        the window -- typing a name would otherwise move the
                        selection out from under the field, and abandoning the
                        edit would leave the board.
                      */
                      e.stopPropagation()
                      if (e.key === "Enter") commitName(row.id)
                      else if (e.key === "Escape") setEditing(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="min-w-0 flex-1 rounded-sm border-0 bg-surface-raised px-1 text-emphasis text-foreground outline-none inset-ring-1 inset-ring-ring"
                  />
                ) : (
                  <span
                    onDoubleClick={() => {
                      if (!row.renamable) return
                      setEditing(row.id)
                      setDraft(row.title)
                    }}
                    title={row.renamable ? "Double-click to rename" : undefined}
                    className={cn(
                      "min-w-0 flex-1 truncate text-emphasis",
                      isActive ? "text-accent" : "text-muted-foreground"
                    )}
                  >
                    {row.title}
                  </span>
                )}

                {/*
                  Right-aligned, so the toggles form a column that stays readable
                  however long the names get and however deep the tree goes.
                  Toggling does not activate the row: hiding something is a
                  glance at the stack, not a decision to start editing it.
                */}
                {/*
                  Its place in the path, where there is one. A number rather
                  than a brighter highlight, because the order is the thing
                  being read and a highlight cannot count.
                */}
                {order >= 0 && selection.length > 1 && (
                  <span
                    className="telemetry shrink-0 rounded-[2px] px-1 text-[9px] text-accent"
                    style={{ background: "rgb(var(--p-accent) / 0.15)" }}
                    title={`${order + 1} of ${selection.length} in the path`}
                  >
                    {order + 1}
                  </span>
                )}
                {/*
                  Left of the eye, so the eyes stay in one column down the
                  whole tree whether or not a row can be removed.
                */}
                {row.removeId && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveFromScene(row.areaId, row.removeId!)
                    }}
                    tabIndex={-1}
                    aria-label={`Remove ${row.title} from the board`}
                    title="Remove from the board"
                    className="shrink-0 rounded-sm text-muted-foreground/50 transition-colors hover:text-foreground"
                  >
                    <Minus className="size-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    row.toggle()
                  }}
                  // Roving with the row, so the toggles are two tab stops for
                  // the whole tree rather than one per raster -- and so the eye
                  // does not become mouse-only, which it was when every one of
                  // them carried tabIndex -1.
                  tabIndex={isActive ? 0 : -1}
                  aria-pressed={row.visible}
                  aria-label={`${row.visible ? "Hide" : "Show"} ${row.title}`}
                  title={row.visible ? "Hide" : "Show"}
                  className={cn(
                    "shrink-0 transition-colors hover:text-foreground",
                    row.visible ? "text-muted-foreground" : "text-muted-foreground/50"
                  )}
                >
                  {row.visible ? (
                    <Eye className="size-3.5" />
                  ) : (
                    <EyeOff className="size-3.5" />
                  )}
                </button>
              </div>
            )
          })}

          {!rows.length && (
            <p className="px-3 py-1 text-meta leading-relaxed text-muted-foreground">
              Nothing to draw. Run a product and its raster appears here.
            </p>
          )}
        </div>
      ) : (
        /*
          What the run produced, drawn or not. The same set the overlay tools
          panel lists as cards; here as rows, because a 15rem column cannot
          hold a 64 px thumbnail, a description and two export buttons per
          asset and still be read at a glance. The description and the actions
          are in the panel below, for whichever row is active -- the same split
          the scene mode uses, for the same reason.
        */
        <div
          role="tree"
          aria-label="Rasters these runs produced"
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {assetRows.map((row) => {
            const isActive = row.asset
              ? row.key === activeAssetRow?.key
              : false
            const isOpen = expanded.has(row.key)
            if (!row.asset) {
              // In use: at least one of this run's rasters is a plane.
              const inUse = row.run.assets.some((a) =>
                sceneIds.has(sceneKey(row.run.areaId, a.sceneId))
              )
              /*
                A run: what produced the rasters under it. Named with the
                period it covers, because two runs of one area differ by when
                they looked rather than by where.
              */
              return (
                <div
                  key={row.key}
                  role="treeitem"
                  aria-level={1}
                  aria-expanded={isOpen}
                  tabIndex={-1}
                  onClick={() => onToggleExpanded(row.key)}
                  className="flex cursor-default select-none items-center gap-1.5 py-[3px] pl-1.5 pr-2 transition-colors hover:bg-surface-raised/40"
                >
                  {isOpen ? (
                    <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <Layers
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                  <span className="min-w-0 flex-1 truncate text-emphasis text-foreground">
                    {row.run.title}
                  </span>
                  <span
                    className="telemetry shrink-0 text-meta text-muted-foreground"
                    title={row.run.period}
                  >
                    {datesByMonth(row.run.period)}
                  </span>
                  {/*
                    Only a run the board fetched, and only while none of its
                    rasters is on the board.

                    Refused rather than hidden while it is in use, with the
                    reason on the control: dropping it then would take planes
                    off the board through something that says nothing about
                    them, and the user would be left looking for what had
                    gone. Taking its last raster off is what makes it go.
                  */}
                  {onDropRun && row.run.areaId !== areaId && (
                    <button
                      type="button"
                      disabled={inUse}
                      onClick={(e) => {
                        e.stopPropagation()
                        onDropRun(row.run.runId)
                      }}
                      tabIndex={-1}
                      aria-label={`Drop ${row.run.title}`}
                      title={
                        inUse
                          ? "On the board: remove its rasters first"
                          : "Drop this run"
                      }
                      className={cn(
                        "shrink-0 rounded-sm transition-colors",
                        inUse
                          ? "cursor-not-allowed text-muted-foreground/25"
                          : "text-muted-foreground/50 hover:text-foreground"
                      )}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              )
            }
            const a = row.asset
            return (
              <div
                key={row.key}
                role="treeitem"
                aria-level={2}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => onActivateAsset(row.key)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onActivateAsset(row.key)
                  }
                }}
                className={cn(
                  "flex cursor-default select-none items-center gap-2 py-[3px] pl-6 pr-2 transition-colors",
                  "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
                  isActive ? "bg-surface-raised" : "hover:bg-surface-raised/40"
                )}
              >
                {/*
                  A thumbnail rather than a type glyph: assets differ by what
                  they show, not by what kind they are, and four of them are
                  the same kind. Class rasters keep their hard edges here too
                  -- a smoothed thumbnail of a classification shows colours
                  between classes that no class has.
                */}
                <img
                  src={a.previewUri}
                  alt=""
                  className={cn(
                    "size-5 shrink-0 rounded-[2px] object-cover",
                    a.pixelated && "overlay-thumb-crisp"
                  )}
                  style={{ border: "1px solid rgb(var(--p-line) / 0.3)" }}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-emphasis",
                    isActive ? "text-accent" : "text-muted-foreground"
                  )}
                >
                  {a.title}
                </span>
                <SceneToggle
                  inScene={sceneIds.has(sceneKey(row.run.areaId, a.sceneId))}
                  placeable={!!a.extent}
                  title={a.title}
                  onAdd={() => onAddToScene(row.run.areaId, a.sceneId)}
                  onRemove={() => onRemoveFromScene(row.run.areaId, a.sceneId)}
                />
              </div>
            )
          })}

          {!allAssetRows.length && (
            <p className="px-3 py-1 text-meta leading-relaxed text-muted-foreground">
              Nothing produced yet. Classify, map surface water, or apply a
              composition.
            </p>
          )}
        </div>
      )}

      {/*
        Under the branches and OUTSIDE the scroller.

        Inside it, the control scrolled away with the list it adds to, and the
        list it opens had to escape a clip its own container imposed. Out here
        it is pinned to the foot of the tree and its list is placed against
        the column, which is the thing it should be measured from anyway.
      */}
      {mode === "data" && <div className="shrink-0">{addRun}</div>}

      {/*
        The properties of whatever is active. One panel however many layers
        there are, and the place a new per-layer property goes.
      */}
      {mode === "scene" && active && (
        <div
          className="shrink-0 border-t px-3 py-2.5"
          style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
        >
          <p className="eyebrow !text-[9px] flex items-center gap-1.5">
            <active.icon className="size-3 shrink-0" strokeWidth={2} />
            <span className="truncate">{active.title}</span>
          </p>

          {activeLayer && activeTarget?.layerId === activeLayer.id ? (
            <>
              <div className="mt-2">
                <NumberField
                  label="Opacity"
                  value={activeLayer.opacity}
                  min={0}
                  max={1}
                  step={0.05}
                  // Stored as a fraction, read as a percentage: the panel
                  // speaks the unit the rest of the application prints.
                  format={(v) => `${Math.round(v * 100)}%`}
                  parse={(t) => {
                    const v = parseFloat(t.replace("%", "").trim())
                    return Number.isFinite(v) ? v / 100 : null
                  }}
                  onChange={(v) =>
                    onLayerChange(activeTarget!.areaId, activeLayer.id, {
                      opacity: v,
                    })
                  }
                />
              </div>
              {/*
                Only where there is a level below to descend to.

                The stack separates layers along Y so orbiting pulls them
                apart, which is what makes the draw order visible. That
                separation is in the way when the question is not "what is the
                order" but "does this line up with that": from overhead a layer
                one step up reads as floating over the base rather than lying
                on it. The base layer itself is the level, so it is offered
                nothing.
              */}
              {activeIsBase === false && activeTarget && (
                <button
                  type="button"
                  onClick={() =>
                    onToggleFlat(activeTarget.areaId, activeLayer.id)
                  }
                  aria-pressed={isFlat}
                  className={cn(
                    "mt-2 flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-meta transition-colors",
                    "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
                    isFlat
                      ? "bg-surface-raised text-foreground"
                      : "bg-surface-raised/40 text-muted-foreground hover:bg-surface-raised/70 hover:text-foreground"
                  )}
                  title={
                    isFlat
                      ? "Return it to its own height in the stack"
                      : "Lay it at the base layer's level"
                  }
                >
                  <AlignVerticalJustifyEnd
                    className="size-3 shrink-0"
                    strokeWidth={1.75}
                  />
                  {isFlat ? "At base level" : "Drop to base level"}
                </button>
              )}

              {/*
                Not a control. Class rasters are drawn without interpolation
                because a bilinear sample between two classes is a colour that
                belongs to neither, and the legend stops matching the pixels --
                the same rule as .overlay-crisp. Stated because it is the
                reason one raster looks blocky beside another.
              */}
              <p className="mt-2 flex items-baseline justify-between text-meta text-muted-foreground">
                Sampling
                <span className="telemetry">
                  {activeLayer.pixelated ? "Nearest" : "Linear"}
                </span>
              </p>
            </>
          ) : activeTarget && !activeTarget.layerId ? (
            <p className="mt-1.5 text-meta leading-relaxed text-muted-foreground">
              {areas.find((a) => a.id === activeTarget.areaId)?.layers.length ??
                0}{" "}
              rasters from one run, stacked in draw order.
            </p>
          ) : (
            <p className="mt-1.5 text-meta leading-relaxed text-muted-foreground">
              Replaces each class with the most frequent one in its
              neighbourhood, moving where a class boundary falls. Applied on the
              map and here alike.
            </p>
          )}
        </div>
      )}

      {/*
        What the selected asset is, and what can be done with it.

        The actions that were on every card in the overlay tools panel --
        export, show, drop -- appear once, for the active row. A column this
        narrow cannot carry four buttons per asset, and it does not have to:
        they act on one thing at a time anyway.
      */}
      {mode === "data" && asset && (
        <div
          className="shrink-0 border-t px-3 py-2.5"
          style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
        >
          <p className="eyebrow !text-[9px] truncate">{asset.title}</p>
          <p className="telemetry mt-1 text-meta leading-snug text-muted-foreground">
            {asset.params}
          </p>

          <div className="mt-2 flex flex-wrap gap-1">
            {/*
              The same act as the row's control, spelled out. A row is read at
              a glance and a panel is read deliberately, and the one place
              someone looks for what can be DONE with a thing is the panel.
            */}
            {asset.extent &&
              activeAssetRow &&
              (sceneIds.has(
                sceneKey(activeAssetRow.run.areaId, asset.sceneId)
              ) ? (
                <AssetAction
                  icon={Minus}
                  label="Remove"
                  onClick={() =>
                    onRemoveFromScene(activeAssetRow.run.areaId, asset.sceneId)
                  }
                />
              ) : (
                <AssetAction
                  icon={Plus}
                  label="Add"
                  onClick={() =>
                    onAddToScene(activeAssetRow.run.areaId, asset.sceneId)
                  }
                />
              ))}
            {asset.selectId && onSelectComposition && (
              <AssetAction
                icon={Eye}
                label={asset.onBoard ? "On board" : "Show"}
                disabled={asset.onBoard}
                onClick={() => onSelectComposition(asset.selectId!)}
              />
            )}
            <AssetAction
              icon={Download}
              label="PNG"
              onClick={() => void exportPng(asset)}
            />
            {asset.exportTif && (
              <AssetAction
                icon={Download}
                label="GeoTIFF"
                onClick={() => void exportTif(asset)}
              />
            )}
            {asset.removeId && onRemoveComposition && (
              <AssetAction
                icon={Trash2}
                label="Drop"
                onClick={() => onRemoveComposition(asset.removeId!)}
              />
            )}
          </div>
        </div>
      )}

      {/*
        Separation belongs to the view rather than to any one thing in the
        tree, so it stays out of the panel that edits one and stays visible
        whatever is active.
      */}
      {mode === "scene" && allRows.filter((r) => r.depth === 1).length > 1 && (
        <div
          className="shrink-0 border-t px-3 py-2.5"
          style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
        >
          <p className="eyebrow !text-[9px]">View</p>
          {/*
            A property of the view rather than of any area, so it sits with the
            spread. Offered only with something to join: a single raster has
            nothing to belong to.
          */}
          {/*
            Always offered, unlike the link: one raster on a board still
            benefits from saying which raster it is, and with several it is
            the only thing that does.
          */}
          <label className="mt-1.5 flex items-center gap-2 text-meta text-muted-foreground">
            <input
              type="checkbox"
              checked={labels}
              onChange={(e) => onLabelsChange(e.target.checked)}
              className="accent-primary"
            />
            Show names
          </label>
          {canLink && (
            <label className="mt-1.5 flex items-center gap-2 text-meta text-muted-foreground">
              <input
                type="checkbox"
                checked={links}
                onChange={(e) => onLinksChange(e.target.checked)}
                className="accent-primary"
              />
              Link each area's rasters
            </label>
          )}
          <div className="mt-1.5">
            <NumberField
              label="Spread"
              value={gap}
              min={0}
              max={gapMax}
              step={0.01}
              /*
                In world units, where the AOI's longest side is 1 -- so the
                figure reads as a fraction of the area being looked at, and is
                the same number whatever the AOI covers on the ground.
              */
              format={(v) => v.toFixed(3)}
              parse={(t) => {
                const v = parseFloat(t)
                return Number.isFinite(v) ? v : null
              }}
              onChange={onGapChange}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** One action on the active asset. Small, and the same size as its siblings. */
function AssetAction({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: LucideIcon
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-[1.375rem] items-center gap-1 rounded-sm bg-surface-raised px-1.5 text-meta transition-colors",
        "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
        disabled
          ? "cursor-not-allowed text-muted-foreground opacity-45"
          : "text-muted-foreground hover:bg-surface-raised/80 hover:text-foreground"
      )}
    >
      <Icon className="size-3" strokeWidth={1.75} />
      {label}
    </button>
  )
}

/**
 * Whether an asset is one of the board's planes.
 *
 * A button rather than a marker, because the state and the way to change it
 * are the same thing here and two controls for one bit is one too many.
 */
function SceneToggle({
  inScene,
  placeable,
  title,
  onAdd,
  onRemove,
}: {
  inScene: boolean
  /** False where the raster resolved no window and cannot be placed. */
  placeable: boolean
  title: string
  onAdd: () => void
  onRemove: () => void
}) {
  if (!placeable) {
    return (
      <span
        title="No extent: this raster cannot be placed"
        className="shrink-0 text-meta text-muted-foreground/40"
        aria-label={`${title} cannot be placed`}
      >
        &mdash;
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        inScene ? onRemove() : onAdd()
      }}
      aria-pressed={inScene}
      aria-label={`${inScene ? "Remove" : "Add"} ${title}`}
      title={inScene ? "Remove from the board" : "Add to the board"}
      className={cn(
        "shrink-0 rounded-sm transition-colors",
        "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
        inScene
          ? "text-accent hover:text-foreground"
          : "text-muted-foreground/60 hover:text-foreground"
      )}
    >
      {inScene ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
    </button>
  )
}
