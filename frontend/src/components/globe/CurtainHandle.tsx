/**
 * The curtain: a line down the map that the top raster is cut at.
 *
 * To its right the stack is drawn whole; to its left the top raster is not
 * drawn, so what lies under it shows -- the raster beneath, or the imagery.
 * The cut itself is made in raisedRasters.ts, in screen space, which is why
 * this component knows nothing about the map: it holds a fraction of the
 * width, and the layer draws to it.
 *
 * A LINE ACROSS THE WHOLE HEIGHT, AND A GRIP ON IT. The line is where the eye
 * reads the comparison, so it is drawn full length; only the grip takes the
 * pointer, so the map under the rest of the line still pans and zooms.
 *
 * The two names travel with the grip rather than sitting in the corners: a
 * corner label is a second place to look, and the question "which side is
 * which" is asked at the line.
 */
import { useRef } from "react"

/** How far one arrow press moves the curtain, as a fraction of the width. */
const STEP = 0.01
const STEP_LARGE = 0.1

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function CurtainHandle({
  at,
  onChange,
  left,
  right,
}: {
  /** Where it stands, as a fraction of the map's width from the left. */
  at: number
  onChange: (at: number) => void
  /** What shows to the left of the line: what lies under the top raster. */
  left: string
  /** What shows to the right: the top raster. */
  right: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)

  const moveTo = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    onChange(clamp01((clientX - rect.left) / rect.width))
  }

  return (
    <div ref={trackRef} className="pointer-events-none absolute inset-0 z-400">
      {/*
        Accent, in a dark casing. The accent is the colour of a control, and
        over red soil it measures under 3 against the ground without one.
      */}
      <div
        aria-hidden
        className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary shadow-[0_0_0_1px_#141414]"
        style={{ left: `${at * 100}%` }}
      />
      {/*
        The grip alone is centred on the line, and the names hang off its two
        sides: centring the group instead would put the grip off the line by
        half the difference between the two names.
      */}
      <div
        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${at * 100}%` }}
      >
        <span className="map-chrome absolute top-1/2 right-full mr-2 max-w-[12rem] -translate-y-1/2 truncate rounded-sm px-1.5 py-0.5 text-label whitespace-nowrap text-foreground">
          {left}
        </span>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Curtain"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(at * 100)}
          aria-valuetext={`${Math.round(at * 100)} % from the left: ${left} to the left, ${right} to the right`}
          className="map-chrome pointer-events-auto flex h-11 w-6 cursor-ew-resize items-center justify-center gap-0.5 rounded-md border border-[rgb(var(--p-line)/0.28)] shadow-[0_2px_8px_rgb(0_0_0/0.28)] focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          style={{ touchAction: "none" }}
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            moveTo(e.clientX)
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
            e.stopPropagation()
            moveTo(e.clientX)
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? STEP_LARGE : STEP
            const next =
              e.key === "ArrowLeft"
                ? at - step
                : e.key === "ArrowRight"
                  ? at + step
                  : e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? 1
                      : null
            if (next === null) return
            e.preventDefault()
            e.stopPropagation()
            onChange(clamp01(next))
          }}
        >
          <span aria-hidden className="h-4 w-0.5 rounded-xs bg-muted-foreground" />
          <span aria-hidden className="h-4 w-0.5 rounded-xs bg-muted-foreground" />
        </div>
        <span className="map-chrome absolute top-1/2 left-full ml-2 max-w-[12rem] -translate-y-1/2 truncate rounded-sm px-1.5 py-0.5 text-label whitespace-nowrap text-foreground">
          {right}
        </span>
      </div>
    </div>
  )
}
