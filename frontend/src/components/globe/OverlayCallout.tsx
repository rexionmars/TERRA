/**
 * A raster's legend, tied to the ground it measures.
 *
 * The legend is drawn in the properties panel and stays there. This is the
 * other reading of it: over the imagery, beside the raster, where the question
 * "what is this colour" is asked. A panel answers it at the edge of the screen,
 * with the reader's eye leaving the map to find the answer and coming back to
 * find the place again.
 *
 * IT IS TIED, NOT PLACED. The dot sits on the raster and the box floats off it
 * on a leader, which is what says WHICH raster this describes -- several can be
 * on the globe at once, and a box with no line is a box that could belong to
 * any of them. The anchor is a coordinate, so the whole assembly travels with
 * the ground under pan, zoom and pitch rather than staying where it was drawn
 * on the screen.
 *
 * THE ANCHOR DOES NOT MOVE; THE BOX DOES. Dragging used to move the marker,
 * which took the dot with it -- so the moment a reader pushed the legend out of
 * the way, the dot stopped marking the raster and the leader pointed at
 * wherever the box had been dropped. The line was drawing itself.
 *
 * So the marker stays at the centre of the extent and the box carries a screen
 * offset from it. The leader is recomputed from that offset on every render,
 * which is what lets it stretch: the dot keeps saying which raster this is
 * while the box goes wherever it is not in the way.
 *
 * EVERY KIND OF LEGEND, CUT TO WHAT A FLOATING BOX CAN HOLD. A ramp is a bar
 * and two ends and fits whole. A class list does not: MapBiomas runs to dozens,
 * and that many swatches over imagery is a panel that happens to be floating.
 * So the classes are cut to the largest few, ordered by share, with a line
 * saying how many were left -- and the panel, which has the height for all of
 * them, stays where the whole list is read.
 *
 * SHOWN BY ASKING. It used to appear for every ramp raster sent to the globe,
 * which made it a property of the raster rather than a thing the reader wanted:
 * six overlays meant six boxes nobody had asked for. It is a toggle now, on
 * the plane and on the tree row, and several can be up at once because
 * comparing two legends is the case that needs them both.
 *
 * IT RIDES THE RASTER'S HEIGHT, not the ground under it. The rasters are drawn
 * at an elevation now, and a marker is anchored to a coordinate, which is on
 * the surface -- so the legend for the top of a stack was tied to the ground
 * beneath it while the raster it described floated above. There is no public
 * way to project an elevated point in MapLibre, so the anchor is offset in
 * pixels instead: see `riseInPixels`.
 *
 * Position is per session and per raster, not stored. Where a reader wants a
 * legend is a function of what they are looking at right now, which is exactly
 * what a preference outliving the session gets wrong.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { CaretRight } from "@phosphor-icons/react"
import { Marker, type Map as MapLibreMap } from "maplibre-gl"
import { createRoot, type Root } from "react-dom/client"

import type { LayerLegend } from "@/lib/layerLegend"
import { cn } from "@/lib/utils"

/**
 * How far up the screen a height of `metres` lands, at this camera.
 *
 * MapLibre will not project an elevated point, so this is worked out from the
 * two things it will answer: the ground scale where the anchor is, and the
 * pitch.
 *
 * At pitch 0 the camera looks straight down and a vertical offset moves the
 * point toward the lens rather than across the screen, so the rise is nothing.
 * At the horizon it is the whole of it, and `sin(pitch)` is the curve between.
 *
 * THE SCALE IS MEASURED ACROSS THE SCREEN, NOT UP IT, and that is the whole of
 * why this failed the first time. Unprojecting a point 100 px UP the screen
 * under a pitched camera lands far away toward the horizon -- the ground
 * distance it returns is foreshortened travel, not the scale at the anchor --
 * so metres-per-pixel came out enormous and every rise rounded to nothing.
 * Pitch tilts the camera about the horizontal axis, which leaves the screen's
 * x direction unforeshortened; two points either side of the anchor measure
 * the scale where the anchor actually is.
 *
 * An approximation still: it ignores the perspective foreshortening that grows
 * with distance from the centre of the view. For a legend tied to a raster a
 * few tens of metres up, that error is smaller than the dot it moves.
 */
function riseInPixels(
  map: MapLibreMap,
  at: [number, number],
  metres: number
): number {
  if (metres <= 0) return 0
  const p = map.project({ lng: at[0], lat: at[1] })
  // Over a hundred pixels: unprojecting two adjacent ones is a distance of
  // centimetres through a projection that is not exact at that scale.
  const a = map.unproject([p.x - 50, p.y])
  const b = map.unproject([p.x + 50, p.y])
  const mPerPx = a.distanceTo(b) / 100
  if (!Number.isFinite(mPerPx) || mPerPx <= 0) return 0
  return (metres / mPerPx) * Math.sin((map.getPitch() * Math.PI) / 180)
}

/** Where the box starts, in pixels from the anchor. Up and to the left of it. */
const START_X = -232
const START_Y = -112

/** The box's width. Its height is measured: see below. */
const BOX_W = 216

/**
 * The height to assume for one frame, before the box has been measured.
 *
 * Declared, this was wrong for half the rasters: a product with no acquisition
 * window draws one line fewer, and a leader computed against a height the box
 * does not have leaves from an edge that is not there.
 */
const BOX_H_GUESS = 92

/**
 * The run the leader takes off the box before it turns.
 *
 * Not all of it straight any more: STRAIGHT below says how much is drawn as a
 * line, and the rest of this length is where the turn's control point sits.
 */
const STUB = 22

/** How many classes or figures a floating box carries before it is a panel. */
const MAX_ROWS = 5

export interface OverlayCaption {
  /**
   * The legend itself, as the panel resolved it.
   *
   * The whole model rather than a flattened copy of the parts a ramp needs.
   * lib/layerLegend.ts records what a second, hand-kept description of a
   * raster's colours cost the last time there was one: a disagreement with the
   * renderer of up to 40 of 255 on three stops.
   */
  legend: NonNullable<LayerLegend>
  /** The ground it was measured over. */
  area: string
  /**
   * The line of parameters under the name: what the raster is, in what unit,
   * from what source, at what opacity.
   *
   * IT WAS CALLED `period` AND HAD STOPPED BEING ONE. The name dated from a
   * caption that carried an acquisition window and nothing else; the readings
   * have passed their whole parameter line through it for some time, and the
   * rasters now do too. A field whose name describes one of the things it
   * holds is the same defect as a label that exists twice -- it tells the next
   * caller to put an acquisition window here, and the box would then say two
   * different kinds of thing in one line depending on where the caption came
   * from.
   */
  detail?: string | null
}

export function OverlayCallouts({
  map,
  ready,
  captions,
}: {
  map: MapLibreMap | null
  /** The style is up. Adding a marker before it is is not an error, but the
   *  projection it would be placed by is the one about to be replaced. */
  ready: boolean
  captions: readonly {
    key: string
    /** Where the dot lands, [lon, lat]: the centre of the raster's extent. */
    at: [number, number]
    /** How far above the ground the raster it describes is drawn, in metres. */
    elevationM: number
    caption: OverlayCaption
  }[]
}) {
  /*
    One marker per raster, held across renders.

    A marker is a DOM node the library positions on every frame, so it is
    created once and updated, not rebuilt: remounting the React tree inside it
    each time the caption changed would drop the drag the reader is in the
    middle of.
  */
  const markers = useRef(new Map<string, { marker: Marker; root: Root }>())
  /** The captions as they are now, for a handler bound to the map's events. */
  const liveCaptions = useRef(captions)
  liveCaptions.current = captions
  /**
   * Put every anchor at its raster's height.
   *
   * As a pixel offset on the marker, since a marker's coordinate is on the
   * surface and there is no elevated one to give it. Negative Y is up.
   */
  const liftAll = useCallback(() => {
    if (!map) return
    for (const c of liveCaptions.current) {
      const held = markers.current.get(c.key)
      if (!held) continue
      held.marker.setOffset([0, -riseInPixels(map, c.at, c.elevationM)])
    }
  }, [map])

  useEffect(() => {
    if (!map || !ready) return
    const live = new Set(captions.map((c) => c.key))

    for (const [key, held] of markers.current) {
      if (live.has(key)) continue
      held.marker.remove()
      // Unmounted on a later task: React refuses to unmount a root while it is
      // rendering, and this effect can run inside that window.
      const root = held.root
      queueMicrotask(() => root.unmount())
      markers.current.delete(key)
    }

    for (const c of captions) {
      let held = markers.current.get(c.key)
      if (!held) {
        const el = document.createElement("div")
        // The element is the ANCHOR POINT, not the box: the library places its
        // centre at the coordinate, so anything drawn here is positioned
        // relative to the dot rather than to a corner of a card.
        el.style.width = "0"
        el.style.height = "0"
        /*
          Not `draggable`. The library's drag moves the marker, and the marker
          IS the anchor: using it would move the dot off the raster, which is
          the one thing the dot is for. The box does its own dragging below, in
          screen pixels, and the anchor stays on the ground.
        */
        const marker = new Marker({ element: el }).setLngLat(c.at).addTo(map)
        held = { marker, root: createRoot(el) }
        markers.current.set(c.key, held)
      } else {
        // Follows its raster. The box's offset is the reader's and is held
        // inside the mounted body, which survives this re-render.
        held.marker.setLngLat(c.at)
      }
      held.root.render(<CalloutBody caption={c.caption} />)
    }
    liftAll()
  }, [map, ready, captions, liftAll])

  /*
    The lift is re-applied on every camera move, because it is a function of
    the camera: a zoom changes the ground scale under the anchor and a pitch
    changes how much of a height is visible at all. Without this the legend
    stayed where it was drawn and slid off its raster as the reader turned.

    `move` covers zoom, pitch and rotate; it fires per frame during an
    animation, and the work per marker is one project and two unprojects.
  */
  useEffect(() => {
    if (!map || !ready) return
    map.on("move", liftAll)
    return () => {
      map.off("move", liftAll)
    }
  }, [map, ready, liftAll])

  useEffect(
    () => () => {
      for (const [, held] of markers.current) {
        held.marker.remove()
        const root = held.root
        queueMicrotask(() => root.unmount())
      }
      markers.current.clear()
    },
    []
  )

  return null
}

/**
 * The leader, from the box's edge to the dot.
 *
 * Two segments, as a drawn callout takes: a straight run off the box so the
 * line leaves it squarely, then one turn to the anchor. Which edge it leaves
 * from is decided by where the box has been dragged to -- a leader that always
 * left the bottom would run back THROUGH the box whenever the reader pushed it
 * below the dot.
 */
/**
 * How much of the stub stays straight before the leader turns.
 *
 * THE CORNER IS THE CURVE'S CONTROL POINT, which is what makes this one number
 * rather than a shape. The leader was a stub and then a straight run to the
 * dot, meeting at a hard elbow; the same two segments become one arc by
 * shortening the stub and handing the elbow to a quadratic as its control.
 * The curve is then tangent to the stub where it leaves the box -- so it still
 * departs square to the edge, which is what says which side of the box it
 * belongs to -- and tangent to the elbow-to-dot line where it arrives.
 *
 * A third of the stub. Nothing straight at all and the leader leaves the box
 * at whatever angle the dot happens to be in, which reads as a line thrown at
 * the box rather than one coming out of it; much more and the arc has too
 * little room left to bend and the elbow comes back.
 */
const STRAIGHT = 0.34

function leaderPath(dx: number, dy: number, boxH: number): string {
  // The box's rectangle, in the anchor's own frame.
  const left = dx
  const right = dx + BOX_W
  const top = dy
  const bottom = dy + boxH

  // Horizontal where the box is clearly to one side, vertical otherwise: the
  // comparison is against the box's own measure, so a box offset by less than
  // its width still leaves from the top or bottom rather than sideways.
  const horizontal = right < 0 || left > 0
  if (horizontal) {
    const x = right < 0 ? right : left
    const y = Math.min(Math.max(0, top + 12), bottom - 12)
    const stub = right < 0 ? STUB : -STUB
    return `M ${x} ${y} L ${x + stub * STRAIGHT} ${y} Q ${x + stub} ${y}, 0 0`
  }
  const y = bottom < 0 ? bottom : top
  const x = Math.min(Math.max(0, left + 24), right - 24)
  const stub = bottom < 0 ? STUB : -STUB
  return `M ${x} ${y} L ${x} ${y + stub * STRAIGHT} Q ${x} ${y + stub}, 0 0`
}

/** A gradient bar and the two ends it runs between. */
function Ramp({
  gradient,
  low,
  high,
}: {
  gradient: string
  low: string
  high: string
}) {
  return (
    <>
      <div
        className="mt-1.5 h-1.5 w-full rounded-[1px]"
        style={{ background: gradient }}
      />
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="telemetry text-micro text-muted-foreground">{low}</span>
        <span className="telemetry text-micro text-muted-foreground">
          {high}
        </span>
      </div>
    </>
  )
}

/**
 * What the legend says, cut to what a floating box can hold.
 *
 * The three kinds are the panel's own -- a ramp, a list of classes, or the
 * figures a run measured where its colour mapping is not published. Only the
 * first fits whole; the other two are cut to MAX_ROWS with a line saying what
 * was left, because the alternative to cutting is a box as tall as the panel
 * standing over the raster it describes.
 *
 * Classes are cut BY SHARE, largest first. Cut in the order the payload lists
 * them, a legend over a soybean field could report five classes covering four
 * percent of it and omit the one covering ninety.
 */
function LegendBody({ legend }: { legend: NonNullable<LayerLegend> }) {
  if (legend.kind === "ramp") {
    return (
      <Ramp gradient={legend.gradient} low={legend.low} high={legend.high} />
    )
  }

  if (legend.kind === "classes") {
    const ordered = [...legend.entries].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
    const shown = ordered.slice(0, MAX_ROWS)
    const rest = ordered.length - shown.length
    return (
      <div className="mt-1.5 flex flex-col gap-0.5">
        {shown.map((c) => (
          <div key={c.name} className="flex items-baseline gap-1.5">
            <span
              className="size-2 shrink-0 translate-y-[1px] rounded-[1px]"
              style={{ background: c.color }}
            />
            <span className="min-w-0 flex-1 truncate text-micro text-foreground">
              {c.name}
            </span>
            {c.pct != null && (
              <span className="telemetry shrink-0 text-micro text-muted-foreground">
                {c.pct.toFixed(1)}%
              </span>
            )}
          </div>
        ))}
        {rest > 0 && (
          <p className="mt-0.5 text-micro text-muted-foreground/70">
            {rest} more {rest === 1 ? "class" : "classes"} in the properties
            panel
          </p>
        )}
      </div>
    )
  }

  if (legend.kind === "note") {
    return (
      <p className="mt-1.5 text-micro leading-relaxed text-muted-foreground">
        {legend.note}
      </p>
    )
  }

  const shown = legend.rows.slice(0, MAX_ROWS)
  const rest = legend.rows.length - shown.length
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      {shown.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-micro text-muted-foreground">
            {r.label}
          </span>
          <span className="telemetry shrink-0 text-micro text-foreground">
            {r.value}
          </span>
        </div>
      ))}
      {rest > 0 && (
        <p className="mt-0.5 text-micro text-muted-foreground/70">
          {rest} more in the properties panel
        </p>
      )}
      {legend.ramp && (
        <Ramp
          gradient={legend.ramp.gradient}
          low={legend.ramp.low}
          high={legend.ramp.high}
        />
      )}
    </div>
  )
}

function CalloutBody({ caption }: { caption: OverlayCaption }) {
  /*
    Where the reader put it, in pixels from the anchor.

    Held here rather than by the parent: this body is rendered into a root that
    outlives every caption change, so its state is what survives a re-render
    without the parent having to keep a map of offsets in step with a map of
    markers.
  */
  const [off, setOff] = useState({ x: START_X, y: START_Y })
  const from = useRef<{ x: number; y: number } | null>(null)

  /*
    The box's height, measured rather than declared. It changes with the
    caption -- a product with no acquisition window is a line shorter -- and
    the leader has to know which edge faces the dot.
  */
  /*
    Whether the parameter line is showing in full, and whether it has anything
    to show. See the disclosure below.
  */
  const [openDetail, setOpenDetail] = useState(false)
  const [clipped, setClipped] = useState(false)
  const detailRef = useRef<HTMLSpanElement | null>(null)
  useLayoutEffect(() => {
    const el = detailRef.current
    if (!el || openDetail) return
    const read = () => setClipped(el.scrollWidth > el.clientWidth + 1)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [openDetail, clipped, caption.detail])

  const boxRef = useRef<HTMLDivElement | null>(null)
  const [boxH, setBoxH] = useState(BOX_H_GUESS)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const read = () => setBoxH(el.offsetHeight || BOX_H_GUESS)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Left button only, and the map must not also read this as a pan.
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()
      from.current = { x: e.clientX - off.x, y: e.clientY - off.y }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [off.x, off.y]
  )

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = from.current
    if (!start) return
    e.stopPropagation()
    setOff({ x: e.clientX - start.x, y: e.clientY - start.y })
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    from.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  return (
    <div className="relative">
      {/*
        THE LEADER, drawn behind the box and under no pointer.

        An SVG rather than two bordered divs: the corner is a single path, and
        a path is what stays one pixel at any device ratio. It runs from the
        box's lower edge, along and down to the dot, which is the shape a
        callout takes where the label sits above what it names.
      */}
      <svg
        aria-hidden
        className="pointer-events-none absolute"
        /*
          Zero-sized at the anchor with `overflow: visible`, so the path is
          drawn in the anchor's own coordinates: every number in leaderPath is
          then a pixel offset from the dot, and the box's position needs no
          second frame of reference to be reconciled with.
        */
        style={{ left: 0, top: 0, width: 0, height: 0, overflow: "visible" }}
      >
        {/* The halo FIRST. Later elements paint over earlier ones, so drawn
            second this wider stroke covered the line it exists to separate
            from the ground. */}
        <path
          d={leaderPath(off.x, off.y, boxH)}
          fill="none"
          stroke="rgb(var(--p-paper))"
          strokeWidth={3}
          strokeOpacity={0.35}
        />
        <path
          d={leaderPath(off.x, off.y, boxH)}
          fill="none"
          stroke="rgb(var(--p-ink))"
          strokeWidth={1}
          strokeOpacity={0.85}
        />
      </svg>

      {/* The dot, at the coordinate itself. */}
      <span
        aria-hidden
        className="absolute size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: "rgb(var(--p-ink))",
          boxShadow: "0 0 0 1.5px rgb(var(--p-paper) / 0.9)",
        }}
      />

      {/*
        The box, and the drag target. The pointer is captured on press, so a
        drag that leaves the box -- which every drag does, since the box moves
        out from under the pointer -- keeps reporting to the element that
        started it.
      */}
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="absolute cursor-grab select-none rounded-sm px-2.5 py-2 shadow-lg active:cursor-grabbing"
        style={{
          left: off.x,
          top: off.y,
          width: BOX_W,
          /* Touch must not scroll the map out from under a drag that has
             already started; the pointer is captured, but the browser's own
             gesture would still fire without this. */
          touchAction: "none",
          /*
            FROSTED, AND THE FILTER IS WHAT MAKES THAT SAFE.

            This was 0.94 -- opaque in all but name -- and the note here said
            why: it sits over satellite imagery, which is arbitrary in tone,
            and lib/contrast.ts records the accent measuring 1.43 against
            bright imagery through a plate at 0.55. Small text is what this box
            is made of, so a wash was not admissible.

            What a wash alone could not do, a wash under a FILTER can.
            `brightness` bounds the backdrop before the tint goes over it:
            imagery cannot arrive brighter than half of white, so the worst
            ground the plate can sit on is known rather than arbitrary. At 0.78
            over a backdrop at 0.5 the binding pair -- the accent eyebrow,
            which is the darkest thing written here -- measures 4.87 against
            pure white and 6.63 against dark ground. It was 5.46 and is now
            4.87: less headroom, still over the floor, and bought with a plate
            that shows the place it is standing on.

            THE BLUR IS DOING MORE THAN THE TINT HERE. What makes small text
            hard over imagery is not only the tone, it is the TEXTURE -- a
            field of speckle at the size of the letterforms. Sixteen pixels of
            scatter removes that structure whatever the imagery is, which is a
            legibility gain the old opaque plate got only by hiding the ground
            entirely.

            The saturation keeps the ground's identity through all of it: blur
            averages toward grey and brightness flattens, so without it the
            vegetation under the box arrives colourless and the plate reads as
            a dark rectangle rather than as glass over that place.

            Same construction as the run board's wires -- see GROUND in
            NodeCanvas -- and the same three terms in the same order.
          */
          background: "rgb(var(--p-ink) / 0.78)",
          backdropFilter: "blur(16px) brightness(0.5) saturate(1.25)",
          WebkitBackdropFilter: "blur(16px) brightness(0.5) saturate(1.25)",
          border: "1px solid rgb(var(--p-line) / 0.35)",
        }}
      >
        <p className="eyebrow !text-[9px] truncate text-primary">
          {caption.legend.subject}
        </p>
        <p className="mt-0.5 truncate text-emphasis italic text-foreground">
          {caption.area}
        </p>
        {caption.detail &&
          (clipped || openDetail ? (
            /*
              THE DISCLOSURE EXISTS ONLY WHERE THERE IS SOMETHING BEHIND IT.

              The parameter line is as long as the product has parameters --
              "Annual · kWh/m2/year · Copernicus DEM GLO-30 · 10 yr · opacity
              100%" in a box 216 wide -- so it clips, and a clipped line with
              no way past it is a box that says it knows more than it will
              tell. A reading's line can be short enough to fit, and there a
              caret would be a control that expands nothing.

              So it is measured rather than assumed: the span reports whether
              its own content overflows it, and the caret appears for that
              answer. Which is also why `clipped` is a dependency of the effect
              that measures -- the node it observes is a different one once the
              line becomes a button, and an observer left on the old node would
              answer for a box that is no longer there.

              `stopPropagation` on the press, because the box captures the
              pointer to be dragged: without it the capture takes the pointerup
              and the button's click never happens, which reads as a caret that
              does nothing.
            */
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setOpenDetail((v) => !v)}
              aria-expanded={openDetail}
              title={openDetail ? "Show less" : caption.detail}
              className="mt-0.5 flex w-full items-start gap-1 text-left text-muted-foreground transition-colors hover:text-foreground"
            >
              <CaretRight
                aria-hidden
                className={cn(
                  "mt-[3px] size-2.5 shrink-0 transition-transform",
                  openDetail && "rotate-90"
                )}
              />
              <span
                ref={detailRef}
                className={cn(
                  "telemetry min-w-0 flex-1 text-micro",
                  openDetail ? "leading-relaxed" : "truncate"
                )}
              >
                {caption.detail}
              </span>
            </button>
          ) : (
            <p className="telemetry text-micro text-muted-foreground">
              <span ref={detailRef} className="block truncate">
                {caption.detail}
              </span>
            </p>
          ))}
        <LegendBody legend={caption.legend} />
      </div>
    </div>
  )
}
