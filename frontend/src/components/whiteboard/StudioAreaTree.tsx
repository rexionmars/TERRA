/**
 * The tree, drawn: every leaf placed, every division draggable.
 *
 * Positions come from one walk of the tree rather than from each surface
 * knowing where it belongs, which is what makes an arrangement changeable at
 * all. Nothing here decides where anything goes; it renders what
 * `lib/boardAreas` computed.
 *
 * THE EDGES ARE THE SPLITS. A drag reports a new fraction for one split, and
 * both of its children move because both are derived from it. There is no
 * resize-this-box operation to get wrong, and no pair of neighbours that can
 * disagree about where their shared edge is.
 *
 * A single absolutely-positioned layer rather than nested flex boxes. The
 * rectangles are already computed, so laying them out again through the box
 * model would be a second geometry to keep in step with the first -- the exact
 * failure this replaces.
 */
import { useRef } from "react"
import {
  areaRects,
  type AreaId,
  type AreaNode,
  type Rect,
} from "@/lib/boardAreas"
import type { EditorId } from "@/lib/studioEditors"
import { cn } from "@/lib/utils"

/** How thick the grab target on a division is. The line itself is one pixel. */
const SEAM_PX = 6

export function StudioAreaTree({
  tree,
  viewport,
  surface,
  onMoveSplit,
  renderArea,
}: {
  tree: AreaNode<EditorId>
  viewport: Rect
  /**
   * The element the rectangles are measured inside.
   *
   * A drag reports pointer positions in WINDOW coordinates while the
   * rectangles are surface-local, so the two have to be reconciled or the
   * division jumps by however far the studio sits from the window's corner.
   */
  surface: HTMLElement | null
  onMoveSplit: (splitId: AreaId, at: number) => void
  renderArea: (leaf: {
    id: AreaId
    editor: EditorId
    rect: Rect
  }) => React.ReactNode
}) {
  const { leaves, seams } = areaRects(tree, viewport)

  return (
    <>
      {leaves.map((l) => (
        <div key={l.id}>
          {renderArea({
            id: l.id,
            editor: l.editor,
            rect: { x: l.x, y: l.y, w: l.w, h: l.h },
          })}
        </div>
      ))}
      {seams.map((s) => (
        <Seam
          key={s.id}
          seam={s}
          surface={surface}
          onMove={(at) => onMoveSplit(s.id, at)}
        />
      ))}
    </>
  )
}

function Seam({
  seam,
  surface,
  onMove,
}: {
  seam: { id: AreaId; dir: "row" | "col"; bounds: Rect; at: number }
  surface: HTMLElement | null
  onMove: (at: number) => void
}) {
  const dragging = useRef(false)
  const horizontal = seam.dir === "row"
  const { bounds, at } = seam

  // Where the line falls inside the split's own rectangle.
  const x = horizontal ? bounds.x + bounds.w * at : bounds.x
  const y = horizontal ? bounds.y : bounds.y + bounds.h * at

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true

    /*
      Reported as a fraction of the SPLIT's extent, not of the window: a split
      nested inside another divides only what its parent gave it, and measuring
      against the window would make a nested division jump on first movement.
    */
    /*
      Read once at the start of the drag rather than per frame: the studio does
      not move while a division is being dragged, and getBoundingClientRect
      forces layout every time it is called.
    */
    const origin = surface?.getBoundingClientRect()
    const ox = origin?.left ?? 0
    const oy = origin?.top ?? 0
    const move = (ev: PointerEvent) => {
      // Window coordinates brought into the surface's frame, which is the one
      // the split's own rectangle is expressed in.
      const frac = horizontal
        ? (ev.clientX - ox - bounds.x) / bounds.w
        : (ev.clientY - oy - bounds.y) / bounds.h
      onMove(frac)
    }
    const up = () => {
      dragging.current = false
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const less = horizontal ? "ArrowLeft" : "ArrowUp"
    const more = horizontal ? "ArrowRight" : "ArrowDown"
    if (e.key !== less && e.key !== more) return
    e.preventDefault()
    // A fiftieth of the split at a time, a tenth with shift.
    const step = e.shiftKey ? 0.1 : 0.02
    onMove(at + (e.key === more ? step : -step))
  }

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-label="Move this division"
      aria-valuenow={Math.round(at * 100)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        "group absolute z-[30] focus-visible:outline-none",
        horizontal ? "cursor-col-resize" : "cursor-row-resize"
      )}
      style={{
        // Centred on the line, so the target straddles both sides of it.
        left: horizontal ? x - SEAM_PX / 2 : bounds.x,
        top: horizontal ? bounds.y : y - SEAM_PX / 2,
        width: horizontal ? SEAM_PX : bounds.w,
        height: horizontal ? bounds.h : SEAM_PX,
      }}
    >
      {/*
        Lit on hover and focus, invisible otherwise: the areas already draw
        their own borders, and a second permanent line on every division would
        turn the arrangement into a grid of rules.
      */}
      <span
        className={cn(
          "absolute bg-accent opacity-0 transition-opacity duration-100",
          "group-hover:opacity-100 group-focus-visible:opacity-100",
          horizontal
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2"
        )}
        aria-hidden
      />
    </div>
  )
}
