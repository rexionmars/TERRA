/**
 * The record windows, as a band of years along the foot of the energy screen.
 *
 * The energy products have no acquisition window: they read NASA POWER back
 * from the last complete year, and how far back was two spinners buried in two
 * different sections of the setup column.
 *
 * THE HOURLY WINDOW SITS INSIDE THE CLIMATOLOGY WINDOW. They are different
 * spans on the same axis, anchored at the same end, and the figures they
 * produce are close enough to be mistaken for each other and not
 * interchangeable: the resource headline is the daily climatology, the loss
 * waterfall's base is the hourly series, and at the study site those differ by
 * about half a percent -- a difference read as a defect once already. Two
 * spinners in two sections state neither the shared anchor nor the
 * containment. Drawn on one axis, both are the control.
 *
 * ONE GRID ROW PER WINDOW, carrying its band and its reading. Laid out as a
 * track with a column of readings centred beside it, the two readings centre
 * as a block and land between the bands rather than on them, so the top line
 * describes the bottom band as readily as the top one. In a grid the row is
 * the relationship, and no two numbers have to be kept equal for it to hold.
 *
 * Wind reads one window on its own grid, so it draws one row.
 */
import { useEffect, useRef, useState } from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"

/**
 * POWER publishes through the previous full year, which is the anchor every
 * window here shares. Mirrors `last_year` in sidecar/infer.py; passed in rather
 * than read from the clock so a render is reproducible.
 */
export function lastCompleteYear(now: Date): number {
  // Local, not UTC: the sidecar computes it from `date.today()`, which is
  // local, and a UTC reading would label the axis a year off from what the run
  // actually fetched for the hours either side of a New Year.
  return now.getFullYear() - 1
}

export interface RecordBand {
  id: string
  label: string
  years: number
  min: number
  max: number
  onChange: (years: number) => void
  /** What this window feeds. Carried on the band rather than beside it. */
  note: string
}

export interface RecordWindowBarProps {
  /**
   * Outermost first. A later band must not extend past the one before it, and
   * the handles enforce that the way the period track's two handles refuse to
   * cross.
   */
  bands: RecordBand[]
  endYear: number
  disabled?: boolean
  /** Left edge, so the bar starts after whatever column is open beside it. */
  leftOffsetClass?: string
}

/**
 * The lane width, which decides how many year marks fit.
 *
 * Measured rather than assumed: the bar is the window width less the setup
 * column, so the same fixed five-year step that reads cleanly on a wide window
 * puts four-digit labels 16px apart on a narrow one, where they overlap into an
 * unreadable smear. Reading the lane is safe because its width comes from the
 * grid, not from the step this feeds -- there is no loop.
 */
function useLaneWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

/** A four-digit year at --text-micro, JetBrains Mono advancing 0.6em. */
const LABEL_PX = 4 * (9 * 0.61)

/**
 * Year marks that do not collide, coarsening until they fit.
 *
 * A label needs its own width again as clear space before the next one starts;
 * below that the rule reads as a texture rather than as a scale, which is what
 * a fixed five-year step did across forty years on a narrow window.
 *
 * Counted back from the anchor rather than forward from a multiple of the step,
 * so the anchor is always the labelled one. Run forward, the rule labelled 2020
 * and stopped, leaving the year every band ends on -- the one thing the rule
 * exists to state -- as the only unmarked position on it.
 */
function yearTicks(first: number, last: number, width: number): number[] {
  const pxPerYear = width / Math.max(1, last - first)
  const step = [1, 2, 5, 10, 20].find((s) => s * pxPerYear >= LABEL_PX * 2) ?? 20
  const out: number[] = []
  for (let y = last; y >= first; y -= step) out.push(y)
  return out.reverse()
}

export function RecordWindowBar({
  bands,
  endYear,
  disabled,
  leftOffsetClass = "left-0",
}: RecordWindowBarProps) {
  const ruleRef = useRef<HTMLDivElement | null>(null)
  const laneWidth = useLaneWidth(ruleRef)
  const [dragging, setDragging] = useState<string | null>(null)

  // The axis spans the widest window that could be asked for, so widening a
  // window never rescales the lane under the pointer that is widening it.
  const span = bands.length ? Math.max(...bands.map((b) => b.max)) : 1
  const first = endYear - span + 1

  const pct = (year: number) => ((year - first) / Math.max(1, span - 1)) * 100

  /** Read off the rule, which occupies the same grid column as every lane. */
  const yearAt = (clientX: number): number | null => {
    const el = ruleRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    return Math.round(first + t * (span - 1))
  }

  /**
   * A band's own bounds, tightened by its neighbours.
   *
   * An inner window longer than the one containing it is not a layout problem
   * to be drawn around: it is a request for hourly data outside the climatology
   * it is read against. The handle stops instead.
   */
  const boundsOf = (i: number): [number, number] => {
    const b = bands[i]
    const outer = bands[i - 1]
    const inner = bands[i + 1]
    return [
      Math.max(b.min, inner ? inner.years : b.min),
      Math.min(b.max, outer ? outer.years : b.max),
    ]
  }

  const commit = (i: number, years: number) => {
    const [lo, hi] = boundsOf(i)
    bands[i].onChange(Math.min(hi, Math.max(lo, years)))
  }

  const activeIndex = bands.findIndex((b) => b.id === dragging)

  if (!bands.length) return null

  return (
    <motion.div
      className={cn(
        "app-no-drag pointer-events-auto absolute bottom-0 right-0 z-[900] overflow-hidden",
        // Animated for the same reason the map's track is: the column it clears
        // opens and closes, and an edge that jumped would read as a different
        // control appearing.
        "transition-[left] duration-200 ease-out",
        leftOffsetClass
      )}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
    >
      {/*
        The side borders are dropped inline rather than with border-x-0. The
        .panel rule in index.css is unlayered, so it outranks anything Tailwind
        emits into @layer utilities and the utility classes are silently dead --
        a bar written with them still draws a line down the window's own right
        edge. Inline is the one declaration that wins without relayering the
        stylesheet under every other panel in the app.
      */}
      <div
        className="panel flex items-center gap-4 px-3 py-1.5"
        style={{ borderInlineWidth: 0, borderBlockEndWidth: 0 }}
      >
        <span className="eyebrow shrink-0">Record window</span>

        {/*
          The lane column holds a floor and the reading column does not, so a
          narrow window shortens the reading rather than crushing the control.
          Sized the other way round -- the readings at their natural width, the
          lanes free -- the bands collapsed to a stub at about 860px of window
          while two lines of prose held full width beside them.
        */}
        <div
          className="grid min-w-0 flex-1 grid-cols-[minmax(11rem,1fr)_minmax(0,max-content)] items-center gap-x-3 gap-y-0.5"
          onPointerMove={(e) => {
            if (activeIndex < 0) return
            const y = yearAt(e.clientX)
            if (y !== null) commit(activeIndex, endYear - y + 1)
          }}
          onPointerUp={() => setDragging(null)}
          onPointerCancel={() => setDragging(null)}
        >
          {bands.map((b, i) => {
            const from = endYear - b.years + 1
            const [lo, hi] = boundsOf(i)
            const reading = `${b.years} years, ${from} to ${endYear} · ${b.note}`
            // The inner band is the denser fill: it is the shorter, costlier
            // read, and the one whose extent is usually being decided.
            const fill = i === bands.length - 1 ? "bg-primary/45" : "bg-primary/20"
            return (
              <div key={b.id} className="contents">
                <div className="relative h-2.5 select-none">
                  {/* Width, not a right edge. Anchored with left and right, a
                      one-year window computes to exactly zero width and the
                      wind band at its minimum drew nothing at all. */}
                  <div
                    title={reading}
                    className={cn(
                      "absolute top-1/2 h-2 -translate-y-1/2 rounded-sm",
                      fill
                    )}
                    style={{
                      left: `${pct(from)}%`,
                      width: `max(3px, ${100 - pct(from)}%)`,
                    }}
                  />
                  <button
                    type="button"
                    role="slider"
                    aria-label={`${b.label}, years back from ${endYear}`}
                    aria-valuemin={lo}
                    aria-valuemax={hi}
                    aria-valuenow={b.years}
                    aria-valuetext={reading}
                    title={reading}
                    disabled={disabled}
                    onPointerDown={(e) => {
                      if (disabled) return
                      e.preventDefault()
                      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
                      setDragging(b.id)
                    }}
                    // Left lengthens the window, because left is further back in
                    // time on this axis. Shift moves by five, matching the rule.
                    onKeyDown={(e) => {
                      const step = e.shiftKey ? 5 : 1
                      if (e.key === "ArrowLeft") commit(i, b.years + step)
                      else if (e.key === "ArrowRight") commit(i, b.years - step)
                      else return
                      e.preventDefault()
                    }}
                    className={cn(
                      "absolute top-1/2 h-3.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-sm",
                      "border border-primary bg-primary/80",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      "disabled:cursor-not-allowed disabled:opacity-50",
                      dragging === b.id && "bg-primary"
                    )}
                    style={{ left: `${pct(from)}%` }}
                  />
                </div>

                {/* Same grid row as the band above, so the reading sits on the
                    band it reads rather than near it. The span, not the note:
                    that sentence is the band's title here and is written out in
                    full in the setup column, and held at its natural width it
                    was what took the lane's room. */}
                <span className="telemetry truncate text-micro text-muted-foreground">
                  <span className="text-foreground">
                    {from}–{endYear}
                  </span>{" "}
                  {b.label}
                </span>
              </div>
            )
          })}

          {/* The rule, under every lane and in the same column: one axis, and
              the shared right edge is the anchor made visible. */}
          <div ref={ruleRef} className="relative col-start-1 h-5 select-none">
            <div className="absolute inset-x-0 top-0 h-px bg-border" />
            {yearTicks(first, endYear, laneWidth).map((y) => {
              const p = pct(y)
              return (
                // Zero-width at the exact year, so the mark keeps the position
                // and only the label moves. Centred, the anchor's own label hung
                // half its width past the lane and into the reading beside it.
                <div key={y} className="absolute top-0" style={{ left: `${p}%` }}>
                  <span className="absolute top-0 h-1.5 w-px bg-border" />
                  <span
                    className={cn(
                      "telemetry absolute top-2 whitespace-nowrap text-micro text-muted-foreground",
                      p >= 99 ? "right-0" : p <= 1 ? "left-0" : "-translate-x-1/2"
                    )}
                  >
                    {y}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
