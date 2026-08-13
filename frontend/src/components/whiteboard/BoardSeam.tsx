/**
 * The edge between a column and the board, moved by dragging it.
 *
 * WHY THIS IS THE PIECE THAT MATTERS. The studio's allocation was decided in
 * source: fifteen rem for the outliner, sixteen for the readout, and every
 * complaint about the layout since has been a consequence of that guess being
 * wrong for the run in front of the reader. A prediction with five classes
 * needs less than one with seventeen; a comparison of two areas needs more
 * than a single plane. No constant is right for all of them, and picking a
 * better constant only moves which case it is wrong for.
 *
 * Blender's answer is not a better default. It is that the reader owns the
 * division: areas there share their corner vertices, so dragging an edge moves
 * both sides at once and the arrangement becomes a property of the task rather
 * than of the program. This is that edge.
 *
 * ONE HANDLE, TWO SIDES. The seam does not resize a box; it reports where the
 * division now is. The column derives its width from the partition and the
 * board derives its inset from the same number, so they cannot disagree -- the
 * seam has no way to move one without the other.
 *
 * NO MODIFIER KEYS AND NO KEYBOARD SHORTCUT. Shift is already overloaded on
 * the board, where it means both extend-the-selection and drag-the-area,
 * disambiguated at pointerup within four pixels; a third meaning on a strip
 * four pixels wide would be a coin toss. The gesture is a plain drag on a
 * visible edge, which is the whole affordance.
 *
 * Arrow keys are bound because a separator that can only be dragged is
 * unreachable without a pointer, and this one governs how much of the screen
 * a reader can see.
 */
import { useRef } from "react"
import { cn } from "@/lib/utils"

export function BoardSeam({
  side,
  rem,
  onDrag,
  onDragEnd,
  label,
}: {
  /** Which column the seam belongs to; decides which way growth lies. */
  side: "left" | "right"
  /** The column's current width in rem, which the drag starts from. */
  rem: number
  onDrag: (rem: number) => void
  /** Called once at the end, for anything too costly to run per frame. */
  onDragEnd?: () => void
  label: string
}) {
  const dragging = useRef(false)

  /*
    Pointer capture, because the pointer leaves this strip immediately: the
    column follows the drag, so the four pixels under the cursor become board
    on the first frame. Without capture the element would stop hearing about
    its own gesture.
  */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    const startX = e.clientX
    const startRem = rem
    const root =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

    const move = (ev: PointerEvent) => {
      // Growth is away from the edge the column is anchored to: the left
      // column grows rightward, the right column grows leftward.
      const dx = side === "left" ? ev.clientX - startX : startX - ev.clientX
      onDrag(startRem + dx / root)
    }
    const up = () => {
      dragging.current = false
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      onDragEnd?.()
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // A rem a press, four with shift held, which is the usual coarse step.
    const step = e.shiftKey ? 4 : 1
    const grow = side === "left" ? "ArrowRight" : "ArrowLeft"
    const shrink = side === "left" ? "ArrowLeft" : "ArrowRight"
    if (e.key !== grow && e.key !== shrink) return
    e.preventDefault()
    onDrag(rem + (e.key === grow ? step : -step))
    onDragEnd?.()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(rem * 16)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        /*
          Wider than it looks. The painted line is the column's own border;
          this is the target over it, at the size a pointer can actually hit
          without the reader aiming. It sits half outside the column so the
          board side of the edge is grabbable too.
        */
        "group absolute inset-y-0 z-[15] w-1.5 cursor-col-resize",
        "focus-visible:outline-none",
        side === "left" ? "-right-0.5" : "-left-0.5"
      )}
    >
      {/*
        Lit on hover and on focus, and otherwise invisible. The edge is already
        drawn by the column's border; a second permanent line would be chrome
        announcing a gesture rather than a surface affording one.
      */}
      <span
        className={cn(
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-accent",
          "opacity-0 transition-opacity duration-100",
          "group-hover:opacity-100 group-focus-visible:opacity-100"
        )}
        aria-hidden
      />
    </div>
  )
}
