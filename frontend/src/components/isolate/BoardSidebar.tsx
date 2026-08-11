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
  Droplet,
  Eye,
  EyeOff,
  Gauge,
  Grid2x2,
  Image as ImageIcon,
  Layers,
  type LucideIcon,
  Sun,
  Wrench,
} from "lucide-react"
import type { RasterLayer } from "@/lib/mapLayers"
import { NumberField } from "@/components/isolate/NumberField"
import { cn } from "@/lib/utils"

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
}

export function BoardSidebar({
  layers,
  areaLabel,
  activeRow,
  expanded,
  gap,
  gapMax,
  smooth,
  onActivate,
  onToggleExpanded,
  onGapChange,
  onLayerChange,
  onSmoothChange,
}: {
  /** Every layer the run could draw, bottom of the stack first. */
  layers: RasterLayer[]
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
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
      >
        <p className="eyebrow !text-[9px]">Outliner</p>
        {layers.length > 0 && (
          <span className="telemetry text-meta text-muted-foreground">
            {layers.filter((l) => l.visible).length}/{layers.length}
          </span>
        )}
      </div>

      {/*
        The tree takes the height that is left and the panels keep the foot, so
        the space that grows is the space rasters are added to.
      */}
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

      {/*
        The properties of whatever is active. One panel however many layers
        there are, and the place a new per-layer property goes.
      */}
      {active && (
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
        Separation belongs to the view rather than to any one thing in the
        tree, so it stays out of the panel that edits one and stays visible
        whatever is active.
      */}
      {layers.length > 1 && (
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
