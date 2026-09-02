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
 * RAMPS ONLY. A class legend is a list of swatches -- MapBiomas alone runs to
 * dozens -- and a list that long over imagery is a panel that happens to be
 * floating. Where the legend is not a ramp, nothing is drawn and the panel
 * remains the place it is read.
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
import { Marker, type Map as MapLibreMap } from "maplibre-gl"
import { createRoot, type Root } from "react-dom/client"

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

/** The straight run the leader takes off the box before it turns. */
const STUB = 22

export interface OverlayCaption {
  /** What is measured, and in what unit: "Irradiation · kWh/m2/year". */
  subject: string
  /** The CSS gradient the raster was painted from, never written by hand. */
  gradient: string
  low: string
  high: string
  /** The ground it was measured over. */
  area: string
  /** The acquisition window, where the product has one. */
  period?: string | null
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
  }, [map, ready, captions])

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
    return `M ${x} ${y} L ${x + stub} ${y} L 0 0`
  }
  const y = bottom < 0 ? bottom : top
  const x = Math.min(Math.max(0, left + 24), right - 24)
  const stub = bottom < 0 ? STUB : -STUB
  return `M ${x} ${y} L ${x} ${y + stub} L 0 0`
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
            Opaque, not a wash. This sits over satellite imagery, which is
            arbitrary in tone: lib/contrast.ts records the accent measuring
            1.43 against bright imagery through a plate at 0.55, and small text
            is what this is made of.
          */
          background: "rgb(var(--p-ink) / 0.94)",
          border: "1px solid rgb(var(--p-line) / 0.35)",
        }}
      >
        <p className="eyebrow !text-[9px] truncate text-primary">
          {caption.subject}
        </p>
        <p className="mt-0.5 truncate text-emphasis italic text-foreground">
          {caption.area}
        </p>
        {caption.period && (
          <p className="telemetry truncate text-micro text-muted-foreground">
            {caption.period}
          </p>
        )}
        <div
          className="mt-1.5 h-1.5 w-full rounded-[1px]"
          style={{ background: caption.gradient }}
        />
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="telemetry text-micro text-muted-foreground">
            {caption.low}
          </span>
          <span className="telemetry text-micro text-muted-foreground">
            {caption.high}
          </span>
        </div>
      </div>
    </div>
  )
}
