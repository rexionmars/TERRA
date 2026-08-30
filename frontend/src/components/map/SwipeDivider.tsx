/**
 * The wipe handle: a vertical line, two labels and a grab target.
 *
 * PURE DOM, over the map rather than in it, which is what makes it portable.
 * It was written for Leaflet and moved out unchanged when a MapLibre surface
 * needed the same control -- it never knew which library was underneath, and
 * two copies of a handle would be two answers to where the line sits.
 */
import { useRef } from "react"

export function SwipeDivider({
  ratio,
  onRatioChange,
  onDraggingChange,
  rightLabel = "Prediction",
}: {
  ratio: number
  onRatioChange: (ratio: number) => void
  onDraggingChange: (dragging: boolean) => void
  rightLabel?: string
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    const next = Math.min(0.92, Math.max(0.08, (clientX - rect.left) / rect.width))
    onRatioChange(next)
  }

  return (
    <div
      ref={trackRef}
      className="map-swipe-track app-no-drag pointer-events-none absolute inset-0 z-[1050]"
      aria-hidden={false}
    >
      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        style={{ left: `${ratio * 100}%`, transform: "translateX(-50%)" }}
      />
      <div
        className="pointer-events-none absolute top-3 -translate-x-full rounded-sm bg-black/55 px-1.5 py-0.5 text-[10px] tracking-wide text-white/90"
        style={{ left: `calc(${ratio * 100}% - 8px)` }}
      >
        Imagery
      </div>
      <div
        className="pointer-events-none absolute top-3 translate-x-0 rounded-sm bg-black/55 px-1.5 py-0.5 text-[10px] tracking-wide text-white/90"
        style={{ left: `calc(${ratio * 100}% + 8px)` }}
      >
        {rightLabel}
      </div>
      <button
        type="button"
        aria-label={`Drag to compare imagery and ${rightLabel.toLowerCase()}`}
        className="map-swipe-handle pointer-events-auto absolute top-1/2 flex h-11 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-white/70 bg-black/55 shadow-md outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        style={{ left: `${ratio * 100}%` }}
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const target = e.currentTarget
          target.setPointerCapture(e.pointerId)
          onDraggingChange(true)
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
          onDraggingChange(false)
        }}
        onPointerCancel={() => onDraggingChange(false)}
      >
        <span className="flex gap-0.5" aria-hidden>
          <span className="h-4 w-0.5 rounded-full bg-white/90" />
          <span className="h-4 w-0.5 rounded-full bg-white/90" />
        </span>
      </button>
    </div>
  )
}
