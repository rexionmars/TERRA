/**
 * The dock layout's control surface: which product, and run it.
 *
 * It is an island, not a bar. PeriodTimeline already runs edge to edge along
 * the very bottom, welded to the frame by a `.panel` with its side and bottom
 * borders removed, and a second full-width strip above it would read as a
 * thicker version of the same thing. This one floats above the track's left
 * end, aligned with the label the track starts with, sized to its contents and
 * clear of the right edge entirely -- which is what leaves the tile attribution
 * at that edge docked to the track instead of being pushed off it.
 *
 * It carries the two things the navigation column and the panel footer used to
 * carry between them: which of the three map products is in view, and the
 * action that runs it.
 *
 * The products are aggregated behind one item rather than listed as peers,
 * matching how the navigation column groups them. Labels in a row made the
 * island as wide as half the window for a choice that changes rarely.
 *
 * The group is a prop, not a constant: the map screen passes its three tools
 * and the energy screen its two resources, and both read as the same object
 * because they are one.
 *
 * The way out of the workspace layout is the toggle in the title bar, which is
 * mounted in both layouts.
 */
import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ChevronUp, Loader2, Play, Settings2 } from "lucide-react"
import { NAV_GROUPS } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import { btnPrimaryCommit } from "@/components/ui/buttons"

/** One row of the menu, in the vocabulary the navigation column already uses. */
const ROW =
  "flex h-8 w-full items-center px-3 text-left text-emphasis transition-colors " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
const ROW_ON = "bg-surface-raised text-foreground"
const ROW_OFF =
  "text-muted-foreground hover:bg-surface-raised/70 hover:text-foreground"

export function WorkspaceBar({
  groupId,
  activeId,
  onNavigate,
  running,
  progress,
  progressMsg,
  runLabel,
  canRun,
  onRun,
  configOpen,
  onConfigToggle,
  onWidthChange,
}: {
  /** The group this screen belongs to, which is the one shown on the trigger. */
  groupId: string
  /** Which of that group's items is in view. */
  activeId: string | null
  /**
   * Go to a destination. The item is absent for a group that is a single place.
   *
   * The bar carries every destination, not just the one it is on, because the
   * dock layout hides the navigation column: without this the only way from the
   * map to energy was to leave the layout, switch, and come back.
   */
  onNavigate: (groupId: string, itemId?: string) => void
  running: boolean
  progress: number
  progressMsg: string
  /** What the action is called for the product in view. */
  runLabel: string
  canRun: boolean
  onRun: () => void
  /**
   * The studio is up, and running belongs to it.
   *
   * The bar exists because in this layout the parameters live in a drawer; the
   * board carries the same panels under its Run tab, so a second button that
   * starts the same run is a second button for one action. Dropped rather than
   * disabled: a control that cannot be used and cannot be explained is worse
   * than one that is not there.
   */
  configOpen: boolean
  onConfigToggle: () => void
  /** The island's measured width, for whatever has to make room for it. */
  onWidthChange?: (px: number) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const islandRef = useRef<HTMLDivElement>(null)

  /*
    The island is sized by its contents, and the contents change: the run
    button reads "Classify" or "Classifying", "Map water" or "Mapping". What
    retracts to sit beside it therefore cannot use a constant, so the measure
    is reported rather than assumed.
  */
  useEffect(() => {
    const el = islandRef.current
    if (!el || !onWidthChange) return
    const ro = new ResizeObserver(([entry]) =>
      onWidthChange(entry.contentRect.width)
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [onWidthChange])

  // A menu that opens over the map has to close on the next thing the user
  // does, or it sits on top of the imagery they were trying to reach.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  // The clamp the surface-water panel uses, which is the only one of the three
  // that is right: a bare Math.max(4, ...) draws a started run before it has
  // started, and a bare Math.max(0, ...) lets a stale value run past the end.
  const pct = Math.max(0, Math.min(100, progress))
  const group = NAV_GROUPS.find((g) => g.id === groupId)
  const Icon = group?.icon
  const active = group?.items.find((t) => t.id === activeId)

  return (
    <motion.div
      ref={rootRef}
      className={cn(
        "app-no-drag absolute z-[1000]",
        // Flush into the corner, beside the track rather than above it. The
        // track retracts to make room, so the two read as two segments of one
        // foot; a gutter under or left of the island would have broken that by
        // letting map show through beneath a bar that is part of the frame.
        "left-0 bottom-0"
      )}
      // On the root, not on the island inside it: the caller wraps this in an
      // AnimatePresence, which can only animate the element it is given.
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
    >
      <AnimatePresence>
        {open && (
          <motion.ul
            // Centred on the island rather than aligned to the button that
            // opens it. The island is flush in the corner, so a menu hung from
            // its left edge sits against the window frame with nothing under
            // its outer half.
            className="panel absolute bottom-[calc(100%+0.5rem)] left-1/2 w-[13rem] -translate-x-1/2 overflow-hidden rounded-md py-1"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
          >
            {/*
              Every destination, grouped as the navigation column groups them.
              This is that column lying down: the same three headings, the same
              children under each, so a user who learned one has learned both.
            */}
            {NAV_GROUPS.map((g) => {
              const onThisGroup = g.id === groupId
              const GroupIcon = g.icon
              return (
                <li key={g.id}>
                  {g.items.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        onNavigate(g.id)
                        setOpen(false)
                      }}
                      aria-current={onThisGroup ? "true" : undefined}
                      className={cn(ROW, "gap-2", onThisGroup ? ROW_ON : ROW_OFF)}
                    >
                      <GroupIcon className="size-3.5 shrink-0" />
                      <span className="min-w-0 truncate">{g.label}</span>
                    </button>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 px-3 pb-0.5 pt-1.5">
                        <GroupIcon className="size-3.5 shrink-0 text-primary" />
                        <span className="eyebrow !text-[9px]">{g.label}</span>
                      </div>
                      <ul>
                        {g.items.map((t) => {
                          const here = onThisGroup && t.id === activeId
                          return (
                            <li key={t.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  onNavigate(g.id, t.id)
                                  setOpen(false)
                                }}
                                aria-current={here ? "true" : undefined}
                                className={cn(
                                  ROW,
                                  "pl-8",
                                  here ? ROW_ON : ROW_OFF
                                )}
                              >
                                <span className="min-w-0 truncate">{t.label}</span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </>
                  )}
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>

      {/*
        The track's own height, taken from the variable that declares it, so the
        two segments cannot drift apart by a pixel. It leaves 13px around the
        36px commit button, which is the tallest thing inside.

        Square on every corner. It sits on the window frame on three sides,
        where a radius shows map through the gap it opens, and it meets the
        period track on the fourth -- the two are segments of one flat band, and
        a curve on either side of the seam reads as two things that failed to
        line up. The border is dropped on the two framed edges, inline because
        .panel is unlayered in index.css and outranks the border utilities --
        they compile, they simply never apply.
      */}
      <div
        ref={islandRef}
        className="panel relative flex h-[var(--map-foot,3.0625rem)] items-center gap-1 overflow-hidden px-2"
        style={{ borderInlineStartWidth: 0, borderBlockEndWidth: 0 }}
      >
        {/*
          One item, named for the group and showing what is selected under it.
          The column above says "Map" with the three nested; this says the same
          thing lying down.
        */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="true"
          className={cn(
            "flex h-9 items-center gap-2 rounded-sm px-2.5 transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            open
              ? "bg-surface-raised text-foreground"
              : "text-muted-foreground hover:bg-surface-raised/70 hover:text-foreground"
          )}
        >
          {Icon && <Icon className="size-4 shrink-0 text-primary" />}
          <span className="text-emphasis text-foreground">
            {active?.label ?? group?.label ?? "Go to"}
          </span>
          <ChevronUp
            className={cn(
              "size-3 shrink-0 transition-transform",
              open ? "" : "rotate-180"
            )}
          />
        </button>

        <span className="hairline mx-1 h-5 w-px self-center border-l" />

        <button
          type="button"
          onClick={onConfigToggle}
          aria-pressed={configOpen}
          title={active ? `${active.label} parameters` : "Parameters"}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            configOpen
              ? "bg-surface-raised text-foreground"
              : "text-muted-foreground hover:bg-surface-raised/70 hover:text-foreground"
          )}
        >
          <Settings2 className="size-4" />
        </button>

        <button
          type="button"
          onClick={onRun}
          disabled={!canRun || running}
          className={cn(btnPrimaryCommit, "ml-1")}
          // The progress message is the button's tooltip rather than a second
          // row of text: it changes several times a second, and a line that
          // reflows on every change costs more attention than it returns.
          title={running && progressMsg ? progressMsg : undefined}
        >
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          {runLabel}
        </button>

        {/*
          The progress hairline rides the island's own bottom edge, so it
          reports without taking height. Only while running: a track drawn at
          rest would assert that a run exists.
        */}
        {running && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-raised">
            <div
              className="h-full bg-primary transition-[width] duration-200 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
    </motion.div>
  )
}
