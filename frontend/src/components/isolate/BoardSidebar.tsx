/**
 * The board's own controls, in one place.
 *
 * The surface had grown a button at the top that opened a panel at the top,
 * and a slider in the title row, and a gizmo at the bottom -- three places to
 * look for three kinds of control. This is the one place: what is on the
 * board, and how it is arranged.
 *
 * The list is the scene, read top to bottom as the stack is seen: the topmost
 * layer is the topmost row. That correspondence is the reason to list them at
 * all rather than to repeat the map's flat set of checkboxes -- on the board
 * the layers are objects you can see, and a row that matches one of them is a
 * handle on that object rather than a setting about it.
 */
import { Eye, EyeOff } from "lucide-react"
import type { RasterLayer } from "@/lib/mapLayers"
import { cn } from "@/lib/utils"

export interface LayerPatch {
  visible?: boolean
  opacity?: number
}

export function BoardSidebar({
  layers,
  gap,
  gapMax,
  smooth,
  onGapChange,
  onLayerChange,
  onSmoothChange,
}: {
  /** Every layer the run could draw, bottom of the stack first. */
  layers: RasterLayer[]
  gap: number
  gapMax: number
  /** The map's majority filter, which decides where a class boundary falls. */
  smooth: boolean
  onGapChange: (v: number) => void
  onLayerChange: (id: string, patch: LayerPatch) => void
  onSmoothChange: (v: boolean) => void
}) {
  // Topmost first, so the list reads in the order the eye meets the planes.
  const rows = [...layers].reverse()
  // Smoothing applies to the classification and to nothing else, so the
  // control is offered only when there is one on the board.
  const canSmooth = layers.some((l) => l.id === "prediction")

  return (
    <div
      /*
        Stops at the foot rather than running to the bottom. The workspace
        island and the period track stay above the board by design, and they
        occupy exactly that band on the left -- a column running under them was
        a column with its last rows hidden.
      */
      className="app-no-drag absolute bottom-[var(--map-foot,0px)] left-0 top-0 z-[10] flex w-[15rem] flex-col overflow-y-auto border-r"
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
      <div className="border-b px-3 py-2" style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}>
        <p className="eyebrow !text-[9px]">Layers</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
        {rows.map((l) => (
          <div
            key={l.id}
            className={cn(
              "rounded-sm px-2 py-1.5 transition-colors",
              l.visible ? "bg-surface-raised/45" : "opacity-50"
            )}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onLayerChange(l.id, { visible: !l.visible })}
                aria-pressed={l.visible}
                title={l.visible ? "Hide" : "Show"}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {l.visible ? (
                  <Eye className="size-3.5" />
                ) : (
                  <EyeOff className="size-3.5" />
                )}
              </button>
              <span className="min-w-0 flex-1 truncate text-emphasis text-foreground">
                {l.title}
              </span>
              <span className="telemetry shrink-0 text-meta text-muted-foreground">
                {Math.round(l.opacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={l.opacity}
              disabled={!l.visible}
              onChange={(e) =>
                onLayerChange(l.id, { opacity: Number(e.target.value) })
              }
              className="mt-1 w-full accent-primary disabled:opacity-40"
            />
          </div>
        ))}

        {rows.length === 0 && (
          <p className="px-1 text-meta leading-relaxed text-muted-foreground">
            Nothing to draw. Run a product and its raster appears here.
          </p>
        )}
      </div>

      {/*
        The one overlay tool that changes what the board draws.

        The rest of that panel is map vocabulary and stays with the map: the
        swipe compares an overlay against the BASEMAP, and there is no basemap
        here; the AOI palette colours a contour the board does not draw. Its
        visibility switches and opacity sliders are the rows above, in a form
        that names the plane rather than the product.

        This one is not cosmetic and is the reason it had to come across: the
        majority filter decides WHERE A CLASS BOUNDARY FALLS. A board that
        disagreed with the map about that would be a second answer to the same
        question, which is what lib/mapLayers.ts exists to prevent.
      */}
      {canSmooth && (
        <div
          className="border-t px-3 py-2.5"
          style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
        >
          <p className="eyebrow !text-[9px]">Classification</p>
          <label className="mt-1.5 flex items-center gap-2 text-meta text-muted-foreground">
            <input
              type="checkbox"
              checked={smooth}
              onChange={(e) => onSmoothChange(e.target.checked)}
              className="accent-primary"
            />
            Majority filter
          </label>
        </div>
      )}

      {/*
        Separation is a property of the view, not of any one layer, so it sits
        below the list rather than inside it.
      */}
      {rows.length > 1 && (
        <div
          className="border-t px-3 py-2.5"
          style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
        >
          <p className="eyebrow !text-[9px]">View</p>
          <label className="mt-1.5 flex items-center gap-2">
            <span className="shrink-0 text-meta text-muted-foreground">
              Spread
            </span>
            <input
              type="range"
              min={0}
              max={gapMax}
              step={0.005}
              value={gap}
              onChange={(e) => onGapChange(Number(e.target.value))}
              className="min-w-0 flex-1 accent-primary"
              title="Separation between layers"
            />
          </label>
        </div>
      )}
    </div>
  )
}
