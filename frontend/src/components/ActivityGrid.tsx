/**
 * A year of runs, one square per day.
 *
 * The counts come from the database grouped by day rather than from the run
 * list: that list is capped at 100 rows and carries the full result payload on
 * each, so a year read through it would show empty weeks that are not empty.
 *
 * What a square counts is a RUN -- a classification, a composition, a water,
 * solar or wind analysis. It is not a measure of work done, and the label says
 * "runs" rather than borrowing a word like contributions that would imply one.
 */
import { useEffect, useMemo, useState } from "react"
import { RunActivity } from "../../wailsjs/go/main/App"
import { cn } from "@/lib/utils"

const DAY_MS = 86_400_000
const WEEKS = 53

/** Local calendar date as YYYY-MM-DD, matching what the query groups on. */
function localISO(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0")
  const day = `${d.getDate()}`.padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * Five steps, quiet to loud.
 *
 * Thresholds rather than a scale of the maximum: one day of thirty runs would
 * otherwise flatten every ordinary day to the lowest step and the year would
 * read as empty. The accent is a fill here, which is the one job it is allowed.
 */
function level(count: number): number {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

/**
 * The ramp, spaced so the steps are actually distinguishable.
 *
 * A day with no run has to be visible -- the grid's job is to show the shape of
 * a year, and a year is mostly empty days. But it also has to stay below the
 * first filled step, or an idle day reads as busier than a working one. The
 * first attempt broke both: the empty cell measured 1.17 against the background,
 * which is nothing, and the first filled step 1.39, which is nothing again.
 *
 * THE IDLE STEP IS THEMED AND THE FILLED ONES ARE NOT, which is a difference
 * in the palette rather than a preference. The filled steps are the accent,
 * and the accent is already darkened for the light theme, so one alpha lands
 * both. The idle step is the neutral line against the page, and the headroom
 * under the first filled step is not the same on both sides: the accent at 45
 * per cent reaches 2.32 on the dark background and only 2.01 on the light one.
 * A single alpha bright enough to be worth looking at in the dark theme rises
 * to 94 per cent of the first filled step in the light one, which is the
 * failure above returning from the other direction. Two values hold the idle
 * step at the same 79 per cent of the first filled step in both.
 *
 * Contrast against `--background`, dark then light:
 *   idle   1.85 / 1.59
 *   1 run  2.32 / 2.01
 *   2-3    3.24 / 2.69
 *   4-6    4.49 / 3.67
 *   7+     6.25 / 5.02
 *
 * `bg-[rgb(var(--p-line))]` AND NOT `bg-line`, WHICH DRAWS NOTHING AT ALL.
 * The `line` scale is declared in index.css as
 * `rgb(var(--p-line) / <alpha-value>)`. That placeholder is Tailwind v3, where
 * the engine substituted it per utility; v4 copies the declared value through
 * and applies opacity around it with color-mix, so the literal string reaches
 * the stylesheet and the parser drops the rule. An invalid background-color is
 * not a wrong colour but no declaration at all, which is why the idle cells
 * were not faint here -- they were absent, and so was the first swatch of the
 * legend below.
 *
 * Reaching past the scale to the channels it is built from was the narrow way
 * around it. THE WIDE WAY HAS SINCE BEEN TAKEN: `<alpha-value>` is gone from
 * every token, and the theme block dropped `inline` so an alpha modifier
 * composes instead of vanishing. See the note above `@theme` in index.css --
 * ninety surface utilities and forty-three borders and washes were reading
 * tokens that compiled to invalid CSS and painted nothing at all.
 *
 * This escape hatch is left standing rather than unwound with it. It is
 * correct as written, it is the one place in the app that needs the channels
 * rather than the scale, and rewriting a working heatmap to prove a repair
 * elsewhere is how a repair acquires an unrelated regression.
 */
const LEVEL_CLASS = [
  "bg-[rgb(var(--p-line))]/75 dark:bg-[rgb(var(--p-line))]",
  "bg-primary/45",
  "bg-primary/[0.62]",
  "bg-primary/80",
  "bg-primary",
]

export function ActivityGrid() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    RunActivity(365)
      .then((rows) => {
        if (!alive) return
        const map: Record<string, number> = {}
        for (const r of rows ?? []) map[r.day] = r.count
        setCounts(map)
      })
      .catch((e) => {
        // Surfaced rather than swallowed into an empty grid: a year that failed
        // to load and a year with no runs look identical, and only one of them
        // is true about the user.
        if (alive) setFailed(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [])

  /**
   * The grid, ending on today and starting on the Sunday that keeps it whole.
   *
   * Columns are weeks and rows are weekdays, so a column is a week of work and
   * the eye reads across the year rather than down it.
   */
  const { weeks, months, total } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // Back to the most recent Sunday, then back again by the full span, so
    // every column holds seven days and no partial week is drawn.
    const end = new Date(today.getTime() + (6 - today.getDay()) * DAY_MS)
    const start = new Date(end.getTime() - (WEEKS * 7 - 1) * DAY_MS)

    const weeks: { date: Date; iso: string; future: boolean }[][] = []
    const months: { col: number; label: string }[] = []
    let seenMonth = -1
    let total = 0

    for (let w = 0; w < WEEKS; w++) {
      const col: { date: Date; iso: string; future: boolean }[] = []
      for (let d = 0; d < 7; d++) {
        const date = new Date(start.getTime() + (w * 7 + d) * DAY_MS)
        const iso = localISO(date)
        const future = date.getTime() > today.getTime()
        if (!future) total += counts?.[iso] ?? 0
        col.push({ date, iso, future })
        // The month label sits over the column its first day falls in.
        if (d === 0 && date.getMonth() !== seenMonth) {
          seenMonth = date.getMonth()
          months.push({
            col: w,
            label: date.toLocaleDateString(undefined, { month: "short" }),
          })
        }
      }
      weeks.push(col)
    }
    return { weeks, months, total }
  }, [counts])

  if (failed) {
    return (
      <p className="text-body text-destructive-quiet">
        Could not read the activity history: {failed}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-body text-muted-foreground">
        <span className="telemetry text-foreground">{total}</span>{" "}
        {total === 1 ? "run" : "runs"} in the last year
      </p>

      {/*
        Sized by the space it is given, not by a cell size in pixels.

        Fifty-three columns of 10px plus their gaps came to 716px inside a
        712px column, so the grid overflowed by four and the panel grew a
        horizontal scrollbar -- a year you have to scroll to see is not a year
        you can read at a glance. Fractional columns fit whatever width exists,
        at any window size, and the squares stay square because each cell is
        drawn on its own aspect ratio rather than on a fixed height.
      */}
      <div className="flex gap-1.5">
        {/* Weekday rail. Three labels, as the reference does: seven would crowd
            a row this short, and the alternating ones are enough to orient. */}
        <div className="mt-[0.85rem] grid shrink-0 grid-rows-7 gap-[2px]">
          {["", "Mon", "", "Wed", "", "Fri", ""].map((d, i) => (
            <span
              key={i}
              className="telemetry flex items-center pr-1 text-micro text-muted-foreground"
            >
              {d}
            </span>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="relative h-[0.7rem]">
            {months.map((m) => (
              <span
                key={`${m.col}-${m.label}`}
                className="telemetry absolute top-0 -translate-x-1/2 text-micro text-muted-foreground"
                style={{ left: `${((m.col + 0.5) / WEEKS) * 100}%` }}
              >
                {m.label}
              </span>
            ))}
          </div>

          <div
            className="grid gap-[2px]"
            style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}
          >
            {weeks.map((col, w) => (
              <div key={w} className="grid grid-rows-7 gap-[2px]">
                {col.map((cell) => {
                  const n = counts?.[cell.iso] ?? 0
                  // Days after today are drawn as holes, not as zero-run days:
                  // nothing has happened on them yet, and an empty square would
                  // claim it did.
                  if (cell.future) {
                    return (
                      <span key={cell.iso} className="aspect-square w-full" />
                    )
                  }
                  return (
                    <span
                      key={cell.iso}
                      title={`${cell.iso} — ${n} ${n === 1 ? "run" : "runs"}`}
                      className={cn(
                        "aspect-square w-full rounded-[2px]",
                        LEVEL_CLASS[level(n)]
                      )}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="telemetry text-micro text-muted-foreground">Less</span>
        {LEVEL_CLASS.map((c) => (
          <span key={c} className={cn("size-[9px] rounded-[2px]", c)} />
        ))}
        <span className="telemetry text-micro text-muted-foreground">More</span>
      </div>
    </div>
  )
}
