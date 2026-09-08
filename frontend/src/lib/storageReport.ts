/**
 * The data directory's size, and the one place that asks for it.
 *
 * Two surfaces want this: the account page, which has always had it, and the
 * application menu, which is a second door onto the same dialog. Two copies of
 * a measure-then-open sequence is two places for the busy flag to be forgotten
 * and two places for the note to be cleared -- so it is one hook, and the
 * dialog is handed the same shape either way.
 *
 * MEASURED ON DEMAND, NOT ON MOUNT. Walking the directory costs real time once
 * there are hundreds of analyses, and neither surface is opened to look at disk
 * usage in the common case. The reasoning was written on the page this was
 * lifted from and belongs with the code rather than with one of its callers.
 *
 * AND MEASURED BEFORE THE DIALOG OPENS, not after. Opening first would render
 * against no data, so every field in it would have to guard against a report
 * that has not arrived. The control the reader pressed carries the wait, which
 * is where they are already looking.
 */
import { useCallback, useState } from "react"

import {
  InspectStorage,
  PurgeOrphanedRunAssets,
} from "../../wailsjs/go/main/App"
import type { store } from "../../wailsjs/go/models"
import { formatBytes } from "@/lib/formatBytes"

export interface StorageReportState {
  report: store.StorageReport | null
  busy: boolean
  /** What the last purge freed, or null when nothing has been purged. */
  note: string | null
  /** Why the last attempt failed. Shown where the reader pressed. */
  problem: string | null
  open: boolean
  /** Measure, then open. The wait is the caller's button, not an empty shell. */
  measureAndOpen: () => Promise<void>
  /** Measure again with the dialog already up. */
  refresh: () => Promise<void>
  /** Clear the folders no analysis points at, then measure again. */
  purge: () => Promise<void>
  close: () => void
}

export function useStorageReport(): StorageReportState {
  const [report, setReport] = useState<store.StorageReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const measure = useCallback(async (thenOpen: boolean) => {
    setBusy(true)
    setProblem(null)
    setNote(null)
    try {
      setReport(await InspectStorage())
      if (thenOpen) setOpen(true)
    } catch (e) {
      /*
        The error stays where the reader pressed rather than opening a dialog
        that exists only to say it could not measure anything -- a line under
        the control is a better way to say that than a modal.
      */
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const measureAndOpen = useCallback(() => measure(true), [measure])
  const refresh = useCallback(() => measure(false), [measure])

  /*
    No confirmation, deliberately: nothing in the application can open these
    files and no export includes them, so there is nothing for the reader to
    weigh. A dialog asking them to approve deleting something they cannot see
    or reach would be theatre.
  */
  const purge = useCallback(async () => {
    setBusy(true)
    setProblem(null)
    try {
      const result = await PurgeOrphanedRunAssets()
      setNote(
        `Cleared ${formatBytes(result.freed_bytes)} from ${result.removed} ${
          result.removed === 1 ? "folder" : "folders"
        }.`
      )
      setReport(await InspectStorage())
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const close = useCallback(() => setOpen(false), [])

  return {
    report,
    busy,
    note,
    problem,
    open,
    measureAndOpen,
    refresh,
    purge,
    close,
  }
}
