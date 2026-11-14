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
 * NEITHER THE BINDINGS NOR ITS OWN NAME ARE WRITTEN OUT on the map: permanent
 * chrome over the imagery, answering a question asked once, about gestures
 * every map on this machine already uses. The name and the three keys are on
 * its title.
 */

/** The needle is drawn in a 16-unit square, as the glyphs beside it are. */
const BOX = 16
const C = BOX / 2

/**
 * The least the needle is flattened to. A camera at MapLibre's 85 degrees
 * would squash it to a twelfth of its length, a line with no direction left
 * in it; at this floor the tip still says which way north is.
 */
const MIN_SQUASH = 0.3

/**
 * The camera as one needle, at the size of the map's other controls.
 *
 * IT WAS A FULL COMPASS -- a 96 px dial with seventy-two ticks, four letters,
 * the heading in degrees and the tilt written under it -- and it drew the eye
 * away from the imagery it sat on whenever the view was turned. The reader
 * needs two things from it: that the view is not square, and a press that
 * squares it. The control's presence says the first, since it shows only
 * while the view is turned or tilted, and the needle says the rest.
 *
 * THE NEEDLE LIES ON THE GROUND. It turns with the map, so the accent tip
 * points where north is on the screen, and it is flattened by the tilt as a
 * line drawn on the ground would be, so a tilted view reads as a shortened
 * needle without a figure to read. The heading and the tilt in degrees are on
 * the title, for the reader who asks.
 *
 * DRAWN BY MUTATION, NOT BY RENDER. Bearing and pitch change on every frame of
 * a drag, and putting them in React state would re-render the control sixty
 * times a second for numbers nothing else reads. The transform and the title
 * are written straight onto the elements that carry them, from the map's own
 * events; the hook above returns only whether the view is level.
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
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const needleRef = useRef<SVGGElement | null>(null)

  useEffect(() => {
    if (!map) return
    const paint = () => {
      const bearing = map.getBearing()
      const pitch = map.getPitch()
      // North's screen angle is the bearing turned the other way: a camera
      // facing east has north on its left. The turn is applied on the ground
      // first and the tilt's foreshortening on the screen after it.
      const squash = Math.max(MIN_SQUASH, Math.cos((pitch * Math.PI) / 180))
      needleRef.current?.setAttribute(
        "transform",
        `translate(${C} ${C}) scale(1 ${squash}) rotate(${-bearing}) translate(${-C} ${-C})`
      )
      const heading = Math.round(((bearing % 360) + 360) % 360) % 360
      const tilt = Math.round(pitch)
      buttonRef.current?.setAttribute(
        "title",
        `Level, facing north (r). Heading ${heading}°, tilt ${tilt}°. ` +
          "n faces north, u looks straight down."
      )
    }
    paint()
    const subs = [
      map.on("rotate", paint),
      map.on("pitch", paint),
      map.on("move", paint),
    ]
    return () => {
      for (const s of subs) s.unsubscribe()
    }
    // `level` is in the list because this control unmounts when the view is
    // square: coming back, the refs are new elements and have to be painted.
  }, [map, level])

  // Nothing to square when the view is already square. The control appears
  // with the turn or the tilt it undoes, and leaves with it.
  if (level) return null
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label="Level the view, facing north"
      onClick={() => map?.easeTo({ bearing: 0, pitch: 0, duration: 400 })}
      className={cn(
        // MapBar and MapButton's measurements, as a bar of one.
        "map-chrome app-no-drag flex size-[2.125rem] items-center justify-center rounded-md",
        "border border-[rgb(var(--p-line)/0.28)] shadow-[0_2px_8px_rgb(0_0_0/0.28)]",
        "text-muted-foreground transition-colors",
        "hover:bg-[rgb(var(--p-surface-raised)/0.92)] hover:text-foreground",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        className
      )}
    >
      <svg viewBox={`0 0 ${BOX} ${BOX}`} className="size-4" aria-hidden>
        <g ref={needleRef}>
          {/* North half in the accent: the one direction a reader squares to. */}
          <path d="M 8 1 L 11 8 L 5 8 Z" fill="rgb(var(--p-accent))" />
          <path d="M 5 8 L 11 8 L 8 15 Z" fill="currentColor" />
        </g>
      </svg>
    </button>
  )
}
