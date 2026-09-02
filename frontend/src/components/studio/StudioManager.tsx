/**
 * Where saved studios are renamed and removed.
 *
 * NOT IN THE MENU THAT LISTS THEM. That popover exists to open one, and its
 * rows are buttons: a rename needs a field and a delete needs a confirmation,
 * and neither fits inside a control whose whole job is a single press. Putting
 * them there would also have meant nesting interactive elements, which is
 * invalid and reads as one target that behaves like three.
 *
 * A BOARD IS AN ARRANGEMENT, NOT A CONTAINER. Deleting one takes the
 * arrangement and leaves every run in the hub, listed and openable, exactly as
 * a run that was never on a board. The dialog says so where the deletion is
 * confirmed, because that is the thing a reader is weighing and the word
 * "delete" beside a list of analyses does not answer it.
 */
import { useEffect, useState } from "react"
import { Check, Stack, Pencil, Trash, X } from "@phosphor-icons/react"

import { ConfirmDelete } from "@/components/ui/ConfirmDelete"
import { ModalShell } from "@/components/ui/ModalShell"
import { notifyError, notifySuccess } from "@/lib/notify"
import {
  deleteStudio,
  renameStudio,
  type Studio,
} from "@/lib/studios"
import { cn } from "@/lib/utils"

export function StudioManager({
  boards,
  openId,
  onDismiss,
  onChanged,
  onOpenDeleted,
}: {
  boards: readonly Studio[]
  /** The board currently on screen, which cannot be deleted from under it. */
  openId: string | null
  onDismiss: () => void
  /** Re-read the list. Awaited, so the dialog shows the result of its own act. */
  onChanged: () => Promise<void>
  /**
   * The open board was deleted.
   *
   * The surface is still showing its arrangement, and the name it shows now
   * names nothing. Only the caller can decide what to do with that, so it is
   * told rather than guessed at here.
   */
  onOpenDeleted: (id: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [pendingDelete, setPendingDelete] = useState<Studio | null>(null)
  const [busy, setBusy] = useState(false)

  // Escape leaves the field before it leaves the dialog: a reader abandoning a
  // rename means the rename, and closing the whole dialog would be a second
  // thing they did not ask for.
  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        setEditing(null)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [editing])

  const commitRename = async (board: Studio) => {
    const next = draft.trim()
    setEditing(null)
    // An unchanged name is not a rename, and an empty one is not a name.
    if (!next || next === board.name) return
    setBusy(true)
    try {
      await renameStudio(board.id, next)
      await onChanged()
      notifySuccess("Studio renamed", next)
    } catch (e) {
      notifyError("Could not rename this studio", e)
    } finally {
      setBusy(false)
    }
  }

  const commitDelete = async (board: Studio) => {
    setBusy(true)
    try {
      await deleteStudio(board.id)
      await onChanged()
      setPendingDelete(null)
      if (board.id === openId) onOpenDeleted(board.id)
      notifySuccess("Studio deleted", board.name)
    } catch (e) {
      notifyError("Could not delete this studio", e)
    } finally {
      setBusy(false)
    }
  }

  if (pendingDelete) {
    return (
      <ConfirmDelete
        eyebrow="Delete studio"
        title={pendingDelete.name}
        subtitle={
          // What it takes, and what it does not. The second half is the part a
          // reader cannot infer and the one they are actually weighing.
          `This removes the arrangement of ${pendingDelete.member_count ?? 0} run(s). The runs themselves stay in the project hub.`
        }
        confirmLabel="Delete studio"
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void commitDelete(pendingDelete)}
      />
    )
  }

  return (
    <ModalShell
      onDismiss={onDismiss}
      dismissible={!busy}
      labelledBy="studio-manager-title"
      className="w-[26rem]"
    >
      <h2 id="studio-manager-title" className="eyebrow px-1 pb-2">
        Studios
      </h2>
      {boards.length === 0 ? (
        <p className="px-1 py-6 text-center text-body text-muted-foreground">
          No studios saved yet. Arrange runs on a board and save it under a
          name, and it is listed here.
        </p>
      ) : (
        <ul className="panel-scroll flex max-h-[22rem] flex-col overflow-y-auto">
          {boards.map((b) => {
            const isOpen = b.id === openId
            return (
              <li
                key={b.id}
                className="flex items-center gap-2 border-b py-1.5 pl-1 pr-0.5 last:border-b-0"
                style={{ borderColor: "rgb(var(--p-line) / 0.2)" }}
              >
                <Stack
                  className={cn(
                    "size-3.5 shrink-0",
                    isOpen ? "text-primary" : "text-muted-foreground"
                  )}
                />
                {editing === b.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => void commitRename(b)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename(b)
                    }}
                    className="field-input min-w-0 flex-1 text-body"
                    aria-label={`Rename ${b.name}`}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-body text-foreground">
                    {b.name}
                    {isOpen && (
                      <span className="ml-2 text-meta text-muted-foreground">
                        open
                      </span>
                    )}
                  </span>
                )}
                {/* How many runs are arranged on it, which is the only thing
                    about a board that says how much is there. */}
                <span className="telemetry shrink-0 text-meta text-muted-foreground">
                  {b.member_count ?? 0}
                </span>
                {editing === b.id ? (
                  <RowButton
                    icon={Check}
                    label="Confirm rename"
                    onClick={() => void commitRename(b)}
                  />
                ) : (
                  <RowButton
                    icon={Pencil}
                    label={`Rename ${b.name}`}
                    onClick={() => {
                      setDraft(b.name)
                      setEditing(b.id)
                    }}
                  />
                )}
                <RowButton
                  icon={Trash}
                  label={`Delete ${b.name}`}
                  danger
                  onClick={() => setPendingDelete(b)}
                />
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex justify-end pt-3">
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="rounded-sm px-2.5 py-1 text-body text-muted-foreground transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <X className="mr-1 inline size-3" />
          Close
        </button>
      </div>
    </ModalShell>
  )
}

/** One row action: a glyph, named for a reader who cannot see the glyph. */
function RowButton({
  icon: Icon,
  label,
  danger = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-sm p-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        danger
          ? "text-muted-foreground hover:bg-destructive/15 hover:text-destructive-quiet"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      )}
    >
      <Icon className="size-3.5" />
    </button>
  )
}
