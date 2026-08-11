/**
 * The workspace layout's control surface: which product, and run it.
 *
 * It is an island, not a bar. PeriodTimeline already runs edge to edge along
 * the very bottom, welded to the frame by a `.panel` with its side and bottom
 * borders removed, and a second full-width strip above it would read as a
 * thicker version of the same thing. This one floats: centred, sized to its
 * contents, clear of both side edges, with a larger corner radius than any
 * docked panel so the difference is legible before anything is read.
 *
 * It carries the two things the navigation column and the panel footer used to
 * carry between them -- which of the three map products is in view, and the
 * action that runs it. It carries nothing else. Energy and the project hub are
 * deliberately absent: three peers is a segmented control, and adding a fourth
 * kind of destination would rebuild the sidebar lying down.
 *
 * The way out of the workspace layout is the toggle in the title bar, which is
 * mounted in both layouts. That is a decision rather than an omission: a route
 * to the other screens belongs here only once the layout has been used enough
 * to say what it should look like.
 */
import { motion } from "motion/react"
import { Loader2, Play, Settings2 } from "lucide-react"
import { MAP_TOOLS, type MapToolId } from "@/lib/mapTools"
import { cn } from "@/lib/utils"
import { btnPrimaryCommit } from "@/components/ui/buttons"

export function WorkspaceBar({
  tool,
  onToolChange,
  running,
  progress,
  progressMsg,
  runLabel,
  canRun,
  onRun,
  configOpen,
  onConfigToggle,
}: {
  tool: MapToolId | null
  onToolChange: (id: MapToolId) => void
  running: boolean
  progress: number
  progressMsg: string
  /** What the action is called for the product in view. */
  runLabel: string
  canRun: boolean
  onRun: () => void
  configOpen: boolean
  onConfigToggle: () => void
}) {
  // The clamp the surface-water panel uses, which is the only one of the three
  // that is right: a bare Math.max(4, ...) draws a started run before it has
  // started, and a bare Math.max(0, ...) lets a stale value run past the end.
  const pct = Math.max(0, Math.min(100, progress))

  return (
    <motion.div
      className={cn(
        "panel app-no-drag absolute left-1/2 z-[1000] -translate-x-1/2",
        // Above whatever the foot already reserves. --map-foot is the total
        // reservation, not the timeline's own height; see index.css.
        "bottom-[calc(var(--map-foot,0px)+1rem)]",
        // h-12 is the commit button's 36px plus 6px of breathing room on each
        // side. Stated because the foot reservation is derived from it.
        "flex h-12 items-center gap-1 overflow-hidden rounded-lg px-2"
      )}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
    >
      {/*
        A segmented control rather than a menu. Three is where a segment beats a
        dropdown, and it keeps the sidebar's most valuable property: every
        destination visible without an interaction. The labels come from
        MAP_TOOLS so this cannot drift from the column that lists the same three.
      */}
      <div className="flex items-center gap-0.5" role="tablist" aria-label="Map products">
        {MAP_TOOLS.map((t) => {
          const active = tool === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onToolChange(t.id)}
              className={cn(
                "flex h-9 items-center rounded-sm px-3 text-emphasis transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                active
                  ? "bg-surface-raised text-foreground"
                  : "text-muted-foreground hover:bg-surface-raised/70 hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <span className="hairline mx-1 h-5 w-px self-center border-l" />

      <button
        type="button"
        onClick={onConfigToggle}
        aria-pressed={configOpen}
        title={tool ? `${MAP_TOOLS.find((t) => t.id === tool)?.label} parameters` : "Parameters"}
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
        // The progress message is the button's tooltip rather than a second row
        // of text: it changes several times a second, and a line that reflows
        // on every change costs more attention than it returns.
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
        The progress hairline rides the island's own bottom edge, so it reports
        without taking height. Only while running: a track drawn at rest would
        assert that a run exists.
      */}
      {running && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-raised">
          <div
            className="h-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </motion.div>
  )
}
