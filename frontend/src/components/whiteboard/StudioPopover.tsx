/**
 * A control that opens a panel, the way every dense control in Blender does.
 *
 * WHY THIS IS THE PRIMITIVE. Blender's headers hold a great deal in very
 * little: the viewport's Overlays, Gizmos, Visibility and Shading are each one
 * glyph that opens a panel of twenty settings. That is the whole trick of a
 * dense header -- the header carries the ENTRANCE, and the settings live one
 * press away. Without it every control has to be visible at once, which is a
 * band of switches, which is what the studio had.
 *
 * PORTALLED, and that is not a detail. An area clips its own body -- it must,
 * or a scrolled table would paint over its neighbour -- so a panel rendered in
 * place is cut off by the very area that opened it. The studio's outliner is
 * 180px wide at the minimum window and the type menu is 240px; in place, a
 * quarter of it is simply not there. The panel goes into the studio surface
 * instead and is clamped against it.
 *
 * The trigger reports its own rectangle, so the panel opens under the control
 * that summoned it rather than at a corner: a menu that appears somewhere else
 * makes the reader look for it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

export function StudioPopover({
  open,
  onOpenChange,
  surface,
  trigger,
  /** Where the panel prefers to sit relative to the trigger. */
  align = "start",
  widthRem = 13.5,
  role = "menu",
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The studio surface the panel is clamped inside and portalled into. */
  surface: HTMLElement | null
  trigger: (props: {
    ref: (el: HTMLElement | null) => void
    onClick: () => void
    "aria-expanded": boolean
    "aria-haspopup": "menu" | "dialog"
  }) => React.ReactNode
  align?: "start" | "end"
  widthRem?: number
  /**
   * What the panel IS, for a reader who cannot see it.
   *
   * Menu is the right answer for every panel this opened for first -- rows of
   * choices, arrowed through. A panel of prose announced as a menu sends a
   * screen reader looking for items that are not there, so the one panel that
   * is a reading rather than a choosing says so.
   */
  role?: "menu" | "dialog"
  children: React.ReactNode
}) {
  const anchorRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  /*
    The window where there is no studio to sit in.

    Portalled to the body the panel is a sibling of the application root
    rather than a child of the surface, so z-60 -- which only ever meant
    "above the areas" -- is compared against the studio's own opaque z-500
    and painted under it. Every other body portal in this application already
    says so in its own way: DateField's calendar is fixed at 1200 from this
    same band, the project menu at 5001, the modal shell at 2000. This is the
    one that arrives here by falling back rather than by choosing to.

    The arithmetic above needs no branch: when the surface IS the body its
    rect is the viewport's, so the offsets are already viewport offsets and
    only the positioning scheme and the layer change.
  */
  const detached = surface === document.body

  /*
    Measured after paint, before the browser shows it: the panel's own size
    decides whether it has to flip or slide, and a frame drawn at the wrong
    place first would read as a jump.
  */
  useLayoutEffect(() => {
    if (!open || !surface) {
      setPos(null)
      return
    }
    const a = anchorRef.current?.getBoundingClientRect()
    const s = surface.getBoundingClientRect()
    const p = panelRef.current
    if (!a || !p) return
    const pad = 6
    const w = p.offsetWidth
    const h = p.offsetHeight
    // Surface-relative, since the panel is a child of the surface.
    let x = (align === "end" ? a.right - w : a.left) - s.left
    let y = a.bottom - s.top + 2
    // Flip above where there is no room below, which is what a header at the
    // foot of the studio needs -- the run editor's menus open upward.
    if (y + h > s.height - pad) {
      const above = a.top - s.top - h - 2
      if (above > pad) y = above
    }
    x = Math.min(Math.max(pad, x), Math.max(pad, s.width - w - pad))
    y = Math.min(Math.max(pad, y), Math.max(pad, s.height - h - pad))
    setPos({ x, y })
  }, [open, surface, align])

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      onOpenChange(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // Stopped, or the studio's own window-level Escape closes the studio
      // underneath a menu the reader was dismissing.
      e.stopPropagation()
      e.preventDefault()
      onOpenChange(false)
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", esc, true)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("keydown", esc, true)
    }
  }, [open, onOpenChange])

  return (
    <>
      {trigger({
        ref: (el) => {
          anchorRef.current = el
        },
        onClick: () => onOpenChange(!open),
        "aria-expanded": open,
        "aria-haspopup": role,
      })}
      {open &&
        surface &&
        createPortal(
          <div
            ref={panelRef}
            role={role}
            className={cn(
              "rounded-sm border py-1 shadow-[0_8px_24px_rgba(0,0,0,0.55)]",
              detached ? "fixed z-[1200]" : "absolute z-[60]"
            )}
            style={{
              left: pos?.x ?? -9999,
              top: pos?.y ?? -9999,
              width: `${widthRem}rem`,
              // Raised rather than ink: the panel floats over areas painted in
              // ink, and a panel the same colour as the ground behind it reads
              // as a hole rather than as a surface.
              background: "rgb(var(--p-surface-raised))",
              borderColor: "rgb(var(--p-line-strong) / 0.5)",
              // Hidden until placed, so the first frame is never at the corner.
              visibility: pos ? "visible" : "hidden",
            }}
          >
            {children}
          </div>,
          surface
        )}
    </>
  )
}

/** One row of a popover: a glyph, a label, and an optional trailing note. */
export function StudioMenuItem({
  icon: Icon,
  label,
  note,
  checked,
  disabled,
  indented,
  onSelect,
  title,
}: {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  /** A shortcut or a value, set at the right end where Blender puts it. */
  note?: string
  checked?: boolean
  disabled?: boolean
  /** A sub-entry of the row above it. */
  indented?: boolean
  onSelect: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 py-[3px] text-left text-meta transition-colors",
        // One glyph's width, so a sub-entry lines up under its parent's label
        // rather than under its icon.
        indented ? "pl-7 pr-2" : "px-2",
        disabled
          ? "cursor-not-allowed text-muted-foreground/40"
          : "text-foreground hover:bg-accent-dim"
      )}
    >
      {/* A fixed slot whether or not there is a glyph, so the labels of a
          mixed menu still line up. */}
      <span className="flex size-3 shrink-0 items-center justify-center">
        {checked ? (
          <span className="size-1.5 rounded-[1px] bg-accent" aria-hidden />
        ) : Icon ? (
          <Icon className="size-3 text-muted-foreground" strokeWidth={1.75} />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note && (
        <span className="telemetry shrink-0 text-[9px] text-muted-foreground">
          {note}
        </span>
      )}
    </button>
  )
}

/** A titled group inside a popover, as Blender labels its overlay sections. */
export function StudioMenuGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="py-0.5">
      <p className="eyebrow !text-[9px] px-2 pb-0.5">{label}</p>
      {children}
    </div>
  )
}

/** The hairline Blender puts between groups of menu entries. */
export function StudioMenuRule() {
  return (
    <div
      className="my-1 h-px"
      style={{ background: "rgb(var(--p-line) / 0.4)" }}
      aria-hidden
    />
  )
}
