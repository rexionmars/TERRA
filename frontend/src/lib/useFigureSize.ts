/**
 * The size a figure has to draw itself into, watched.
 *
 * A figure that is laid out from measured text needs the panel's actual width,
 * not a reference one, and that width changes whenever a division is dragged.
 * ResizeObserver is what reports it; the alternative -- reading offsetWidth on
 * render -- is one frame behind every drag and never fires when a sibling area
 * grows.
 *
 * The height is watched too but is rarely what constrains: a studio area is
 * wider than tall in every workspace preset, so the figures below take the
 * width they are given and ask for the height they need.
 */
import { useEffect, useState, type RefObject } from "react"

export interface FigureSize {
  width: number
  height: number
}

export function useFigureSize(
  ref: RefObject<HTMLElement | null>,
  /** Until the first measurement lands, and where the element is detached. */
  fallback: FigureSize = { width: 640, height: 320 }
): FigureSize {
  const [size, setSize] = useState<FigureSize>(fallback)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box) return
      // Rounded, because a fractional pixel in a viewBox is a blurred hairline
      // and the layout is in whole pixels by construction.
      setSize({ width: Math.round(box.width), height: Math.round(box.height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return size
}
