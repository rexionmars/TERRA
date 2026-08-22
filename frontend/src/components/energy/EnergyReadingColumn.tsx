/**
 * The energy result, read in a column that mirrors the one it was set up in.
 *
 * ONE SPECIES OF SURFACE ON THIS SCREEN. The result has been three shapes and
 * all three were a second grammar: a 44rem overlay anchored to the map foot at
 * a higher z-index than the panel it belonged to; then a centred dialog over a
 * scrim, which covers the map the figures were measured over; then a foot panel
 * that grew upward and paged, which put a title band in the middle of itself
 * and a caption strip under content that had already stated it. The parameters
 * are read in a 19rem docked column, so the result is read in a 19rem docked
 * column against the other edge. Two columns of one species flanking the map
 * say what they are without a legend.
 *
 * WHAT THE COLUMN OWNS AND WHAT THE BLOCKS OWN. The column states each
 * product's name, its provenance and its four headline figures once, at the
 * head of that product's group; the blocks below state their own subject and
 * nothing else. Held the other way round -- which is how it was -- the six
 * blocks of the energy model each opened with the product's name and its
 * window, the panel framing them printed the same name again, and the block's
 * own subject was never drawn at all.
 *
 * THE INDEX IS THE POSITION. A column of nine blocks scrolls past several
 * thousand pixels, and a scrollbar states how far through the pixels a reader
 * is, not which block they are in. The band under the title names every block
 * and marks the one at the top of the viewport, which is the question a reader
 * of a long reading actually has.
 *
 * IN THE DOCK LAYOUT THE SETUP DRAWER COVERS THIS COLUMN, and is left to.
 * There is no docked column there to mirror -- the parameters open as a
 * right-edge drawer -- so the two want the same edge. The drawer is a surface
 * the reader opens and closes on purpose and it sits a layer above; the
 * alternative, moving this column to the free left edge in that layout only,
 * would make the result appear on whichever side the reader last chose a
 * layout on.
 *
 * THE BODY SCROLLS, THE COLUMN DOES NOT. The title and the index band are
 * outside the scroll container rather than stuck to the top of it, so they stay
 * on screen without a fill of their own. Stuck instead, the band had to be
 * opaque enough to hide the reading passing under it -- and a band at 0.92
 * across a plate at 0.55 is a darker rectangle inside the panel, which is the
 * second-surface defect this column exists to remove, in miniature and in its
 * own chrome. Nothing passes under anything now, so the band is the panel.
 *
 * THE ACCENT IS A LINE, A FILL AND AN ICON, NEVER A LABEL. The rule is the
 * setup column's, at SolarProductSelector.tsx:88 and AoiSection.tsx:65-72: the
 * chosen product takes `border-primary/60 bg-primary/10` and keeps its label in
 * the text colour, and the defined-area row takes an accent check beside a
 * foreground label. lib/contrast.ts carries the accent at 3.0 as a fill and
 * says never small text; over a panel at 0.55 on bright imagery accentQuiet
 * measures 1.43, which is what an orange chip label was.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronRight, Trash2 } from "lucide-react"

import { Chip, WaterFigure } from "@/components/analysisPrimitives"
import { PanelShell } from "@/components/ui/PanelShell"
import {
  readingIndex,
  type ReadingGroup,
} from "@/components/energy/readingSections"
import { btnIcon } from "@/components/ui/buttons"
import { cn } from "@/lib/utils"

/** Clearance above a block when the index scrolls to it, in pixels. */
const ANCHOR_GAP = 12

export interface EnergyReadingColumnProps {
  /** The tab's name, which is what the column is a reading of. */
  title: string
  groups: ReadingGroup[]
  /** Clears one product's result. The group names which. */
  onClear: (key: ReadingGroup["key"]) => void
  /** Folds the column back against the right edge. */
  onCollapse: () => void
}

export function EnergyReadingColumn({
  title,
  groups,
  onClear,
  onCollapse,
}: EnergyReadingColumnProps) {
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
    /* The offsets this reads are content offsets, and the content reflows: a
       narrower window rewraps every paragraph in the column and moves every
       block below the first. Without this the index kept marking the block
       that was at the top before the resize. */
    window.addEventListener("resize", onScroll)
    measure()
    return () => {
      el.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [measure])

  /* Escape leaves the reading. A column this tall that can only be dismissed by
     finding one button is a trap for anyone not using a pointer. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCollapse()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCollapse])

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

  return (
    <PanelShell
      placement="reading"
      title={title}
      style={
        {
          /*
            What a full-width raster tile inside a block may occupy. PanelTile
            reaches for 45vh where no host says otherwise, which is measured
            against the window and not against this column, and pushed the
            siting class list below it off the bottom of the scroll viewport.
          */
          "--reading-h": "min(28rem, calc(100vh - var(--map-foot, 0px) - 12rem))",
        } as React.CSSProperties
      }
    >
      <div className="-mx-4 flex shrink-0 items-center gap-2 border-b border-[var(--hairline)] px-4 pb-2">
        <nav
          aria-label="Blocks of this reading"
          className="panel-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
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
                   technology takes the accessible name from the label, not
                   from the tooltip, so the block's full name is set on both. */
                aria-label={e.title}
                title={e.title}
                className={cn(
                  "telemetry shrink-0 rounded-[2px] border px-1.5 py-0.5 text-micro uppercase tracking-wider transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  /*
                    The chosen product's own treatment, borrowed whole from the
                    selector in the setup column: an accent line, an accent
                    wash at a tenth, and the label in the text colour. The
                    inactive chip takes `border-border`, which is what every
                    other unchosen control in these two columns takes.
                  */
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
        {/* A chevron pointing right means "fold back against the right edge",
            which is what this column does. */}
        <button
          type="button"
          onClick={onCollapse}
          className={btnIcon}
          title="Hide the reading"
          aria-label="Hide the reading"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/*
        The reading itself, and the only box on this column that scrolls.

        `relative` on purpose: the blocks inside it measure their position with
        `offsetTop`, which is read against the nearest positioned ancestor. Left
        static, that ancestor is the panel, and every offset would carry the
        height of the title and the band above it while the scroll position they
        are compared against would not -- so the index would mark a block one
        header early. The negative margins put the scrollbar on the panel's own
        edge, where the other three columns put theirs.
      */}
      <div
        ref={box}
        className="panel-scroll relative -mx-4 -mb-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4"
      >
        {groups.map((g, gi) => (
          <section key={g.key} className="flex flex-col gap-3">
            {gi > 0 && <hr className="hairline -mx-4" />}

            <header className="flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                <span className="eyebrow !text-foreground">{g.label}</span>
                <button
                  type="button"
                  onClick={() => onClear(g.key)}
                  className={btnIcon}
                  title={`Clear the ${g.label} result`}
                  aria-label={`Clear the ${g.label} result`}
                >
                  <Trash2 className="size-3.5" />
                </button>
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

            {/* The product's headline, stated here and nowhere below. Two columns
                at this measure: four figures in one column push the first block
                of the group off the first screen of its own group. */}
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
                  heading, and printing it again is the defect this column was
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
    </PanelShell>
  )
}
