/**
 * A value you drag, or type, or step with the arrow keys.
 *
 * The widget every dense editor uses where a web page would reach for a range
 * input, and it is not a matter of taste. In `components/ui` rather than with
 * the whiteboard because the product panels need it too: a slider in a 15rem
 * column spends the width of the column on a value it cannot show. A slider spends a whole row on one
 * value and still cannot express it: the number it holds is never shown unless
 * a second element is added to show it, its precision is bounded by how many
 * pixels of track are available, and returning to an exact value after moving
 * it is a matter of aim. In a 15rem column two of them fill the panel.
 *
 * This holds the label and the value on one line, at the size of a row of
 * text, and gives three ways in: drag across it to scrub, click it to type an
 * exact figure, or step with the arrow keys. Precision does not depend on the
 * width of the control, so the column can stay narrow and hold more of them.
 *
 * `role="spinbutton"` rather than a slider, because that is what this is: a
 * numeric field with a range, not a track with a thumb.
 */
import { useRef, useState } from "react"
import { cn } from "@/lib/utils"

/** Pixels of travel that cover the whole range, at normal sensitivity. */
const DRAG_SPAN_PX = 220
/** Below this, a press was a click asking to type rather than a drag. */
const CLICK_SLOP_PX = 3

export function NumberField({
  label,
  value,
  min,
  max,
  step,
  format,
  parse,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  /** One arrow press. Shift takes a tenth of it. */
  step: number
  /** How the value reads when it is not being edited. */
  format: (v: number) => string
  /**
   * Reads what was typed back, or null to reject it and keep the old value.
   *
   * Given rather than assumed, because the text is not always the number: an
   * opacity reads as a percentage and stores a fraction.
   */
  parse: (text: string) => number | null
  disabled?: boolean
  onChange: (v: number) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null)

  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return
    drag.current = { x: e.clientX, from: value, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < CLICK_SLOP_PX) return
    d.moved = true
    // Shift slows the travel rather than changing what it means, so the same
    // gesture reaches a coarse value and then refines it without letting go.
    const perPx = (max - min) / DRAG_SPAN_PX / (e.shiftKey ? 8 : 1)
    onChange(clamp(d.from + dx * perPx))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    // A press that did not travel was a request to type, which is the only way
    // to reach an exact figure and the reason this is not a slider.
    if (!d.moved && !disabled) setEditing(format(value))
  }

  const commit = (text: string) => {
    const v = parse(text)
    if (v !== null && Number.isFinite(v)) onChange(clamp(v))
    setEditing(null)
    hostRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    const by = e.shiftKey ? step / 10 : step
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault()
      onChange(clamp(value + by))
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault()
      onChange(clamp(value - by))
    } else if (e.key === "Enter") {
      e.preventDefault()
      setEditing(format(value))
    } else if (e.key === "Home") {
      e.preventDefault()
      onChange(min)
    } else if (e.key === "End") {
      e.preventDefault()
      onChange(max)
    }
  }

  if (editing !== null) {
    return (
      <input
        autoFocus
        value={editing}
        onChange={(e) => setEditing(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          /*
            Stopped here, both of them. Escape closes the board from a listener
            on the window, so without this, abandoning an edit would also leave
            the board; Enter would otherwise reach whatever else is listening.
          */
          e.stopPropagation()
          if (e.key === "Enter") commit(e.currentTarget.value)
          else if (e.key === "Escape") setEditing(null)
        }}
        className="h-[1.375rem] w-full rounded-sm border-0 bg-surface-raised px-2 text-center text-meta text-foreground outline-none ring-1 ring-ring"
      />
    )
  }

  return (
    <div
      ref={hostRef}
      role="spinbutton"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={format(value)}
      aria-disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null
      }}
      onKeyDown={onKeyDown}
      className={cn(
        "flex h-[1.375rem] select-none items-center justify-between gap-2 rounded-sm px-2 transition-colors",
        "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
        /*
          A boundary, not only a fill. The fill alone measures 1.33 against the
          whiteboard band's ink and 1.13 in light, so the field had no visible
          edge in either theme -- it read as text, which is what it was reported
          as. line-strong clears 4.11 and 3.82 there, and inset-ring is an inset
          box-shadow, so it costs no layout width.
        */
        disabled
          ? "cursor-not-allowed bg-surface-raised/40 inset-ring-1 inset-ring-line opacity-45"
          : "cursor-ew-resize bg-surface-raised inset-ring-1 inset-ring-line-strong hover:bg-surface-raised/80"
      )}
    >
      <span className="min-w-0 truncate text-meta text-muted-foreground">
        {label}
      </span>
      <span className="telemetry shrink-0 text-meta text-foreground">
        {format(value)}
      </span>
    </div>
  )
}
