/**
 * What can be done to a plane, offered on the plane.
 *
 * WHY THIS EXISTS NOW. Blender's navigation moved orbit, pan and zoom onto the
 * middle button, which freed the right one -- and a context menu on the object
 * is what it was freed for. Until this, "drop to base level" lived in the
 * outliner's footer, under the Scene pane: a reader who wanted to lay one
 * raster on another had to select it in a tree, find the pane, and press a
 * button three surfaces from the thing it acts on.
 *
 * An action on a plane belongs on the plane. That is the whole argument, and
 * it is the same one that moved the view controls into the viewport's header
 * and the plane's opacity into the properties editor: each control beside the
 * thing it changes.
 *
 * WHAT IS AND IS NOT HERE. Only what acts on this one plane. Its opacity is
 * not -- that is a value to be read against the legend beside it, which is the
 * properties editor's job, and a number field in a menu that closes on the
 * first click is a control that cannot be adjusted. Selecting is not either:
 * the left button already does it, and a menu entry for a gesture the reader
 * has just performed is a row that says nothing.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlignVerticalJustifyEnd,
  Eye,
  EyeOff,
  Layers,
  Maximize,
  Trash2,
} from "lucide-react"
import { StudioMenuItem, StudioMenuRule } from "@/components/studio/StudioPopover"

export interface PlaneContextTarget {
  areaId: string
  layerId: string
  title: string
  /** Window coordinates of the press, which is where the menu opens. */
  at: { x: number; y: number }
  visible: boolean
  /** The base layer has no level below it to descend to. */
  isBase: boolean
  flat: boolean
  removable: boolean
  /**
   * Whether every other plane on the board is already hidden.
   *
   * Solo is a toggle rather than a one-way action: hiding eleven planes to
   * look at one, and then restoring them by hand, is eleven gestures to undo
   * one. The label says which way the entry goes.
   */
  soloed: boolean
}

export function PlaneContextMenu({
  target,
  surface,
  onClose,
  onToggleFlat,
  onToggleVisible,
  onSolo,
  onFit,
  onRemove,
}: {
  target: PlaneContextTarget | null
  /** Portalled here and clamped inside it, as every studio panel is. */
  surface: HTMLElement | null
  onClose: () => void
  onToggleFlat: () => void
  onToggleVisible: () => void
  /** Hide every other plane on the board, or bring them all back. */
  onSolo: () => void
  /** Put the camera on this plane. */
  onFit: () => void
  onRemove: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    if (!target || !surface) {
      setPos(null)
      return
    }
    const p = panelRef.current
    if (!p) return
    const s = surface.getBoundingClientRect()
    const pad = 6
    // Surface-relative: the press reports window coordinates and the panel is
    // a child of the surface, which is the frame those have to be brought into.
    let x = target.at.x - s.left
    let y = target.at.y - s.top
    x = Math.min(Math.max(pad, x), Math.max(pad, s.width - p.offsetWidth - pad))
    y = Math.min(Math.max(pad, y), Math.max(pad, s.height - p.offsetHeight - pad))
    setPos({ x, y })
  }, [target, surface])

  useEffect(() => {
    if (!target) return
    const away = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return
      onClose()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // Stopped, or the studio's window-level Escape closes the studio under a
      // menu the reader was dismissing.
      e.stopPropagation()
      e.preventDefault()
      onClose()
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", esc, true)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("keydown", esc, true)
    }
  }, [target, onClose])

  if (!target || !surface) return null

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      className="absolute z-[70] w-[14rem] rounded-sm border py-1 shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
      style={{
        left: pos?.x ?? -9999,
        top: pos?.y ?? -9999,
        background: "rgb(var(--p-surface-raised))",
        borderColor: "rgb(var(--p-line-strong) / 0.5)",
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <p className="truncate px-2 pb-1 pt-0.5 text-[10px] text-muted-foreground">
        {target.title}
      </p>
      <StudioMenuRule />

      {/*
        Offered only where there is a level below to descend to.

        The stack separates layers along Y so orbiting pulls them apart, which
        is what makes the draw order visible. That separation is in the way
        when the question is not "what is the order" but "does this line up
        with that": from overhead a layer one step up reads as floating over
        the base rather than lying on it. The base layer IS the level, so it is
        offered nothing.
      */}
      {!target.isBase && (
        <StudioMenuItem
          icon={AlignVerticalJustifyEnd}
          label={target.flat ? "Return to its own height" : "Drop to base level"}
          checked={target.flat}
          onSelect={() => {
            onToggleFlat()
            onClose()
          }}
        />
      )}
      <StudioMenuItem
        icon={target.visible ? EyeOff : Eye}
        label={target.visible ? "Hide this plane" : "Show this plane"}
        onSelect={() => {
          onToggleVisible()
          onClose()
        }}
      />
      {/*
        Solo, which the outliner can only do a row at a time. A board of four
        areas carries a dozen planes, and reading one against the ground meant
        eleven presses in a tree.
      */}
      <StudioMenuItem
        icon={Layers}
        label={target.soloed ? "Show every plane" : "Hide every other plane"}
        title={
          target.soloed
            ? "Bring the rest of the studio back"
            : "Leave this one visible and hide the rest"
        }
        onSelect={() => {
          onSolo()
          onClose()
        }}
      />
      {/*
        Zoom to fit, on the plane rather than on the stack. The viewport header
        frames everything; this frames what the reader pointed at, from the
        direction they are already looking.
      */}
      <StudioMenuItem
        icon={Maximize}
        label="Zoom to fit this plane"
        onSelect={() => {
          onFit()
          onClose()
        }}
      />
      {target.removable && (
        <>
          <StudioMenuRule />
          <StudioMenuItem
            icon={Trash2}
            label="Remove from the studio"
            title="The run keeps it; the studio stops drawing it"
            onSelect={() => {
              onRemove()
              onClose()
            }}
          />
        </>
      )}
    </div>,
    surface
  )
}
