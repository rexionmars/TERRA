/**
 * The acquisition period, as a track along the foot of the map.
 *
 * The period was two date fields inside a panel and the scenes it returns were a
 * count read afterwards, so choosing a window meant typing a number, running a
 * listing, reading how many came back and typing again. They are one thing here:
 * the window is dragged, and what falls inside it is drawn underneath.
 *
 * Every product on the map screen reads this one period -- classification,
 * compositions and surface water alike -- which is why it belongs to the screen
 * rather than to a panel.
 */
import { useCallback, useMemo, useRef, useState } from "react"
import { motion } from "motion/react"
import { Boxes } from "lucide-react"
import type { DataCubeScene } from "@/lib/types"
import { cn } from "@/lib/utils"

const DAY_MS = 86_400_000

/** YYYY-MM-DD to a UTC day number, so arithmetic never crosses a timezone. */
function toDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS
}

function toISO(day: number): string {
  return new Date(Math.round(day) * DAY_MS).toISOString().slice(0, 10)
}

function monthLabel(day: number): string {
  return new Date(day * DAY_MS).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  })
}

/**
 * Month boundaries across the track, thinned so labels never collide.
 *
 * A period can be a fortnight or a decade, and a tick per month is unreadable
 * past a couple of years. The step grows with the span instead of the labels
 * being allowed to overlap.
 */
function monthTicks(from: number, to: number): number[] {
  const span = to - from
  const step = span > 3650 ? 12 : span > 1460 ? 6 : span > 550 ? 3 : 1
  const out: number[] = []
  const d = new Date(from * DAY_MS)
  let y = d.getUTCFullYear()
  let m = d.getUTCMonth()
  if (d.getUTCDate() !== 1) m += 1
  for (;;) {
    const day = Date.UTC(y, m, 1) / DAY_MS
    if (day > to) break
    if (day >= from) out.push(day)
    m += step
    if (m > 11) {
      y += Math.floor(m / 12)
      m %= 12
    }
  }
  return out
}

export interface PeriodTimelineProps {
  start: string
  end: string
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
  /** Scenes found for the AOI, drawn under the track. Empty until listed. */
  scenes: DataCubeScene[]
  scenesLoading?: boolean
  /** Runs the scene listing, so the track can be filled without a modal. */
  onListScenes?: () => void
  /**
   * Opens the listing with previews. The track says how many scenes and when;
   * the listing says which, with a thumbnail, a tile and a satellite per scene.
   */
  onOpenListing?: () => void
  disabled?: boolean
  /**
   * Left edge, so the track starts after whatever column is open beside it.
   *
   * Run full width under an open panel, the first months of the track and the
   * start handle sit behind it: the edge a user reaches for to widen the window
   * backwards is the one the panel covers.
   */
  /**
   * How far the track's left edge is pushed in, as a CSS length.
   *
   * A length rather than a class because what it clears is not always a fixed
   * width: the docked column is 19rem by construction, but the workspace
   * layout's island is sized by its own contents and changes with the label on
   * its run button. The rounded corner follows automatically -- a retracted
   * track meets something at that edge, and a square corner there reads as the
   * track having been cut off rather than as having made room.
   */
  leftOffset?: string
  /**
   * Whether what the track retracts for sits on the frame rather than floating
   * above it.
   *
   * The rounded corner exists to meet a floating panel, which carries its own
   * radius and its own gutter off the bottom. Against a segment flush with the
   * frame there is nothing to meet: the two are one band, and a curve on one
   * side of the seam reads as a misalignment.
   */
  flushLeft?: boolean
}

export function PeriodTimeline({
  start,
  end,
  onStartChange,
  onEndChange,
  scenes,
  scenesLoading,
  onListScenes,
  onOpenListing,
  disabled,
  leftOffset,
  flushLeft = false,
}: PeriodTimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState<"start" | "end" | null>(null)

  const startDay = toDay(start)
  const endDay = toDay(end)

  /**
   * Today, as a UTC day number.
   *
   * The period selects scenes that have already been acquired, so there is
   * nothing to the right of it. Read once per mount rather than per render: a
   * value taken from the clock inside the render body would make the axis a
   * function of when React happened to re-render.
   */
  const [today] = useState(() => Math.floor(Date.now() / DAY_MS))

  /**
   * The drawn span, which is the period plus a margin.
   *
   * Drawn edge to edge, the handles would sit on the boundary with nowhere to
   * drag outward to, so the window could only ever shrink.
   *
   * The margin runs past today on purpose. Clamping the axis as well as the
   * handle put the end handle at exactly 100 percent whenever the period ran to
   * the present -- against the right edge, with its date label overflowing into
   * whatever sat beside the track. The months ahead are drawn and simply cannot
   * be reached, which is also what makes the stop legible.
   */
  const [from, to] = useMemo(() => {
    if (startDay === null || endDay === null) return [0, 1]
    const pad = Math.max(30, Math.round((endDay - startDay) * 0.25))
    return [startDay - pad, endDay + pad]
  }, [startDay, endDay])

  const pct = useCallback(
    (day: number) => ((day - from) / Math.max(1, to - from)) * 100,
    [from, to]
  )

  const dayAt = useCallback(
    (clientX: number): number | null => {
      const el = trackRef.current
      if (!el) return null
      const r = el.getBoundingClientRect()
      const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
      return Math.round(from + t * (to - from))
    },
    [from, to]
  )

  const commit = useCallback(
    (which: "start" | "end", day: number) => {
      if (startDay === null || endDay === null) return
      // The handles cannot cross. Swapping them silently would invert the
      // period, and every consumer reads start before end.
      //
      // Neither can pass today. A period ending in the future is not a wider
      // search, it is a request for imagery that has not been acquired: the
      // listing returns the same scenes and the run reports a date range the
      // data does not cover.
      if (which === "start") {
        onStartChange(toISO(Math.min(day, endDay - 1, today - 1)))
      } else {
        onEndChange(toISO(Math.min(Math.max(day, startDay + 1), today)))
      }
    },
    [startDay, endDay, today, onStartChange, onEndChange]
  )

  const onPointerDown = (which: "start" | "end") => (e: React.PointerEvent) => {
    if (disabled) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDragging(which)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const day = dayAt(e.clientX)
    if (day !== null) commit(dragging, day)
  }

  const endDrag = (e: React.PointerEvent) => {
    if (!dragging) return
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    setDragging(null)
  }

  /** Arrow keys move a day, shift a week, so the track is not pointer-only. */
  const onKeyDown = (which: "start" | "end") => (e: React.KeyboardEvent) => {
    const current = which === "start" ? startDay : endDay
    if (current === null) return
    const step = e.shiftKey ? 7 : 1
    if (e.key === "ArrowLeft") commit(which, current - step)
    else if (e.key === "ArrowRight") commit(which, current + step)
    else return
    e.preventDefault()
  }

  if (startDay === null || endDay === null) return null

  const inWindow = scenes.filter((s) => {
    const d = toDay(s.date)
    return d !== null && d >= startDay && d <= endDay
  })

  return (
    <motion.div
      className={cn(
        "app-no-drag pointer-events-auto absolute bottom-0 right-0 z-[900] overflow-hidden",
        // Animated, because the panel it clears opens and closes: a track that
        // jumped its left edge would read as a different control appearing.
        "transition-[left] duration-200 ease-out",
        leftOffset && !flushLeft ? "rounded-tl-md" : null
      )}
      style={{ left: leftOffset ?? 0 }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
    >
      {/*
        One band: the label at one end, the scene count at the other, and the
        track between them. Stacked, the two ends cost a second row of height
        over the map for text that fits beside what it describes.

        The dates are not here either -- the handles carry them and the month
        rule places them. What this row adds is the one thing the track cannot
        show on its own: how many scenes the window actually holds.
      */}
      <div
        className="panel flex items-center gap-4 px-3 py-1.5"
        // Inline, because .panel is unlayered in index.css and outranks the
        // border-x-0/border-b-0 utilities this carried before: they compiled,
        // they just never applied, and the bar kept drawing a line down the
        // window's own right edge.
        style={{ borderInlineWidth: 0, borderBlockEndWidth: 0 }}
      >
        <span className="eyebrow shrink-0">Acquisition period</span>

        <div
          ref={trackRef}
          className="relative h-9 min-w-0 flex-1 select-none"
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {/* Month rule */}
          <div className="absolute inset-x-0 top-4 h-px bg-border" />

          {/*
            Where the calendar ends. Drawn only when it falls inside the track,
            so a historical period never carries a marker for a boundary far off
            to its right. Without it the end handle stops at a point the track
            gives no reason for, which reads as the control sticking.
          */}
          {today > from && today < to && (
            <span
              aria-hidden
              title="Today — no imagery has been acquired past this point"
              className="absolute top-1.5 w-px bg-line-strong"
              style={{ left: `${pct(today)}%`, height: "1.25rem" }}
            />
          )}
          {monthTicks(from, to).map((d) => (
            <div
              key={d}
              className="absolute top-4 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${pct(d)}%` }}
            >
              <span className="h-1.5 w-px bg-border" />
              <span className="telemetry mt-0.5 whitespace-nowrap text-micro text-muted-foreground">
                {monthLabel(d)}
              </span>
            </div>
          ))}

          {/* The window */}
          <div
            className="absolute top-2.5 h-3 rounded-sm bg-primary/25"
            style={{
              left: `${pct(startDay)}%`,
              width: `${Math.max(0, pct(endDay) - pct(startDay))}%`,
            }}
          />

          {/*
            Scenes, drawn as they fall. Cloud cover is the height rather than a
            colour: a clear scene and a clouded one are not two categories, and
            the useful question at a glance is how much of the window is usable.
          */}
          {scenes.map((s) => {
            const d = toDay(s.date)
            if (d === null || d < from || d > to) return null
            const clear = Math.max(0, Math.min(100, 100 - s.cloud_cover)) / 100
            const inside = d >= startDay && d <= endDay
            return (
              <span
                key={s.id}
                title={`${s.date} · ${s.cloud_cover.toFixed(0)}% cloud`}
                className={cn(
                  "absolute w-px",
                  inside ? "bg-accent-quiet" : "bg-line-strong/50"
                )}
                style={{
                  left: `${pct(d)}%`,
                  bottom: "1.35rem",
                  height: `${0.15 + clear * 0.55}rem`,
                }}
              />
            )
          })}

          {/* The date of each edge, on the edge. Dragging is what asks the
              question, so the answer belongs under the thumb rather than in a
              readout somewhere else on the bar. */}
          {(["start", "end"] as const).map((which) => {
            const day = which === "start" ? startDay : endDay
            return (
              <span
                key={`${which}-label`}
                aria-hidden
                className={cn(
                  "telemetry pointer-events-none absolute top-[0.35rem] whitespace-nowrap text-micro",
                  dragging === which ? "text-foreground" : "text-muted-foreground",
                  which === "start" ? "-translate-x-full pr-1.5" : "pl-1.5"
                )}
                style={{ left: `${pct(day)}%` }}
              >
                {toISO(day)}
              </span>
            )
          })}

          {(["start", "end"] as const).map((which) => {
            const day = which === "start" ? startDay : endDay
            return (
              <button
                key={which}
                type="button"
                role="slider"
                aria-label={`${which === "start" ? "Start" : "End"} of the acquisition period`}
                aria-valuemin={from}
                aria-valuemax={to}
                aria-valuenow={day}
                aria-valuetext={toISO(day)}
                disabled={disabled}
                onPointerDown={onPointerDown(which)}
                onKeyDown={onKeyDown(which)}
                className={cn(
                  "absolute top-1.5 h-5 w-2 -translate-x-1/2 cursor-ew-resize rounded-sm border border-primary bg-primary/80",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  dragging === which && "bg-primary"
                )}
                style={{ left: `${pct(day)}%` }}
              />
            )
          })}
        </div>

        <span className="telemetry shrink-0 text-micro text-muted-foreground">
          {scenesLoading ? (
            "listing scenes"
          ) : scenes.length ? (
            // The count opens the listing, which carries what the track cannot:
            // a preview per scene, its tile and its satellite. The track answers
            // how many and when; the listing answers which.
            <button
              type="button"
              onClick={onOpenListing}
              disabled={disabled || !onOpenListing}
              className="flex h-7 items-center gap-1.5 rounded-sm border border-border px-2 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              title="Open the scene listing, with previews"
            >
              <Boxes className="size-3.5" />
              {inWindow.length} of {scenes.length} scenes
            </button>
          ) : onListScenes ? (
            // The data cube glyph, because this IS the data cube listing: the
            // panel carried a button issuing the same request to a modal, and
            // two controls for one listing is one more than the listing has.
            <button
              type="button"
              onClick={onListScenes}
              disabled={disabled}
              className="flex h-7 items-center gap-1.5 rounded-sm border border-border px-2 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            >
              <Boxes className="size-3.5" />
              List scenes
            </button>
          ) : null}
        </span>
      </div>
    </motion.div>
  )
}
