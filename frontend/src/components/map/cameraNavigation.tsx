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

import { MapBar, MapButton } from "@/components/map/MapChrome"

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
 * NEITHER THE BINDINGS NOR ITS OWN NAME ARE WRITTEN OUT. A strip naming the
 * drag, the modifier and the wheel stood beside it and was removed: permanent
 * chrome over the imagery, answering a question asked once, about gestures
 * every map on this machine already uses. The control then kept a label of its
 * own and read as a pill twice the height of the bar under it -- a different
 * kind of control, which it is not. A glyph, at the neighbours' measurements,
 * with the name and the three keys on its title.
 */
/** Where the ground ring is drawn, in the gizmo's own 24-unit box. */
const GIZMO_C = 12
const GIZMO_R = 8

/**
 * The camera, drawn rather than named.
 *
 * A COMPASS GLYPH SAID THERE WAS A TILT AND NOT WHAT IT WAS. The control has
 * always been the way back from a turned camera; what it could not do was
 * report the camera it was undoing, so a reader who had orbited had to move
 * the view to find out where they had got to.
 *
 * The drawing is an attitude gizmo, in the shape the reference instruments use
 * -- Earth's navigation ball, an artificial horizon:
 *
 *   THE RING IS THE GROUND, seen from where the camera is. Straight down it is
 *   a circle; laid over towards the horizon it closes into a line. That is not
 *   a metaphor for pitch, it is the ground plane's actual projection, so
 *   `ry = r * cos(pitch)` is the whole of it.
 *
 *   NORTH RIDES THE RING. At bearing 0 it is at the top; turning the camera
 *   carries it around, and the ring's compression carries it up and down with
 *   the tilt. One mark rather than four cardinals: at 22px the other three are
 *   three more things to resolve and none of them says anything the first does
 *   not.
 *
 *   THE BAR IS THE VIEWER and does not move. Everything else turns under it,
 *   which is what makes the gizmo read as the world moving rather than the
 *   instrument.
 *
 * DRAWN BY MUTATION, NOT BY RENDER. The hook above returns a boolean and its
 * comment says why: bearing and pitch change on every frame of a drag, and
 * putting them in React state would re-render this bar sixty times a second
 * for two numbers nothing else reads. The angles are written straight onto the
 * two elements that carry them, from the map's own events.
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
  const groundRef = useRef<SVGEllipseElement | null>(null)
  const northRef = useRef<SVGGElement | null>(null)

  useEffect(() => {
    if (!map) return
    const paint = () => {
      const p = (map.getPitch() * Math.PI) / 180
      const b = (map.getBearing() * Math.PI) / 180
      const flat = Math.cos(p)
      groundRef.current?.setAttribute("ry", `${GIZMO_R * flat}`)
      /*
        North's screen direction is the bearing turned the other way -- the
        camera faces east and north goes to the left -- and its vertical half
        is compressed by the same cosine the ring is, so the mark sits ON the
        ring at every tilt rather than crossing it.
      */
      const x = GIZMO_C - GIZMO_R * Math.sin(b)
      const y = GIZMO_C - GIZMO_R * Math.cos(b) * flat
      northRef.current?.setAttribute("transform", `translate(${x} ${y})`)
    }
    paint()
    const subs = [map.on("rotate", paint), map.on("pitch", paint), map.on("move", paint)]
    return () => {
      for (const s of subs) s.unsubscribe()
    }
    // `level` is in the list because this control unmounts when the view is
    // square: coming back, the refs are new elements and have to be painted.
  }, [map, level])

  // Nothing to square when the view is already square. The control appears
  // with the tilt it undoes, and leaves with it -- and an instrument that
  // reports a level camera by being absent is the same statement the compass
  // made, now with something to say for the whole time it is up.
  if (level) return null
  return (
    <MapBar className={className}>
      <MapButton
        label="Level, facing north (r). n faces north, u looks straight down."
        onClick={() => map?.easeTo({ bearing: 0, pitch: 0, duration: 400 })}
      >
        {/*
          22px inside the 34px control, where the compass was 16. The button
          keeps its measurements -- MapChrome states what a control of a
          different size costs in a stack of them -- and the extra six pixels
          come out of the padding, which is what a drawing with three parts
          needs and a single glyph did not.
        */}
        <svg
          viewBox="0 0 24 24"
          className="size-[1.375rem]"
          fill="none"
          aria-hidden="true"
        >
          {/* The bezel: the instrument's own edge, fixed. */}
          <circle
            cx={GIZMO_C}
            cy={GIZMO_C}
            r={GIZMO_R + 2.5}
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={1}
          />
          {/* The ground, closing towards a line as the camera lies down. */}
          <ellipse
            ref={groundRef}
            cx={GIZMO_C}
            cy={GIZMO_C}
            rx={GIZMO_R}
            ry={GIZMO_R}
            stroke="currentColor"
            strokeWidth={1.25}
          />
          {/* North, riding it. Filled, so it reads at this size. */}
          <g ref={northRef}>
            <circle r={1.9} fill="rgb(var(--p-accent))" />
          </g>
          {/*
            The viewer. Last, so it is over the ring at every tilt: it is the
            one part of the picture that is not in the world.
          */}
          <path
            d={`M ${GIZMO_C - 4.5} ${GIZMO_C} H ${GIZMO_C + 4.5}`}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        </svg>
      </MapButton>
    </MapBar>
  )
}
