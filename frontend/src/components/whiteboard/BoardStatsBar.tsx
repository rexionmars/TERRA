/**
 * What the selected planes are, and what their colours mean, along the foot.
 *
 * It began as a card floating over the board and that was the wrong shape
 * twice. A MapBiomas map has thirteen classes, which as a vertical list is a
 * column tall enough to cover the planes it is explaining; and a card over a
 * surface whose whole content is what lies under it takes the one thing the
 * board is for.
 *
 * It takes a LIST, not one layer, and that is the point rather than a
 * generalisation. The board's selection is already ordered -- shift adds to it
 * and the scene draws an arrowed path through the result -- so putting two
 * rasters side by side is the gesture this surface is built around, and their
 * figures belong beside each other where the comparison is being made. Prose
 * and figures are bounded so the next block has somewhere to start -- a caveat
 * running the band's whole width was that failure with a single block -- while
 * a class list is bounded by the band's HEIGHT instead and flows into as many
 * columns as it needs. The band's own row is the only thing that scrolls.
 *
 * Twice the run band's height and starting where it starts, so the foot reads
 * as one edge in two registers: what the run WILL do below, what the selected
 * rasters ARE above.
 *
 * IT CARRIES NO ACTIONS, and that is the rule rather than the current state.
 * It replaced the result panel and took that panel's buttons with it, which was
 * wrong twice over: two of them ended the session -- an X on a row of class
 * shares reads as "close this bar" and took an imported AOI's whole analysis --
 * and the last one navigated to the legacy analysis page, which is the surface
 * this one is replacing. A readout describes; it does not act, and it does not
 * send you somewhere else to act. All three are on the map, one board-close
 * away, where their consequences are stated.
 */
import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { RunLogEntry } from "@/lib/runLog"
import type { LayerLegend } from "@/lib/layerLegend"

export interface StatsEntry {
  key: string
  legend: LayerLegend
  /** Which stack the plane belongs to; two areas draw the same layer ids. */
  area?: string
  /** The run's window, where the area has one. */
  period?: string
  /**
   * What produced this raster, from the run record.
   *
   * Two runs of one AOI are told apart by their estimator, not by their name --
   * both are called "run-custom-aoi-..." and both cover the same window. The
   * figures beside them are only comparable once it is said which made which.
   */
  model?: string
}

/**
 * What the run has said, while it is saying it.
 *
 * The progress message used to be spent on the run button's tooltip, and the
 * argument for that was sound about a single line: one that rewrites itself
 * several times a second costs more attention than it returns. A log is the
 * other thing -- each line is read once and stays, and the stack of them is the
 * only account of what the run actually did. The sidecar's stages carry their
 * own detail, and it was being thrown away several times a second.
 */
function RunLog({ entries }: { entries: RunLogEntry[] }) {
  const endRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    // Scrolled to the foot, which is where a log is read: the stage in
    // progress is the one being waited on.
    endRef.current?.scrollIntoView({ block: "end" })
  }, [entries.length])

  return (
    <ul className="panel-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-2">
      {entries.map((e, i) => (
        <li
          key={`${i}-${e.text}`}
          ref={i === entries.length - 1 ? endRef : undefined}
          className="flex items-baseline gap-2"
        >
          <span className="telemetry w-8 shrink-0 text-right text-[9px] text-muted-foreground">
            {Math.round(e.at)}%
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-meta",
              // The last is what is happening; the rest is what happened.
              i === entries.length - 1
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            {e.text}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The width a block's prose and figures are held to. */
const BLOCK = "w-[21rem]"

/**
 * One selected raster's block.
 *
 * Bounded, but not by one number for every kind. A caveat and a row of figures
 * are held to BLOCK, because prose that runs the band's whole width was the
 * complaint that started this. A CLASS LIST is not held to it: it flows into
 * columns bounded by the band's HEIGHT, so its width is however many columns
 * its classes need, and the band's own row is what scrolls.
 *
 * That is one scroller rather than two. Giving the list its own made it scroll
 * inside a block inside a scrolling row, and the bar it drew to say so cost a
 * row of the classes it was hiding.
 */
function Entry({ entry }: { entry: StatsEntry }) {
  const { legend, area, period, model } = entry
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <div className={cn(BLOCK, "flex max-w-full flex-col gap-0.5")}>
        <p className="eyebrow !text-[9px] truncate">
          {legend?.subject ?? "Unnamed raster"}
        </p>
        {area && (
          <p className="telemetry truncate text-meta text-foreground">{area}</p>
        )}
        {(period || model) && (
          <p className="telemetry truncate text-[9px] text-muted-foreground">
            {[model, period].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {legend?.kind === "classes" && legend.rows && (
        /*
          Above the shares, on one line. What qualifies the whole map is read
          before what it is made of -- a 71% class under a mean vote share of
          37% is a different statement from the same 71% under 80% -- and one
          line is what the band's height can spare for it.
        */
        <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
          {legend.rows.map((r) => (
            <li key={r.label} className="flex shrink-0 items-baseline gap-1">
              <span className="eyebrow !text-[9px]">{r.label}</span>
              <span className="telemetry whitespace-nowrap text-meta text-foreground">
                {r.value}
              </span>
            </li>
          ))}
        </ul>
      )}

      {legend?.kind === "classes" && (
        <ul className="flex min-h-0 flex-1 flex-col flex-wrap content-start gap-x-5 gap-y-0.5">
          {legend.entries.map((e) => (
            <li
              key={`${e.name}-${e.color}`}
              className="flex w-[15rem] shrink-0 items-center gap-1.5"
            >
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{
                  background: e.color,
                  // Holds its edge over a pale class as well as a dark one.
                  boxShadow: "inset 0 0 0 1px rgb(var(--p-line-strong) / 0.5)",
                }}
              />
              <span className="min-w-0 flex-1 truncate text-meta text-foreground">
                {e.name}
              </span>
              {e.areaHa !== undefined && (
                <span className="telemetry shrink-0 text-[9px] text-muted-foreground/70">
                  {e.areaHa.toFixed(0)} ha
                </span>
              )}
              {e.pct !== undefined && (
                <span className="telemetry w-12 shrink-0 text-right text-meta text-foreground">
                  {e.pct.toFixed(1)}%
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {legend?.kind === "ramp" && (
        <div className={cn(BLOCK, "flex flex-col gap-0.5")}>
          <div
            className="h-2.5 w-full rounded-[3px]"
            style={{ background: legend.gradient }}
            aria-hidden
          />
          <div className="telemetry flex justify-between text-[9px] text-muted-foreground">
            <span className="truncate">{legend.low}</span>
            <span className="truncate">{legend.high}</span>
          </div>
        </div>
      )}

      {legend?.kind === "stats" && (
        <div className={cn(BLOCK, "flex min-h-0 flex-1 flex-col gap-1")}>
          {legend.ramp && (
            /*
              Before the figures, because it explains the plane and they only
              summarise it: a reader looking at a colour asks this first.
            */
            <div className="flex flex-col gap-0.5">
              <div
                className="h-2.5 w-full rounded-[3px]"
                style={{ background: legend.ramp.gradient }}
                aria-hidden
              />
              <div className="telemetry flex justify-between text-[9px] text-muted-foreground">
                <span>{legend.ramp.low}</span>
                <span>{legend.ramp.high}</span>
              </div>
            </div>
          )}
          <ul className="flex flex-wrap items-start gap-x-5 gap-y-1">
            {legend.rows.map((r) => (
              <li key={r.label} className="flex shrink-0 flex-col gap-0.5">
                <span className="eyebrow !text-[9px]">{r.label}</span>
                <span className="telemetry whitespace-nowrap text-meta text-foreground">
                  {r.value}
                </span>
              </li>
            ))}
          </ul>
          {legend.note && (
            <p className="mt-auto text-[9px] leading-snug text-muted-foreground">
              {legend.note}
            </p>
          )}
        </div>
      )}

      {legend?.kind === "note" && (
        <p className={cn(BLOCK, "text-meta leading-snug text-muted-foreground")}>
          {legend.note}
        </p>
      )}
    </div>
  )
}

export function BoardStatsBar({
  entries,
  leftOffset,
  runLog = [],
  running = false,
}: {
  /** The selected rasters, in the order they were picked. */
  entries: StatsEntry[]
  /** Where the board's column ends, matching the run band below. */
  leftOffset: string
  /**
   * What the run has said so far.
   *
   * It takes the band while a run is going, and the reason is that the figures
   * it displaces are STALE: they describe the rasters from before, and the
   * question in front of the reader is what the run is doing now. When it
   * finishes they come back.
   */
  runLog?: RunLogEntry[]
  running?: boolean
}) {
  return (
    <div
      className="app-no-drag absolute right-0 z-[20] flex items-stretch overflow-hidden border-t px-3 py-2"
      style={{
        left: leftOffset,
        /*
          Sits on the run band and is as tall as the map screen says. Both
          numbers are declared once, beside the foot reservation that has to
          equal their sum -- a height written here would drift from it.
        */
        bottom: "var(--map-band, 4rem)",
        height: "var(--map-stats, 8rem)",
        background: "rgb(var(--p-ink))",
        borderColor: "rgb(var(--p-line) / 0.28)",
      }}
    >
      {running && runLog.length > 0 ? (
        <RunLog entries={runLog} />
      ) : entries.length === 0 ? (
        <p className="flex items-center text-meta text-muted-foreground">
          Pick a raster to read its legend. Shift-pick a second to compare.
        </p>
      ) : (
        <div className="panel-scroll flex min-w-0 flex-1 items-stretch gap-3 overflow-x-auto">
          {entries.map((e, i) => (
            <div key={e.key} className="flex shrink-0 items-stretch gap-3">
              {i > 0 && (
                <div
                  className="w-px shrink-0"
                  style={{ background: "rgb(var(--p-line) / 0.28)" }}
                />
              )}
              <Entry entry={e} />
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
