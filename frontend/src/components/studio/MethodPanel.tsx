/**
 * What the run will do, and what it did.
 *
 * The band is one line to scan -- that is the argument its own header makes,
 * and it is right -- so this is not more band. It is the ENTRANCE pattern
 * StudioPopover exists for: the header carries one glyph and the twenty facts
 * live one press away.
 *
 * Two halves, in that order, because they answer questions asked at different
 * moments. The BRIEF is read before a run, while choosing: which bands, which
 * cadence, what the model actually is. The TRACE is read during and after one:
 * how many scenes it found, which path it took, why it is taking so long. The
 * brief comes from lib/methodBrief.ts and the trace from lib/runLog.ts, and
 * neither is written here -- this file is the drawing and nothing else.
 *
 * The trace is kept after the run ends, which is the whole point of keeping it
 * at all: "how many scenes did that use" is asked once the map is on screen,
 * not while the spinner is turning.
 */
import { Info } from "@phosphor-icons/react"
import { useState } from "react"
import type { MethodBrief } from "@/lib/methodBrief"
import type { RunLogEntry } from "@/lib/runLog"
import { cn } from "@/lib/utils"
import { StudioPopover } from "./StudioPopover"

/** A titled block of the brief. */
function Section({
  title,
  lines,
  note,
}: {
  title: string
  lines: string[]
  note?: string
}) {
  return (
    <div className="px-2.5 py-1.5">
      <p className="eyebrow !text-[9px] pb-1">{title}</p>
      <ul className="flex flex-col gap-1">
        {lines.map((l) => (
          <li
            key={l}
            /*
              A hanging indent rather than a bullet glyph. These lines wrap --
              some are a full sentence of band names -- and a wrapped line that
              returns to the left margin reads as a new item.
            */
            className="pl-2 -indent-2 text-meta leading-snug text-muted-foreground"
          >
            {/* An en dash as the marker, at the same token as the line it
                marks: check:contrast measures TOKEN PAIRS, so an opacity
                invented here would be the one value in the panel nobody has
                measured. muted on surfaceRaised is 5.18. */}
            <span aria-hidden>– </span>
            {l}
          </li>
        ))}
      </ul>
      {note && (
        /*
          Set apart by a rule on the leading edge, not by a colour: a caveat
          tinted amber would compete with the accent, which in this studio
          means CHOSEN. What marks it is that it is inset and quiet, which is
          how the board's tree marks a sub-entry.
        */
        <p
          className="mt-1.5 border-l pl-2 text-meta leading-snug text-muted-foreground"
          style={{ borderColor: "rgb(var(--p-line-strong) / 0.55)" }}
        >
          {note}
        </p>
      )}
    </div>
  )
}

function Rule() {
  return (
    <div
      className="h-px"
      style={{ background: "rgb(var(--p-line) / 0.4)" }}
      aria-hidden
    />
  )
}

/**
 * The stages the sidecar reported, most recent last.
 *
 * Bounded in height and scrolled rather than allowed to grow, so opening the
 * panel mid-run does not push the brief off the surface it is clamped inside.
 */
function Trace({
  entries,
  running,
}: {
  entries: RunLogEntry[]
  running: boolean
}) {
  return (
    <div className="px-2.5 py-1.5">
      <p className="eyebrow !text-[9px] pb-1">
        {running ? "Running" : "Last run"}
      </p>
      <ul className="selectable panel-scroll flex max-h-40 flex-col gap-0.5 overflow-y-auto">
        {entries.map((e, i) => {
          const last = i === entries.length - 1
          return (
            <li key={`${i}-${e.text}`} className="flex items-baseline gap-2">
              <span className="telemetry w-7 shrink-0 text-right text-[9px] text-muted-foreground">
                {Math.round(e.at)}%
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 text-meta leading-snug",
                  // While running, the foot is what is HAPPENING and the rest
                  // is what happened. Once it ends they are all history and
                  // lighting one of them would assert it is still going.
                  last && running ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {e.text}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The entrance and its panel.
 *
 * Open state is held here rather than lifted: nothing else in the band needs
 * to know, and a parent that owned it would be a prop threaded through
 * StudioScreen for one glyph.
 */
export function MethodPanel({
  brief,
  runLog,
  running,
  surface,
  disabled,
}: {
  brief: MethodBrief
  runLog: RunLogEntry[]
  running: boolean
  /** The surface the panel is portalled into; the window where none is given. */
  surface?: HTMLElement | null
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <StudioPopover
      open={open}
      onOpenChange={setOpen}
      surface={surface ?? document.body}
      align="end"
      widthRem={23}
      role="dialog"
      trigger={(t) => (
        <button
          type="button"
          ref={t.ref as (el: HTMLButtonElement | null) => void}
          onClick={t.onClick}
          aria-expanded={t["aria-expanded"]}
          aria-haspopup={t["aria-haspopup"]}
          disabled={disabled}
          title="What this run does"
          className={cn(
            // The same 22px the fields beside it stand at, so the band still
            // scans as one line.
            "flex h-[1.375rem] shrink-0 items-center gap-1 rounded-sm px-1.5 text-meta transition-colors",
            "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
            disabled
              ? "cursor-not-allowed text-muted-foreground/40"
              : open
                ? "bg-accent-dim text-foreground inset-ring-1 inset-ring-accent"
                : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
          )}
        >
          <Info className="size-3 shrink-0" />
          Method
        </button>
      )}
    >
      <div className="flex max-h-[24rem] flex-col overflow-y-auto panel-scroll">
        <div className="px-2.5 pb-1.5 pt-1">
          <p className="text-meta leading-snug text-foreground">
            {brief.subtitle}
          </p>
        </div>
        {brief.sections.map((s) => (
          <div key={s.title}>
            <Rule />
            <Section title={s.title} lines={s.lines} note={s.note} />
          </div>
        ))}
        {runLog.length > 0 && (
          <>
            <Rule />
            <Trace entries={runLog} running={running} />
          </>
        )}
        <Rule />
        {/*
          The file to check these lines against. They are claims about what the
          next run does, not documentation, so a reader who doubts one needs to
          know where it is asserted.
        */}
        <p className="telemetry px-2.5 py-1.5 text-[9px] text-muted-foreground">
          {brief.source}
        </p>
      </div>
    </StudioPopover>
  )
}
