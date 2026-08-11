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
  onGapChange,
  onLayerChange,
}: {
  /** Every layer the run could draw, bottom of the stack first. */
  layers: RasterLayer[]
  gap: number
  gapMax: number
  onGapChange: (v: number) => void
  onLayerChange: (id: string, patch: LayerPatch) => void
}) {
  // Topmost first, so the list reads in the order the eye meets the planes.
  const rows = [...layers].reverse()

  return (
    <div
      className="app-no-drag absolute bottom-0 left-0 top-0 z-[10] flex w-[15rem] flex-col overflow-y-auto border-r"
      style={{
        // The board's own plate, not `.panel`: that rule carries a backdrop
        // blur, and blurring a live WebGL canvas behind a full-height column
        // is a composite this webview pays for on every frame.
        background: "rgb(var(--p-surface))",
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
              l.visible ? "bg-surface-raised/60" : "opacity-55"
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
