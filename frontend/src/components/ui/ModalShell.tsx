/**
 * The dialog shell, written once.
 *
 * Five modals carried their own copy of it, and the copies had drifted in every
 * dimension that matters and none that shows: the scrim was black at 65 percent
 * in four and 55 in the fifth, blurred in four and not the fifth, and stacked at
 * z-2000 in four while What's New sat at z-80 -- under the map panels at z-1000,
 * so the one modal a user meets before anything else was the one that could be
 * covered by the interface behind it.
 *
 * Four also positioned the scrim with `absolute inset-0`, which resolves against
 * the nearest positioned ancestor. That happened to be the window while the
 * pages were flat fills; it stopped being guaranteed the moment the pages became
 * panels. `fixed` says what all five meant.
 *
 * AND IT RENDERS THROUGH A PORTAL, because `fixed` fixes the position and not
 * the stacking. A positioned ancestor carrying a z-index opens a stacking
 * context, and every z-index inside it is then compared only with its siblings
 * there -- so the board surface, at z-500, held this shell's z-2000 inside 500
 * and the run band at z-900 painted over a dialog that outranks it by 1100.
 * The symptom is unmistakable once seen: the band stays sharp while everything
 * else goes behind the scrim, because it is not behind it at all.
 *
 * The portal puts the shell in document.body, where 2000 is compared against
 * the panels and the bands it was written to outrank.
 */
import type { ReactNode } from "react"
import { SURFACE, SCRIM } from "@/lib/motion"
import { useEffect } from "react"
import { createPortal } from "react-dom"
import { motion } from "motion/react"
import { X } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { btnIcon } from "@/components/ui/buttons"

/** Above every panel and every foot track, which sit at 1000 and 900. */
const MODAL_Z = "z-[2000]"

/**
 * Escape, handled here and taken away from whatever is underneath.
 *
 * NO DIALOG BOUND ESCAPE AT ALL, and one surface underneath them did: the
 * studio closes itself on a window-level keydown. Pressing Escape while
 * drawing an area therefore dismissed the surface the drawing was for and left
 * the dialog standing over an empty map -- the one key a user presses to back
 * out of a dialog was the key that destroyed the context instead.
 *
 * A stack rather than one listener per shell, because the topmost dialog is
 * the one Escape belongs to, and listeners on the same node fire in the order
 * they were added -- so per-shell listeners would hand the key to the oldest
 * dialog rather than the newest. Nothing in the application stacks dialogs
 * today; the stack costs a few lines and removes the question.
 *
 * Registered in the CAPTURE phase so it runs before the bubble-phase listeners
 * underneath, and stops propagation so they do not also act on it.
 */
const dismissStack: Array<() => void> = []

function onWindowKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape" || !dismissStack.length) return
  /*
    A dialog is open, so nothing underneath it acts on this key -- and the
    stop comes FIRST, before the composition test. Returning early on
    composition would let the keystroke fall through to the surface below,
    which is the original defect in a narrower form: the studio would close
    behind a dialog whose text field happened to have an IME candidate open.
  */
  e.stopPropagation()
  // Escape belongs to the candidate window while composing. It dismisses the
  // candidate, not the dialog, and not the surface under it either.
  if (e.isComposing) return
  e.preventDefault()
  dismissStack[dismissStack.length - 1]()
}

function pushDismiss(fn: () => void) {
  if (!dismissStack.length) {
    window.addEventListener("keydown", onWindowKeyDown, true)
  }
  dismissStack.push(fn)
  return () => {
    const i = dismissStack.lastIndexOf(fn)
    if (i >= 0) dismissStack.splice(i, 1)
    if (!dismissStack.length) {
      window.removeEventListener("keydown", onWindowKeyDown, true)
    }
  }
}

export function ModalShell({
  children,
  onDismiss,
  labelledBy,
  label,
  className,
  dismissible = true,
}: {
  children: ReactNode
  onDismiss: () => void
  /** id of the element naming the dialog; prefer this to a literal label. */
  labelledBy?: string
  label?: string
  /** Size and shape, which is the one thing a dialog legitimately varies. */
  className?: string
  /** False while an operation is in flight, so a click cannot abandon it. */
  dismissible?: boolean
}) {
  useEffect(() => {
    // The same gate the scrim's click uses: an operation in flight is not
    // abandoned by Escape either. Still registered while it is false, so the
    // key is absorbed rather than falling through to the surface below.
    return pushDismiss(() => {
      if (dismissible) onDismiss()
    })
  }, [dismissible, onDismiss])

  return createPortal(
    <motion.div
      className={cn(
        "app-no-drag fixed inset-0 flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]",
        MODAL_Z
      )}
      onClick={() => dismissible && onDismiss()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={SCRIM}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        className={cn(
          "flex flex-col overflow-hidden rounded-md border border-border bg-panel-solid shadow-[0_16px_48px_rgba(0,0,0,0.55)]",
          className
        )}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={SURFACE}
      >
        {children}
      </motion.div>
    </motion.div>,
    document.body
  )
}

/**
 * The dialog's own header: what it is, and the way out.
 *
 * The close control is here rather than left to each caller because four of the
 * five had one and they were four different treatments, and the fifth relied on
 * the scrim alone -- which is not reachable from a keyboard.
 */
export function ModalHeader({
  eyebrow,
  title,
  titleId,
  subtitle,
  actions,
  onClose,
  tone = "default",
}: {
  eyebrow: string
  title: ReactNode
  titleId?: string
  subtitle?: ReactNode
  actions?: ReactNode
  onClose?: () => void
  tone?: "default" | "destructive"
}) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <p
          className={cn(
            "telemetry text-meta",
            // Accent as small text fails on a raised surface at 3.93, so the
            // quiet variant carries it; destructive is already a text token.
            tone === "destructive" ? "text-destructive-quiet" : "text-accent-quiet"
          )}
        >
          {eyebrow}
        </p>
        <h2
          id={titleId}
          className="mt-0.5 truncate font-display text-heading font-semibold tracking-wide"
        >
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-body text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {actions}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={btnIcon}
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}
