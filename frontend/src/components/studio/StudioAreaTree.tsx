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
import { useRef, useState } from "react"
import {
  areaRects,
  splitsWithin,
  type AreaId,
  type AreaNode,
  type AreaSeam,
  type Rect,
  type SplitDir,
} from "@/lib/boardAreas"
import type { EditorId } from "@/lib/studioEditors"
import { cn } from "@/lib/utils"

/** How thick the grab target on a division is. The line itself is one pixel. */
const SEAM_PX = 6

/**
 * How near a division has to come to another before it takes its place.
 *
 * THE PROBLEM IT ANSWERS is that two divisions running the same way are only
 * aligned when they are aligned to the pixel, and a pointer cannot do that.
 * An arrangement one pixel out reads as a mistake rather than as a choice --
 * the eye is very good at seeing a line that nearly continues -- and there was
 * no way to fix it except by dragging repeatedly and looking.
 *
 * Five, which is under half the grab target: a reader aiming BETWEEN two
 * neighbouring divisions can still land between them.
 */
const SNAP_PX = 5

/** Where a division's line falls, in the surface's own frame. */
const seamLine = (s: AreaSeam): number =>
  s.dir === "row" ? s.bounds.x + s.bounds.w * s.at : s.bounds.y + s.bounds.h * s.at

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
  /*
    THE GUIDE, HELD HERE AND NOT IN THE SEAM THAT CAUSED IT.

    A division only knows its own split's rectangle, and the line it has lined
    up with runs the whole surface -- that is the whole point of drawing it,
    since what a reader is checking is that two divisions in different parts of
    the arrangement continue each other. So the seam reports the coordinate it
    snapped to and this draws it, across the viewport rather than across one
    split.

    Null except while a drag is actually holding a snap: a guide that showed on
    every drag would be a line following the pointer, which says nothing.
  */
  const [guide, setGuide] = useState<{ dir: SplitDir; at: number } | null>(null)

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
      {seams.map((s) => {
        const inside = splitsWithin(tree, s.id)
        return (
          <Seam
            key={s.id}
            seam={s}
            surface={surface}
            targets={seams
              .filter((o) => o.dir === s.dir && !inside.has(o.id))
              .map(seamLine)}
            onGuide={setGuide}
            onMove={(at) => onMoveSplit(s.id, at)}
          />
        )
      })}
      {/*
        Drawn over the areas and under nothing: it is the answer to a question
        the reader is asking with the pointer, and it lasts exactly as long as
        the answer is yes. Dashed, so it cannot be mistaken for a division that
        is actually there.
      */}
      {guide && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-[31]"
          style={{
            left: guide.dir === "row" ? guide.at : viewport.x,
            top: guide.dir === "row" ? viewport.y : guide.at,
            width: guide.dir === "row" ? 1 : viewport.w,
            height: guide.dir === "row" ? viewport.h : 1,
            backgroundImage: `repeating-linear-gradient(${
              guide.dir === "row" ? "to bottom" : "to right"
            }, rgb(var(--p-accent)) 0 4px, transparent 4px 8px)`,
          }}
        />
      )}
    </>
  )
}

function Seam({
  seam,
  surface,
  targets,
  onGuide,
  onMove,
}: {
  seam: { id: AreaId; dir: "row" | "col"; bounds: Rect; at: number }
  surface: HTMLElement | null
  /** Where the divisions this one may line up with sit, surface-local. */
  targets: number[]
  onGuide: (guide: { dir: SplitDir; at: number } | null) => void
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
    /*
      Captured at the press rather than read per frame, for the same reason the
      origin is: the arrangement is about to start changing under the pointer,
      and a target list recomputed mid-drag would move while being aimed at.
      These are where the other divisions were when the drag began, which is
      what the reader can see and therefore what they are aiming for.
    */
    const lines = targets.slice()
    let held: number | null = null
    const move = (ev: PointerEvent) => {
      // Window coordinates brought into the surface's frame, which is the one
      // the split's own rectangle is expressed in.
      const raw = horizontal ? ev.clientX - ox : ev.clientY - oy
      /*
        The NEAREST division within reach, not the first one found: two of them
        can be inside the threshold at once, and taking whichever came earlier
        in the tree would make the snap depend on the shape of the tree rather
        than on where the pointer is.

        Alt defeats it, which is the escape every snapping tool needs: an
        arrangement that is deliberately a few pixels off cannot be built by a
        tool that refuses to leave the line.
      */
      let snap: number | null = null
      if (!ev.altKey) {
        let best = SNAP_PX
        for (const l of lines) {
          const d = Math.abs(l - raw)
          if (d <= best) {
            best = d
            snap = l
          }
        }
      }
      if (snap !== held) {
        held = snap
        onGuide(snap === null ? null : { dir: seam.dir, at: snap })
      }
      const coord = snap ?? raw
      const frac = horizontal
        ? (coord - bounds.x) / bounds.w
        : (coord - bounds.y) / bounds.h
      onMove(frac)
    }
    const up = () => {
      dragging.current = false
      onGuide(null)
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
