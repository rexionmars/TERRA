/**
 * What the application has told the reader, kept after the toast leaves.
 *
 * A toast is gone in four to six seconds, which is shorter than it takes to
 * look up from a run that just failed and read why. Every notification goes
 * through lib/notify.ts, so it is recorded there as it is raised; the Reports
 * editor reads this list, and a closed editor loses nothing because the list
 * is not its own. Operator lines record what a key, a menu row or the search
 * ran, as Blender's Info editor does. Input and output lines are the
 * Console's: what was typed there and what it answered, which the Reports
 * editor leaves out.
 *
 * A module list rather than React state, because what writes to it -- notify,
 * the operators -- is not a component, and a subscription is what lets any
 * number of Reports areas read one list.
 */
import { useSyncExternalStore } from "react"

export type ReportLevel =
  | "operator"
  | "info"
  | "success"
  | "error"
  | "input"
  | "output"

export interface Report {
  id: number
  time: Date
  level: ReportLevel
  title: string
  description?: string
}

// Older reports are dropped past this, so a long session does not grow the
// list the editor renders without bound.
export const MAX_REPORTS = 500

let log: readonly Report[] = []
let nextId = 0
const listeners = new Set<() => void>()

function publish(next: readonly Report[]) {
  log = next
  for (const l of listeners) l()
}

export function report(level: ReportLevel, title: string, description?: string): void {
  const r: Report = { id: nextId++, time: new Date(), level, title, description }
  publish([...log.slice(-(MAX_REPORTS - 1)), r])
}

export function clearReports(): void {
  publish([])
}

export function readReports(): readonly Report[] {
  return log
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The log, kept current. */
export function useReports(): readonly Report[] {
  return useSyncExternalStore(subscribe, readReports)
}
