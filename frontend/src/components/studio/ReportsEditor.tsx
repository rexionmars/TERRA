/**
 * Every notification the application raised, and every operator run, newest at
 * the foot. A toast leaves; this keeps it.
 *
 * The filters are this area's own, which is why they are here rather than in
 * the parent's header slots: two Reports areas can show two different cuts of
 * the one log, and neither owes the board a record of which.
 */
import { useEffect, useRef, useState } from "react"
import {
  CheckCircle,
  FunnelSimple,
  Info,
  Play,
  WarningOctagon,
  type Icon,
} from "@phosphor-icons/react"

import { clearReports, useReports, type ReportLevel } from "@/lib/reports"
import { AreaHeaderOptions } from "@/components/studio/StudioArea"
import {
  StudioHeaderPopoverButton,
  StudioHeaderRule,
} from "@/components/studio/StudioHeaderControls"
import { StudioMenuItem, StudioPopover } from "@/components/studio/StudioPopover"
import { cn } from "@/lib/utils"

const LEVELS: { level: ReportLevel; label: string; icon: Icon }[] = [
  { level: "operator", label: "Operators", icon: Play },
  { level: "info", label: "Info", icon: Info },
  { level: "success", label: "Done", icon: CheckCircle },
  { level: "error", label: "Errors", icon: WarningOctagon },
]

const ICON = new Map(LEVELS.map((l) => [l.level, l.icon]))

const time = (d: Date) =>
  d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })

export function ReportsEditor({
  surface,
}: {
  /** The studio surface its filter menu is portalled into. */
  surface: HTMLElement | null
}) {
  // The Console's own lines stay in the Console.
  const all = useReports().filter((r) => r.level !== "input" && r.level !== "output")
  const [hidden, setHidden] = useState<ReadonlySet<ReportLevel>>(new Set())
  const [filterMenu, setFilterMenu] = useState(false)
  const shown = all.filter((r) => !hidden.has(r.level))
  const scroller = useRef<HTMLDivElement>(null)
  // Follows the foot until the reader scrolls up to read something.
  const atFoot = useRef(true)

  useEffect(() => {
    const el = scroller.current
    if (el && atFoot.current) el.scrollTop = el.scrollHeight
  }, [shown.length])

  const toggle = (level: ReportLevel) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })

  return (
    <>
      <AreaHeaderOptions>
        {/*
          One entrance with the count as its label, as the outliner filters its
          tree: four switches lit in the accent, all on by default, drew the
          loudest thing in the header for the state nobody had chosen.
        */}
        <StudioPopover
          open={filterMenu}
          onOpenChange={setFilterMenu}
          surface={surface}
          align="end"
          widthRem={12}
          trigger={(p) => (
            <StudioHeaderPopoverButton
              {...p}
              icon={FunnelSimple}
              label={`${LEVELS.length - hidden.size}/${LEVELS.length}`}
              showLabel
              open={filterMenu}
              active={hidden.size > 0}
              title="Which kinds of report are listed"
            />
          )}
        >
          {LEVELS.map(({ level, label, icon }) => (
            <StudioMenuItem
              key={level}
              icon={icon}
              label={label}
              note={String(all.filter((r) => r.level === level).length)}
              checked={!hidden.has(level)}
              title={`${hidden.has(level) ? "List" : "Leave out"} ${label.toLowerCase()}`}
              onSelect={() => toggle(level)}
            />
          ))}
        </StudioPopover>
        <StudioHeaderRule />
        <button
          type="button"
          onClick={clearReports}
          disabled={all.length === 0}
          className="flex h-5 items-center rounded-sm px-1.5 text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
      </AreaHeaderOptions>
      <div
        ref={scroller}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget
          atFoot.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="panel-scroll selectable h-full min-h-0 overflow-y-auto py-1"
        style={{ background: "var(--s-field)" }}
      >
        {shown.length === 0 && (
          <p className="px-3 py-1 text-body text-muted-foreground">
            {all.length === 0
              ? "Nothing reported yet. Notifications and the commands that ran are kept here."
              : "Every report is filtered out."}
          </p>
        )}
        {shown.map((r) => {
          const Glyph = ICON.get(r.level) ?? Info
          const error = r.level === "error"
          return (
            <div
              key={r.id}
              className="flex items-start gap-2 px-2 py-px hover:bg-hover"
            >
              <span className="telemetry shrink-0 pt-px text-[9px] text-muted-foreground">
                {time(r.time)}
              </span>
              <Glyph
                className={cn(
                  "mt-[3px] size-3 shrink-0",
                  error ? "text-destructive-quiet" : "text-muted-foreground"
                )}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 whitespace-pre-wrap break-words",
                  r.level === "operator"
                    ? "telemetry text-meta text-muted-foreground"
                    : error
                      ? "text-body text-destructive-quiet"
                      : "text-body text-foreground"
                )}
              >
                {r.title}
                {r.description && (
                  <span className="text-muted-foreground">
                    {" \u2014 "}
                    {r.description}
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}
