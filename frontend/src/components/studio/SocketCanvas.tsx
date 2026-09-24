/**
 * A node field whose nodes declare their sockets, as Blender's compositor and
 * shader editors draw them.
 *
 * WHY NOT NodeCanvas. That field draws the run graph, where the edges are the
 * shape of a request: a node's input rows exist because a wire arrives, and a
 * socket only pulls where the reader added the card. Here the reader builds
 * the graph, so every socket exists whether or not anything is linked to it,
 * a link joins one output socket to one input socket, and pulling a link off
 * an input is how it is removed -- Blender's gestures, which a request-shaped
 * field would have to be taught to refuse. The view mechanics are the same as
 * NodeCanvas's and are written the same way; the geometry constants and the
 * wire curve are its own, imported.
 *
 * A NODE IS A HEADER, ITS OUTPUTS, ITS INPUTS, THEN ITS SETTINGS. Blender sets
 * some settings between the outputs and the inputs; they are set after both
 * here, so every socket sits at a height known without measuring a row.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowsOut, CaretDown, CaretRight } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { BODY_PAD, HEAD_H, ROW_H, wirePath } from "./NodeCanvas"

export type Place = { x: number; y: number }

const SOCKET = 10
/** How far from a socket, in board units, a dropped link still lands on it. */
const SOCKET_REACH = 14
const MIN_ZOOM = 0.3
const MAX_ZOOM = 2.2
const FIT_PAD = 32

export interface SocketRow {
  id: string
  label: string
  colour: string
  /** An input with a link on it. Unlinked inputs are written in the muted colour. */
  linked?: boolean
}

export interface SocketNode {
  id: string
  place: Place
  w: number
  /** A guess until measured; see NodeCanvas for why both exist. */
  h: number
  header: React.ReactNode
  /** The header band's colour. */
  head: string
  /** What a chosen control inside the node is drawn in: see nodeCard's Choice. */
  lit: { band: string; ink: string }
  outputs: SocketRow[]
  inputs: SocketRow[]
  children: React.ReactNode
  selected?: boolean
  status?: "busy"
}

export interface SocketLink {
  from: string
  fromSocket: string
  to: string
  toSocket: string
  colour: string
  state?: "ok" | "pending" | "failed"
}

/** What the editor may ask of the field from outside a gesture. */
export interface CanvasApi {
  /** Board coordinates of a window point. */
  toBoard: (clientX: number, clientY: number) => Place
  /** The board point at the middle of the pane. */
  centre: () => Place
  fit: () => void
}

interface View {
  x: number
  y: number
  z: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function outputSocketY(node: SocketNode, index: number, folded: boolean): number {
  if (folded) return node.place.y + HEAD_H / 2
  return node.place.y + HEAD_H + BODY_PAD + index * ROW_H + ROW_H / 2
}

export function inputSocketY(node: SocketNode, index: number, folded: boolean): number {
  if (folded) return node.place.y + HEAD_H / 2
  return node.place.y + HEAD_H + BODY_PAD + (node.outputs.length + index) * ROW_H + ROW_H / 2
}

function Socket({
  colour,
  side,
  onPointerDown,
  label,
}: {
  colour: string
  side: "left" | "right"
  onPointerDown?: (e: React.PointerEvent) => void
  label: string
}) {
  return (
    <span
      role="button"
      aria-label={label}
      onPointerDown={onPointerDown}
      className="absolute top-1/2 z-10 grid cursor-crosshair place-items-center"
      style={{ width: 16, height: 16, marginTop: -8, [side]: -8 }}
    >
      <span
        className="rounded-full transition-transform hover:scale-125"
        style={{
          width: SOCKET,
          height: SOCKET,
          background: colour,
          boxShadow: "0 0 0 1px rgb(0 0 0 / 0.55)",
        }}
      />
    </span>
  )
}

export function SocketCanvas({
  nodes,
  links,
  onMove,
  onMoveEnd,
  onMeasure,
  onLink,
  onUnlink,
  onSelect,
  apiRef,
  className,
}: {
  nodes: readonly SocketNode[]
  links: readonly SocketLink[]
  onMove: (id: string, place: Place) => void
  /** A node drag ended: the moment a caller that holds places elsewhere writes them. */
  onMoveEnd?: () => void
  onMeasure?: (id: string, h: number) => void
  /**
   * A link was pulled from an output and let go over an input -- `toSocket` --
   * or over a node's body, where the caller chooses the input (null).
   */
  onLink: (from: string, fromSocket: string, to: string, toSocket: string | null) => void
  /** A link was pulled off the input it landed on. */
  onUnlink: (to: string, toSocket: string) => void
  /** A node was pressed, or the empty field (null). */
  onSelect: (id: string | null, mods: { ctrl: boolean; shift: boolean }) => void
  apiRef?: React.RefObject<CanvasApi | null>
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View>({ x: FIT_PAD, y: FIT_PAD, z: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  /* Once moved by hand, the view is never moved on its own again. */
  const touched = useRef(false)

  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  const fit = useCallback(() => {
    const host = hostRef.current
    const list = nodesRef.current
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
      maxX = Math.max(maxX, n.place.x + n.w)
      maxY = Math.max(maxY, n.place.y + n.h)
    }
    const gw = maxX - minX
    const gh = maxY - minY
    // Never magnified to fill, for the reason NodeCanvas gives.
    const z = clamp(Math.min((w - FIT_PAD * 2) / gw, (h - FIT_PAD * 2) / gh), MIN_ZOOM, 1)
    setView({ z, x: (w - gw * z) / 2 - minX * z, y: (h - gh * z) / 2 - minY * z })
  }, [])

  const sizes = nodes.map((n) => `${n.id}:${Math.round(n.h)}`).join(",")
  useLayoutEffect(() => {
    if (!touched.current) fit()
  }, [sizes, fit])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ro = new ResizeObserver(() => {
      if (!touched.current) fit()
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [fit])

  const toBoard = useCallback((clientX: number, clientY: number): Place => {
    const r = hostRef.current?.getBoundingClientRect()
    const v = viewRef.current
    if (!r) return { x: 0, y: 0 }
    return { x: (clientX - r.left - v.x) / v.z, y: (clientY - r.top - v.y) / v.z }
  }, [])

  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      toBoard,
      centre: () => {
        const r = hostRef.current?.getBoundingClientRect()
        return r ? toBoard(r.left + r.width / 2, r.top + r.height / 2) : { x: 0, y: 0 }
      },
      fit: () => {
        touched.current = false
        fit()
      },
    }
    return () => {
      apiRef.current = null
    }
  }, [apiRef, toBoard, fit])

  /* Measured heights, through one observer; see NodeCanvas for borderBoxSize. */
  const measureRef = useRef(onMeasure)
  measureRef.current = onMeasure
  const watched = useRef(new Map<Element, string>())
  const observer = useRef<ResizeObserver | null>(null)
  if (observer.current === null && typeof ResizeObserver !== "undefined") {
    observer.current = new ResizeObserver((entries) => {
      for (const e of entries) {
        const id = watched.current.get(e.target)
        if (!id) continue
        const box = e.borderBoxSize?.[0]
        measureRef.current?.(id, box ? box.blockSize : e.contentRect.height)
      }
    })
  }
  useEffect(() => () => observer.current?.disconnect(), [])
  const watch = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      const ro = observer.current
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
    },
    []
  )

  /* Zoom about the pointer, on a non-passive listener: see NodeCanvas. */
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
        return { z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z }
      })
    }
    host.addEventListener("wheel", onWheel, { passive: false })
    return () => host.removeEventListener("wheel", onWheel)
  }, [])

  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const toggleFold = (id: string) =>
    setFolded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  /*
    One gesture at a time. Every gesture captures the pointer on the field
    itself, so its moves and its release arrive here whichever element it
    began on.
  */
  const drag = useRef<
    | { kind: "pan"; startX: number; startY: number; from: View }
    | { kind: "node"; id: string; startX: number; startY: number; from: Place }
    | { kind: "link"; from: string; fromSocket: string }
    | null
  >(null)
  const [pulling, setPulling] = useState<{
    from: string
    fromSocket: string
    x: number
    y: number
  } | null>(null)
  const [front, setFront] = useState<string | null>(null)

  const capture = (e: React.PointerEvent) => hostRef.current?.setPointerCapture(e.pointerId)

  const beginPan = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    if (e.button === 0 && e.target !== e.currentTarget) return
    if (e.button === 0) onSelect(null, { ctrl: false, shift: false })
    touched.current = true
    drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, from: view }
    capture(e)
  }

  const beginNode = (e: React.PointerEvent, n: SocketNode) => {
    if (e.button !== 0) return
    e.stopPropagation()
    touched.current = true
    setFront(n.id)
    drag.current = { kind: "node", id: n.id, startX: e.clientX, startY: e.clientY, from: n.place }
    capture(e)
  }

  const beginLink = (e: React.PointerEvent, from: string, fromSocket: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    touched.current = true
    drag.current = { kind: "link", from, fromSocket }
    setPulling({ from, fromSocket, ...toBoard(e.clientX, e.clientY) })
    capture(e)
  }

  /* Pressing a linked input takes the link off it and puts it in the hand, as Blender does. */
  const pullOff = (e: React.PointerEvent, to: string, toSocket: string) => {
    if (e.button !== 0) return
    const link = links.find((l) => l.to === to && l.toSocket === toSocket)
    if (!link) {
      e.stopPropagation()
      return
    }
    onUnlink(to, toSocket)
    beginLink(e, link.from, link.fromSocket)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.kind === "link") {
      setPulling({ from: d.from, fromSocket: d.fromSocket, ...toBoard(e.clientX, e.clientY) })
      return
    }
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (d.kind === "pan") {
      setView({ ...d.from, x: d.from.x + dx, y: d.from.y + dy })
      return
    }
    onMove(d.id, { x: Math.round(d.from.x + dx / view.z), y: Math.round(d.from.y + dy / view.z) })
  }

  const endDrag = (e?: React.PointerEvent) => {
    const d = drag.current
    if (d?.kind === "link" && e) {
      const at = toBoard(e.clientX, e.clientY)
      // An input socket within reach first, since that is what was aimed at;
      // then any node under the pointer, whose input the caller chooses.
      let best: { node: string; socket: string; d: number } | null = null
      for (const n of nodes) {
        if (n.id === d.from) continue
        const isFolded = folded.has(n.id)
        n.inputs.forEach((s, i) => {
          const dist = Math.hypot(at.x - n.place.x, at.y - inputSocketY(n, i, isFolded))
          if (dist <= SOCKET_REACH && (!best || dist < best.d)) best = { node: n.id, socket: s.id, d: dist }
        })
      }
      const hit = best as { node: string; socket: string } | null
      if (hit) onLink(d.from, d.fromSocket, hit.node, hit.socket)
      else {
        const onto = nodes.find(
          (n) =>
            n.id !== d.from &&
            at.x >= n.place.x &&
            at.x <= n.place.x + n.w &&
            at.y >= n.place.y &&
            at.y <= n.place.y + n.h
        )
        if (onto) onLink(d.from, d.fromSocket, onto.id, null)
      }
    }
    if (d?.kind === "node") onMoveEnd?.()
    drag.current = null
    setPulling(null)
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))

  const outputPoint = (n: SocketNode, socket: string) => {
    const i = Math.max(0, n.outputs.findIndex((s) => s.id === socket))
    return { x: n.place.x + n.w, y: outputSocketY(n, i, folded.has(n.id)) }
  }

  return (
    <div
      ref={hostRef}
      onPointerDown={beginPan}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={() => endDrag()}
      className={cn("app-no-drag relative h-full w-full overflow-hidden touch-none select-none", className)}
      style={{
        background: "var(--s-field)",
        backgroundImage: "radial-gradient(rgb(var(--p-line) / 0.45) 1px, transparent 1px)",
        backgroundSize: `${24 * view.z}px ${24 * view.z}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        cursor: drag.current?.kind === "pan" ? "var(--cursor-grabbing)" : "var(--cursor-default)",
      }}
    >
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
      >
        <svg width={1} height={1} className="absolute left-0 top-0 overflow-visible">
          {links.map((l) => {
            const a = byId.get(l.from)
            const b = byId.get(l.to)
            if (!a || !b) return null
            const j = b.inputs.findIndex((s) => s.id === l.toSocket)
            if (j < 0) return null
            const p = outputPoint(a, l.fromSocket)
            const d = wirePath(p.x, p.y, b.place.x, inputSocketY(b, j, folded.has(b.id)))
            const stroke = l.state === "failed" ? "var(--p-wire-failed)" : l.colour
            return (
              <g key={`${l.to}-${l.toSocket}`}>
                <path d={d} fill="none" stroke="rgb(0 0 0 / 0.45)" strokeWidth={4} />
                <path
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={2}
                  strokeOpacity={l.state === "pending" ? 0.5 : 1}
                  strokeDasharray={l.state === "pending" ? "8 4" : undefined}
                  className={l.state === "pending" ? "wire-flow" : undefined}
                />
              </g>
            )
          })}
          {pulling && byId.get(pulling.from) && (
            <path
              d={wirePath(
                outputPoint(byId.get(pulling.from)!, pulling.fromSocket).x,
                outputPoint(byId.get(pulling.from)!, pulling.fromSocket).y,
                pulling.x,
                pulling.y
              )}
              fill="none"
              stroke="rgb(var(--p-accent))"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          )}
        </svg>

        {nodes.map((n) => {
          const isFolded = folded.has(n.id)
          return (
            <div
              key={n.id}
              ref={watch(n.id)}
              onPointerDownCapture={(e) => {
                if (e.button === 0) onSelect(n.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })
              }}
              className="pointer-events-auto absolute rounded-md"
              style={{
                left: n.place.x,
                top: n.place.y,
                width: n.w,
                background: "var(--b-card)",
                ["--b-lit" as string]: n.lit.band,
                ["--b-lit-ink" as string]: n.lit.ink,
                boxShadow: `0 0 0 ${n.selected ? "1.5px rgb(var(--p-accent))" : `1px ${n.status === "busy" ? "var(--warning)" : "rgb(0 0 0 / 0.6)"}`}, 0 6px 18px -6px rgb(0 0 0 / 0.65)`,
                zIndex: front === n.id ? 1 : undefined,
              }}
            >
              <div
                onPointerDown={(e) => beginNode(e, n)}
                className={cn(
                  "relative flex cursor-grab items-center gap-1 pl-1 pr-1.5 text-body active:cursor-grabbing",
                  isFolded ? "rounded-md" : "rounded-t-md"
                )}
                style={{ height: HEAD_H, background: n.head, color: "var(--b-node-ink)" }}
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
                {isFolded &&
                  n.outputs.map((s) => (
                    <Socket
                      key={s.id}
                      colour={s.colour}
                      side="right"
                      label={`Link from ${s.label}`}
                      onPointerDown={(e) => beginLink(e, n.id, s.id)}
                    />
                  ))}
              </div>

              {!isFolded && (
                <div style={{ paddingTop: BODY_PAD }}>
                  {n.outputs.map((s) => (
                    <div
                      key={s.id}
                      className="relative flex items-center justify-end px-2.5 text-meta"
                      style={{ height: ROW_H }}
                    >
                      <span className="min-w-0 truncate text-foreground" title={s.label}>
                        {s.label}
                      </span>
                      <Socket
                        colour={s.colour}
                        side="right"
                        label={`Link from ${s.label}`}
                        onPointerDown={(e) => beginLink(e, n.id, s.id)}
                      />
                    </div>
                  ))}
                  {n.inputs.map((s) => (
                    <div
                      key={s.id}
                      className="relative flex items-center px-2.5 text-meta"
                      style={{ height: ROW_H }}
                    >
                      <Socket
                        colour={s.colour}
                        side="left"
                        label={s.linked ? `Pull the link off ${s.label}` : s.label}
                        onPointerDown={(e) => pullOff(e, n.id, s.id)}
                      />
                      <span
                        className={cn("min-w-0 truncate", s.linked ? "text-foreground" : "text-muted-foreground")}
                        title={s.label}
                      >
                        {s.label}
                      </span>
                    </div>
                  ))}
                  <div className="flex flex-col gap-1.5 px-2.5 pb-2 pt-1">{n.children}</div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => {
          touched.current = false
          fit()
        }}
        title="Frame every node (Home)"
        className={cn(
          "absolute bottom-2 right-2 flex size-7 items-center justify-center rounded-sm",
          "bg-selected text-muted-foreground transition-colors hover:bg-hover hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        )}
      >
        <ArrowsOut className="size-3.5" />
      </button>
    </div>
  )
}
