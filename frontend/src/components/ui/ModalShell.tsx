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
 */
import type { ReactNode } from "react"
import { motion } from "motion/react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { btnIcon } from "@/components/ui/buttons"

/** Above every panel and every foot track, which sit at 1000 and 900. */
const MODAL_Z = "z-[2000]"

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
  return (
    <motion.div
      className={cn(
        "app-no-drag fixed inset-0 flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]",
        MODAL_Z
      )}
      onClick={() => dismissible && onDismiss()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
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
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      >
        {children}
      </motion.div>
    </motion.div>
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
