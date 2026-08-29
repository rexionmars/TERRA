/**
 * Google Earth's navigation, on any MapLibre surface in this application.
 *
 * Here rather than in the globe because both surfaces are the same camera over
 * the same planet, and the globe screen is where it happened to be written
 * first. Two copies would be two answers to what the middle button does.
 *
 * WHAT MAPLIBRE ALREADY MATCHES: left-drag turns, the wheel zooms, Ctrl with
 * the left button tilts and rotates, the arrows pan and Shift with the arrows
 * tilts and rotates. That is Earth's mapping already; what it lacked was any
 * statement of itself.
 *
 * WHAT IS ADDED HERE: the middle button, for the same tilt-and-rotate. Earth
 * binds it, and so does this application's own studio viewport, so it is the
 * one gesture that satisfies the outside convention and the inside one at once.
 * Written by hand because MapLibre's handlers are button-bound at construction
 * -- generateMouseRotationHandler and generateMousePitchHandler both test
 * `LEFT && ctrl || RIGHT`, with no option for the middle -- and at their rates,
 * 0.8 degrees of bearing and -0.5 of pitch per pixel, so the two gestures feel
 * like one binding.
 *
 * And Earth's resets on Earth's keys: `n` faces north, `u` looks straight down,
 * `r` does both.
 */
import { useEffect, useRef, useState } from "react"
import { Compass } from "lucide-react"
import type { Map as MapLibreMap } from "maplibre-gl"

import { cn } from "@/lib/utils"

/** MapLibre's own rates, so a middle-drag feels like a Ctrl-drag. */
const BEARING_PER_PX = 0.8
const PITCH_PER_PX = -0.5

/**
 * Binds the middle button and the reset keys, and reports whether the camera
 * is north-up and flat.
 *
 * The camera state is returned as a BOOLEAN rather than as the two angles:
 * bearing and pitch change on every frame of a drag, and whether the view is
 * level changes twice -- once on leaving it, once on returning.
 */
export function useCameraNavigation(
  map: MapLibreMap | null,
  ready: boolean
): { level: boolean } {
  const [level, setLevel] = useState(true)
  const mapRef = useRef(map)
  mapRef.current = map

  useEffect(() => {
    if (!map || !ready) return
    const canvas = map.getCanvas()
    let orbit: { x: number; y: number } | null = null

    const onDown = (e: MouseEvent) => {
      if (e.button !== 1) return
      // Middle-press is autoscroll on some platforms, and paste on X11.
      e.preventDefault()
      orbit = { x: e.clientX, y: e.clientY }
    }
    // On the window rather than the canvas, so a drag that leaves the surface
    // keeps turning it instead of stopping at the edge.
    const onMove = (e: MouseEvent) => {
      if (!orbit) return
      const dx = e.clientX - orbit.x
      const dy = e.clientY - orbit.y
      orbit = { x: e.clientX, y: e.clientY }
      map.setBearing(map.getBearing() + dx * BEARING_PER_PX)
      map.setPitch(map.getPitch() + dy * PITCH_PER_PX)
    }
    const onUp = (e: MouseEvent) => {
      if (e.button === 1) orbit = null
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const to =
        e.key === "n"
          ? { bearing: 0 }
          : e.key === "u"
            ? { pitch: 0 }
            : e.key === "r"
              ? { bearing: 0, pitch: 0 }
              : null
      if (!to) return
      e.preventDefault()
      map.easeTo({ ...to, duration: 400 })
    }

    const readLevel = () => {
      const flat = map.getBearing() === 0 && map.getPitch() === 0
      setLevel((prev) => (prev === flat ? prev : flat))
    }

    canvas.addEventListener("mousedown", onDown)
    canvas.addEventListener("keydown", onKey)
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    const rotate = map.on("rotate", readLevel)
    const pitch = map.on("pitch", readLevel)
    readLevel()

    return () => {
      canvas.removeEventListener("mousedown", onDown)
      canvas.removeEventListener("keydown", onKey)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      rotate.unsubscribe()
      pitch.unsubscribe()
    }
  }, [map, ready])

  return { level }
}

/**
 * The way back, and the gestures written down.
 *
 * A surface that tilts and turns with no way to square it is a trap: once the
 * horizon is off-axis there is no edge left to level against, and a reader who
 * tilted by accident cannot undo it by dragging.
 *
 * THREE CHIPS, not the whole mapping. The keys are on the control's own title,
 * where a reader wanting one is already looking; printing all of it would trade
 * the view for a manual.
 */
export function CameraControls({
  map,
  level,
  className,
}: {
  map: MapLibreMap | null
  level: boolean
  className?: string
}) {
  return (
    <div className={cn("pointer-events-none flex flex-col items-end gap-1.5", className)}>
      {!level && (
        <button
          type="button"
          onClick={() => map?.easeTo({ bearing: 0, pitch: 0, duration: 400 })}
          title="Level and face north (r). n faces north, u looks straight down."
          className="panel pointer-events-auto flex items-center gap-1.5 rounded-sm px-2 py-1 text-meta text-foreground transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Compass className="size-3.5 text-primary" strokeWidth={1.5} />
          Level, facing north
        </button>
      )}
      <span className="telemetry flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>drag to turn</span>
        <span>middle-drag or ctrl-drag to tilt</span>
        <span>scroll to zoom</span>
      </span>
    </div>
  )
}
