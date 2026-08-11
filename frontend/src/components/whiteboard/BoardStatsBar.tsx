/**
 * What the selected plane is, and what its colours mean, along the foot.
 *
 * It began as a card floating over the board and that was the wrong shape
 * twice. A MapBiomas map has thirteen classes, which as a vertical list is a
 * column tall enough to cover the planes it is explaining; and a card over a
 * surface whose whole content is what is under it takes the one thing the
 * board is for. A band of the window's width turns the same list into columns,
 * leaves the planes uncovered, and has room for the area figure beside the
 * share -- which a 13rem card never would.
 *
 * Twice the run band's height and starting where it starts, so the two read as
 * one foot in two registers: what the run WILL do below, what the selected
 * raster IS above.
 */
import type { LayerLegend } from "@/lib/layerLegend"

export function BoardStatsBar({
  legend,
  area,
  period,
  leftOffset,
}: {
  legend: LayerLegend
  /** Which stack the selected plane belongs to; two areas draw the same ids. */
  area?: string
  /** The run's window, where the area has one. */
  period?: string
  /** Where the board's column ends, matching the run band below. */
  leftOffset: string
}) {
  return (
    <div
      className="app-no-drag absolute right-0 z-[20] flex items-stretch gap-3 overflow-hidden border-t px-3 py-2"
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
      {/*
        The identity, at a fixed width so the figures beside it start at the
        same place whatever is selected. A column that reflowed with the
        subject's length would move every number on the bar.
      */}
      <div className="flex w-[13rem] shrink-0 flex-col justify-center gap-0.5">
        <p className="eyebrow !text-[9px] truncate">
          {legend?.subject ?? "No layer selected"}
        </p>
        {area && (
          <p className="telemetry truncate text-meta text-foreground">{area}</p>
        )}
        {period && (
          <p className="telemetry truncate text-[9px] text-muted-foreground">
            {period}
          </p>
        )}
        {!legend && (
          <p className="text-meta text-muted-foreground">
            Pick a raster to read its legend.
          </p>
        )}
      </div>

      <div
        className="hairline w-px shrink-0 border-l"
        style={{ borderColor: "rgb(var(--p-line) / 0.28)" }}
      />

      {legend?.kind === "classes" && (
        /*
          Column-flow, so the classes fill the bar's height first and then flow
          rightward -- a list of thirteen becomes four short columns rather
          than one that does not fit. The bar scrolls sideways rather than
          growing, which is the run band's own rule.
        */
        <ul
          className="panel-scroll flex min-w-0 flex-1 flex-col flex-wrap content-start gap-x-6 gap-y-1 overflow-x-auto"
          style={{ maxHeight: "100%" }}
        >
          {legend.entries.map((e) => (
            <li
              key={`${e.name}-${e.color}`}
              className="flex w-[17rem] shrink-0 items-center gap-1.5"
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
        <div className="flex min-w-0 max-w-[24rem] flex-1 flex-col justify-center gap-1">
          <div
            className="h-2.5 w-full rounded-[3px]"
            style={{ background: legend.gradient }}
            aria-hidden
          />
          <div className="telemetry flex justify-between text-meta text-muted-foreground">
            <span className="truncate">{legend.low}</span>
            <span className="truncate">{legend.high}</span>
          </div>
        </div>
      )}

      {legend?.kind === "stats" && (
        /*
          The figures the run measured, in the same column flow as the classes
          so the bar reads the same way whichever kind is selected. The caveat
          runs under them rather than beside: it changes how every figure above
          it must be read, and a note in a column would look like one more.
        */
        <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
          <ul className="panel-scroll flex min-w-0 flex-wrap items-start gap-x-6 gap-y-1 overflow-x-auto">
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
        <p className="flex min-w-0 flex-1 items-center text-meta text-muted-foreground">
          {legend.note}
        </p>
      )}
    </div>
  )
}
