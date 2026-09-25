/**
 * The job queue as the interface holds it: analyses queued over areas that are
 * not in hand -- the fields of an area, most often -- and run one after another
 * by the Go side (internal/jobs, app_jobs.go).
 *
 * The queue lives there, not here. A job is a Python process the Go side
 * starts, ends and records the run of; what this module keeps is the list as
 * last announced, so every editor that draws it draws the same one. Held
 * outside React, as the report log is, because it is the application's and not
 * any one studio area's: two Jobs editors are two views of one queue.
 */
import { useSyncExternalStore } from "react"

import { ListJobs } from "../../wailsjs/go/main/App"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import type { MineralRequest, PredictRequest, WaterRequest } from "@/lib/types"

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled"

/**
 * The products a job can run. The field delineation is not one: it runs over
 * an area to make its fields, and the queue exists for the fields once made.
 */
export const JOB_KINDS = ["classify", "water", "mineral"] as const
export type JobKind = (typeof JOB_KINDS)[number]

export function isJobKind(id: string | null | undefined): id is JobKind {
  return !!id && (JOB_KINDS as readonly string[]).includes(id)
}

/**
 * The run kind a job of each product records (store.RunKind*). A row written
 * before the column existed has none, and every such row is a classification.
 */
export const JOB_RUN_KIND: Record<JobKind, string> = {
  classify: "classification",
  water: "water",
  mineral: "mineral",
}

/**
 * The latest run of a product over each area, for the areas that have one, and
 * how many have none. What "Show" in the Jobs editor puts on the board: the
 * queue forgets its jobs when the application closes, the runs they recorded
 * do not, and this finds them again by area.
 */
export function latestRuns(
  runs: readonly { id: string; created_at: string; area_id?: string; kind?: string }[],
  areaIds: readonly string[],
  kind: JobKind
): { ids: string[]; missing: number } {
  const want = JOB_RUN_KIND[kind]
  const ids: string[] = []
  let missing = 0
  for (const areaId of areaIds) {
    let best: { id: string; created_at: string } | null = null
    for (const r of runs) {
      if (r.area_id !== areaId || (r.kind || "classification") !== want) continue
      if (!best || r.created_at > best.created_at) best = r
    }
    if (best) ids.push(best.id)
    else missing += 1
  }
  return { ids, missing }
}

/**
 * The jobs finished since this was last asked, each returned once for the life
 * of the page.
 *
 * Held here rather than in a board: the queue is the application's, and a board
 * that is closed and opened again must not put back the results a reader has
 * already taken off it. A job finished before the page loaded is returned once,
 * which after a reload in development is the right answer.
 */
const taken = new Set<string>()
export function takeFinished(jobs: readonly Job[]): Job[] {
  const out = jobs.filter((j) => j.state === "done" && !!j.run_id && !taken.has(j.id))
  for (const j of out) taken.add(j.id)
  return out
}

/** Mirrors jobs.Job in internal/jobs/queue.go. */
export interface Job {
  id: string
  kind: JobKind
  area_id: string
  area_name: string
  state: JobState
  progress: number
  message: string
  run_id: string
  error: string
  queued_at: string
  started_at: string
  finished_at: string
}

/** Mirrors JobSpec in app_jobs.go: one request, in the field its kind names. */
export interface JobSpec {
  kind: JobKind
  area_name: string
  classify?: PredictRequest
  water?: WaterRequest
  mineral?: MineralRequest
}

/** A job's list entry replaced by a newer copy of itself; others untouched. */
export function withJob(jobs: readonly Job[], job: Job): readonly Job[] {
  const at = jobs.findIndex((j) => j.id === job.id)
  // A progress line for a job not in the list is a line from before a clear
  // the list has already seen; it is not added back.
  if (at < 0) return jobs
  const next = jobs.slice()
  next[at] = job
  return next
}

export interface JobCounts {
  queued: number
  running: number
  done: number
  failed: number
  cancelled: number
}

export function countJobs(jobs: readonly Job[]): JobCounts {
  const counts: JobCounts = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 }
  for (const j of jobs) counts[j.state] += 1
  return counts
}

/** Whether a job will not run again unless retried. */
export function isFinished(job: Job): boolean {
  return job.state === "done" || job.state === "failed" || job.state === "cancelled"
}

/**
 * "1 m 12 s": how long a job ran, or has been running at `now`. Null before it
 * starts.
 */
export function jobDuration(job: Job, now: number = Date.now()): string | null {
  const start = Date.parse(job.started_at)
  if (!Number.isFinite(start)) return null
  const end = job.finished_at ? Date.parse(job.finished_at) : now
  if (!Number.isFinite(end)) return null
  const s = Math.max(0, Math.round((end - start) / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} m ${s % 60} s`
  return `${Math.floor(m / 60)} h ${m % 60} m`
}

const STATE_RANK: Record<JobState, number> = {
  running: 0,
  queued: 1,
  done: 2,
  failed: 2,
  cancelled: 2,
}

/**
 * The list as the Jobs editor reads it: running first, then waiting in queue
 * order, then finished with the latest first. The queue's own order puts the
 * running job between the finished and the waiting ones, a screen down after a
 * few hundred fields; what a reader opens the list to see is the one running.
 */
export function jobsInReadingOrder(jobs: readonly Job[]): Job[] {
  const at = new Map(jobs.map((j, i) => [j.id, i]))
  return [...jobs].sort((a, b) => {
    const rank = STATE_RANK[a.state] - STATE_RANK[b.state]
    if (rank) return rank
    // Finished: the latest to finish first. Otherwise: queue order.
    if (isFinished(a)) return b.finished_at.localeCompare(a.finished_at)
    return (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0)
  })
}

let current: readonly Job[] = []
const listeners = new Set<() => void>()
let started = false
// Whether an event has arrived, which makes the first listing older than what
// is already held.
let heard = false

function set(next: readonly Job[]) {
  current = next
  for (const l of listeners) l()
}

/*
  Subscribed on the first reader and never undone: the events are the queue's
  only voice, and a list that stopped listening while no editor was open would
  come back stale when one opened. The first read asks for the list, since a
  queue can hold jobs from before this page loaded (a reload in development).
*/
function start() {
  if (started) return
  started = true
  EventsOn("jobs:changed", (list: Job[] | null) => {
    heard = true
    set(list ?? [])
  })
  EventsOn("jobs:progress", (job: Job) => {
    heard = true
    set(withJob(current, job))
  })
  void ListJobs()
    .then((list) => {
      if (!heard) set((list ?? []) as unknown as Job[])
    })
    .catch(() => {})
}

function subscribe(listener: () => void) {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function readJobs(): readonly Job[] {
  return current
}

export function useJobs(): readonly Job[] {
  return useSyncExternalStore(subscribe, readJobs)
}
