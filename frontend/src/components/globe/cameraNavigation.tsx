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

/** The compass's own box, in px: the dial is drawn in a 96-unit square. */
const DIAL = 96
const C = DIAL / 2
/** The outer ring, broken at the top for the index. */
const RING_R = 45
/** The arc from north to the index runs between the ring and the ticks. */
const ARC_R = 41
/** The ticks hang inward from here. */
const TICK_R = 38
/** The cardinal letters sit on this circle. */
const LETTER_R = 27

const CARDINALS = [
  { at: 0, letter: "N" },
  { at: 90, letter: "E" },
  { at: 180, letter: "S" },
  { at: 270, letter: "W" },
] as const
const TICKS = Array.from({ length: 72 }, (_, i) => i * 5)
const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const

/** A point on a circle about the dial's centre, at `deg` clockwise from the top. */
function onCircle(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [C + r * Math.sin(a), C - r * Math.cos(a)]
}

/**
 * The camera as a compass.
 *
 * THE DIAL TURNS AND THE INDEX DOES NOT. The triangle at the top is where the
 * camera faces; the dial under it carries north round as the map turns, so
 * the letter under the triangle is the way the reader is looking, and the
 * figure in the middle says it in degrees. North alone is in the accent: it is
 * the one direction a reader squares to, and the arc from it to the index in
 * the same colour is how far the view is turned away -- the distance the press
 * on this control takes back.
 *
 * THE TILT IS WRITTEN, NOT DRAWN. The control also undoes a tilted camera, so
 * it says how far it is tilted, under the heading, and says nothing when the
 * camera looks straight down.
 *
 * DRAWN BY MUTATION, NOT BY RENDER. Bearing and pitch change on every frame of
 * a drag, and putting them in React state would re-render the control sixty
 * times a second for numbers nothing else reads. The angles and the figures
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
  const dialRef = useRef<SVGGElement | null>(null)
  const arcRef = useRef<SVGPathElement | null>(null)
  const headingRef = useRef<SVGTextElement | null>(null)
  const pointRef = useRef<SVGTextElement | null>(null)
  const tiltRef = useRef<SVGTextElement | null>(null)

  useEffect(() => {
    if (!map) return
    const paint = () => {
      const bearing = map.getBearing()
      const pitch = map.getPitch()
      // North's screen angle is the bearing turned the other way: a camera
      // facing east has north on its left.
      dialRef.current?.setAttribute("transform", `rotate(${-bearing} ${C} ${C})`)
      // The turn away from north, the short way round, in (-180, 180].
      const away = ((((bearing + 180) % 360) + 360) % 360) - 180
      if (arcRef.current) {
        if (Math.abs(away) < 0.5) {
          arcRef.current.setAttribute("d", "")
        } else {
          const [fx, fy] = onCircle(ARC_R, away > 0 ? -away : 0)
          const [tx, ty] = onCircle(ARC_R, away > 0 ? 0 : -away)
          arcRef.current.setAttribute(
            "d",
            `M ${fx} ${fy} A ${ARC_R} ${ARC_R} 0 0 1 ${tx} ${ty}`
          )
        }
      }
      const heading = Math.round(((bearing % 360) + 360) % 360) % 360
      if (headingRef.current) headingRef.current.textContent = `${heading}°`
      if (pointRef.current) {
        pointRef.current.textContent = POINTS[Math.round(heading / 45) % 8]
      }
      if (tiltRef.current) {
        tiltRef.current.textContent = pitch >= 0.5 ? `tilt ${Math.round(pitch)}°` : ""
      }
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
  const [gapL] = onCircle(RING_R, -9)
  const [gapR] = onCircle(RING_R, 9)
  const gapY = onCircle(RING_R, 9)[1]
  return (
    <button
      type="button"
      title="Level, facing north (r). n faces north, u looks straight down."
      aria-label="Level the view, facing north"
      onClick={() => map?.easeTo({ bearing: 0, pitch: 0, duration: 400 })}
      className={cn(
        "map-chrome app-no-drag rounded-full border transition-colors",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        className
      )}
      style={{
        width: DIAL,
        height: DIAL,
        // The menus' plate (MenuPopover), as a disc.
        background:
          "linear-gradient(180deg, rgb(var(--p-control) / 0.94), rgb(var(--p-ink) / 0.94))",
        borderColor: "rgb(var(--p-line) / 0.45)",
        boxShadow: "0 12px 32px rgb(0 0 0 / 0.45)",
        backdropFilter: "blur(14px)",
      }}
    >
      <svg viewBox={`0 0 ${DIAL} ${DIAL}`} className="block size-full" aria-hidden>
        {/* The ring, fixed, broken at the top where the index stands. */}
        <path
          d={`M ${gapR} ${gapY} A ${RING_R} ${RING_R} 0 1 1 ${gapL} ${gapY}`}
          fill="none"
          stroke="rgb(var(--p-text) / 0.28)"
          strokeWidth={1}
        />
        {/* The index: where the camera faces. */}
        <path
          d={`M ${C - 4} 1.5 L ${C + 4} 1.5 L ${C} 8 Z`}
          fill="rgb(var(--p-text) / 0.75)"
        />
        {/* How far the view is turned from north. */}
        <path
          ref={arcRef}
          fill="none"
          stroke="rgb(var(--p-accent))"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <g ref={dialRef}>
          {TICKS.map((d) => {
            const len = d % 90 === 0 ? 7 : d % 30 === 0 ? 5 : 2.5
            const [x1, y1] = onCircle(TICK_R, d)
            const [x2, y2] = onCircle(TICK_R - len, d)
            return (
              <line
                key={d}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={d === 0 ? "rgb(var(--p-accent))" : "rgb(var(--p-text))"}
                strokeOpacity={d === 0 ? 1 : d % 30 === 0 ? 0.7 : 0.35}
                strokeWidth={d % 30 === 0 ? 1.25 : 0.75}
              />
            )
          })}
          {CARDINALS.map(({ at, letter }) => (
            <text
              key={letter}
              x={C}
              y={C - LETTER_R}
              transform={`rotate(${at} ${C} ${C})`}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={9}
              fontWeight={600}
              fill={at === 0 ? "rgb(var(--p-accent))" : "rgb(var(--p-muted))"}
            >
              {letter}
            </text>
          ))}
        </g>
        {/* The way the camera faces, as a point of the compass and in degrees. */}
        <text
          ref={pointRef}
          x={C}
          y={C - 10}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={7}
          letterSpacing={0.6}
          fill="rgb(var(--p-muted))"
          style={{ fontFamily: "var(--font-telemetry)" }}
        />
        <text
          ref={headingRef}
          x={C}
          y={C + 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={15}
          fill="rgb(var(--p-text))"
          style={{ fontVariantNumeric: "tabular-nums" }}
        />
        <text
          ref={tiltRef}
          x={C}
          y={C + 14}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={6.5}
          fill="rgb(var(--p-muted))"
          style={{ fontFamily: "var(--font-telemetry)" }}
        />
      </svg>
    </button>
  )
}
