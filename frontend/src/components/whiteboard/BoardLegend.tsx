/**
 * What the selected plane's colours mean, drawn beside it.
 *
 * The board's complaint it answers: six planes of pink, cream and blue, each
 * named for its product and none for its content. A class raster IS its
 * palette -- without one, the plane is a picture that only its author can read.
 *
 * Tied to the selection rather than always on, and for all of them rather than
 * none: a legend per plane would be six panels over a surface whose whole point
 * is the planes, and the reader is already selecting the one being asked about.
 */
import { cn } from "@/lib/utils"
import type { LayerLegend } from "@/lib/layerLegend"

export function BoardLegend({
  legend,
  area,
}: {
  legend: LayerLegend
  /** Which stack the selected plane belongs to; two areas draw the same ids. */
  area?: string
}) {
  if (!legend) return null

  return (
    <div
      className="panel app-no-drag absolute right-3 top-3 z-[20] w-[13rem] rounded-md p-2.5"
      role="note"
      aria-label="Legend for the selected layer"
    >
      <p className="eyebrow !text-[9px] truncate">{legend.subject}</p>
      {area && (
        <p className="telemetry truncate text-[9px] text-muted-foreground">
          {area}
        </p>
      )}

      {legend.kind === "classes" && (
        <ul className="mt-2 flex flex-col gap-1">
          {legend.entries.map((e) => (
            <li key={`${e.name}-${e.color}`} className="flex items-center gap-1.5">
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{
                  background: e.color,
                  // The swatch has to hold its edge over a pale class as well
                  // as a dark one, on a surface that is neither.
                  boxShadow: "inset 0 0 0 1px rgb(var(--p-line-strong) / 0.5)",
                }}
              />
              <span className="min-w-0 flex-1 truncate text-meta text-foreground">
                {e.name}
              </span>
              {e.pct !== undefined && (
                <span className="telemetry shrink-0 text-[9px] text-muted-foreground">
                  {e.pct.toFixed(1)}%
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {legend.kind === "ramp" && (
        <div className="mt-2 flex flex-col gap-1">
          <div
            className="h-2 w-full rounded-[3px]"
            style={{ background: legend.gradient }}
            aria-hidden
          />
          <div className="telemetry flex justify-between text-[9px] text-muted-foreground">
            <span className="truncate">{legend.low}</span>
            <span className="truncate">{legend.high}</span>
          </div>
        </div>
      )}

      {legend.kind === "note" && (
        <p className={cn("mt-1.5 text-meta text-muted-foreground")}>
          {legend.note}
        </p>
      )}
    </div>
  )
}
