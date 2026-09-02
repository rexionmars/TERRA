/**
 * A pannable, zoomable field of draggable cards joined by wires.
 *
 * Generic over what the cards hold: it owns the view, the gestures and the
 * geometry, and nothing about runs. `BoardRunGraph` supplies the nodes.
 *
 * WHAT IT DELIBERATELY DOES NOT HAVE IS PORTS YOU CAN PULL. The edges it draws
 * come from the graph its caller passes and cannot be made or broken, because
 * the graph is the shape of a request rather than an arrangement someone
 * chose. A port that looked draggable and refused to drag would promise a
 * freedom that does not exist -- so the ends are drawn as small filled marks
 * and take no pointer events at all.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowsOut } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { NODE_W, PORT_Y, type Place } from "./runGraph"

const MIN_ZOOM = 0.45
const MAX_ZOOM = 2.2
/** Space left around the graph when the view is fitted to it. */
const FIT_PAD = 32

export interface CanvasNode {
  id: string
  place: Place
  /**
   * Roughly how tall the card draws.
   *
   * Read only to fit the view around the graph. Wires do not need it -- they
   * meet the card on its header row, at a known offset from its top edge --
   * and the card itself is sized by its contents like any other element.
   */
  h: number
  header: React.ReactNode
  children: React.ReactNode
  /**
   * How the card is lit, and the two are DIFFERENT CLAIMS.
   *
   * "action" is the card the others arrive at, so the eye finds the end of the
   * graph. Its header is filled.
   *
   * "held" is a card that is carrying something -- an area has been drawn or
   * chosen -- against the same card when it is empty. It is OUTLINED and never
   * filled, because a fill here would read as a second run button, and because
   * the difference between "this is the action" and "this has a value" has to
   * survive both being lit at once. The accent is the only colour this chassis
   * has to say either with, so the shapes carry the distinction.
   *
   * Absent is a card with nothing to report about itself: the period and the
   * model always hold a value, so lighting them would be a light that is
   * always on.
   */
  tone?: "action" | "held"
}

interface View {
  x: number
  y: number
  z: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * A wire from one card's right edge to another's left.
 *
 * Cubic rather than straight, with the handles pushed out horizontally: a
 * straight line between two cards in the same column would lie along their
 * shared edge and read as a border, and the curve is what says these two are
 * joined rather than adjacent. The handle length follows the gap so a short
 * hop does not loop and a long one does not sag.
 */
function wirePath(from: Place, to: Place): string {
  const x1 = from.x + NODE_W
  const y1 = from.y + PORT_Y
  const x2 = to.x
  const y2 = to.y + PORT_Y
  const reach = clamp(Math.abs(x2 - x1) * 0.55, 26, 130)
  return `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${x2} ${y2}`
}

export function NodeCanvas({
  nodes,
  edges,
  onMove,
  className,
}: {
  nodes: readonly CanvasNode[]
  edges: readonly (readonly [string, string])[]
  /** A card was dragged. The caller owns where cards are. */
  onMove: (id: string, place: Place) => void
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View>({ x: FIT_PAD, y: FIT_PAD, z: 1 })

  /*
    Once the view has been moved BY HAND it is never moved again on its own.

    The fit below runs when the graph changes shape -- a different product
    brings a different set of cards -- and running it after that would undo a
    reader's own pan every time they switched tools and came back.
  */
  const touched = useRef(false)

  const placesRef = useRef(nodes)
  placesRef.current = nodes

  const fit = useCallback(() => {
    const host = hostRef.current
    const list = placesRef.current
    if (!host || !list.length) return
    const w = host.clientWidth
    const h = host.clientHeight
    if (!w || !h) return

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of list) {
      minX = Math.min(minX, n.place.x)
      minY = Math.min(minY, n.place.y)
      maxX = Math.max(maxX, n.place.x + NODE_W)
      maxY = Math.max(maxY, n.place.y + n.h)
    }
    const gw = maxX - minX
    const gh = maxY - minY
    // Never magnified to fill: a graph smaller than its pane is drawn at its
    // own size and centred, because scaling three cards up to fill a wide area
    // makes the type large and says nothing new.
    const z = clamp(
      Math.min((w - FIT_PAD * 2) / gw, (h - FIT_PAD * 2) / gh),
      MIN_ZOOM,
      1
    )
    setView({
      z,
      x: (w - gw * z) / 2 - minX * z,
      y: (h - gh * z) / 2 - minY * z,
    })
  }, [])

  /* The graph's shape, so a changed set of cards refits and a moved one does not. */
  const shape = nodes.map((n) => n.id).join(",")
  useLayoutEffect(() => {
    touched.current = false
    fit()
  }, [shape, fit])

  /* And once more when the pane itself is resized, until the reader takes over. */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ro = new ResizeObserver(() => {
      if (!touched.current) fit()
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [fit])

  /*
    Zoom about the pointer, on a listener registered by hand.

    React attaches wheel handlers passively, and a passive handler cannot call
    preventDefault -- so the gesture would zoom the graph AND scroll whatever
    ancestor was willing to scroll. Registered here with `passive: false`, the
    wheel belongs to this surface entirely.
  */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      touched.current = true
      const rect = host.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      setView((v) => {
        const z = clamp(v.z * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM)
        // The point under the pointer is the one that must not move: solve the
        // new offset from the world coordinate it maps to at the old zoom.
        return {
          z,
          x: px - ((px - v.x) / v.z) * z,
          y: py - ((py - v.y) / v.z) * z,
        }
      })
    }
    host.addEventListener("wheel", onWheel, { passive: false })
    return () => host.removeEventListener("wheel", onWheel)
  }, [])

  /*
    One gesture at a time, held in a ref rather than in state: a drag writes on
    every pointermove and state there would re-render the whole graph to move
    one card by a pixel.
  */
  const drag = useRef<
    | { kind: "pan"; startX: number; startY: number; from: View }
    | { kind: "node"; id: string; startX: number; startY: number; from: Place }
    | null
  >(null)

  const beginPan = (e: React.PointerEvent) => {
    // Middle button pans from anywhere; the left button pans only from the
    // field itself, so pressing a card is never mistaken for pressing past it.
    if (e.button !== 0 && e.button !== 1) return
    if (e.button === 0 && e.target !== e.currentTarget) return
    touched.current = true
    drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, from: view }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const beginNode = (e: React.PointerEvent, id: string, place: Place) => {
    if (e.button !== 0) return
    e.stopPropagation()
    touched.current = true
    drag.current = { kind: "node", id, startX: e.clientX, startY: e.clientY, from: place }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (d.kind === "pan") {
      setView({ ...d.from, x: d.from.x + dx, y: d.from.y + dy })
      return
    }
    // Screen pixels are zoomed pixels: a card under a halved view has to move
    // twice as far in its own space to keep up with the pointer.
    onMove(d.id, { x: d.from.x + dx / view.z, y: d.from.y + dy / view.z })
  }

  const endDrag = () => {
    drag.current = null
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))

  return (
    <div
      ref={hostRef}
      onPointerDown={beginPan}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        "app-no-drag relative h-full w-full overflow-hidden touch-none select-none",
        className
      )}
      style={{
        /*
          The field is a dot grid that travels with the view, which is what
          makes a pan legible: without it the cards slide against nothing and
          the gesture reads as the cards moving rather than the eye.

          Drawn from --p-line at a low alpha through a gradient rather than
          through the `line` scale, which is declared with a Tailwind v3
          <alpha-value> placeholder and compiles to a rule the parser drops --
          see the note on LEVEL_CLASS in components/ActivityGrid.tsx.
        */
        backgroundImage:
          "radial-gradient(rgb(var(--p-line) / 0.55) 1px, transparent 1px)",
        backgroundSize: `${24 * view.z}px ${24 * view.z}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        cursor:
          drag.current?.kind === "pan"
            ? "var(--cursor-grabbing)"
            : "var(--cursor-default)",
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
        }}
      >
        {/*
          The wires sit under the cards, in the same space.

          A 1x1 box with overflow visible rather than a sized viewport: the
          graph has no fixed extent once cards can be dragged anywhere, and a
          box big enough for every arrangement would be a box that decides how
          far the field goes.
        */}
        <svg
          width={1}
          height={1}
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
        >
          {edges.map(([from, to]) => {
            const a = byId.get(from)
            const b = byId.get(to)
            if (!a || !b) return null
            return (
              <g key={`${from}-${to}`}>
                <path
                  d={wirePath(a.place, b.place)}
                  fill="none"
                  stroke="rgb(var(--p-line-strong))"
                  strokeWidth={1.5}
                />
                {/* The ends, marking where a wire meets a card. Filled dots
                    rather than rings, so they read as terminals and not as
                    sockets waiting to be pulled out of. */}
                <circle
                  cx={a.place.x + NODE_W}
                  cy={a.place.y + PORT_Y}
                  r={3}
                  fill="rgb(var(--p-line-strong))"
                />
                <circle
                  cx={b.place.x}
                  cy={b.place.y + PORT_Y}
                  r={3}
                  fill="rgb(var(--p-line-strong))"
                />
              </g>
            )
          })}
        </svg>

        {nodes.map((n) => (
          <div
            key={n.id}
            className={cn(
              "absolute rounded-md border shadow-lg",
              n.tone === "action"
                ? "border-accent/60"
                : n.tone === "held"
                  ? "border-accent/45"
                  : "border-line-strong/45"
            )}
            style={{
              left: n.place.x,
              top: n.place.y,
              width: NODE_W,
              background: "rgb(var(--p-surface))",
            }}
          >
            {/*
              The header is the handle. Dragging from anywhere on the card would
              mean a date field or a number could not be swiped through, and
              those are the controls the card exists to hold.
            */}
            <div
              onPointerDown={(e) => beginNode(e, n.id, n.place)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={cn(
                "flex h-[2.125rem] cursor-grab items-center gap-1.5 rounded-t-md px-2.5 active:cursor-grabbing",
                n.tone === "action" ? "bg-accent-dim" : "bg-surface-raised/70"
              )}
            >
              {n.header}
            </div>
            <div className="flex flex-col gap-1.5 px-2.5 py-2">{n.children}</div>
          </div>
        ))}
      </div>

      {/*
        One control, and it is the way back. A field that can be panned can be
        panned off the edge of what it holds, and without this the only way to
        find the graph again would be to guess which direction it went.
      */}
      <button
        type="button"
        onClick={() => {
          touched.current = false
          fit()
        }}
        title="Fit the graph to the view"
        className={cn(
          "absolute bottom-2 right-2 flex size-7 items-center justify-center rounded-sm",
          "bg-surface-raised/80 text-muted-foreground transition-colors",
          "hover:bg-surface-raised hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        )}
      >
        <ArrowsOut className="size-3.5" />
      </button>
    </div>
  )
}
