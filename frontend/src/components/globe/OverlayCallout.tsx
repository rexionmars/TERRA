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
 * DRAGGABLE, because a legend over the part of the raster you are reading is a
 * legend in the way. It is born at the centre of the raster's extent, where it
 * is unambiguous about ownership, and moved from there. The offset between dot
 * and box is fixed: dragging moves both, so the leader never becomes a line
 * whose length is the thing the reader is asked to interpret.
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
import { useEffect, useRef } from "react"
import { Marker, type Map as MapLibreMap } from "maplibre-gl"
import { createRoot, type Root } from "react-dom/client"

/** How far the box sits from its anchor, in pixels. */
const OFFSET_X = -232
const OFFSET_Y = -104

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
  /** Where the reader dragged each one, so a re-render does not put it back. */
  const moved = useRef(new Map<string, [number, number]>())

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
      moved.current.delete(key)
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
        const marker = new Marker({ element: el, draggable: true })
          .setLngLat(moved.current.get(c.key) ?? c.at)
          .addTo(map)
        marker.on("dragend", () => {
          const { lng, lat } = marker.getLngLat()
          moved.current.set(c.key, [lng, lat])
        })
        held = { marker, root: createRoot(el) }
        markers.current.set(c.key, held)
      } else if (!moved.current.has(c.key)) {
        // Follows the raster while it is where it was put. Once dragged, the
        // reader's placement wins: a legend that jumped back to the centroid
        // because the extent was recomputed would undo the drag.
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

function CalloutBody({ caption }: { caption: OverlayCaption }) {
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
        style={{
          left: OFFSET_X,
          top: OFFSET_Y,
          width: -OFFSET_X,
          height: -OFFSET_Y,
          overflow: "visible",
        }}
      >
        <path
          d={`M 96 ${-OFFSET_Y - 96} L 96 ${-OFFSET_Y - 24} L ${-OFFSET_X} ${-OFFSET_Y}`}
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
        The box. `cursor-grab` because the whole of it is the drag target --
        MapLibre listens on the marker's element, and the element is this.
      */}
      <div
        className="absolute w-[13.5rem] cursor-grab select-none rounded-sm px-2.5 py-2 shadow-lg active:cursor-grabbing"
        style={{
          left: OFFSET_X,
          top: OFFSET_Y,
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
