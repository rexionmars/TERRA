/**
 * The job queue: what is running, what is waiting and what has finished, one
 * line each.
 *
 * A job is the band's product queued over one selected area (lib/jobs.ts). The
 * lines are short on purpose. A job's result is a run like any other, saved
 * under its area, and read where every run is read -- the board, the
 * compositor, the tables -- once it is opened; this list says only where each
 * one stands and offers the one action that state allows. The running job is
 * listed first (jobsInReadingOrder says why).
 */
import { useEffect, useState } from "react"
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
import { AreaHeaderOptions } from "@/components/studio/StudioArea"
import { StudioHeaderRule } from "@/components/studio/StudioHeaderControls"
import { TOOL_ICON } from "@/components/studio/BoardRunGraph"
import { BOARD_TOOLS } from "@/lib/mapTools"
import {
  countJobs,
  JOB_KINDS,
  jobDuration,
  jobsInReadingOrder,
  useJobs,
  type Job,
  type JobKind,
  type JobState,
} from "@/lib/jobs"
import { notifyError } from "@/lib/notify"
import { cn } from "@/lib/utils"

const STATE_ICON: Record<JobState, Icon> = {
  queued: Clock,
  running: CircleNotch,
  done: CheckCircle,
  failed: WarningOctagon,
  cancelled: Prohibit,
}

const toolLabel = (kind: string) => BOARD_TOOLS.find((t) => t.id === kind)?.label ?? kind

async function act(what: string, call: () => Promise<void>) {
  try {
    await call()
  } catch (e) {
    notifyError(what, e)
  }
}

/**
 * What a queue started from this editor runs with: how many areas are
 * selected, and the band's parameters it takes.
 */
export interface JobQueueParams {
  selected: number
  start: string
  end: string
  /** The classification's model, as the band names it. */
  model: string
  onQueue: (kind: JobKind) => void
  /** Put the latest run of the product over each selected area on the board. */
  onShow?: (kind: JobKind) => void
}

export function JobsEditor({
  onShow,
  queue,
}: {
  /**
   * Put runs on the board with their answer on the globe, over their areas: a
   * finished job's from its row, every finished one from the header.
   */
  onShow?: (runIds: string[]) => void
  queue?: JobQueueParams
}) {
  const jobs = useJobs()
  const counts = countJobs(jobs)
  const pending = counts.queued + counts.running
  const finished = counts.done + counts.failed + counts.cancelled

  // A running job's clock, and nothing else, moves on its own.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!counts.running) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [counts.running])

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
    <>
      <AreaHeaderOptions>
        <span className="telemetry truncate px-1 text-meta text-muted-foreground">{summary}</span>
        <StudioHeaderRule />
        {onShow && (
          <button
            type="button"
            onClick={() => onShow(jobs.filter((j) => j.state === "done" && j.run_id).map((j) => j.run_id))}
            disabled={counts.done === 0}
            title="Put every finished job's run on the board, its answer on the globe over its area"
            className="flex h-5 items-center rounded-sm px-1.5 text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            Show all
          </button>
        )}
        <button
          type="button"
          onClick={() => void act("Could not cancel the jobs", CancelAllJobs)}
          disabled={pending === 0}
          title="Cancel every job that has not finished"
          className="flex h-5 items-center rounded-sm px-1.5 text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Cancel all
        </button>
        <button
          type="button"
          onClick={() => void act("Could not clear the jobs", ClearJobs)}
          disabled={finished === 0}
          title="Take the finished jobs off the list; their runs stay saved"
          className="flex h-5 items-center rounded-sm px-1.5 text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
      </AreaHeaderOptions>
      {queue && queue.selected > 0 && <QueueRow {...queue} />}
      <ul
        aria-label="Jobs"
        className="panel-scroll selectable h-full min-h-0 overflow-y-auto py-1"
        style={{ background: "var(--s-field)" }}
      >
        {jobs.length === 0 && (
          <li className="px-3 py-1 text-body text-muted-foreground">
            No jobs. Shift-press fields on the globe or in the outliner, or shift-drag a box over
            them, then queue the band&apos;s product over the selection.
          </li>
        )}
        {jobsInReadingOrder(jobs).map((job) => (
          <JobRow key={job.id} job={job} now={now} onOpen={onShow ? (j) => onShow([j.run_id]) : undefined} />
        ))}
      </ul>
    </>
  )
}

/*
  THE QUEUE STARTED HERE, as well as from the band. A workspace built around
  fields -- the globe, the outliner, the compositor -- need not hold the Run
  editor, and sending a reader to another workspace to press one button over a
  selection they are looking at is the round trip this row saves. The product
  is chosen here; everything else is the band's, and is stated so a queue of
  three hundred runs does not go out over a period nobody looked at.
*/
function QueueRow({ selected, start, end, model, onQueue, onShow }: JobQueueParams) {
  const [kind, setKind] = useState<JobKind>("classify")
  const period = start && end ? `${start} to ${end}` : "no period set"
  return (
    <div className="flex min-w-0 items-center gap-1.5 border-b border-border px-2 py-1">
      <div role="radiogroup" aria-label="Product to queue" className="flex shrink-0 items-center">
        {JOB_KINDS.map((k) => {
          const Tool = TOOL_ICON[k]
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              title={toolLabel(k)}
              onClick={() => setKind(k)}
              className={cn(
                "rounded-sm p-1 transition-colors",
                kind === k ? "bg-selected text-foreground" : "text-muted-foreground hover:bg-hover"
              )}
            >
              <Tool className="size-3.5" />
            </button>
          )
        })}
      </div>
      <span
        className="telemetry min-w-0 flex-1 truncate text-meta text-muted-foreground"
        title="The period and model are the Run editor's"
      >
        {toolLabel(kind)} · {selected} {selected === 1 ? "area" : "areas"} · {period}
        {kind === "classify" && model ? ` · ${model}` : ""}
      </span>
      {onShow && (
        <button
          type="button"
          onClick={() => onShow(kind)}
          title={`Put the latest ${toolLabel(kind).toLowerCase()} run of each selected area on the board`}
          className="shrink-0 rounded-sm px-1.5 py-0.5 text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          Show
        </button>
      )}
      <button
        type="button"
        onClick={() => onQueue(kind)}
        disabled={!start || !end}
        className="shrink-0 rounded-sm bg-accent px-2 py-0.5 text-meta text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-control disabled:text-muted-foreground"
      >
        Queue {selected}
      </button>
    </div>
  )
}

function JobRow({ job, now, onOpen }: { job: Job; now: number; onOpen?: (job: Job) => void }) {
  const Glyph = STATE_ICON[job.state]
  const Tool = TOOL_ICON[job.kind] ?? Clock
  const duration = jobDuration(job, now)
  const failed = job.state === "failed"
  // Done in the success colour the toasts use, glyph and name, so a list of a
  // few hundred reads as what is finished and what is not without reading it.
  const done = job.state === "done"
  const detail =
    job.state === "running"
      ? job.message
      : failed
        ? job.error
        : null
  return (
    <li className="group flex flex-col px-2 py-0.5 hover:bg-hover">
      <div className="flex min-w-0 items-center gap-2">
        <Glyph
          className={cn(
            "size-3 shrink-0",
            job.state === "running" && "animate-spin text-foreground",
            failed ? "text-destructive-quiet" : done ? "text-success" : "text-muted-foreground"
          )}
          aria-label={job.state}
        />
        <Tool className="size-3 shrink-0 text-muted-foreground" aria-label={toolLabel(job.kind)} />
        <span
          className={cn("min-w-0 flex-1 truncate text-body", done ? "text-success" : "text-foreground")}
          title={`${toolLabel(job.kind)} over ${job.area_name}`}
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
        {job.state === "done" && onOpen && (
          <RowAction
            icon={ArrowSquareOut}
            label="Put the run on the board, its answer on the globe over its area"
            onClick={() => onOpen(job)}
          />
        )}
      </div>
      {job.state === "running" && (
        <div
          className="ml-5 mt-0.5 h-px bg-control"
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
            "ml-5 truncate text-meta",
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
