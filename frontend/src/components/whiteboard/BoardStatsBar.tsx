/**
 * What the selected planes are, and what their colours mean.
 *
 * Default placement is the right sidebar: multi-AOI land-cover legends need
 * vertical room, and packing them into the foot band side-by-side was the
 * cramped readout that started the swap with BoardSolarDetail.
 *
 * `foot` remains for the older horizontal band (class columns bounded by
 * height). Renaming a catalogued AOI is identity of the readout — double-click
 * the area title when the parent wires `onRenameArea`.
 */
import { useEffect, useRef, useState } from "react"
import { Pencil } from "lucide-react"
import { cn } from "@/lib/utils"
import type { RunLogEntry } from "@/lib/runLog"
import type { LayerLegend } from "@/lib/layerLegend"
import type { LULCAgreement } from "@/lib/types"
import { BOARD_RIGHT_REM } from "@/lib/boardPartition"
import {
  ClassAccuracyChart,
  DisagreementBar,
} from "@/components/whiteboard/AgreementCharts"

export interface StatsEntry {
  /**
   * How this plane stands against MapBiomas, where the run measured it.
   *
   * A measurement of ONE raster against a reference, so it belongs beside the
   * raster's identity and classes. It used to sit in the foot band, which by
   * the board's division is for what relates two planes -- and there it was
   * drawn beside figures the column was already drawing.
   *
   * Only for the layer the agreement is ABOUT: a run's agreement describes its
   * classification, not its confidence raster or its true-colour scene.
   */
  agreement?: LULCAgreement | null
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
  /**
   * Commit a new area title. Absent for run stacks that are not in the drawn
   * catalog — those keep their run label elsewhere.
   */
  onRenameArea?: (name: string) => void
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
                : "text-muted-foreground",
            )}
          >
            {e.text}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Auto names from the draw catalog — still editable, but read as provisional. */
function isProvisionalAreaName(name: string): boolean {
  const t = name.trim().toLowerCase()
  return (
    /^drawn(\s+\d+)?$/.test(t) || t === "custom aoi" || t === "unnamed area"
  )
}

/**
 * One selected raster's block.
 *
 * Full width of the column, stacked. This used to carry a second layout for the
 * foot band -- fixed-width blocks whose class lists flowed into computed
 * columns -- and the arithmetic that sized them (CLASS_ROWS, classListWidthRem,
 * BLOCK_REM) existed only for that. The band no longer describes a single
 * plane, so the second layout and its arithmetic went with it.
 */
function Entry({ entry }: { entry: StatsEntry }) {
  const { legend, area, period, model, onRenameArea, agreement } = entry
  const provisional = !!area && isProvisionalAreaName(area)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(area ?? "")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(area ?? "")
  }, [area, editing])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commitRename = () => {
    setEditing(false)
    const next = draft.trim()
    if (!next || !onRenameArea || next === area) return
    onRenameArea(next)
  }

  return (
    <div
      // overflow-hidden as a backstop: whatever a future layout does inside,
      // one block must not be able to paint into the one beside it.
      className={cn("flex min-h-0 flex-col gap-1.5 overflow-hidden", "w-full")}
    >
      <div className={cn("w-full flex max-w-full flex-col gap-0.5")}>
        <p className="eyebrow !text-[9px] truncate tracking-[0.08em]">
          {legend?.subject ?? "Unnamed raster"}
        </p>

        {area &&
          (editing && onRenameArea ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  commitRename()
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  setEditing(false)
                  setDraft(area)
                }
              }}
              className="w-full rounded-sm border border-border bg-background px-1.5 py-0.5 text-[12px] font-medium leading-tight text-foreground outline-none"
              aria-label="Area name"
            />
          ) : (
            <button
              type="button"
              disabled={!onRenameArea}
              onDoubleClick={() => {
                if (!onRenameArea) return
                setDraft(area)
                setEditing(true)
              }}
              title={
                onRenameArea
                  ? provisional
                    ? "Provisional name — double-click to rename"
                    : "Double-click to rename"
                  : undefined
              }
              className={cn(
                "group flex max-w-full items-center gap-1.5 text-left",
                onRenameArea &&
                  "cursor-text rounded-sm hover:bg-surface-raised/50",
              )}
            >
              <span
                className={cn(
                  "min-w-0 truncate text-[12px] font-medium leading-tight tracking-wide",
                  provisional
                    ? "italic text-muted-foreground"
                    : "text-foreground",
                )}
              >
                {area}
              </span>
              {onRenameArea && (
                <Pencil
                  className="size-2.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70"
                  strokeWidth={1.75}
                  aria-hidden
                />
              )}
            </button>
          ))}

        {(period || model) && (
          <p className="telemetry truncate text-[9px] text-muted-foreground">
            {[model, period].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {legend?.kind === "classes" && legend.rows && (
        /*
          Above the shares. What qualifies the whole map is read before what it
          is made of -- a 71% class under a mean vote share of 37% is a
          different statement from the same 71% under 80%.
        */
        <ul
          className={cn(
            "w-full",
            true
              ? "flex flex-col gap-0.5 border-y border-border/40 py-1.5"
              : "flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-y border-border/40 py-1",
          )}
        >
          {legend.rows.map((r) => (
            <li
              key={r.label}
              className={cn(
                "flex items-baseline gap-1",
                "justify-between gap-2",
              )}
            >
              <span className="eyebrow !text-[8px] tracking-[0.06em]">
                {r.label}
              </span>
              <span className="telemetry whitespace-nowrap text-[11px] text-foreground">
                {r.value}
              </span>
            </li>
          ))}
        </ul>
      )}

      {legend?.kind === "classes" && (
        <div
          className="flex h-1.5 w-full overflow-hidden rounded-[2px]"
          aria-hidden
        >
          {legend.entries
            .filter((e) => (e.pct ?? 0) > 0)
            .map((e) => (
              <div
                key={`${e.name}-${e.color}`}
                className="h-full min-w-px"
                style={{
                  width: `${e.pct}%`,
                  background: e.color,
                }}
                title={`${e.name}: ${e.pct?.toFixed(1)}%`}
              />
            ))}
        </div>
      )}

      {legend?.kind === "classes" && (
        <ul className="flex flex-col gap-1">
          {legend.entries.map((e) => (
            <li
              key={`${e.name}-${e.color}`}
              className="flex min-w-0 items-center gap-1.5"
            >
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{
                  background: e.color,
                  boxShadow: "inset 0 0 0 1px rgb(var(--p-line-strong) / 0.5)",
                }}
              />
              <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/90">
                {e.name}
              </span>
              {e.areaHa !== undefined && (
                <span className="telemetry shrink-0 text-[9px] tabular-nums text-muted-foreground/80">
                  {e.areaHa.toFixed(0)} ha
                </span>
              )}
              {e.pct !== undefined && (
                <span className="telemetry w-11 shrink-0 text-right text-[11px] tabular-nums text-foreground">
                  {e.pct.toFixed(1)}%
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {legend?.kind === "ramp" && (
        <div className={cn("w-full flex flex-col gap-0.5")}>
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
        <div className={cn("w-full flex min-h-0 flex-1 flex-col gap-1")}>
          {legend.ramp && (
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
          <ul className={cn("flex items-start gap-x-5 gap-y-1", "flex-col")}>
            {legend.rows.map((r) => (
              <li
                key={r.label}
                className="flex w-full flex-row items-baseline justify-between gap-0.5"
              >
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

      {/*
        Accuracy as figures rather than as a matrix. The k×k grid that used to
        sit here is what made this column scroll: it spent k² cells to say what
        producer's against user's says in k rows, and its cell-by-cell reading
        -- which pair of classes gets confused for which -- needs width this
        column does not have. It moves to the compare modal, drawn large enough
        to read, and what stays is the part that answers "which way does this
        class fail" at a glance.
      */}
      {agreement && (
        <div className="flex w-full flex-col gap-2.5">
          <DisagreementBar a={agreement} />
          <ClassAccuracyChart classes={agreement.per_class} />
        </div>
      )}

      {legend?.kind === "note" && (
        <p className="w-full text-meta leading-snug text-muted-foreground">
          {legend.note}
        </p>
      )}
    </div>
  )
}

export function BoardStatsBar({
  entries,
  runLog = [],
  running = false,
}: {
  /** The selected rasters, in the order they were picked. */
  entries: StatsEntry[]
  /**
   * What the run has said so far.
   *
   * It takes the selection panel while a run is going: the figures it
   * displaces are STALE, and the question in front of the reader is what the
   * run is doing now. When it finishes they come back.
   */
  runLog?: RunLogEntry[]
  running?: boolean
}) {
  const empty = (
    <p className="px-1 text-meta leading-snug text-muted-foreground">
      Pick a raster to read its legend. Shift-pick a second to compare.
    </p>
  )

  const body =
    running && runLog.length > 0 ? (
      <RunLog entries={runLog} />
    ) : entries.length === 0 ? (
      empty
    ) : (
      <div className="panel-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-2">
        {entries.map((e, i) => (
          <div key={e.key} className="flex flex-col gap-3">
            {i > 0 && (
              <div
                className="h-px w-full"
                style={{ background: "rgb(var(--p-line) / 0.35)" }}
                aria-hidden
              />
            )}
            <Entry entry={e} />
          </div>
        ))}
      </div>
    )

  return (
    <aside
      /*
          Width from the shared constant, not a literal. It was w-[15rem] while
          the band recessed by BOARD_RIGHT_REM, so widening the constant opened
          a gap between the two instead of moving them together -- the band
          stopped short of the column by exactly the amount the column grew.
        */
        className="app-no-drag flex h-full w-full flex-col"
      style={{
        background: "rgb(var(--p-ink))",
        borderColor: "rgb(var(--p-line) / 0.28)",
      }}
    >
      <div
        className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5"
        style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
      >
        <span className="eyebrow !text-foreground">Selection</span>
        {entries.length > 0 && !running && (
          <span className="telemetry text-[9px] text-muted-foreground">
            {entries.length}
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </aside>
  )
}
