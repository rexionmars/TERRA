/**
 * The queue, in the run card of the Run graph: what is running, what is
 * waiting and what has finished, one line each.
 *
 * IN THE RUN CARD AND NOT IN A PANEL OF ITS OWN. A job is the Run graph's
 * request -- its period, its cloud ceiling, its model -- queued over each
 * selected area (lib/jobs.ts), so the card that sends the request is where its
 * answers are followed. A Jobs editor beside the graph held a second Queue
 * button over the same selection and parameters, and a list of runs away from
 * the request that made them; two ways to one action is one too many.
 *
 * THE JOBS OF THIS PRODUCT, since the graph is drawn for one product at a
 * time. The queue is one for the whole application and runs one job after
 * another, so the jobs of other products still waiting ahead are counted in a
 * line: without it, a job of this product waiting behind them would look
 * stalled.
 *
 * A job's result is a run like any other, saved under its area and put on the
 * board when it finishes; each line says where one stands and offers the one
 * action that state allows.
 */
import { createContext, useContext, useEffect, useState } from "react"
import {
  ArrowClockwise,
  ArrowSquareOut,
  CheckCircle,
  CircleNotch,
  Clock,
  Prohibit,
  WarningOctagon,
  X,
  type Icon,
} from "@phosphor-icons/react"

import { CancelAllJobs, CancelJob, ClearJobs, RetryJob } from "../../../wailsjs/go/main/App"
import {
  countJobs,
  isFinished,
  jobDuration,
  jobsInReadingOrder,
  useJobs,
  type Job,
  type JobKind,
  type JobState,
} from "@/lib/jobs"
import { notifyError } from "@/lib/notify"
import { cn } from "@/lib/utils"

/**
 * What the board does with runs, for the Run graph, which is built by the map
 * screen and drawn inside the board: put runs on the board with their answer
 * on the globe, and put there the latest run of a product over each selected
 * area. Provided by BoardSurface around the Run editor.
 */
export interface RunsOnBoard {
  show: (runIds: string[]) => void
  showLatest: (kind: JobKind) => void
}

export const RunsOnBoardContext = createContext<RunsOnBoard | null>(null)

export const useRunsOnBoard = () => useContext(RunsOnBoardContext)

const STATE_ICON: Record<JobState, Icon> = {
  queued: Clock,
  running: CircleNotch,
  done: CheckCircle,
  failed: WarningOctagon,
  cancelled: Prohibit,
}

async function act(what: string, call: () => Promise<void>) {
  try {
    await call()
  } catch (e) {
    notifyError(what, e)
  }
}

export function RunQueue({ kind }: { kind: JobKind }) {
  const board = useRunsOnBoard()
  const all = useJobs()
  const jobs = all.filter((j) => j.kind === kind)
  const counts = countJobs(jobs)
  const pending = counts.queued + counts.running
  const finished = counts.done + counts.failed + counts.cancelled
  const others = all.filter((j) => j.kind !== kind && !isFinished(j)).length

  // A running job's clock, and nothing else, moves on its own.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!counts.running) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [counts.running])

  if (!jobs.length && !others) return null

  const summary = [
    counts.running && `${counts.running} running`,
    counts.queued && `${counts.queued} waiting`,
    counts.done && `${counts.done} done`,
    counts.failed && `${counts.failed} failed`,
    counts.cancelled && `${counts.cancelled} cancelled`,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="flex flex-col gap-0.5 border-t border-border pt-1">
      {jobs.length > 0 && (
        <>
          <span className="telemetry truncate text-[9px] text-muted-foreground">{summary}</span>
          <div className="flex items-center gap-0.5">
            {board && (
              <QueueAction
                label="Show all"
                title="Put every finished run on the board, its answer on the globe over its area"
                disabled={counts.done === 0}
                onClick={() => board.show(jobs.filter((j) => j.state === "done" && j.run_id).map((j) => j.run_id))}
              />
            )}
            <QueueAction
              label="Cancel all"
              title="Cancel every job of this product that has not finished"
              disabled={pending === 0}
              onClick={() =>
                void act("Could not cancel the jobs", async () => {
                  // CancelAllJobs is the whole queue's; with other products
                  // waiting, this product's jobs are cancelled one by one.
                  if (others) {
                    for (const j of jobs) if (!isFinished(j)) await CancelJob(j.id)
                  } else {
                    await CancelAllJobs()
                  }
                })
              }
            />
            <QueueAction
              label="Clear"
              title="Take every finished job off the queue, of every product; their runs stay saved"
              disabled={finished === 0}
              onClick={() => void act("Could not clear the jobs", ClearJobs)}
            />
          </div>
          <ul aria-label="Jobs" className="panel-scroll flex max-h-[9rem] flex-col overflow-y-auto pr-1">
            {jobsInReadingOrder(jobs).map((job) => (
              <JobRow key={job.id} job={job} now={now} onOpen={board ? (j) => board.show([j.run_id]) : undefined} />
            ))}
          </ul>
        </>
      )}
      {others > 0 && (
        <span className="text-[9px] text-muted-foreground">
          {others} {others === 1 ? "job" : "jobs"} of other products in the queue
        </span>
      )}
    </div>
  )
}

function QueueAction({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string
  title: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-sm px-1 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  )
}

function JobRow({ job, now, onOpen }: { job: Job; now: number; onOpen?: (job: Job) => void }) {
  const Glyph = STATE_ICON[job.state]
  const duration = jobDuration(job, now)
  const failed = job.state === "failed"
  // Done in the success colour the toasts use, glyph and name, so a long list
  // reads as what is finished and what is not without reading it.
  const done = job.state === "done"
  const detail = job.state === "running" ? job.message : failed ? job.error : null
  return (
    <li className="flex flex-col py-px">
      <div className="flex min-w-0 items-center gap-1.5">
        <Glyph
          className={cn(
            "size-3 shrink-0",
            job.state === "running" && "animate-spin text-foreground",
            failed ? "text-destructive-quiet" : done ? "text-success" : "text-muted-foreground"
          )}
          aria-label={job.state}
        />
        <span
          className={cn("min-w-0 flex-1 truncate text-meta", done ? "text-success" : "text-foreground")}
          title={job.area_name}
        >
          {job.area_name}
        </span>
        <span className="telemetry shrink-0 text-[9px] text-muted-foreground">
          {job.state === "running" ? `${job.progress}%` : null}
          {job.state === "running" && duration ? " · " : null}
          {job.state !== "queued" ? duration : null}
        </span>
        {(job.state === "queued" || job.state === "running") && (
          <RowAction
            icon={X}
            label={job.state === "running" ? "Cancel this run; its process is stopped" : "Take this job out of the queue"}
            onClick={() => void act("Could not cancel the job", () => CancelJob(job.id))}
          />
        )}
        {(failed || job.state === "cancelled") && (
          <RowAction
            icon={ArrowClockwise}
            label="Queue it again, after the jobs waiting"
            onClick={() => void act("Could not queue the job again", () => RetryJob(job.id))}
          />
        )}
        {done && onOpen && (
          <RowAction
            icon={ArrowSquareOut}
            label="Put the run on the board, its answer on the globe over its area"
            onClick={() => onOpen(job)}
          />
        )}
      </div>
      {job.state === "running" && (
        <div
          className="ml-[1.125rem] mt-0.5 h-px bg-control"
          role="progressbar"
          aria-valuenow={job.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${job.area_name} progress`}
        >
          <div className="h-px bg-accent transition-[width]" style={{ width: `${job.progress}%` }} />
        </div>
      )}
      {detail && (
        <span
          className={cn(
            "ml-[1.125rem] truncate text-[9px]",
            failed ? "text-destructive-quiet" : "telemetry text-muted-foreground"
          )}
          title={detail}
        >
          {detail}
        </span>
      )}
    </li>
  )
}

function RowAction({ icon: Glyph, label, onClick }: { icon: Icon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-control hover:text-foreground"
    >
      <Glyph className="size-3" />
    </button>
  )
}
