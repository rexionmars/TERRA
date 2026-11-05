import { CircleNotch } from "@/components/icons"
import type { activeRuns } from "@/lib/productRun"

/**
 * What is running, wherever the reader has gone. A classification takes minutes, and the
 * product panel it started from may be closed long before it ends.
 *
 * Also a saved analysis being opened, named by its area. That load takes seconds and
 * changes nothing on screen until it arrives, so without a line here the press that
 * started it looks like a press that did nothing.
 */
export function RunStatus({
  running,
  opening,
}: {
  running: ReturnType<typeof activeRuns>
  opening?: string | null
}) {
  return (
    <div
      role="status"
      className="map-chrome app-no-drag absolute bottom-10 left-1/2 z-440 w-[24rem] max-w-[60%] -translate-x-1/2 rounded-md border border-[rgb(var(--p-line)/0.28)] px-3 py-2 shadow-[0_2px_8px_rgb(0_0_0/0.28)]"
    >
      {opening && (
        <div className="flex items-center gap-2 text-label">
          <CircleNotch className="size-3 shrink-0 animate-spin text-muted-foreground" />
          <span className="truncate text-foreground">
            Opening the analysis of {opening}
          </span>
        </div>
      )}
      {running.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-label">
            <span className="truncate text-foreground">{r.progressMsg || r.label}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {Math.round(r.progress)} %
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-sm bg-[rgb(var(--p-control))]">
            <div
              className="h-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.min(100, Math.max(0, r.progress))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
