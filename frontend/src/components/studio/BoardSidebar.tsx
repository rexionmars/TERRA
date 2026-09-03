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
  CaretDown,
  CaretRight,
  Download,
  Drop,
  Eye,
  EyeSlash,
  Gauge,
  GridFour,
  Image as ImageIcon,
  Lightning,
  MapTrifold,
  Minus,
  Note,
  Pentagon,
  Plus,
  Stack,
  Sun,
  Trash,
  type Icon,
  Wrench,
  X,
} from "@phosphor-icons/react"
import {
  StudioContextMenu,
  StudioMenuItem,
  StudioMenuRule,
} from "@/components/studio/StudioPopover"
import { AoiFootprint } from "@/components/AoiFootprint"
import type { GeoJSONGeometry } from "@/lib/types"
import type { RasterLayer } from "@/lib/mapLayers"
import type { AssetRun, RunAsset } from "@/lib/runAssets"
import type { AnalysisEntry } from "@/lib/analysisCallout"
import { exportPng, exportTif } from "@/lib/runAssets"
import { datesByMonth } from "@/lib/runSummary"
import { cn } from "@/lib/utils"

/**
 * What the column is listing.
 *
 * The outliner in the editor this follows has the same switch, and for the
 * same reason: a scene and the data behind it are two different questions, and
 * a column that answered both at once would answer neither at the width it
 * has. "Scene" is what is in the studio and can be arranged; "Data" is what the
 * run produced, drawn or not, and what can be exported or dropped.
 */
/*
  Two modes, not three.

  A `tasks` mode held the run controls until the foot took them: one product's
  parameters already filled this column, and with solar and wind still to come
  it would have become a scroll with no end. They have since moved on again,
  from the foot into an area of their own -- see BoardRunGraph.
*/
/*
  A FOURTH PANE, AND IT IS A COUNTING ARGUMENT.

  "Analyses" is not a fourth way of looking at the same things. The board
  divides into a fixed number of regions and every product this application
  gains arrives with a reading; the reading that has no region left is the one
  that cannot be seen at all. A tree has no such limit -- this one lists
  rasters in the dozens -- so a reading listed here is a reading the board does
  not have to make room for, and one that can be put on the map beside the
  ground it was read over.
*/
export type OutlinerMode = "scene" | "data" | "areas" | "analyses"

/**
 * One geometry the board is working on.
 *
 * The tree lists what is DRAWN and the data tab lists what a run PRODUCED;
 * neither answers "which pieces of ground are in this studio". An area with no
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
function layerIcon(id: string): Icon {
  if (id.startsWith("solar:")) return Sun
  if (id === "water") return Drop
  if (id === "composition") return ImageIcon
  if (id === "confidence") return Gauge
  return GridFour
}

/**
 * What a raster IS, in the word the Type column prints.
 *
 * Beside `layerIcon` because the two answer the same question and would drift
 * if they were apart: an icon is this word drawn, and a row whose glyph says
 * one thing while its type says another is worse than either alone.
 *
 * The icons already carry this, and a column carries it differently -- a glyph
 * is recognised and a word is READ, which is what makes a column of them
 * scannable and sortable by eye down a tree of thirty rows.
 */
function layerKind(id: string): string {
  if (id.startsWith("solar:")) return "Solar"
  if (id === "water") return "Water"
  if (id === "composition") return "Composite"
  if (id === "confidence") return "Confidence"
  if (id === "prediction") return "Prediction"
  return "Raster"
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
/**
 * The readings held for this area, and whether each is on the map.
 *
 * ONE CONTROL PER ROW, and it is the same gesture the plane rows carry: an eye
 * that says whether the thing is drawn. A reading is not a raster, so what it
 * puts on the globe is a callout tied to the ground rather than a surface over
 * it -- but "is this on the map" is the same question, and giving it a second
 * vocabulary would make the tree teach two.
 *
 * The panel is not replaced by this. A callout holds the figures a reading
 * leads with; the sentences that qualify them need the width a panel has, and
 * a reader who wants the whole of one still opens it. What this removes is the
 * requirement that every reading have a region of the board to live in.
 */
function AnalysesPane({
  entries,
  onMap,
  onToggleMap,
}: {
  entries: readonly AnalysisEntry[]
  onMap: (id: string) => boolean
  onToggleMap: (id: string) => void
}) {
  if (entries.length === 0) {
    return (
      <div className="p-3 text-meta leading-relaxed text-muted-foreground">
        No reading yet. Run a product from the band below, and what it answers
        is listed here.
      </div>
    )
  }
  return (
    <div className="panel-scroll min-h-0 flex-1 overflow-y-auto py-1">
      {entries.map((e) => {
        const on = onMap(e.id)
        return (
          <div
            key={e.id}
            className="flex items-start gap-1.5 px-2 py-1 hover:bg-surface-raised/40"
          >
            <button
              type="button"
              aria-label={on ? "Take off the globe" : "Put on the globe"}
              aria-pressed={on}
              onClick={() => onToggleMap(e.id)}
              className={cn(
                "mt-0.5 shrink-0 transition-colors",
                on
                  ? "text-accent"
                  : "text-muted-foreground/50 hover:text-foreground"
              )}
            >
              {on ? <Eye className="size-3" /> : <EyeSlash className="size-3" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-meta text-foreground">
                {e.title}
              </div>
              <div className="telemetry truncate text-micro text-muted-foreground">
                {e.params}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AreasPane({
  areas,
  activeRow,
  onActivate,
  onUseArea,
  onRenameArea,
  onDeleteArea,
}: {
  areas: AreaInfo[]
  activeRow: string | null
  onActivate: (rowId: string, additive?: boolean) => void
  onUseArea?: (id: string) => void
  onRenameArea?: (id: string, name: string) => void
  onDeleteArea?: (id: string, title: string) => void
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
            />
          )}
          {editing === a.id ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                setEditing(null)
                if (a.catalogId) onRenameArea?.(a.catalogId, draft)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  setEditing(null)
                  if (a.catalogId) onRenameArea?.(a.catalogId, draft)
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
                if (!a.catalogId || !onRenameArea) return
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
          {/*
            THE ACTIVE AREA CAN BE DELETED TOO, and it could not before.

            The guard was `!a.current`, which left the one area a reader is most
            likely to be finished with as the one they could not remove -- and
            the handler already clears the active geometry when the id it drops
            is the active one, so the guard was protecting against a case that
            was handled.

            It asks first, which the others do not need to. Taking a raster off
            the board costs a press to undo; a drawn polygon is not stored
            anywhere else and cannot be drawn again the same way, so this is the
            one control in the tree whose mistake is unrecoverable. The asking
            belongs to the studio, which owns the dialog -- this only requests.
          */}
          {a.catalogId && onDeleteArea && (
            <button
              type="button"
              onClick={() => onDeleteArea(a.catalogId!, a.title)}
              title={
                a.current
                  ? "Delete this area, which is the one in use"
                  : "Delete this area"
              }
              className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              <Trash className="size-3" />
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
  icon: Icon
  /** The word the Type column prints. See `layerKind`. */
  kind: string
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
  /**
   * Take the whole stack off, for the row that IS an area.
   *
   * The area row carried no remove at all, so clearing an area meant pressing
   * the same control once per plane -- four presses for a run that produced a
   * prediction, a confidence, an NDVI mean and a true colour, and no way to
   * say the thing the reader actually meant. The parent's eye already sets
   * every child at once; this is the same idea for the other of the two things
   * you do to something in a scene.
   */
  removeAll?: () => void
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
  onRenameArea,
  onDeleteArea,
  activeRow,
  selection,
  activeAsset,
  expanded,
  smooth,
  onModeChange,
  analyses,
  onAnalysisOnMap,
  onToggleAnalysisMap,
  onActivate,
  onActivateAsset,
  surface,
  onAddToScene,
  onRemoveFromScene,
  names,
  onRename,
  onDropRun,
  onRemoveArea,
  onDeleteRun,
  onReorder,
  globe,
  onToggleExpanded,
  onLayerChange,
  onSmoothChange,
  onRowContext,
  onSelectComposition,
  onRemoveComposition,
  hideInvisible = false,
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
  /** Take a whole area off the board, rasters and all. */
  onRemoveArea?: (areaId: string) => void
  /** Ends the run everywhere, unlike onDropRun which only unloads it. */
  onDeleteRun?: (runId: string, title: string) => void
  /**
   * A new stack order for one area, given TOP FIRST -- as the tree reads.
   *
   * The tree is the only place the order is visible, so it is the place to
   * change it; and it lists an area from the top down, so that is the order it
   * hands back rather than making the caller reverse what it just showed.
   */
  onReorder: (areaId: string, layerIdsTopFirst: string[]) => void
  /**
   * The globe's two acts, for the tree's own menu.
   *
   * One bundle rather than four props, because they are one subject and a
   * caller that could pass the sets without the callbacks would draw entries
   * that report a state and do nothing. Absent where there is no globe to act
   * on, and the entries are withheld rather than shown refusing.
   */
  globe?: {
    /** Scene keys the globe is drawing. */
    onGlobe: ReadonlySet<string>
    /** Of those, the ones drawing their legend beside them. */
    withProperty: ReadonlySet<string>
    onToggleGlobe: (areaId: string, sceneId: string) => void
    onToggleProperty: (areaId: string, sceneId: string) => void
  }
  /** Each raster's name, shown over it on the board. */
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
  onRenameArea?: (id: string, name: string) => void
  onDeleteArea?: (id: string, title: string) => void
  /** The asset the panel is describing, in data mode. */
  activeAsset: string | null
  onModeChange: (m: OutlinerMode) => void
  /**
   * The readings held for this area, and which of them are on the map.
   *
   * Built by the surface rather than here, because it is what holds the
   * results: a tree that reached into a run's payload would be a second place
   * that knows the shape of every product's answer.
   */
  analyses: readonly AnalysisEntry[]
  onAnalysisOnMap: (id: string) => boolean
  onToggleAnalysisMap: (id: string) => void
  onActivateAsset: (id: string) => void
  /**
   * Where a context menu is portalled and clamped, as every studio panel is.
   *
   * The column itself is too narrow to hold one: a 14rem menu opened inside a
   * 15rem column with nowhere to go would be clamped to its edge on every
   * press. It belongs to the surface the column sits in.
   */
  surface?: HTMLElement | null
  /** Switches the board to a composition from the gallery. */
  /**
   * A raster was right-clicked in the tree.
   *
   * The same menu the viewport opens on a plane, from the surface that LISTS
   * the planes. Without it the tree was the one place a raster could be found
   * by name and the one place nothing could be done to it beyond the two
   * toggles on the row -- the rest was reachable only by locating the plane in
   * three dimensions first.
   *
   * Offered for a raster and not for the area above it or the modifier below:
   * the menu's entries are a plane's -- hide it, solo it, fit to it, send it to
   * the globe -- and the other two rows are not planes.
   */
  onRowContext?: (
    areaId: string,
    layerId: string,
    at: { x: number; y: number }
  ) => void
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
  /** The map's majority filter, which decides where a class boundary falls. */
  smooth: boolean
  /** Additive where the modifier was held: shift builds an order. */
  onActivate: (rowId: string, additive?: boolean) => void
  onToggleExpanded: (rowId: string) => void
  onLayerChange: (areaId: string, id: string, patch: LayerPatch) => void
  onSmoothChange: (v: boolean) => void
  /**
   * Withhold the planes whose eye is off.
   *
   * Blender's Outliner filters this way rather than by search first: a tree of
   * twenty-five rows is read by structure, and what a reader hides is usually
   * what they want out of the way. The switch is in the area's header, where
   * a filter belongs; the tree only obeys it.
   */
  hideInvisible?: boolean
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
    const stack = [...area.layers]
      .reverse()
      .filter((l) => !hideInvisible || l.visible)
    // An area whose planes are all hidden goes with them: a stack row with no
    // children under a filter reads as an empty area rather than a filtered one.
    if (hideInvisible && !stack.length) continue
    const allVisible =
      area.layers.length > 0 && area.layers.every((l) => l.visible)
    allRows.push({
      id: stackRow(area.id),
      areaId: area.id,
      layerId: null,
      title: names[stackRow(area.id)] ?? area.title,
      icon: Stack,
      kind: "Area",
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
        No single id to remove, because this row is not a plane.

        It used to carry nothing at all, on the reading that an area is ended
        by taking its last raster off and that a second control would be a
        second answer. The rule holds and the conclusion did not: taking every
        raster off IS that same ending, done once instead of once per plane,
        and a run that produced a prediction, a confidence, an NDVI mean and a
        true colour charged four presses for it. The eye on this row already
        sets every child at once for the other of the two things a scene does
        to a thing, so the precedent is on the row itself.
      */
      removeId: null,
      /*
        Always offered, including on an area with nothing on it.

        Gating this on `stack.length` left the one row a reader most wants gone
        as the only one with no way to go: a catalogued AOI with no rasters
        survives the board's filter by design -- it is the ground a run is
        about to be made on -- and once they are done with it, it stayed. The
        board's own dismissal is what removes it; the catalogue entry is
        untouched, and putting a raster on it brings it back.
      */
      removeAll: () => onRemoveArea?.(area.id),
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
        kind: layerKind(l.id),
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
          kind: "Modifier",
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
  /*
    A raster right-clicked in the data tree.

    Held by KEY rather than by the row, so the entries below read the row out of
    `assetRows` on every render. A row object captured at the press would go
    stale the moment the thing it describes changed -- put on the board, taken
    off, its opacity moved -- and the menu would then name a state that had
    passed, which is the defect the plane menu paid for once already.
  */
  const [assetMenu, setAssetMenu] = useState<{
    key: string
    at: { x: number; y: number }
  } | null>(null)
  const menuRow = assetMenu
    ? (assetRows.find((r) => r.key === assetMenu.key) ?? null)
    : null
  const menuAsset = menuRow?.asset ?? null

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
      className="app-no-drag flex h-full w-full flex-col"
      style={{
        /*
          Width from the partition. It was a literal here while the foot bands
          recessed by a constant declared elsewhere, which is the pairing that
          let the two drift apart.
        */
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
              ["scene", "Scene", Stack],
              ["data", "Data", ImageIcon],
              ["analyses", "Analyses", Lightning],
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
              <Icon className="size-3" />
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
              : mode === "analyses"
                ? analyses.length || null
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
      {mode === "analyses" ? (
        <AnalysesPane
          entries={analyses}
          onMap={onAnalysisOnMap}
          onToggleMap={onToggleAnalysisMap}
        />
      ) : mode === "areas" ? (
        <AreasPane
          areas={areaInfo}
          activeRow={activeRow}
          onActivate={onActivate}
          onUseArea={onUseArea}
          onRenameArea={onRenameArea}
          onDeleteArea={onDeleteArea}
        />
      ) : mode === "scene" ? (
        <>
        {/*
          THE COLUMN HEADER, which is what turns a list into an outliner.

          The tree already carried all of this -- an eye, a glyph, a name, a
          kind -- with nothing naming any of it, so every column had to be
          inferred from its contents. Naming them costs one row and makes the
          gutter legible before it is used: the eye at the head of its own
          column says the column is visibility, which no amount of eyes down
          the tree says on its own.

          Not sortable, and not pretending to be. These are labels, so they
          take no button affordance and no cursor of one.
        */}
        <div
          aria-hidden
          className="flex shrink-0 items-center border-b py-1 text-meta text-muted-foreground/70"
          style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
        >
          <span className="flex w-6 shrink-0 justify-center">
            <Eye className="size-3" />
          </span>
          <span className="min-w-0 flex-1 pl-1.5">Item Label</span>
          <span className="w-[74px] shrink-0 pr-2 text-right">Type</span>
        </div>
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
                onContextMenu={(e) => {
                  if (!onRowContext || !row.layerId || row.depth !== 1) return
                  /*
                    Selected first, so the menu and the tree agree about what is
                    being acted on. A menu opened over an unselected row would
                    otherwise name one raster while the panels around it still
                    describe another.
                  */
                  e.preventDefault()
                  onActivate(row.id, false)
                  onRowContext(row.areaId, row.layerId, {
                    x: e.clientX,
                    y: e.clientY,
                  })
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
                  "relative flex cursor-default select-none items-center py-[3px] pr-2 transition-colors",
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
              >
                {/*
                  THE VISIBILITY GUTTER, at the head of the row rather than the
                  tail of it.

                  The eye sat on the right, where it read as the last of the
                  row's actions and moved with the row's contents. A gutter is
                  a column: fixed width, outside the indent, so every eye in the
                  tree lands on one vertical line whatever the depth or the
                  length of the name -- and the header above it can say what
                  that line is.
                */}
                <span className="flex w-6 shrink-0 justify-center">
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
                      "transition-colors hover:text-foreground",
                      row.visible
                        ? "text-muted-foreground"
                        : "text-muted-foreground/40"
                    )}
                  >
                    {row.visible ? (
                      <Eye className="size-3.5" />
                    ) : (
                      <EyeSlash className="size-3.5" />
                    )}
                  </button>
                </span>

                {/*
                  The label column. Indent lives here rather than on the row so
                  the gutter beside it does not step in with the tree. Inline
                  because the depth is data: a Tailwind class per level would be
                  a class per level.
                */}
                <div
                  className="flex min-w-0 flex-1 items-center gap-1.5"
                  style={{ paddingLeft: `${row.depth * 0.75}rem` }}
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
                      <CaretDown className="size-3" />
                    ) : (
                      <CaretRight className="size-3" />
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
                </div>

                {/*
                  The actions sit between the label and the Type column, so the
                  type stays the last thing on every row and reads as a column
                  rather than as another control.
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
                    title="Remove from the studio"
                    className="shrink-0 rounded-sm text-muted-foreground/50 transition-colors hover:text-foreground"
                  >
                    <Minus className="size-3.5" />
                  </button>
                )}
                {row.removeAll && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      row.removeAll!()
                    }}
                    tabIndex={-1}
                    aria-label={`Remove every raster of ${row.title} from the board`}
                    // Named by its count, so the press is not a guess about how
                    // much it takes. Nothing is destroyed -- the run keeps its
                    // rasters and the data tree still lists it -- so this asks
                    // for no confirmation.
                    title={(() => {
                      const n =
                        areas.find((a) => a.id === row.areaId)?.layers.length ?? 0
                      return n
                        ? `Take this area and its ${n} rasters off the board`
                        : "Take this area out of the studio"
                    })()}
                    className="shrink-0 rounded-sm text-muted-foreground/50 transition-colors hover:text-foreground"
                  >
                    <Minus className="size-3.5" />
                  </button>
                )}
                {/*
                  What the row IS, in a fixed column under its header.

                  Muted against the label beside it: the name is what a reader
                  is looking for and the type is what tells two rows with
                  similar names apart, so it answers when asked rather than
                  competing with the thing being scanned.
                */}
                <span className="w-[74px] shrink-0 truncate pl-2 pr-2 text-right text-meta text-muted-foreground/70">
                  {row.kind}
                </span>
              </div>
            )
          })}

          {!rows.length && (
            <p className="px-3 py-1 text-meta leading-relaxed text-muted-foreground">
              Nothing to draw. Run a product and its raster appears here.
            </p>
          )}
        </div>
        </>
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
                    <CaretDown className="size-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <CaretRight className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <Stack
                    className="size-3.5 shrink-0 text-muted-foreground"
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

                    It used to REFUSE while the run was in use, with the reason
                    on the control, because dropping it then would take planes
                    off the board through something that says nothing about
                    them. The objection was to a silent side effect, not to the
                    act -- so the control names the side effect and performs
                    it, rather than sending the reader to another tab to do by
                    hand what this press already implies. A disabled control
                    whose remedy is elsewhere is a dead end wearing a tooltip.
                  */}
                  {onDropRun && row.run.areaId !== areaId && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDropRun(row.run.runId)
                      }}
                      tabIndex={-1}
                      aria-label={`Drop ${row.run.title}`}
                      title={
                        inUse
                          ? `Drop this run and take its ${
                              row.run.assets.filter((a) =>
                                sceneIds.has(
                                  sceneKey(row.run.areaId, a.sceneId)
                                )
                              ).length
                            } rasters off the board`
                          : "Drop this run"
                      }
                      className="shrink-0 rounded-sm text-muted-foreground/50 transition-colors hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                  {/*
                    Ending the run, which the tree could list and not do.

                    Beside the drop and deliberately unlike it: dropping leaves
                    the board and keeps the file, and this ends it in the
                    analysis list, its project and the exports. Two presses a
                    pixel apart, one recoverable and one not, so the shapes
                    differ and the destructive one is the only one that asks.
                  */}
                  {onDeleteRun && row.run.deletable && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteRun(row.run.runId, row.run.title)
                      }}
                      tabIndex={-1}
                      aria-label={`Delete ${row.run.title} permanently`}
                      title="Delete this run from disk"
                      className="shrink-0 rounded-sm text-muted-foreground/40 transition-colors hover:text-destructive"
                    >
                      <Trash className="size-3.5" />
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
                onContextMenu={(e) => {
                  if (!surface) return
                  // Selected first, so the menu and the panel below it agree
                  // about which raster is being acted on.
                  e.preventDefault()
                  onActivateAsset(row.key)
                  setAssetMenu({
                    key: row.key,
                    at: { x: e.clientX, y: e.clientY },
                  })
                }}
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
        WHAT THE PANE HOLDS, counted, at its foot.

        The tab strip already carries a ratio -- 3/7 visible, or a bare count --
        which says how much is drawn and not how much there IS, and says nothing
        at all about the selection. A reader arranging a board is working with
        both: how many planes are on it, and how many are in hand.

        Its own row rather than a second number in the strip above, because the
        strip is a control and this is a readout, and the two answer to
        different things -- the strip to the reader's press, this to the board.
      */}
      <div
        className="flex shrink-0 items-center justify-between border-t px-2 py-1 text-meta text-muted-foreground/70"
        style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
      >
        <span className="telemetry truncate">
          {mode === "scene"
            ? `${allRows.length} ${allRows.length === 1 ? "item" : "items"}${
                selection.length ? ` (${selection.length} selected)` : ""
              }`
            : mode === "data"
              ? `${allAssetRows.length} ${allAssetRows.length === 1 ? "raster" : "rasters"}`
              : `${areaInfo.length} ${areaInfo.length === 1 ? "area" : "areas"}`}
        </span>
      </div>

      {/*
        Under the branches and OUTSIDE the scroller.

        Inside it, the control scrolled away with the list it adds to, and the
        list it opens had to escape a clip its own container imposed. Out here
        it is pinned to the foot of the tree and its list is placed against
        the column, which is the thing it should be measured from anyway.
      */}
      {mode === "data" && <div className="shrink-0">{addRun}</div>}


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
        </div>
      )}

      {/*
        THE SAME ACTIONS, AT THE PRESS THAT ASKS FOR THEM.

        They were a row of five buttons under the panel above, which made the
        panel a control surface and put export beside a destructive act at the
        same weight, a pixel apart. As a menu they are where a menu is looked
        for -- on the thing -- and the one that cannot be undone can be set
        apart by a rule instead of by reading two words carefully.

        The panel above keeps what a panel is for: what this raster IS.
      */}
      <StudioContextMenu
        at={assetMenu?.at ?? null}
        surface={surface ?? null}
        title={menuAsset?.title ?? ""}
        onClose={() => setAssetMenu(null)}
      >
        {menuRow && menuAsset && (
          <>
            {/*
              The same act as the row's control, spelled out. A row is read at
              a glance and a panel is read deliberately, and the one place
              someone looks for what can be DONE with a thing is the panel.
            */}
            {menuAsset.extent &&
              (sceneIds.has(
                sceneKey(menuRow.run.areaId, menuAsset.sceneId)
              ) ? (
                <StudioMenuItem
                  icon={Minus}
                  label="Take off the board"
                  title="The run keeps it; the studio stops drawing it"
                  onSelect={() => {
                    onRemoveFromScene(menuRow.run.areaId, menuAsset.sceneId)
                    setAssetMenu(null)
                  }}
                />
              ) : (
                <StudioMenuItem
                  icon={Plus}
                  label="Put on the board"
                  onSelect={() => {
                    onAddToScene(menuRow.run.areaId, menuAsset.sceneId)
                    setAssetMenu(null)
                  }}
                />
              ))}
            {/*
              THE SAME PAIR THE PLANE'S OWN MENU CARRIES, so a raster can be
              put on the globe and given its legend from wherever it is being
              read. The tree lists what a run produced; the viewport draws it;
              the two are the same rasters, and an act offered in one and not
              the other is an act whose availability depends on where the
              reader happened to be looking.

              Offered only for a raster that HAS a place on the ground.
              `extent` is what says so, and it is the same test the board entry
              above makes.
            */}
            {globe && menuAsset.extent && (
              <>
                <StudioMenuItem
                  icon={MapTrifold}
                  label={
                    globe.onGlobe.has(
                      sceneKey(menuRow.run.areaId, menuAsset.sceneId)
                    )
                      ? "Take off the globe"
                      : "Show on the globe"
                  }
                  checked={globe.onGlobe.has(
                    sceneKey(menuRow.run.areaId, menuAsset.sceneId)
                  )}
                  onSelect={() => {
                    globe.onToggleGlobe(menuRow.run.areaId, menuAsset.sceneId)
                    setAssetMenu(null)
                  }}
                />
                {/*
                  Disabled rather than hidden without the raster on the globe:
                  the entry is what says a legend can be drawn beside it, and
                  one that appeared only once it was already there would never
                  teach that.
                */}
                <StudioMenuItem
                  icon={Note}
                  label={
                    globe.withProperty.has(
                      sceneKey(menuRow.run.areaId, menuAsset.sceneId)
                    )
                      ? "Hide the property on the map"
                      : "Show the property on the map"
                  }
                  title={
                    globe.onGlobe.has(
                      sceneKey(menuRow.run.areaId, menuAsset.sceneId)
                    )
                      ? "Its legend, tied to the ground it measures"
                      : "Show it on the globe first; the legend is drawn beside it"
                  }
                  checked={globe.withProperty.has(
                    sceneKey(menuRow.run.areaId, menuAsset.sceneId)
                  )}
                  disabled={
                    !globe.onGlobe.has(
                      sceneKey(menuRow.run.areaId, menuAsset.sceneId)
                    )
                  }
                  onSelect={() => {
                    globe.onToggleProperty(
                      menuRow.run.areaId,
                      menuAsset.sceneId
                    )
                    setAssetMenu(null)
                  }}
                />
              </>
            )}
            {/*
              Only where it would change something. The button this replaces was
              disabled and relabelled "On board" when the composition was
              already the one being drawn -- a readout wearing a control's
              clothes, and the only entry in the row that named a state rather
              than an act.
            */}
            {menuAsset.selectId && onSelectComposition && !menuAsset.onBoard && (
              <StudioMenuItem
                icon={Eye}
                label="Show on the map"
                onSelect={() => {
                  onSelectComposition(menuAsset.selectId!)
                  setAssetMenu(null)
                }}
              />
            )}
            <StudioMenuRule />
            <StudioMenuItem
              icon={Download}
              label="Export PNG"
              onSelect={() => {
                void exportPng(menuAsset)
                setAssetMenu(null)
              }}
            />
            {menuAsset.exportTif && (
              <StudioMenuItem
                icon={Download}
                label="Export GeoTIFF"
                onSelect={() => {
                  void exportTif(menuAsset)
                  setAssetMenu(null)
                }}
              />
            )}
            {/*
              Behind a rule of its own, because it is the one act here the run
              does not survive: the others take a raster off a board or write a
              file, and this drops the composition from the project.
            */}
            {menuAsset.removeId && onRemoveComposition && (
              <>
                <StudioMenuRule />
                <StudioMenuItem
                  icon={Trash}
                  label="Drop from the project"
                  title="Removes this composition from the project's gallery"
                  onSelect={() => {
                    onRemoveComposition(menuAsset.removeId!)
                    setAssetMenu(null)
                  }}
                />
              </>
            )}
          </>
        )}
      </StudioContextMenu>

    </div>
  )
}

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
      title={inScene ? "Remove from the studio" : "Add to the studio"}
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
