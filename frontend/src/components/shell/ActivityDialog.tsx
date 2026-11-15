import { useState } from "react"

import { PanelEmpty } from "@/components/shell/ShellPanel"
import { ModalHeader, ModalShell } from "@/components/ui/ModalShell"
import { clearReports, useReports, type ReportLevel } from "@/lib/reports"
import { cn } from "@/lib/utils"

const TONE: Partial<Record<ReportLevel, string>> = {
  error: "text-destructive-quiet",
  success: "text-success",
}

/** Which kinds are listed; the two the Console wrote are in the log and not offered. */
const LEVELS: readonly { level: ReportLevel; label: string }[] = [
  { level: "operator", label: "Commands" },
  { level: "info", label: "Info" },
  { level: "success", label: "Done" },
  { level: "error", label: "Errors" },
]

/*
  WHAT THE APPLICATION HAS SAID, kept after each toast leaves, in a dialog over
  whatever screen is open. It was a panel over the map, so opening it from
  Compare, Workflows or Settings took the reader to the globe first, away from
  the screen whose notification they had come to read.
*/
export function ActivityDialog({ onClose }: { onClose: () => void }) {
  const all = useReports().filter((r) => LEVELS.some((l) => l.level === r.level))
  const [hidden, setHidden] = useState<ReadonlySet<ReportLevel>>(() => new Set())
  const reports = all.filter((r) => !hidden.has(r.level))
  const toggle = (level: ReportLevel) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  return (
    <ModalShell
      onDismiss={onClose}
      labelledBy="activity-dialog-title"
      className="h-[min(78vh,640px)] w-[min(94vw,640px)]"
    >
      <ModalHeader
        eyebrow="THIS SESSION"
        title="Activity"
        titleId="activity-dialog-title"
        subtitle="What TERRA has reported since it started, newest first."
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        {reports.length === 0 ? (
          <PanelEmpty title="Nothing here">
            {all.length
              ? "Every kind of report that exists is hidden."
              : "Runs and notifications are listed here as they happen."}
          </PanelEmpty>
        ) : (
          <ul className="flex flex-col">
            {[...reports].reverse().map((r) => (
              <li key={r.id} className="border-b border-border/60 py-2 last:border-b-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={cn("min-w-0 text-read text-foreground", TONE[r.level])}
                  >
                    {r.title}
                  </span>
                  <span className="shrink-0 text-label text-muted-foreground tabular-nums">
                    {r.time.toLocaleTimeString()}
                  </span>
                </div>
                {r.description && (
                  <p className="mt-0.5 text-label text-muted-foreground">
                    {r.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 border-t border-border px-4 py-2">
        <div
          role="group"
          aria-label="Kinds of report listed"
          className="flex min-w-0 flex-1 flex-wrap gap-1"
        >
          {LEVELS.map(({ level, label }) => {
            const on = !hidden.has(level)
            return (
              <button
                key={level}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(level)}
                className={cn(
                  "rounded-sm px-2 py-1 text-label transition-colors",
                  on
                    ? "bg-[rgb(var(--p-surface-raised))] text-foreground"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground"
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          disabled={all.length === 0}
          onClick={clearReports}
          className="shrink-0 rounded-sm px-2 py-1 text-label text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </ModalShell>
  )
}
