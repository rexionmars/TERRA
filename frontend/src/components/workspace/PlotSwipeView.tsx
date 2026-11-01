import { useRef } from "react"
import { cn } from "@/lib/utils"

export type AnalysisPlotAsset = {
  id: string
  title: string
  uri: string
  exportPngName: string
  rasterTif?: string
  showClassLegend?: boolean
  pixelated?: boolean
}

function shortLabel(title: string): string {
  if (title.startsWith("Predicted")) return "Predicted"
  if (title.startsWith("MapBiomas")) return "MapBiomas"
  if (title.startsWith("NDVI")) return "NDVI"
  if (title.startsWith("Confidence")) return "Confidence"
  if (title.startsWith("Satellite") || title.startsWith("True color")) {
    return "Satellite"
  }
  return title
}

/** Two rasters over one another, with a handle that moves the line between them. */
export function PlotSwipeView({
  left,
  right,
  ratio,
  onRatioChange,
}: {
  left: AnalysisPlotAsset
  right: AnalysisPlotAsset
  ratio: number
  onRatioChange: (r: number) => void
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    onRatioChange(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)))
  }

  return (
    <div ref={trackRef} className="relative size-full min-h-0 overflow-hidden">
      <div className="absolute inset-0">
        <img
          src={left.uri}
          alt={left.title}
          draggable={false}
          className={cn(
            "absolute inset-0 size-full object-contain",
            left.pixelated && "overlay-thumb-crisp"
          )}
        />
        <div
          className="absolute inset-0"
          style={{ clipPath: `inset(0 0 0 ${ratio * 100}%)` }}
        >
          <img
            src={right.uri}
            alt={right.title}
            draggable={false}
            className={cn(
              "absolute inset-0 size-full object-contain",
              right.pixelated && "overlay-thumb-crisp"
            )}
          />
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-y-0 z-10 w-px bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        style={{ left: `${ratio * 100}%`, transform: "translateX(-50%)" }}
      />
      {/* Fixed corner labels — keep the divider free to travel edge-to-edge */}
      <div className="pointer-events-none absolute top-2 left-2 z-10 rounded-sm bg-black/55 px-1.5 py-0.5 text-meta tracking-wide text-white/90">
        {shortLabel(left.title)}
      </div>
      <div className="pointer-events-none absolute top-2 right-2 z-10 rounded-sm bg-black/55 px-1.5 py-0.5 text-meta tracking-wide text-white/90">
        {shortLabel(right.title)}
      </div>
      <button
        type="button"
        aria-label="Drag to compare plots"
        className="map-swipe-handle absolute top-1/2 z-20 flex h-11 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-white/70 bg-black/55 shadow-md outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        style={{ left: `${ratio * 100}%` }}
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          setFromClientX(e.clientX)
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
          e.preventDefault()
          e.stopPropagation()
          setFromClientX(e.clientX)
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        }}
      >
        <span className="flex gap-0.5" aria-hidden>
          <span className="h-4 w-0.5 rounded-full bg-white/90" />
          <span className="h-4 w-0.5 rounded-full bg-white/90" />
        </span>
      </button>
    </div>
  )
}
