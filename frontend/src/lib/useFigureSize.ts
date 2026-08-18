/**
 * The box a figure has to draw itself into, watched.
 *
 * THE LOOP THIS AVOIDS, AND HOW. The first version measured the element the
 * figure filled and handed back both dimensions; the figures took their height
 * from it, so the height a figure produced became the height measured next --
 * nothing damped it and the spectral figure grew without bound on screen.
 *
 * The measured box must therefore be one whose size is imposed from OUTSIDE:
 * a flex child with `flex-1 min-h-0`, holding the figure in absolute position
 * so the figure is out of flow and cannot push its own container. Then the
 * panel decides the box, the box decides the figure, and there is no path back.
 *
 * Callers that cannot give the figure a box of its own -- an inline sparkline
 * in a column of prose -- take `useFigureWidth` instead and let the figure
 * derive its own height, which is loop-free for the same reason.
 *
 * ResizeObserver rather than reading offsetWidth on render: that is one frame
 * behind every drag and never fires at all when a sibling area grows.
 */
import { useEffect, useState, type RefObject } from "react"

export interface FigureBox {
  width: number
  height: number
}

/**
 * Sub-pixel jitter is ignored.
 *
 * A scrollbar appearing and vanishing, or a fractional layout, otherwise turns
 * into a relayout on every frame -- and a relayout that changes the figure's
 * height is what makes a scrollbar appear.
 */
const JITTER = 2

export function useFigureBox(
  /** An element sized by its parent, NOT by the figure inside it. */
  ref: RefObject<HTMLElement | null>,
  fallback: FigureBox = { width: 640, height: 300 }
): FigureBox {
  const [box, setBox] = useState<FigureBox>(fallback)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      setBox((prev) => {
        const width = Math.round(rect.width)
        const height = Math.round(rect.height)
        if (
          Math.abs(width - prev.width) < JITTER &&
          Math.abs(height - prev.height) < JITTER
        ) {
          return prev
        }
        return { width, height }
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return box
}

/** The width alone, for a figure that derives its own height. */
export function useFigureWidth(
  ref: RefObject<HTMLElement | null>,
  fallback = 640
): number {
  return useFigureBox(ref, { width: fallback, height: 0 }).width
}
