/**
 * The application's own "are you sure", for acts that cannot be taken back.
 *
 * WHY NOT `window.confirm`. Two deletions in this codebase asked in two
 * different ways: a project opened a modal, a run called `window.confirm`. In a
 * WKWebView that second one is not a dialog the application controls -- the
 * host has to implement the JavaScript confirm panel for it to appear at all,
 * and where it does not the call returns false and the guarded branch simply
 * never runs. A deletion written as
 *
 *     if (!window.confirm(...)) return
 *
 * therefore reads as a button that does nothing, with no error and nothing in
 * the log, which is what was reported: the control was there, the run stayed.
 *
 * It is also the wrong shape even where it works. A native panel arrives in the
 * platform's own chrome, outside the theme, and cannot say what a deletion
 * takes with it -- which for a run is its place in a project and its exports.
 *
 * Generalised from the project modal that already existed rather than written
 * beside it, so a second destructive act does not become a third way of asking.
 */
import { useEffect } from "react"
import { Trash } from "@phosphor-icons/react"
import { ModalHeader, ModalShell } from "@/components/ui/ModalShell"
import { btnGhost } from "@/components/ui/buttons"

export function ConfirmDelete({
  eyebrow,
  title,
  subtitle,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: {
  /** The kind of thing, in the header's own voice: "DELETE RUN". */
  eyebrow: string
  /** The thing itself, named. */
  title: React.ReactNode
  /** What the deletion takes with it, which is what the reader is weighing. */
  subtitle: string
  confirmLabel: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy) return
      if (e.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [busy, onCancel])

  return (
    <ModalShell
      onDismiss={onCancel}
      dismissible={!busy}
      labelledBy="confirm-delete-title"
      className="w-full max-w-md"
    >
      <ModalHeader
        tone="destructive"
        eyebrow={eyebrow}
        titleId="confirm-delete-title"
        title={title}
        subtitle={subtitle}
      />
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className={btnGhost}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="flex h-8 items-center gap-1.5 rounded-sm bg-destructive px-3 text-body font-semibold text-destructive-foreground disabled:opacity-50"
        >
          <Trash className="h-3 w-3" />
          {busy ? "Deleting…" : confirmLabel}
        </button>
      </div>
    </ModalShell>
  )
}
