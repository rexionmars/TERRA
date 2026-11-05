/**
 * Deleting an area, confirmed first.
 *
 * Shared by the Areas panel and the bin in the map's tool column, so the two
 * ask the same question and name the same losses. DeleteArea removes the runs
 * of the area and their rasters, and its fields with theirs, which cannot be
 * taken back, so the dialog says how many go with it.
 */
import { useState } from "react"

import { ConfirmDelete } from "@/components/ui/ConfirmDelete"
import type { Area } from "@/lib/areas"
import { notifyError, notifySuccess } from "@/lib/notify"

function deletionNote(area: Area, areas: readonly Area[]): string {
  const fields = areas.filter((a) => a.parent_id === area.id)
  const runs = area.run_count + fields.reduce((n, f) => n + f.run_count, 0)
  const parts = [
    runs > 0 && `${runs} ${runs === 1 ? "run" : "runs"} and their rasters`,
    fields.length > 0 && `${fields.length} ${fields.length === 1 ? "field" : "fields"}`,
  ].filter(Boolean)
  return parts.length
    ? `This also deletes ${parts.join(" and ")}. It cannot be undone.`
    : "It holds no runs. This cannot be undone."
}

export function AreaDeleteDialog({
  area,
  areas,
  onDelete,
  onDeleted,
  onClose,
}: {
  area: Area
  /** The open project's areas, which is where this one's fields are found. */
  areas: readonly Area[]
  /** Throws on failure, so the deletion is announced only when it happened. */
  onDelete: (id: string) => void | Promise<void>
  /** Once the area is gone, before the dialog closes. */
  onDeleted?: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await onDelete(area.id)
      onDeleted?.()
      notifySuccess(`${area.name} deleted.`)
      onClose()
    } catch (e) {
      notifyError("Could not delete the area", e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDelete
      eyebrow="DELETE AREA"
      title={area.name}
      subtitle={deletionNote(area, areas)}
      confirmLabel="Delete area"
      busy={busy}
      onCancel={onClose}
      onConfirm={() => void confirm()}
    />
  )
}
