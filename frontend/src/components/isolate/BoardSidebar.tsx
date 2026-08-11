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
import { useRef } from "react"
import {
  ChevronDown,
  ChevronRight,
  Download,
  Minus,
  Plus,
  Droplet,
  Eye,
  EyeOff,
  Gauge,
  Grid2x2,
  Image as ImageIcon,
  Layers,
  type LucideIcon,
  Sun,
  Trash2,
  Wrench,
} from "lucide-react"
import type { RasterLayer } from "@/lib/mapLayers"
import type { RunAsset } from "@/lib/runAssets"
import { exportPng, exportTif } from "@/lib/runAssets"
import { NumberField } from "@/components/isolate/NumberField"
import { cn } from "@/lib/utils"

/**
 * What the column is listing.
 *
 * The outliner in the editor this follows has the same switch, and for the
 * same reason: a scene and the data behind it are two different questions, and
 * a column that answered both at once would answer neither at the width it
 * has. "Scene" is what is on the board and can be arranged; "Data" is what the
 * run produced, drawn or not, and what can be exported or dropped.
 */
export type OutlinerMode = "scene" | "data"

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
export const COLLECTION_ROW = "::stack"
const MAJORITY_SUFFIX = "::majority"

/** The layer a row acts on, or null for rows that act on the whole stack. */
export function rowLayerId(rowId: string | null): string | null {
  if (!rowId || rowId === COLLECTION_ROW) return null
  return rowId.split("::")[0]
}

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

interface Row {
  id: string
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
   * The id to take out of the stack, for rows that are a plane.
   *
   * Beside the eye rather than only in the data list: hiding and removing are
   * the two things you do to something in a scene, and sending one of them to
   * another tab means changing tabs to undo what you just looked at.
   */
  removeId: string | null
}

export function BoardSidebar({
  layers,
  assets,
  sceneIds,
  mode,
  areaLabel,
  activeRow,
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
  onToggleExpanded,
  onGapChange,
  onLayerChange,
  onSmoothChange,
  onSelectComposition,
  onRemoveComposition,
}: {
  /** Every layer the run could draw, bottom of the stack first. */
  layers: RasterLayer[]
  /** Everything the run produced, drawn or not. */
  assets: RunAsset[]
  /**
   * Which assets are planes on the board right now.
   *
   * Not the same as an asset being DRAWN. The eye hides a plane that is still
   * in the stack; this is whether it is in the stack at all, which is the
   * distinction the data list exists to let someone change.
   */
  sceneIds: ReadonlySet<string>
  /** Both take an id in the SCENE's space -- see RunAsset.sceneId. */
  onAddToScene: (id: string) => void
  onRemoveFromScene: (id: string) => void
  mode: OutlinerMode
  /** The asset the panel is describing, in data mode. */
  activeAsset: string | null
  onModeChange: (m: OutlinerMode) => void
  onActivateAsset: (id: string) => void
  /** Switches the board to a composition from the gallery. */
  onSelectComposition?: (id: string) => void
  onRemoveComposition?: (id: string) => void
  /** Names the collection row, as the scene's own name does in an outliner. */
  areaLabel: string
  /** The row the panel below is editing, and the plane the board outlines. */
  activeRow: string | null
  expanded: ReadonlySet<string>
  gap: number
  gapMax: number
  /** The map's majority filter, which decides where a class boundary falls. */
  smooth: boolean
  onActivate: (rowId: string) => void
  onToggleExpanded: (rowId: string) => void
  onGapChange: (v: number) => void
  onLayerChange: (id: string, patch: LayerPatch) => void
  onSmoothChange: (v: boolean) => void
}) {
  // Topmost first, so the tree reads in the order the eye meets the planes.
  const stack = [...layers].reverse()
  const allVisible = layers.length > 0 && layers.every((l) => l.visible)

  /*
    Every row the tree has, open or not. What is DRAWN is filtered from this
    below; the properties panel reads from the full set, because collapsing a
    parent hides a row without stopping it being the active one -- and a panel
    that emptied when the stack was folded would lose the thing being edited to
    a gesture about layout.
  */
  const allRows: Row[] = []
  if (layers.length) {
    allRows.push({
      id: COLLECTION_ROW,
      title: areaLabel || "Stack",
      icon: Layers,
      depth: 0,
      visible: allVisible,
      /*
        Sets every layer to one state rather than inverting each. Inverting
        would turn a mixed stack inside out, which is not what pressing the
        parent's eye means anywhere it exists.
      */
      toggle: () =>
        layers.forEach((l) => onLayerChange(l.id, { visible: !allVisible })),
      expandable: true,
      dimmed: false,
      // The stack itself is not taken out of the stack; closing the board is
      // what that would mean.
      removeId: null,
      posinset: 1,
      setsize: 1,
    })
  }

  for (const l of stack) {
    // Only the classification carries a transform, so it is the only row
    // with anything under it. The others reserve the space and stay flat.
    const hasModifier = l.id === "prediction"
    allRows.push({
      id: l.id,
      title: l.title,
      icon: layerIcon(l.id),
      depth: 1,
      visible: l.visible,
      toggle: () => onLayerChange(l.id, { visible: !l.visible }),
      expandable: hasModifier,
      dimmed: !l.visible,
      removeId: l.id,
      posinset: stack.indexOf(l) + 1,
      setsize: stack.length,
    })
    if (hasModifier) {
      allRows.push({
        id: l.id + MAJORITY_SUFFIX,
        title: "Majority filter",
        icon: Wrench,
        depth: 2,
        visible: smooth,
        toggle: () => onSmoothChange(!smooth),
        expandable: false,
        dimmed: !l.visible,
        // A transform is not a plane; it leaves with the raster it acts on.
        removeId: null,
        posinset: 1,
        setsize: 1,
      })
    }
  }

  // Shown only where every ancestor is open. Depth is enough to decide it,
  // because a row's parent is the nearest shallower row above it.
  const rows = allRows.filter(
    (r) =>
      r.depth === 0 ||
      (expanded.has(COLLECTION_ROW) &&
        (r.depth === 1 || expanded.has(r.id.split("::")[0])))
  )

  const active = allRows.find((r) => r.id === activeRow) ?? null
  const activeLayer =
    layers.find((l) => l.id === rowLayerId(activeRow)) ?? null

  const asset = assets.find((a) => a.id === activeAsset) ?? assets[0] ?? null

  const rowRefs = useRef(new Map<string, HTMLElement>())

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
        Stops at the foot rather than running to the bottom. The workspace
        island and the period track stay above the board by design, and they
        occupy exactly that band on the left -- a column running under them was
        a column with its last rows hidden.
      */
      className="app-no-drag absolute bottom-[var(--map-foot,0px)] left-0 top-0 z-[10] flex w-[15rem] flex-col border-r"
      style={{
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
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => onModeChange(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-sm px-2 py-1 text-meta transition-colors",
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
            ? layers.length > 0
              ? `${layers.filter((l) => l.visible).length}/${layers.length}`
              : null
            : assets.length || null}
        </span>
      </div>

      {/*
        The tree takes the height that is left and the panels keep the foot, so
        the space that grows is the space rasters are added to.
      */}
      {mode === "scene" ? (
        <div
          role="tree"
          aria-label="Layers on the board"
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {rows.map((row) => {
            const isActive = row.id === activeRow
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
                onClick={() => onActivate(row.id)}
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
                    onActivate(row.id)
                  }
                }}
                className={cn(
                  "flex cursor-default select-none items-center gap-1.5 py-[3px] pr-2 transition-colors",
                  "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
                  isActive ? "bg-surface-raised" : "hover:bg-surface-raised/40",
                  row.dimmed && !isActive && "opacity-50"
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

                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-emphasis",
                    isActive ? "text-accent" : "text-muted-foreground"
                  )}
                >
                  {row.title}
                </span>

                {/*
                  Right-aligned, so the toggles form a column that stays readable
                  however long the names get and however deep the tree goes.
                  Toggling does not activate the row: hiding something is a
                  glance at the stack, not a decision to start editing it.
                */}
                {/*
                  Left of the eye, so the eyes stay in one column down the
                  whole tree whether or not a row can be removed.
                */}
                {row.removeId && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveFromScene(row.removeId!)
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
          role="listbox"
          aria-label="Rasters this run produced"
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {assets.map((a) => {
            const isActive = a.id === asset?.id
            return (
              <div
                key={a.id}
                role="option"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => onActivateAsset(a.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onActivateAsset(a.id)
                  }
                }}
                className={cn(
                  "flex cursor-default select-none items-center gap-2 py-[3px] pl-1.5 pr-2 transition-colors",
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
                {/*
                  In or out of the stack, in the same right-hand column the
                  scene tree puts its eye in -- and a different question from
                  that eye, which hides a plane that is still there. An asset
                  with no extent cannot be placed at all, so the control says
                  so rather than putting the raster across the null island.
                */}
                <SceneToggle
                  inScene={sceneIds.has(a.sceneId)}
                  placeable={!!a.extent}
                  title={a.title}
                  onAdd={() => onAddToScene(a.sceneId)}
                  onRemove={() => onRemoveFromScene(a.sceneId)}
                />
              </div>
            )
          })}

          {!assets.length && (
            <p className="px-3 py-1 text-meta leading-relaxed text-muted-foreground">
              Nothing produced yet. Classify, map surface water, or apply a
              composition.
            </p>
          )}
        </div>
      )}

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

          {activeLayer && activeRow === activeLayer.id ? (
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
                    onLayerChange(activeLayer.id, { opacity: v })
                  }
                />
              </div>
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
          ) : activeRow === COLLECTION_ROW ? (
            <p className="mt-1.5 text-meta leading-relaxed text-muted-foreground">
              {layers.length} raster{layers.length === 1 ? "" : "s"} from one
              run, stacked in draw order.
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
              (sceneIds.has(asset.sceneId) ? (
                <AssetAction
                  icon={Minus}
                  label="Remove"
                  onClick={() => onRemoveFromScene(asset.sceneId)}
                />
              ) : (
                <AssetAction
                  icon={Plus}
                  label="Add"
                  onClick={() => onAddToScene(asset.sceneId)}
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
      {mode === "scene" && layers.length > 1 && (
        <div
          className="shrink-0 border-t px-3 py-2.5"
          style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
        >
          <p className="eyebrow !text-[9px]">View</p>
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
