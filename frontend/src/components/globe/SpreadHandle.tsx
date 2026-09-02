/**
 * The move handle for a stack of rasters on the globe.
 *
 * Blender's translate gizmo, reduced to the one axis this surface has to
 * offer. A raster here is over the ground it measures, so its position on the
 * ground is not the reader's to change -- moving it would be moving the field.
 * What is theirs is the height, which is the whole reason a second raster over
 * one area can be seen at all.
 *
 * SHOWN BY THE MOVE TOOL, not always. A gizmo standing on every stack whether
 * or not anyone is arranging one is chrome on a map, and the map's whole
 * business is what is under it. The tool is a button in the same column as
 * search and relief, and pressing it is what says "I am arranging" -- which is
 * exactly what Blender's own tool does.
 *
 * PIXELS TO METRES BY MEASURING THE GROUND. There is no public way to project
 * an elevated point in MapLibre, so the drag cannot be resolved against the
 * stack's real geometry. It is resolved against the ground instead: two screen
 * points a hundred pixels apart at the anchor are unprojected and their
 * distance taken, which gives metres per pixel where the reader is pointing.
 *
 * ACROSS the screen, not up it. Under a pitched camera a point 100 px higher
 * unprojects far away toward the horizon, and the distance to it is
 * foreshortened travel rather than the scale at the anchor -- which made the
 * gain fall away to nothing as the camera was tilted, exactly where a stack is
 * read. Pitch tilts about the horizontal axis, so the screen's x direction
 * keeps the scale.
 *
 * The rate is read at the PRESS and held for the drag. Recomputed per frame it
 * would change as the anchor moved under the pointer, and a control whose gain
 * shifts while it is being used is a control that overshoots.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { Marker, type Map as MapLibreMap } from "maplibre-gl"
import { createRoot, type Root } from "react-dom/client"

/** How far up the arrow stands from the anchor, in pixels. */
const ARROW_PX = 96

export function SpreadHandle({
  map,
  ready,
  /** Where the arrow stands: the centre of the stacked area's extent. */
  at,
  spreadM,
  maxM,
  /**
   * How many steps the spread is divided into: the top raster's index.
   *
   * Dragging raises the TOP of the stack to the pointer, so the gap it implies
   * is that height over this. Without it a stack of four would spread four
   * times as fast as a stack of two under the same hand.
   */
  steps,
  onChange,
}: {
  map: MapLibreMap | null
  ready: boolean
  at: [number, number] | null
  spreadM: number
  maxM: number
  steps: number
  onChange: (m: number) => void
}) {
  const held = useRef<{ marker: Marker; root: Root } | null>(null)
  /*
    The live values, for a handler that is created once and outlives them.

    The marker's element is mounted into a root of its own, and the drag runs
    from that tree; closing over the props as they were at mount would make the
    gain and the ceiling whatever they happened to be then.
  */
  const live = useRef({ spreadM, maxM, steps, onChange })
  live.current = { spreadM, maxM, steps, onChange }

  useEffect(() => {
    if (!map || !ready || !at) {
      if (held.current) {
        held.current.marker.remove()
        const root = held.current.root
        queueMicrotask(() => root.unmount())
        held.current = null
      }
      return
    }
    if (!held.current) {
      const el = document.createElement("div")
      el.style.width = "0"
      el.style.height = "0"
      const marker = new Marker({ element: el }).setLngLat(at).addTo(map)
      held.current = { marker, root: createRoot(el) }
    } else {
      held.current.marker.setLngLat(at)
    }
    held.current.root.render(<Arrow map={map} live={live} />)
  }, [map, ready, at])

  useEffect(
    () => () => {
      if (!held.current) return
      held.current.marker.remove()
      const root = held.current.root
      queueMicrotask(() => root.unmount())
      held.current = null
    },
    []
  )

  return null
}

function Arrow({
  map,
  live,
}: {
  map: MapLibreMap
  live: React.MutableRefObject<{
    spreadM: number
    maxM: number
    steps: number
    onChange: (m: number) => void
  }>
}) {
  const from = useRef<{ y: number; spread: number; mPerPx: number } | null>(
    null
  )
  const [dragging, setDragging] = useState(false)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return
      // The map must not read this as a pan.
      e.stopPropagation()
      e.preventDefault()
      /*
        Metres per pixel, measured where the pointer is. Over a hundred pixels
        rather than one, because unprojecting two adjacent pixels is a distance
        of a few centimetres resolved through a projection that is not exact at
        that scale.
      */
      const a = map.unproject([e.clientX - 50, e.clientY])
      const b = map.unproject([e.clientX + 50, e.clientY])
      const mPerPx = a.distanceTo(b) / 100
      from.current = { y: e.clientY, spread: live.current.spreadM, mPerPx }
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [map, live]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const start = from.current
      if (!start) return
      e.stopPropagation()
      const { maxM, steps, onChange } = live.current
      // Up is negative in screen coordinates, and up is more spread.
      const risen = (start.y - e.clientY) * start.mPerPx
      const next = start.spread + risen / Math.max(1, steps)
      onChange(Math.min(maxM, Math.max(0, next)))
    },
    [live]
  )

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    from.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  return (
    <svg
      width={40}
      height={ARROW_PX + 20}
      viewBox={`0 0 40 ${ARROW_PX + 20}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={dragging ? "cursor-grabbing" : "cursor-grab"}
      style={{
        // The anchor is the arrow's FOOT, at the marker's own point.
        position: "absolute",
        left: -20,
        top: -(ARROW_PX + 10),
        touchAction: "none",
        overflow: "visible",
      }}
    >
      {/*
        A halo under every stroke. This stands over satellite imagery, which is
        arbitrary in tone, and a one-pixel line on it is a line that disappears
        over half the fields it is drawn on.
      */}
      {[
        { w: 5, colour: "rgb(var(--p-paper))", o: 0.45 },
        { w: 2, colour: "rgb(var(--p-accent))", o: 1 },
      ].map((s) => (
        <g key={s.w} stroke={s.colour} strokeOpacity={s.o} fill="none">
          <line x1={20} y1={ARROW_PX + 10} x2={20} y2={22} strokeWidth={s.w} />
        </g>
      ))}
      <path
        d="M 20 6 L 28 24 L 12 24 Z"
        fill="rgb(var(--p-accent))"
        stroke="rgb(var(--p-paper))"
        strokeOpacity={0.45}
        strokeWidth={2}
        paintOrder="stroke"
      />
      {/* The foot, marking the ground the stack stands on. */}
      <circle
        cx={20}
        cy={ARROW_PX + 10}
        r={3.5}
        fill="rgb(var(--p-accent))"
        stroke="rgb(var(--p-paper))"
        strokeOpacity={0.7}
        strokeWidth={1.5}
      />
      {/*
        A wider invisible target over the shaft. Two pixels of line is a target
        for a mouse on a good day and for nothing else.
      */}
      <rect
        x={10}
        y={0}
        width={20}
        height={ARROW_PX + 14}
        fill="transparent"
      />
    </svg>
  )
}
