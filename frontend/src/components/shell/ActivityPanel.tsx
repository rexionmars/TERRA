import { useReports, type ReportLevel } from "@/lib/reports"
import { cn } from "@/lib/utils"
import { PanelEmpty, ShellPanel } from "@/components/shell/ShellPanel"

/** The Console's own lines stay in the Console. */
const CONSOLE: readonly ReportLevel[] = ["input", "output"]

const TONE: Partial<Record<ReportLevel, string>> = {
  error: "text-destructive-quiet",
  success: "text-success",
}

/** What the application has said, kept after each toast leaves. */
export function ActivityPanel({ onClose }: { onClose: () => void }) {
  const reports = useReports().filter((r) => !CONSOLE.includes(r.level))
  return (
    <ShellPanel crumbs={[{ label: "Activity" }]} onClose={onClose}>
      {reports.length === 0 ? (
        <PanelEmpty title="Nothing yet">Runs and notifications are listed here as they happen.</PanelEmpty>
      ) : (
        <ul className="flex flex-col">
          {[...reports].reverse().map((r) => (
            <li key={r.id} className="border-b border-border/60 py-2 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className={cn("min-w-0 text-read text-foreground", TONE[r.level])}>{r.title}</span>
                <span className="shrink-0 text-label tabular-nums text-muted-foreground">
                  {r.time.toLocaleTimeString()}
                </span>
              </div>
              {r.description && <p className="mt-0.5 text-label text-muted-foreground">{r.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </ShellPanel>
  )
}
