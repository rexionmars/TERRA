/**
 * A pie menu, as Blender's: the options stand in a ring around the pointer,
 * and one is picked by the direction the pointer leaves the centre in, not by
 * aiming at a row.
 *
 * WHY A RING. A list puts every option at a different distance from where the
 * press was, and the one at the foot of the list is the furthest; a ring puts
 * them all one short movement away, and the same option always in the same
 * direction, so a hand learns it. The target is a direction rather than a
 * shape: anywhere in an option's slice of the circle picks it.
 *
 * TWO WAYS TO USE IT, the two Blender gives. Press, move toward an option and
 * let go: the release picks it, a gesture once learnt. Or press and let go
 * where you are: the ring stays open, and a click picks. The keys work too:
 * the arrows move round the ring, Enter picks, a digit picks that option, and
 * Escape steps back a ring or closes it.
 *
 * QUIET OVER THE BOARD. No shadow under the ring and none under the options,
 * and the accent at half strength: the ring is a moment between two actions on
 * the board, and drawn at full weight it took the eye off the card the reader
 * had right-clicked.
 *
 * Nothing here knows about workflows. The caller gives the options and acts on
 * the one picked; an option that opens another ring is the caller's to show.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { ArrowLeft, CaretRight } from "@/components/icons"
import { cn } from "@/lib/utils"

export interface RadialItem {
  id: string
  label: string
  /** A mark in a category's colour, before the label. */
  colour?: string
  /** An icon before the label, where there is no colour to show. */
  icon?: React.ReactNode
  /** The key that does the same outside the menu, after the label. */
  note?: string
  /** Why it cannot be picked. It is shown, and picking it does nothing. */
  blockedBy?: string | null
  /** Picking it opens another ring rather than acting. */
  opens?: boolean
}

/** Around the centre, where no option is aimed at: a click there steps back. */
const DEAD = 30
const HUB = 64
/** A press that travels further than this before its release picks on release. */
const GESTURE = 14
/** Beyond the ring by this much, a click is a dismissal and not a pick. */
const REACH = 140
/** The accent, at the strength the ring draws it. */
const AIM = "rgb(var(--p-accent) / 0.5)"

const radiusFor = (n: number) => (n <= 4 ? 96 : n <= 6 ? 116 : 136)

/*
  Two options stand left and right, where their labels read across. More start
  at the top and go clockwise, so the first is always the one straight up.
*/
const angleOf = (i: number, n: number) =>
  (n === 2 ? Math.PI : -Math.PI / 2) + (i * 2 * Math.PI) / n

const wrap = (a: number) => {
  const t = (a + Math.PI) % (2 * Math.PI)
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI
}

/**
 * The option of `n` a pointer `dx`, `dy` from the centre aims at: the one
 * whose direction is nearest, however far out the pointer is, or null inside
 * the centre.
 */
export function aimIndex(dx: number, dy: number, n: number): number | null {
  if (!n || Math.hypot(dx, dy) < DEAD) return null
  const a = Math.atan2(dy, dx)
  let best = 0
  let gap = Infinity
  for (let i = 0; i < n; i++) {
    const d = Math.abs(wrap(a - angleOf(i, n)))
    if (d < gap) {
      gap = d
      best = i
    }
  }
  return best
}

export function RadialMenu({
  at,
  held = false,
  surface,
  within,
  title,
  items,
  onPick,
  onBack,
  onClose,
}: {
  /** The window point it opens on. */
  at: { x: number; y: number }
  /** The press that opened it is still down, so its release may pick. */
  held?: boolean
  /** Portalled here. */
  surface: HTMLElement | null
  /**
   * Kept inside this box -- the board, so the ring does not ride up over a
   * header or across a side panel. The surface's own, without it.
   */
  within?: HTMLElement | null
  /** What the ring is about, in its centre. */
  title: string
  items: readonly RadialItem[]
  onPick: (id: string) => void
  /** Present on an inner ring: the centre and Escape go back to the outer one. */
  onBack?: () => void
  onClose: () => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [centre, setCentre] = useState<{ x: number; y: number } | null>(null)
  const [hot, setHot] = useState<number | null>(null)
  const pressed = useRef<{ x: number; y: number } | null>(held ? at : null)
  const n = items.length
  const R = radiusFor(n)

  /*
    Kept inside the surface: the centre moves in from an edge far enough for
    the ring and the labels standing out from it. The pointer is then off the
    centre, which the direction reading does not mind.
  */
  useLayoutEffect(() => {
    if (!surface) return
    const s = surface.getBoundingClientRect()
    const b = (within ?? surface).getBoundingClientRect()
    const padX = R + 150
    const padY = R + 28
    const fit = (v: number, lo: number, hi: number) =>
      lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v))
    setCentre({
      x: fit(at.x, b.left + padX, b.right - padX) - s.left,
      y: fit(at.y, b.top + padY, b.bottom - padY) - s.top,
    })
  }, [at, surface, within, R])

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [centre])

  /** The option the pointer aims at, or null inside the centre. */
  const aim = (clientX: number, clientY: number): number | null => {
    if (!surface || !centre) return null
    const s = surface.getBoundingClientRect()
    return aimIndex(clientX - s.left - centre.x, clientY - s.top - centre.y, n)
  }

  const distance = (clientX: number, clientY: number) => {
    if (!surface || !centre) return 0
    const s = surface.getBoundingClientRect()
    return Math.hypot(clientX - s.left - centre.x, clientY - s.top - centre.y)
  }

  const choose = (i: number) => {
    const item = items[i]
    if (!item || item.blockedBy) return
    onPick(item.id)
  }
  const back = () => (onBack ? onBack() : onClose())

  // The latest of each, for listeners registered once per ring.
  const live = useRef({ aim, choose, back, hot, n })
  live.current = { aim, choose, back, hot, n }

  useEffect(() => {
    const move = (e: PointerEvent) => setHot(live.current.aim(e.clientX, e.clientY))
    const up = (e: PointerEvent) => {
      const from = pressed.current
      if (e.button !== 2 || !from) return
      pressed.current = null
      // Let go where it was pressed: the ring stays for a click.
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < GESTURE) return
      const i = live.current.aim(e.clientX, e.clientY)
      if (i !== null) live.current.choose(i)
    }
    const keys = (e: KeyboardEvent) => {
      const { n, hot } = live.current
      if (e.key === "Escape") {
        live.current.back()
      } else if (e.key === "Enter" && hot !== null) {
        live.current.choose(hot)
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        setHot(((hot ?? -1) + 1) % n)
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setHot(((hot ?? 0) - 1 + n) % n)
      } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) {
        live.current.choose(Number(e.key) - 1)
      } else {
        return
      }
      // Handled here, so the studio's own keys -- X, Escape -- do not act too.
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener("pointermove", move, true)
    window.addEventListener("pointerup", up, true)
    window.addEventListener("keydown", keys, true)
    return () => {
      window.removeEventListener("pointermove", move, true)
      window.removeEventListener("pointerup", up, true)
      window.removeEventListener("keydown", keys, true)
    }
  }, [])

  if (!surface || !centre) return null
  const { x: cx, y: cy } = centre
  const aimAngle = hot !== null ? angleOf(hot, n) : null
  const track = HUB / 2 + 7

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      aria-label={title}
      tabIndex={-1}
      className="absolute inset-0 z-70 outline-none"
      style={{ cursor: "var(--cursor-default)" }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.stopPropagation()
        // A second secondary press dismisses, as in Blender.
        if (e.button === 2) {
          onClose()
          return
        }
        if (e.button !== 0 || e.target !== e.currentTarget) return
        const d = distance(e.clientX, e.clientY)
        if (d < DEAD) back()
        else if (d > R + REACH) onClose()
        else {
          const i = aim(e.clientX, e.clientY)
          if (i !== null) choose(i)
        }
      }}
    >
      {/* The ring the direction is read on, and where it points now. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute overflow-visible"
        style={{ left: cx, top: cy }}
        width={1}
        height={1}
      >
        <circle r={track} fill="none" stroke="var(--hairline)" strokeWidth={2} />
        {aimAngle !== null && (
          <>
            <path
              d={arc(track, aimAngle, Math.min(0.5, Math.PI / n))}
              fill="none"
              stroke={AIM}
              strokeWidth={3}
              strokeLinecap="round"
            />
            <line
              x1={Math.cos(aimAngle) * (track + 6)}
              y1={Math.sin(aimAngle) * (track + 6)}
              x2={Math.cos(aimAngle) * (R - 18)}
              y2={Math.sin(aimAngle) * (R - 18)}
              stroke="rgb(var(--p-accent) / 0.25)"
              strokeWidth={1.5}
              strokeDasharray="2 4"
            />
          </>
        )}
      </svg>

      <button
        type="button"
        onClick={back}
        aria-label={onBack ? "Back" : "Close"}
        title={onBack ? "Back (Esc)" : "Close (Esc)"}
        className="node-card absolute flex flex-col items-center justify-center gap-0.5 rounded-full px-1.5 text-center focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        style={{
          left: cx - HUB / 2,
          top: cy - HUB / 2,
          width: HUB,
          height: HUB,
          boxShadow: "0 0 0 1px var(--b-node-edge)",
        }}
      >
        {onBack && <ArrowLeft className="size-3 shrink-0 text-muted-foreground" />}
        <span className="line-clamp-2 text-meta leading-tight font-medium text-foreground">
          {title}
        </span>
      </button>

      {items.map((item, i) => {
        const a = angleOf(i, n)
        const cos = Math.cos(a)
        const x = cx + R * cos
        const y = cy + R * Math.sin(a)
        // Upright options are centred on their spot; the rest stand out from it.
        const anchor =
          Math.abs(cos) < 0.26 ? "-50%" : cos > 0 ? "-14px" : "calc(-100% + 14px)"
        const on = hot === i
        const off = !!item.blockedBy
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            aria-disabled={off || undefined}
            title={item.blockedBy ?? item.label}
            onClick={() => choose(i)}
            onPointerEnter={() => setHot(i)}
            onFocus={() => setHot(i)}
            className={cn(
              "node-card radial-pop absolute flex h-8 max-w-[13rem] items-center gap-2 rounded-full px-3 text-label whitespace-nowrap",
              "focus-visible:outline-none",
              off ? "cursor-not-allowed text-muted-foreground" : "text-foreground"
            )}
            style={
              {
                left: x,
                top: y,
                transform: `translate(${anchor}, -50%)`,
                boxShadow: on ? `0 0 0 1.5px ${AIM}` : "0 0 0 1px var(--b-node-edge)",
                "--radial-from": `${-cos * 28}px ${-Math.sin(a) * 28}px`,
                animationDelay: `${i * 14}ms`,
              } as React.CSSProperties
            }
          >
            {item.colour ? (
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", off && "opacity-40")}
                style={{
                  background: item.colour,
                  boxShadow: "0 0 0 1px rgb(0 0 0 / 0.3)",
                }}
              />
            ) : item.icon ? (
              <span aria-hidden className="flex shrink-0 text-muted-foreground">
                {item.icon}
              </span>
            ) : null}
            <span className="min-w-0 truncate">{item.label}</span>
            {item.note && (
              <span className="telemetry shrink-0 text-micro text-muted-foreground">
                {item.note}
              </span>
            )}
            {item.opens && (
              <CaretRight
                aria-hidden
                className="size-3 shrink-0 text-muted-foreground"
              />
            )}
          </button>
        )
      })}
    </div>,
    surface
  )
}

/** An arc of the ring, `half` radians either side of `mid`. */
function arc(r: number, mid: number, half: number): string {
  const a0 = mid - half
  const a1 = mid + half
  return `M ${r * Math.cos(a0)} ${r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)}`
}
