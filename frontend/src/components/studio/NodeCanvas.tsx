/**
 * A pannable, zoomable field of nodes joined by wires, drawn as Blender's and
 * Solara's node editors are.
 *
 * Generic over what the nodes hold: it owns the view, the gestures and the
 * geometry, and nothing about runs. `BoardRunGraph` supplies the nodes.
 *
 * A NODE IS A HEADER AND ROWS. The header is a narrow band in a dark tone of
 * the node's category, with a caret that folds the node to that band. Under it
 * come the rows: the node's output, its value written beside a socket on the
 * right edge, and one input per wire that arrives, its name and its state
 * beside a socket on the left edge. What the node holds -- its controls --
 * comes after the rows.
 *
 * NOTHING IS WRITTEN ON A WIRE. This board drew its wires as ribbons with the
 * value and the card's name set along them and the state set where they
 * landed; Solara, built on this studio, moved all of that onto the rows, and
 * this follows. A wire is a thin curve from an output socket to an input
 * socket, and says its state by how it is drawn:
 *
 *   missing   dashed grey, and the socket it lands on is hollow
 *   pending   the colour of the node it leaves, dimmed
 *   reading   that colour, dashed and flowing towards the node that reads it
 *   read      that colour
 *   failed    the failure colour
 *
 * THE PORTS THAT PULL ARE THE ONES THE READER PUT THERE, AND ONLY THOSE. A
 * node the caller marks `connectable` -- a card the reader added to the board
 * rather than one the request declares -- has an output socket that can be
 * pulled onto another node, and whether that means anything is the caller's
 * to say. Every other socket is a mark that takes no pointer events: the edges
 * are the shape of a request, and a socket that looked draggable and refused
 * would promise a freedom that does not exist.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowsOut, CaretDown, CaretRight } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { NODE_W, type Place } from "./runGraph"

/** The fixed geometry that places sockets without measuring rows. */
export const HEAD_H = 26
export const ROW_H = 22
export const BODY_PAD = 4
const SOCKET = 10

const MIN_ZOOM = 0.45
const MAX_ZOOM = 2.2
/** Space left around the graph when the view is fitted to it. */
const FIT_PAD = 32

export interface CanvasNode {
  /**
   * Whether this node's output socket can be pulled onto another node. See
   * the note at the top: only a node the reader added is.
   */
  connectable?: boolean
  id: string
  place: Place
  /**
   * The caller's own number until `onMeasure` has answered for this node, at
   * which point it is whatever was measured. A guess is enough to fit a view
   * the first time; the measurement is what the layout is kept by.
   */
  h: number
  header: React.ReactNode
  children: React.ReactNode
  /**
   * The run node, and a node on the graph that is not in the request. Each
   * has a header of its own; see --b-action-node and --b-aside-node.
   */
  tone?: "action" | "aside"
  /** A run under way, said on the node's outline. */
  status?: "busy"
  /**
   * The node's category, as three colours the caller measured together.
   *
   * `band` is the category at full strength: its sockets, the wires that leave
   * it, and a control lit inside it. `ink` is what is written on `band` where a
   * control is lit. `head` is the header, a dark tone of the same hue with light
   * type on it, as a node editor's headers are.
   */
  subject?: { band: string; ink: string; head: string }
}

export type EdgeState = "missing" | "pending" | "reading" | "read" | "failed"

export interface CanvasEdge {
  from: string
  to: string
  /** Absent for a wire that has no state to report: a rule between two cards. */
  state?: EdgeState
  /** The value the wire carries, written on the output row of the node it leaves. */
  label?: string
  /** What the input is called, written on the input row where the wire lands. */
  name?: string
  /** The state in a word, written at the end of that input row. */
  note?: string
  /** The wire's colour, and the sockets at both its ends: the node it leaves. */
  paint?: string
}

interface View {
  x: number
  y: number
  z: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/*
  The colour a state's word is written in on its row. Null takes the row's own
  muted colour: "not set" and "pending" are the whole message, and have no
  outcome to colour.
*/
const NOTE_COLOUR: Record<EdgeState, string | null> = {
  missing: null,
  pending: null,
  reading: "rgb(var(--p-accent))",
  read: "var(--success)",
  failed: "var(--p-wire-failed)",
}

/** A socket's colour where the caller gave none. */
const PLAIN = "var(--b-card-ink)"

/** One node's rows: its output, and an input per wire that arrives. */
export interface NodeRows {
  output?: { label: string; colour: string }
  inputs: {
    from: string
    label: string
    note?: string
    noteColour?: string
    colour: string
    hollow: boolean
  }[]
}

/**
 * The rows every node draws, from the edges.
 *
 * A node has an output row when a wire leaves it or when it is connectable;
 * the value written there is the first label any of its wires carries. Its
 * inputs are the wires that arrive, in the order the caller lists them, so a
 * row does not change places when a node above it is dragged.
 */
export function nodeRows(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[]
): Map<string, NodeRows> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const rows = new Map<string, NodeRows>(nodes.map((n) => [n.id, { inputs: [] }]))
  const colourOf = (e: CanvasEdge) => e.paint ?? byId.get(e.from)?.subject?.band ?? PLAIN
  for (const n of nodes) {
    const out = edges.filter((e) => e.from === n.id)
    if (out.length || n.connectable) {
      rows.get(n.id)!.output = {
        label: out.find((e) => e.label)?.label ?? "",
        colour: out[0] ? colourOf(out[0]) : n.subject?.band ?? PLAIN,
      }
    }
  }
  for (const e of edges) {
    const target = rows.get(e.to)
    if (!target || !byId.has(e.from)) continue
    target.inputs.push({
      from: e.from,
      label: e.name ?? e.from,
      note: e.note,
      noteColour: e.state ? NOTE_COLOUR[e.state] ?? undefined : undefined,
      colour: colourOf(e),
      hollow: e.state === "missing",
    })
  }
  return rows
}

/** Where a node's output socket is, in board units: its row, or the header's middle while folded. */
export function outputY(place: Place, folded: boolean): number {
  return place.y + (folded ? HEAD_H / 2 : HEAD_H + BODY_PAD + ROW_H / 2)
}

/** Where a node's input socket is: its row, under the output row when there is one. */
export function inputY(place: Place, index: number, hasOutput: boolean, folded: boolean): number {
  if (folded) return place.y + HEAD_H / 2
  return place.y + HEAD_H + BODY_PAD + (hasOutput ? ROW_H : 0) + index * ROW_H + ROW_H / 2
}

/** A wire from (x1, y1) to (x2, y2), leaving and arriving level. */
export function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const reach = clamp(Math.abs(x2 - x1) * 0.5, 30, 160)
  return `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${x2} ${y2}`
}

function Socket({
  colour,
  hollow,
  side,
}: {
  colour: string
  hollow?: boolean
  side: "left" | "right"
}) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 rounded-full"
      style={{
        width: SOCKET,
        height: SOCKET,
        marginTop: -SOCKET / 2,
        [side]: -SOCKET / 2,
        background: hollow ? "var(--b-card)" : colour,
        boxShadow: `0 0 0 1px ${hollow ? colour : "rgb(0 0 0 / 0.55)"}`,
      }}
    />
  )
}

export function NodeCanvas({
  nodes,
  edges,
  onMove,
  onMeasure,
  onConnect,
  className,
}: {
  nodes: readonly CanvasNode[]
  edges: readonly CanvasEdge[]
  /**
   * A port was pulled onto a node. The caller says whether that means
   * anything; see endDrag for why this field does not.
   */
  onConnect?: (from: string, to: string) => void
  /** A node was dragged. The caller owns where nodes are. */
  onMove: (id: string, place: Place) => void
  /**
   * What a node actually draws, once it has drawn.
   *
   * The caller lays nodes out before any of them exists, from a height written
   * by hand beside each kind of node. That number cannot be right for a node
   * whose contents depend on what is being asked, so the drawing is measured
   * and reported per node; the caller owns where nodes go.
   */
  onMeasure?: (id: string, h: number) => void
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View>({ x: FIT_PAD, y: FIT_PAD, z: 1 })

  /*
    Once the view has been moved BY HAND it is never moved again on its own.

    The fit below runs when the graph changes shape -- a different product
    brings a different set of nodes -- and running it after that would undo a
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
    // own size and centred, because scaling three nodes up to fill a wide area
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

  /* The graph's shape, so a changed set of nodes refits and a moved one does not. */
  const shape = nodes.map((n) => n.id).join(",")
  useLayoutEffect(() => {
    touched.current = false
    fit()
  }, [shape, fit])

  /*
    And again when the heights come back, which is one frame after the fit
    above and with different numbers. Keyed on the heights rather than on the
    places: a place changes when a node is dragged, and refitting there would
    take the view away from the reader mid-gesture.
  */
  const sizes = nodes.map((n) => Math.round(n.h)).join(",")
  useLayoutEffect(() => {
    if (!touched.current) fit()
  }, [sizes, fit])

  /*
    What each node draws, watched rather than asked for once: a node's height
    changes after its first frame -- a rule can block an option, a period can
    gain a scene list, and folding takes it down to its header. One observer for
    the field, with the element's id carried beside it.

    borderBoxSize, not getBoundingClientRect: the nodes live inside the zoom
    transform, so a rect measured off the screen is the height times whatever
    the view is at. The observer reports in the element's own space.
  */
  const measureRef = useRef(onMeasure)
  measureRef.current = onMeasure
  const watched = useRef(new Map<Element, string>())
  const nodeSizes = useRef<ResizeObserver | null>(null)
  if (nodeSizes.current === null && typeof ResizeObserver !== "undefined") {
    nodeSizes.current = new ResizeObserver((entries) => {
      for (const e of entries) {
        const id = watched.current.get(e.target)
        if (!id) continue
        const box = e.borderBoxSize?.[0]
        measureRef.current?.(id, box ? box.blockSize : e.contentRect.height)
      }
    })
  }
  useEffect(() => () => nodeSizes.current?.disconnect(), [])

  const watch = useCallback((id: string) => (el: HTMLDivElement | null) => {
    const ro = nodeSizes.current
    if (!ro) return
    for (const [node, seen] of watched.current) {
      if (seen === id && node !== el) {
        ro.unobserve(node)
        watched.current.delete(node)
      }
    }
    if (el) {
      watched.current.set(el, id)
      ro.observe(el)
    }
  }, [])

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
    Zoom about the pointer, on a listener registered by hand: React attaches
    wheel handlers passively, and a passive handler cannot call preventDefault,
    so the gesture would zoom the graph AND scroll whatever ancestor would.
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
        // The point under the pointer is the one that must not move.
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
    Which nodes are folded to their header. The canvas's own, as Blender keeps
    it on the node: folding changes how a node is drawn, not what it says, so
    the caller has nothing to hold.
  */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const toggleFold = (id: string) =>
    setFolded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /*
    One gesture at a time, held in a ref rather than in state: a drag writes on
    every pointermove and state there would re-render the whole graph to move
    one node by a pixel.
  */
  const drag = useRef<
    | { kind: "pan"; startX: number; startY: number; from: View }
    | { kind: "node"; id: string; startX: number; startY: number; from: Place }
    | { kind: "link"; from: string }
    | null
  >(null)

  /*
    The line being pulled, in board coordinates. State where the other two
    gestures use a ref: a link has nothing on screen until this draws it.
  */
  const [pulling, setPulling] = useState<{ from: string; x: number; y: number } | null>(null)

  const beginPan = (e: React.PointerEvent) => {
    // Middle button pans from anywhere; the left button pans only from the
    // field itself, so pressing a node is never mistaken for pressing past it.
    if (e.button !== 0 && e.button !== 1) return
    if (e.button === 0 && e.target !== e.currentTarget) return
    touched.current = true
    drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, from: view }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  /*
    The node last taken hold of, which is the one drawn in front, and stays in
    front after the gesture: dropping it behind another the moment it is
    released would undo the arrangement that was just made by hand. `lifted` is
    the same gesture's other half, cleared when it ends.
  */
  const [front, setFront] = useState<string | null>(null)
  const [lifted, setLifted] = useState<string | null>(null)

  const beginNode = (e: React.PointerEvent, id: string, place: Place) => {
    if (e.button !== 0) return
    e.stopPropagation()
    touched.current = true
    setFront(id)
    setLifted(id)
    drag.current = { kind: "node", id, startX: e.clientX, startY: e.clientY, from: place }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  /** Board coordinates for a pointer, which is what every hit test needs. */
  const atBoard = (e: React.PointerEvent) => {
    const r = hostRef.current?.getBoundingClientRect()
    if (!r) return null
    return {
      x: (e.clientX - r.left - view.x) / view.z,
      y: (e.clientY - r.top - view.y) / view.z,
    }
  }

  const beginLink = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    touched.current = true
    const at = atBoard(e)
    drag.current = { kind: "link", from: id }
    if (at) setPulling({ from: id, ...at })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.kind === "link") {
      const at = atBoard(e)
      if (at) setPulling({ from: d.from, ...at })
      return
    }
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (d.kind === "pan") {
      setView({ ...d.from, x: d.from.x + dx, y: d.from.y + dy })
      return
    }
    // Screen pixels are zoomed pixels: a node under a halved view has to move
    // twice as far in its own space to keep up with the pointer.
    onMove(d.id, { x: d.from.x + dx / view.z, y: d.from.y + dy / view.z })
  }

  /*
    A link ends on the node under the pointer, or nowhere. Hit tested against
    the node rectangles, which are what a reader aims at; the caller decides
    whether the pair means anything, since a field that knew which links were
    legal would be a field that knows what a run is.
  */
  const endDrag = (e?: React.PointerEvent) => {
    const d = drag.current
    if (d?.kind === "link" && e) {
      const at = atBoard(e)
      const onto = at
        ? nodes.find(
            (n) =>
              n.id !== d.from &&
              at.x >= n.place.x &&
              at.x <= n.place.x + NODE_W &&
              at.y >= n.place.y &&
              at.y <= n.place.y + (n.h ?? 0)
          )
        : undefined
      if (onto) onConnect?.(d.from, onto.id)
    }
    drag.current = null
    setLifted(null)
    setPulling(null)
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const rows = nodeRows(nodes, edges)

  const headOf = (n: CanvasNode) =>
    n.tone === "action"
      ? "var(--b-action-node)"
      : n.tone === "aside"
        ? "var(--b-aside-node)"
        : n.subject
          ? n.subject.head
          : "var(--b-card-node)"

  return (
    <div
      ref={hostRef}
      onPointerDown={beginPan}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={() => endDrag()}
      className={cn(
        "app-no-drag relative h-full w-full overflow-hidden touch-none select-none",
        className
      )}
      style={{
        background: "var(--s-field)",
        /*
          A dot grid that travels with the view, which is what makes a pan
          legible: without it the nodes slide against nothing.
        */
        backgroundImage: "radial-gradient(rgb(var(--p-line) / 0.45) 1px, transparent 1px)",
        backgroundSize: `${24 * view.z}px ${24 * view.z}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        cursor:
          drag.current?.kind === "pan" ? "var(--cursor-grabbing)" : "var(--cursor-default)",
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
      >
        {/* The wires, under the nodes and in the same space. */}
        <svg
          width={1}
          height={1}
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
        >
          {edges.map((edge) => {
            const a = byId.get(edge.from)
            const b = byId.get(edge.to)
            const index = rows.get(edge.to)?.inputs.findIndex((r) => r.from === edge.from) ?? -1
            if (!a || !b || index < 0) return null
            const x1 = a.place.x + NODE_W
            const y1 = outputY(a.place, folded.has(a.id))
            const x2 = b.place.x
            const y2 = inputY(b.place, index, !!rows.get(b.id)?.output, folded.has(b.id))
            const d = wirePath(x1, y1, x2, y2)
            const st = edge.state
            const stroke =
              st === "failed"
                ? "var(--p-wire-failed)"
                : st === "missing"
                  ? "rgb(var(--p-line-strong))"
                  : edge.paint ?? a.subject?.band ?? PLAIN
            return (
              <g key={`${edge.from}-${edge.to}`}>
                {/* A dark underlay, so a wire stays a line where it crosses another. */}
                {st !== "missing" && (
                  <path d={d} fill="none" stroke="rgb(0 0 0 / 0.45)" strokeWidth={4} />
                )}
                <path
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={st === "missing" ? 1.5 : 2}
                  strokeOpacity={st === "pending" ? 0.5 : st === "missing" ? 0.6 : 1}
                  strokeDasharray={
                    st === "missing" ? "3 4" : st === "reading" ? "8 4" : undefined
                  }
                  className={st === "reading" ? "wire-flow" : undefined}
                />
              </g>
            )
          })}
          {/*
            The line being pulled: dashed and thin, which is the vocabulary a
            wire that carries nothing already has -- and it carries nothing
            until it lands.
          */}
          {pulling && byId.get(pulling.from) && (
            <line
              x1={byId.get(pulling.from)!.place.x + NODE_W}
              y1={outputY(byId.get(pulling.from)!.place, folded.has(pulling.from))}
              x2={pulling.x}
              y2={pulling.y}
              stroke="rgb(var(--p-accent))"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          )}
        </svg>

        {nodes.map((n) => {
          const isFolded = folded.has(n.id)
          const r = rows.get(n.id)
          return (
            <div
              key={n.id}
              ref={watch(n.id)}
              className="absolute rounded-md transition-shadow duration-150"
              style={{
                left: n.place.x,
                top: n.place.y,
                width: NODE_W,
                background: "var(--b-card)",
                /*
                  A lit control inside the node -- a chosen option -- is drawn
                  in the node's own colour. Declared here because the depth is
                  arbitrary and the answer is not: everything inside this box
                  belongs to this node.
                */
                ["--b-lit" as string]:
                  n.tone === "action"
                    ? "var(--b-action-head)"
                    : n.tone === "aside"
                      ? "var(--b-aside-head)"
                      : n.subject
                        ? n.subject.band
                        : "var(--b-card-head)",
                ["--b-lit-ink" as string]:
                  n.tone === "action"
                    ? "var(--b-action-ink)"
                    : n.tone === "aside"
                      ? "var(--b-aside-ink)"
                      : n.subject
                        ? n.subject.ink
                        : "var(--b-card-ink)",
                /*
                  A hairline and a shadow, as Blender outlines a node; a run
                  under way takes the warning on the hairline, the one place on
                  the node that can carry it without covering what it says.
                */
                boxShadow: `0 0 0 1px ${
                  n.status === "busy" ? "var(--warning)" : "rgb(0 0 0 / 0.6)"
                }, ${
                  lifted === n.id
                    ? "0 14px 34px -10px rgb(0 0 0 / 0.62)"
                    : "0 4px 14px -6px rgb(0 0 0 / 0.6)"
                }`,
                zIndex: front === n.id ? 1 : undefined,
              }}
            >
              {/*
                The header is the handle. Dragging from anywhere on the node
                would mean a date field or a number could not be swiped
                through, and those are the controls the node exists to hold.
              */}
              <div
                onPointerDown={(e) => beginNode(e, n.id, n.place)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className={cn(
                  "relative flex cursor-grab items-center gap-1 pl-1 pr-2 text-body active:cursor-grabbing",
                  isFolded ? "rounded-md" : "rounded-t-md"
                )}
                style={{ height: HEAD_H, background: headOf(n), color: "var(--b-node-ink)" }}
              >
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => toggleFold(n.id)}
                  aria-expanded={!isFolded}
                  aria-label={isFolded ? "Unfold" : "Fold"}
                  className="grid size-4 shrink-0 place-items-center rounded-sm opacity-80 hover:bg-hover hover:opacity-100"
                >
                  {isFolded ? (
                    <CaretRight className="size-2.5" weight="bold" />
                  ) : (
                    <CaretDown className="size-2.5" weight="bold" />
                  )}
                </button>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">{n.header}</span>
                {isFolded && r?.output && <Socket colour={r.output.colour} side="right" />}
                {isFolded && !!r?.inputs.length && (
                  <Socket colour={r.inputs[0].colour} side="left" />
                )}
              </div>

              {!isFolded && (
                <div style={{ paddingTop: BODY_PAD }}>
                  {r?.output && (
                    <div
                      className="relative flex items-center justify-end gap-2 px-2.5 text-meta"
                      style={{ height: ROW_H }}
                    >
                      <span className="min-w-0 truncate text-foreground" title={r.output.label}>
                        {r.output.label}
                      </span>
                      {n.connectable ? (
                        /*
                          The one socket that takes a pointer: the output of a
                          node the reader added, pulled onto another node.
                        */
                        <span
                          role="button"
                          aria-label={`Connect ${n.id}`}
                          onPointerDown={(e) => beginLink(e, n.id)}
                          onPointerMove={onPointerMove}
                          onPointerUp={endDrag}
                          onPointerCancel={() => endDrag()}
                          className="absolute top-1/2 z-10 grid cursor-crosshair place-items-center"
                          style={{ width: 16, height: 16, marginTop: -8, right: -8 }}
                        >
                          <span
                            className="rounded-full transition-transform hover:scale-125"
                            style={{
                              width: SOCKET,
                              height: SOCKET,
                              background: r.output.colour,
                              boxShadow: "0 0 0 1px rgb(0 0 0 / 0.55)",
                            }}
                          />
                        </span>
                      ) : (
                        <Socket colour={r.output.colour} side="right" />
                      )}
                    </div>
                  )}
                  {r?.inputs.map((s) => (
                    <div
                      key={s.from}
                      className="relative flex items-center gap-2 px-2.5 text-meta"
                      style={{ height: ROW_H }}
                    >
                      <Socket colour={s.colour} side="left" hollow={s.hollow} />
                      <span className="min-w-0 flex-1 truncate text-foreground">{s.label}</span>
                      {s.note && (
                        <span
                          className="shrink-0 text-micro"
                          style={{ color: s.noteColour ?? "var(--muted-foreground)" }}
                        >
                          {s.note}
                        </span>
                      )}
                    </div>
                  ))}
                  <div className="flex flex-col gap-1.5 px-2.5 pb-2 pt-1">{n.children}</div>
                </div>
              )}
            </div>
          )
        })}
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
          "bg-selected text-muted-foreground transition-colors",
          "hover:bg-hover hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        )}
      >
        <ArrowsOut className="size-3.5" />
      </button>
    </div>
  )
}
