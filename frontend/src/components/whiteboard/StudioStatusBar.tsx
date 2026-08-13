/**
 * The one strip across the studio's foot, in Blender's three zones.
 *
 * WHY THIS ONE AND NOT THE OTHERS. An audit of what a Blender screen carries
 * proposed four new permanent regions -- a toolbar, a tool-settings strip, an
 * icon rail and this. Blender's density is bought with a screen that has room
 * to spend, and this application declares a 1000x700 floor whose workspace
 * presets are tuned against it; four regions would be Blender's chrome budget
 * on a canvas a third the size, taken out of the 3D surface the studio exists
 * to show. So one, and the one that gives back more than it takes.
 *
 * It gives back because the run's progress lived INSIDE the properties column,
 * replacing every figure there for as long as a run lasted -- a reader
 * watching a classification could not read the legend of anything. Twenty-two
 * pixels once, at the foot, buys that column back.
 *
 * LEFT what the pointer does here, MIDDLE what the application is doing, RIGHT
 * what is selected. Blender's own division, and each zone answers a question a
 * reader asks without looking away from the board.
 */
import { Loader2 } from "lucide-react"
import type { RunLogEntry } from "@/lib/runLog"
import { cn } from "@/lib/utils"

/** The strip's height, which the area tree subtracts from its rectangle. */
export const STATUS_BAR_PX = 22

export function StudioStatusBar({
  running,
  progress,
  runLog,
  selected,
  total,
  areas,
  onOpenLog,
}: {
  running: boolean
  /** 0 to 100, from the sidecar's own stages. */
  progress: number
  runLog: RunLogEntry[]
  selected: number
  total: number
  areas: number
  /** Opens the full log, which the middle zone summarises to one line. */
  onOpenLog?: () => void
}) {
  const stage = runLog.length ? runLog[runLog.length - 1] : null

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-[35] flex items-center gap-2 border-t px-2"
      style={{
        height: STATUS_BAR_PX,
        background: "rgb(var(--p-ink))",
        borderColor: "rgb(var(--p-line) / 0.28)",
      }}
    >
      {/*
        LEFT: what the pointer does. Blender draws mouse glyphs here and names
        the binding under each; these are the board's own gestures, which had
        no written form anywhere -- pressing a plane, shift to extend, drag to
        move were all discoverable only by trying.
      */}
      <span className="telemetry flex shrink-0 items-center gap-2 text-[9px] text-muted-foreground">
        <Binding keys="Press" what="Select" />
        <Binding keys="Shift" what="Extend" />
        <Binding keys="Drag" what="Move plane" />
        <Binding keys="Right drag" what="Pan" />
        <Binding keys="Ctrl Space" what="Maximise area" />
      </span>

      <span className="flex-1" />

      {/*
        MIDDLE: what the application is doing. One line, and the stack of them
        behind a press -- the argument the run log was written with, which is
        that a line rewriting itself several times a second costs more
        attention than it returns while a stack read once is the only account
        of what a run did.
      */}
      {running && (
        <button
          type="button"
          onClick={onOpenLog}
          title="Open the run log"
          className="flex min-w-0 max-w-[24rem] shrink items-center gap-1.5 rounded-sm px-1.5 text-meta text-foreground transition-colors hover:bg-surface-raised"
        >
          <Loader2 className="size-3 shrink-0 animate-spin text-accent" strokeWidth={2} />
          <span className="telemetry shrink-0 text-[9px] tabular-nums text-muted-foreground">
            {Math.round(progress)}%
          </span>
          <span className="min-w-0 truncate">{stage?.text ?? "Running"}</span>
          {/*
            The bar under the line rather than beside it: a progress figure and
            a progress bar saying the same thing twice is the duplication this
            codebase keeps having to remove, and the bar is the one that reads
            at a glance.
          */}
          <span
            className="ml-1 h-1 w-16 shrink-0 overflow-hidden rounded-full"
            style={{ background: "rgb(var(--p-line) / 0.35)" }}
            aria-hidden
          >
            <span
              className="block h-full bg-accent transition-[width] duration-200"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </span>
        </button>
      )}

      <span className="flex-1" />

      {/* RIGHT: what is in the scene and how much of it is picked. */}
      <span className="telemetry flex shrink-0 items-center gap-2 text-[9px] text-muted-foreground">
        <span>
          <span className={cn(selected > 0 && "text-foreground")}>{selected}</span>
          /{total} planes
        </span>
        <span>
          {areas} {areas === 1 ? "area" : "areas"}
        </span>
      </span>
    </div>
  )
}

/** One binding: the key in the foreground, what it does beside it. */
function Binding({ keys, what }: { keys: string; what: string }) {
  return (
    <span className="hidden items-center gap-1 lg:inline-flex">
      <span
        className="rounded-[2px] px-1 text-foreground"
        style={{ background: "rgb(var(--p-line) / 0.28)" }}
      >
        {keys}
      </span>
      {what}
    </span>
  )
}
