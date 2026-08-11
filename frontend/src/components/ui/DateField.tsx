/**
 * A date, with a calendar that opens where there is room.
 *
 * `<input type="date">` was here first, and the argument for it was that it is
 * the one control that opens a calendar. That argument fails at the bottom of
 * a window: the platform draws its picker BELOW the input, and an input in the
 * foot band has nothing below it — the calendar rendered over the dock, cut
 * off, with no way to reach the days it had hidden. Where the picker opens is
 * not something a page can ask the platform to change.
 *
 * So the calendar is drawn here and opens upward. The rest of what the native
 * control gave is kept deliberately: the value still reads and writes ISO, the
 * arrow keys still step a day at a time, and typing still works — those are
 * the parts people use, and losing them to fix the position would trade one
 * failure for three.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

const DAY_MS = 86_400_000
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"]

/** ISO to a UTC day number, so arithmetic never crosses a timezone. */
function toDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null
  const d = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(d) ? d / DAY_MS : null
}

function toISO(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

function monthLabel(day: number): string {
  const d = new Date(day * DAY_MS)
  return d.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

/**
 * The first of the month `by` months away.
 *
 * Real month arithmetic, not an index into the grid. Stepping by a cell count
 * was wrong whenever a month began late in the week -- the 32nd cell is still
 * in January when January starts on a Wednesday, so "next month" from any
 * January 2025 date landed back in January 2025. Date.UTC carries the overflow
 * itself, so December to January crosses the year without a special case.
 */
function shiftMonth(day: number, by: number): number {
  const d = new Date(day * DAY_MS)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + by, 1) / DAY_MS
}

/** The day numbers of the grid: the month, padded to whole weeks. */
function monthGrid(anchor: number): { days: number[]; month: number } {
  const d = new Date(anchor * DAY_MS)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  const first = Date.UTC(year, month, 1) / DAY_MS
  const start = first - new Date(first * DAY_MS).getUTCDay()
  // Six rows always, so the grid does not change height as months change and
  // the popover does not resize under the pointer.
  return { days: Array.from({ length: 42 }, (_, i) => start + i), month }
}

export function DateField({
  value,
  disabled,
  onChange,
  className,
}: {
  /** ISO, `YYYY-MM-DD`. */
  value: string
  disabled?: boolean
  onChange: (iso: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  /**
   * Typing, which the native control also gave.
   *
   * A calendar reaches a nearby day quickly and a date two years out slowly,
   * and that is the case a period actually has. Entered as ISO because that is
   * what the field shows -- a format someone reads and then cannot type back
   * is a format that only looks like an answer.
   */
  const [typing, setTyping] = useState<string | null>(null)
  const day = toDay(value)
  const [anchor, setAnchor] = useState(() => day ?? 0)
  const hostRef = useRef<HTMLDivElement>(null)

  // The grid follows the value while the calendar is shut, so opening it lands
  // on the month being looked at rather than wherever it was left.
  useLayoutEffect(() => {
    if (!open && day !== null) setAnchor(day)
  }, [open, day])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!hostRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("pointerdown", onDown)
    return () => window.removeEventListener("pointerdown", onDown)
  }, [open])

  const step = (by: number) => {
    if (day === null) return
    onChange(toISO(day + by))
  }

  const { days, month } = monthGrid(anchor)

  const commitTyped = (text: string) => {
    setTyping(null)
    /*
      Accepted only where it survives the round trip.

      The shape test alone is not enough: `2026-13-40` matches it, and Date.UTC
      rolls the overflow into 2027-02-09 -- so a typo either committed a date
      nobody asked for or, worse, committed the raw text and handed the backend
      a month that does not exist. Rejected rather than guessed at: half a date
      is not a date, and a field that invented the rest would move a period
      without being asked.
    */
    const trimmed = text.trim()
    const d = toDay(trimmed)
    if (d !== null && toISO(d) === trimmed) onChange(trimmed)
  }

  return (
    <div ref={hostRef} className="relative shrink-0">
      {typing !== null ? (
        <input
          autoFocus
          value={typing}
          onChange={(e) => setTyping(e.target.value)}
          onBlur={(e) => commitTyped(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            // Escape closes the board from a listener on the window, so
            // abandoning an entry here must not leave the board with it.
            e.stopPropagation()
            if (e.key === "Enter") commitTyped(e.currentTarget.value)
            else if (e.key === "Escape") setTyping(null)
          }}
          className="telemetry w-[6.5rem] rounded-sm border-0 bg-surface-raised px-1.5 py-0.5 text-meta text-foreground outline-none inset-ring-1 inset-ring-ring"
        />
      ) : (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          // A day at a time, and a week with shift: the two nudges a period
          // actually gets once it is roughly right.
          if (e.key === "ArrowUp" || e.key === "ArrowRight") {
            e.preventDefault()
            step(e.shiftKey ? 7 : 1)
          } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
            e.preventDefault()
            step(e.shiftKey ? -7 : -1)
          } else if (/^[0-9]$/.test(e.key)) {
            // A digit starts an entry, as it does in every field that accepts
            // one: pressing 2 to begin 2026 should not need a click first.
            e.preventDefault()
            setOpen(false)
            setTyping(e.key)
          } else if (e.key === "Enter") {
            e.preventDefault()
            setOpen(false)
            setTyping(value)
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "telemetry rounded-sm px-1.5 py-0.5 text-meta transition-colors",
          "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
          disabled
            ? "cursor-not-allowed text-muted-foreground/50"
            : open
              ? "bg-surface-raised text-foreground"
              : "bg-surface-raised/60 text-foreground hover:bg-surface-raised",
          className
        )}
      >
        {value || "—"}
      </button>
      )}

      {open && (
        /*
          Upward, which is the whole reason this exists. `bottom-full` anchors
          the calendar to the top of the field, so a field sitting on the foot
          of the window opens into the window rather than past it.
        */
        <div
          role="dialog"
          aria-label="Choose a date"
          className="absolute bottom-full left-0 z-[1200] mb-1 w-[13.5rem] rounded-sm border p-1.5 shadow-xl"
          style={{
            background: "rgb(var(--p-ink))",
            borderColor: "rgb(var(--p-line-strong) / 0.6)",
          }}
        >
          <div className="mb-1 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setAnchor(shiftMonth(anchor, -1))}
              aria-label="Previous month"
              className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-3" />
            </button>
            <span className="text-meta text-foreground">
              {monthLabel(anchor)}
            </span>
            <button
              type="button"
              onClick={() => setAnchor(shiftMonth(anchor, 1))}
              aria-label="Next month"
              className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="size-3" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-px">
            {WEEKDAYS.map((w, i) => (
              <span
                key={i}
                className="py-0.5 text-center text-[9px] text-muted-foreground"
              >
                {w}
              </span>
            ))}
            {days.map((d) => {
              const inMonth = new Date(d * DAY_MS).getUTCMonth() === month
              const chosen = d === day
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    onChange(toISO(d))
                    setOpen(false)
                  }}
                  className={cn(
                    "rounded-[2px] py-0.5 text-center text-[10px] transition-colors",
                    chosen
                      ? "bg-accent text-white"
                      : inMonth
                        ? "text-foreground hover:bg-surface-raised"
                        : // Kept rather than blanked: a week that runs into the
                          // next month is still a week, and a gap where its
                          // days should be is harder to count across.
                          "text-muted-foreground/40 hover:bg-surface-raised/50"
                  )}
                >
                  {new Date(d * DAY_MS).getUTCDate()}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
