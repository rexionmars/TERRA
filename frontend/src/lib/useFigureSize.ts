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

/** Shared by both forms below: the observer, and the jitter rule. */
function observeInto(
  element: HTMLElement,
  setBox: (next: (prev: FigureBox) => FigureBox) => void
): () => void {
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
}

/**
 * ONLY FOR A HOST THAT IS MOUNTED ON THE FIRST RENDER, and on every one after.
 *
 * The dependency is the ref OBJECT, whose identity never changes, so this
 * effect runs once. If `ref.current` is null when it does -- the caller took an
 * early return before reaching the host, or rendered a message instead -- it
 * finds nothing to observe and never looks again, and the figure is laid out
 * from `fallback` for the rest of the component's life. An unmount is worse
 * than a late mount: the cleanup disconnects, and nothing reconnects.
 *
 * A component whose host comes and goes with its data wants `useFigureHost`,
 * which is driven by the element rather than by a ref that may not point at one.
 */
export function useFigureBox(
  /** An element sized by its parent, NOT by the figure inside it. */
  ref: RefObject<HTMLElement | null>,
  fallback: FigureBox = { width: 640, height: 300 }
): FigureBox {
  const [box, setBox] = useState<FigureBox>(fallback)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    return observeInto(element, setBox)
  }, [ref])

  return box
}

/**
 * The same measurement, for a host that is not on screen at every render.
 *
 * Returns a CALLBACK REF rather than taking a ref object. React calls it with
 * the element when the host mounts and with null when it unmounts, and because
 * that lands in state the effect re-runs on each -- so a figure whose panel
 * shows "nothing selected" first, and the chart afterwards, is measured when the
 * chart actually appears rather than never.
 *
 * `setElement` is a state setter, so its identity is stable and passing it
 * straight to `ref=` does not detach and reattach on every render.
 *
 * Same loop rule as `useFigureBox`: the element handed here must be sized by
 * its parent and hold the figure in absolute position. See this module's header.
 */
export function useFigureHost(
  fallback: FigureBox = { width: 640, height: 300 }
): [(el: HTMLElement | null) => void, FigureBox] {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [box, setBox] = useState<FigureBox>(fallback)

  useEffect(() => {
    if (!element) return
    return observeInto(element, setBox)
  }, [element])

  return [setElement, box]
}

/** The width alone, for a figure that derives its own height. */
export function useFigureWidth(
  ref: RefObject<HTMLElement | null>,
  fallback = 640
): number {
  return useFigureBox(ref, { width: fallback, height: 0 }).width
}
