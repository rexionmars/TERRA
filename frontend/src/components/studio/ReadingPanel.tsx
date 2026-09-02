/**
 * A reading, in an area of the studio.
 *
 * This is the body of what was `EnergyReadingColumn`, moved rather than copied:
 * the energy screen is gone, and the reading it carried is the one thing on it
 * the studio could not already do. What came across is the part that is about
 * the reading -- the blocks, their headline figures, and the index that says
 * which block you are in. What did not is the part that was about being a
 * column floated over a map: the `PanelShell`, the fold-away chevron and the
 * Escape handler. An area already has a header, and it already closes.
 *
 * WHAT THIS OWNS AND WHAT THE BLOCKS OWN, unchanged from the column. This states
 * each product's name, its provenance and its four headline figures once, at the
 * head of that product's group; the blocks below state their own subject and
 * nothing else. Held the other way round -- which is how it was -- the six
 * blocks of the energy model each opened with the product's name and its
 * window, the panel framing them printed the same name again, and the block's
 * own subject was never drawn at all.
 *
 * THE INDEX IS THE POSITION. A reading of nine blocks scrolls past several
 * thousand pixels, and a scrollbar states how far through the pixels a reader
 * is, not which block they are in. The strip at the top names every block and
 * marks the one at the top of the viewport, which is the question a reader of a
 * long reading actually has.
 *
 * THE BODY SCROLLS, THE PANEL DOES NOT. The index strip is outside the scroll
 * container rather than stuck to the top of it, so it stays on screen without a
 * fill of its own. Stuck instead, it had to be opaque enough to hide the reading
 * passing under it -- and a band at 0.92 across a plate at 0.55 is a darker
 * rectangle inside the panel, a second surface inside one panel's own chrome.
 * Nothing passes under anything, so the strip is the panel.
 *
 * THE ACCENT IS A LINE, A FILL AND AN ICON, NEVER A LABEL. lib/contrast.ts
 * carries the accent at 3.0 as a fill and says never small text; over a panel at
 * 0.55 on bright imagery accentQuiet measures 1.43, which is what an orange chip
 * label was. The marked chip takes `border-primary/60 bg-primary/10` and keeps
 * its label in the text colour.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Trash2 } from "lucide-react"

import { Chip, WaterFigure } from "@/components/analysisPrimitives"
import {
  readingIndex,
  type ReadingGroup,
} from "@/components/energy/readingSections"
import { btnIcon } from "@/components/ui/buttons"
import { cn } from "@/lib/utils"

/** Clearance above a block when the index scrolls to it, in pixels. */
const ANCHOR_GAP = 12

export interface ReadingPanelProps {
  groups: ReadingGroup[]
  /**
   * Clears one product's result. The group names which.
   *
   * Optional, because not every reading is clearable from where it is read: a
   * run recorded against an area is discarded with the run, not with the panel
   * that happens to be showing it.
   */
  onClear?: (key: ReadingGroup["key"]) => void
  /** Shown in place of the reading when there is nothing to read yet. */
  empty: string
}

export function ReadingPanel({ groups, onClear, empty }: ReadingPanelProps) {
  const box = useRef<HTMLDivElement | null>(null)
  const entries = useMemo(() => readingIndex(groups), [groups])
  const [activeId, setActiveId] = useState<string | null>(
    entries[0]?.id ?? null
  )

  /*
    Which block is at the top of the viewport, measured rather than observed.

    An IntersectionObserver answers "is this element in view", and blocks here
    are routinely taller than the box they are read in: several answer yes at
    once and the tallest answers yes for the longest, so the index would mark a
    block the reader had scrolled past. The question is which block owns the
    first line of the viewport, which is a comparison of offsets, and there are
    nine of them.
  */
  const measure = useCallback(() => {
    const el = box.current
    if (!el) return
    const line = el.scrollTop + ANCHOR_GAP
    let current: string | null = null
    for (const node of el.querySelectorAll<HTMLElement>("[data-section]")) {
      if (node.offsetTop > line) break
      current = node.dataset.section ?? null
    }
    setActiveId(current ?? entries[0]?.id ?? null)
  }, [entries])

  useEffect(() => {
    const el = box.current
    if (!el) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    /*
      The offsets this reads are content offsets, and the content reflows. In a
      column over a map that meant the window; in an area it means the area,
      which a reader resizes by dragging a border while the reading is on
      screen. `resize` on the window does not fire for that, so the box is
      observed directly -- without it the index kept marking the block that was
      at the top before the drag.
    */
    const ro = new ResizeObserver(onScroll)
    ro.observe(el)
    measure()
    return () => {
      el.removeEventListener("scroll", onScroll)
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [measure])

  const goTo = (id: string) => {
    const el = box.current
    const target = el?.querySelector<HTMLElement>(`[data-section="${id}"]`)
    if (!el || !target) return
    el.scrollTo({
      top: Math.max(0, target.offsetTop - ANCHOR_GAP),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    })
  }

  if (!groups.length) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="max-w-[22rem] text-center text-meta leading-relaxed text-muted-foreground">
          {empty}
        </p>
      </div>
    )
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2 p-3"
      style={
        {
          /*
            What a full-width raster tile inside a block may occupy. PanelTile
            reaches for 45vh where no host says otherwise, which is measured
            against the window and not against this panel, and pushed the class
            list below it off the bottom of the scroll viewport. An area is not
            the window either, so the ceiling is stated here too.
          */
          "--reading-h": "min(28rem, 60vh)",
        } as React.CSSProperties
      }
    >
      <nav
        aria-label="Blocks of this reading"
        className="panel-scroll flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--hairline)] pb-2"
      >
        {entries.map((e) => {
          const on = e.id === activeId
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => goTo(e.id)}
              aria-current={on ? "true" : undefined}
              /* The chip is abbreviated; the control is not. Assistive
                 technology takes the accessible name from the label, not from
                 the tooltip, so the block's full name is set on both. */
              aria-label={e.title}
              title={e.title}
              className={cn(
                "telemetry shrink-0 rounded-[2px] border px-1.5 py-0.5 text-micro uppercase tracking-wider transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                on
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {e.short}
            </button>
          )
        })}
      </nav>

      {/*
        The reading itself, and the only box here that scrolls.

        `relative` on purpose: the blocks inside it measure their position with
        `offsetTop`, which is read against the nearest positioned ancestor. Left
        static, that ancestor is the area, and every offset would carry the
        height of the header and the strip above it while the scroll position
        they are compared against would not -- so the index would mark a block
        one header early.
      */}
      <div
        ref={box}
        className="panel-scroll relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
      >
        {groups.map((g, gi) => (
          <section key={g.key} className="flex flex-col gap-3">
            {gi > 0 && <hr className="hairline" />}

            <header className="flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                <span className="eyebrow !text-foreground">{g.label}</span>
                {onClear && (
                  <button
                    type="button"
                    onClick={() => onClear(g.key)}
                    className={btnIcon}
                    title={`Clear the ${g.label} result`}
                    aria-label={`Clear the ${g.label} result`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              {g.chips && (
                <div className="flex flex-wrap gap-1">
                  {g.chips.map((c) => (
                    <Chip key={c}>{c}</Chip>
                  ))}
                </div>
              )}
              {g.meta && (
                <p className="telemetry text-meta leading-relaxed text-muted-foreground">
                  {g.meta}
                </p>
              )}
            </header>

            {/* The product's headline, stated here and nowhere below. Two
                columns at this measure: four figures in one column push the
                first block of the group off the first screen of its own
                group. */}
            {g.headline && (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {g.headline.figures.map((f) => (
                    <WaterFigure key={f.label} dense {...f} />
                  ))}
                </div>
                {g.headline.note && (
                  <p className="text-micro leading-relaxed text-muted-foreground">
                    {g.headline.note}
                  </p>
                )}
              </div>
            )}

            {g.sections.map((s) => (
              <div
                key={s.id}
                data-section={s.id}
                className="flex flex-col gap-2"
              >
                {/*
                  Named only where the name is not already above it. A product
                  that contributes one block has that block named by the group
                  heading, and printing it again is the defect this reading was
                  written to remove.
                */}
                {g.sections.length > 1 && (
                  <span className="eyebrow !text-foreground">{s.title}</span>
                )}
                {s.node}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
