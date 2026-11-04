import type { activeRuns } from "@/lib/productRun"

/**
 * What is running, wherever the reader has gone. A classification takes minutes, and the
 * product panel it started from may be closed long before it ends.
 */
export function RunStatus({ running }: { running: ReturnType<typeof activeRuns> }) {
  return (
    <div
      role="status"
      className="map-chrome app-no-drag absolute bottom-10 left-1/2 z-440 w-[24rem] max-w-[60%] -translate-x-1/2 rounded-md border border-[rgb(var(--p-line)/0.28)] px-3 py-2 shadow-[0_2px_8px_rgb(0_0_0/0.28)]"
    >
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
