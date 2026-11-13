import { useLayoutEffect, useRef, useState, type RefObject } from "react"

import {
  CARD_RADIUS,
  FRAME_EDGE,
  FRAME_REACH,
  leftCorner,
  rightCorner,
} from "@/lib/frameCorners"

/**
 * The frame's corner pieces over the card's top corners, with what the right
 * one holds; lib/frameCorners.ts gives the construction.
 *
 * Drawn from measured boxes, not from constants, because both ends move: the
 * card's left edge with the rail, and the path's width with the names in it.
 * A ResizeObserver on each redraws the pieces in the frame the box changes.
 *
 * The pieces and the strip of frame above the card move the window, as the
 * bar across the top did; what the right piece holds sets its own buttons
 * apart with app-no-drag.
 */
export function ShellCorners({
  card,
  lights,
  children,
}: {
  /** The card the pieces reach into. */
  card: RefObject<HTMLElement | null>
  /** Whether the window's traffic lights are drawn over the top left. */
  lights: boolean
  /** What the right piece holds. */
  children: React.ReactNode
}) {
  const held = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ left: number; right: number; held: number } | null>(
    null
  )

  useLayoutEffect(() => {
    const measure = () => {
      const c = card.current?.getBoundingClientRect()
      const h = held.current?.getBoundingClientRect()
      if (!c || !h) return
      setBox((prev) =>
        prev && prev.left === c.left && prev.right === c.right && prev.held === h.left
          ? prev
          : { left: c.left, right: c.right, held: h.left }
      )
    }
    measure()
    const watch = new ResizeObserver(measure)
    if (card.current) watch.observe(card.current)
    if (held.current) watch.observe(held.current)
    return () => watch.disconnect()
  }, [card])

  const left = box && lights ? leftCorner(box.left) : null
  const right = box ? rightCorner(box.held, box.right) : null

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-500"
      style={{ height: FRAME_REACH + CARD_RADIUS }}
    >
      {/* The frame's edge above the card, which the bar used to be. */}
      <div
        className="app-draggable pointer-events-auto absolute inset-x-0 top-0"
        style={{ height: FRAME_EDGE }}
      />
      <svg className="absolute inset-0 size-full overflow-visible" aria-hidden>
        {left && (
          <path d={left} className="app-draggable pointer-events-auto fill-app" />
        )}
        {right && (
          <path d={right} className="app-draggable pointer-events-auto fill-app" />
        )}
      </svg>
      <div
        ref={held}
        className="app-draggable pointer-events-auto absolute top-0 flex items-center gap-0.5"
        style={{ right: FRAME_EDGE + 10, height: FRAME_REACH }}
      >
        {children}
      </div>
    </div>
  )
}
