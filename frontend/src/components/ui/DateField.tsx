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
import { createPortal } from "react-dom"
import { CaretLeft, CaretRight } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

const DAY_MS = 86_400_000
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"]
/** Fixed, because the calendar is measured into place rather than laid out. */
const CALENDAR_W = 216

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
  /**
   * Where the calendar sits, in viewport coordinates.
   *
   * `position: fixed` rather than absolute, and this is why: the field lives
   * inside a horizontally scrolling band, and `overflow-x: auto` does not
   * leave the other axis alone -- per CSS Overflow, an axis cannot stay
   * `visible` while the other is not, so overflow-y becomes `auto` and clips.
   * An absolutely positioned calendar opening upward was cut off entirely,
   * leaving the band's own black where it should have been.
   *
   * Fixed elements are not clipped by an ancestor's overflow, so the only cost
   * is one measurement -- taken when it opens, from a bar that does not move
   * while it is open.
   *
   * Fixed alone was not enough. The band is `absolute` AND carries z-[900],
   * which makes it a stacking context: the calendar's z-index was being
   * compared only against the band's own children, and the band as a whole
   * sits below the result panel at z-[1000]. So the calendar is also rendered
   * through a portal, which leaves that context and the clip in one step.
   */
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null)
  const day = toDay(value)
  const [anchor, setAnchor] = useState(() => day ?? 0)
  const hostRef = useRef<HTMLDivElement>(null)
  /** The calendar itself, which the portal puts outside `hostRef`. */
  const popRef = useRef<HTMLDivElement>(null)

  // The grid follows the value while the calendar is shut, so opening it lands
  // on the month being looked at rather than wherever it was left.
  useLayoutEffect(() => {
    if (!open && day !== null) setAnchor(day)
  }, [open, day])

  useLayoutEffect(() => {
    if (!open) {
      setAt(null)
      return
    }
    const el = hostRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // Clamped so a field near the right edge does not push the calendar off
    // it; the band scrolls sideways, so that edge is reachable.
    setAt({
      left: Math.min(r.left, window.innerWidth - CALENDAR_W - 8),
      bottom: window.innerHeight - r.top + 4,
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      // Both, because the calendar is no longer a descendant of the field: a
      // press on a day would otherwise read as a press outside, and shut the
      // calendar before the day under the pointer was taken.
      if (hostRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
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
          className="telemetry w-[6.5rem] rounded-sm border-0 bg-sunk px-1.5 py-0.5 text-meta text-foreground outline-none inset-ring-1 inset-ring-ring"
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
          /*
            The same box as NumberField, and for the same reason: at
            bg-selected this composited to 1.17 against the band's ink
            and 1.08 in light -- the faintest chrome in the band, reading as
            plain mono text. Matched in height too, so a row of fields lines up.
          */
          "telemetry inline-flex h-[1.375rem] items-center rounded-sm px-1.5 text-meta transition-colors",
          "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
          disabled
            ? "cursor-not-allowed bg-control inset-ring-1 inset-ring-line text-muted-foreground/50"
            : open
              ? "bg-selected text-foreground inset-ring-1 inset-ring-accent"
              : "bg-selected text-foreground inset-ring-1 inset-ring-line-strong hover:bg-hover",
          className
        )}
      >
        {value || "—"}
      </button>
      )}

      {open && at && createPortal(
        /*
          Upward, which is the whole reason this exists: measured from the
          field's top edge, so a field sitting on the foot of the window opens
          into the window rather than past it.

          Its own raised surface rather than the board's ink. Everything behind
          it here -- the band, the board -- is painted in --p-ink, and ink on
          ink measures 1.000 against its own background whatever border it
          carries.
        */
        <div
          ref={popRef}
          role="dialog"
          aria-label="Choose a date"
          className="fixed z-[1200] rounded-sm border p-1.5 shadow-xl"
          style={{
            left: at.left,
            bottom: at.bottom,
            width: CALENDAR_W,
            background: "rgb(var(--p-surface-raised))",
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
              <CaretLeft className="size-3" />
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
              <CaretRight className="size-3" />
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
                      ? "bg-accent text-accent-foreground"
                      : inMonth
                        ? "text-foreground hover:bg-secondary"
                        : // Kept rather than blanked: a week that runs into the
                          // next month is still a week, and a gap where its
                          // days should be is harder to count across.
                          "text-muted-foreground/40 hover:bg-secondary/60"
                  )}
                >
                  {new Date(d * DAY_MS).getUTCDate()}
                </button>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
