/**
 * The container a map product's controls are drawn in.
 *
 * The three map panels -- classification, compositions, surface water -- were
 * each written as their own positioned, animated box, and the box was the same
 * string in all three:
 *
 *     panel app-no-drag panel-scroll absolute left-3 top-3 bottom-3 z-[1000]
 *     flex w-[19rem] flex-col gap-4 overflow-y-auto rounded-md p-4
 *
 * Everything below that line -- 840 to 1100px of sections per panel -- is
 * position-agnostic. So the panels' coupling to the left column was one line,
 * written three times, and moving them anywhere meant editing three files that
 * had already drifted in every other respect.
 *
 * That line lives here now, and it takes a placement. `docked` reproduces the
 * left column exactly; `drawer` anchors to the right edge, for the workspace
 * layout where there is no column to dock to. The panel bodies do not know
 * which one they are in.
 *
 * The width stays 19rem in both. The bodies were authored for that measure --
 * the date pairs, the radio cards, the band selects all lay out against it --
 * so changing it in the drawer would turn a re-host into a redesign.
 */
import { forwardRef } from "react"
import { motion } from "motion/react"
import { ChevronLeft, X, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Which container the panel is drawn in.
 *
 * Named for what each one is rather than for the layout mode that uses it: a
 * placement is a fact about this box, and the modes are free to change which
 * placement they ask for.
 */
export type PanelPlacement = "docked" | "drawer" | "reading"

/**
 * Docked is the left column: full height between 0.75rem gutters, sliding in
 * from the left edge it is attached to.
 *
 * Reading is the only one of the three that does not scroll as a whole: its
 * body scrolls inside it, so the title and the index band stay put without
 * needing a fill of their own to hide the reading passing beneath them. A band
 * that needs its own fill is a second surface inside the panel, and at these
 * alphas it is a visibly darker block across a translucent plate.
 *
 * Reading is the docked column's mirror: same width, same gutters, same fill,
 * against the right edge instead of the left. It is what the energy result is
 * read in, and it is deliberately the setup column's twin -- the parameters
 * that produced a run and the run's own figures are the one comparison
 * somebody tuning a run makes, and two columns of one species flanking the map
 * state that they are two halves of one thing. It clears the map foot rather
 * than running to the bottom gutter, because the period track spans the foot
 * to the right edge, and `right-14` clears the zoom stack exactly as the
 * drawer's does.
 *
 * Drawer is the right-edge overlay, following OverlayToolsPanel, which is the
 * established vocabulary for a right-anchored surface on this screen. It sits
 * on the foot and grows upward, sharing a baseline with the map's own control
 * column: these bodies are genuinely 840 to 1100px tall, so anchoring them at
 * the top left them running off the bottom of the screen. --map-foot is what
 * the reservation is measured in; see index.css.
 */
const CONTAINER: Record<PanelPlacement, string> = {
  docked:
    "panel app-no-drag panel-scroll absolute left-3 top-3 bottom-3 z-[1000] " +
    "flex w-[19rem] flex-col gap-4 overflow-y-auto rounded-md p-4",
  reading:
    "panel app-no-drag absolute right-14 top-3 z-[1000] " +
    "bottom-[calc(var(--map-foot,0px)+0.75rem)] " +
    "flex w-[19rem] flex-col gap-3 overflow-hidden rounded-md p-4",
  drawer:
    "panel app-no-drag panel-scroll absolute right-14 z-[1100] " +
    "bottom-[calc(var(--map-foot,0px)+0.625rem)] " +
    "flex max-h-[calc(100%-var(--map-foot,0px)-5rem)] w-[19rem] flex-col gap-4 " +
    "overflow-y-auto rounded-md p-4",
}

/**
 * Entry offset per placement, so a panel enters from the edge it belongs to.
 *
 * This is the reason the animation has to live on the container and not on the
 * body: the docked column slides in from the left and the drawer from the
 * right, and a body that carried its own transition would fight whichever
 * container it was placed in.
 */
const ENTER: Record<PanelPlacement, { x: number; y?: number }> = {
  docked: { x: -28 },
  reading: { x: 28 },
  drawer: { x: 16, y: 8 },
}

/**
 * Where each placement settles. Written out per placement rather than as one
 * `{ x: 0, y: 0 }`, so the docked panel animates the two values it offsets and
 * not a third it never touches -- an axis listed here that the entry offset
 * does not set is inert on screen but still costs a computed-style read per
 * mount to find the value it is animating from.
 */
const REST: Record<PanelPlacement, { x: number; y?: number }> = {
  docked: { x: 0 },
  reading: { x: 0 },
  drawer: { x: 0, y: 0 },
}

/** The spring each placement's neighbours already use. */
const SPRING: Record<PanelPlacement, { stiffness: number; damping: number }> = {
  docked: { stiffness: 360, damping: 34 },
  reading: { stiffness: 360, damping: 34 },
  drawer: { stiffness: 380, damping: 32 },
}

export const PanelShell = forwardRef<
  HTMLDivElement,
  {
    title: string
    children: React.ReactNode
    placement?: PanelPlacement
    /**
     * Custom properties the body's own rules read, set on the container
     * because the container is the box they are measured against. The reading
     * column declares `--reading-h` here, which bounds a raster tile against
     * the scroll viewport it is in rather than against the window.
     */
    style?: React.CSSProperties
    /**
     * Dismiss. Optional because one of the three panels has always treated it
     * so, and a shell that demanded it would be a change to that panel's
     * contract rather than to its container.
     */
    onCollapse?: () => void
  }
>(function PanelShell(
  { title, children, placement = "docked", style, onCollapse },
  ref
) {
  const enter = ENTER[placement]
  return (
    <motion.div
      ref={ref}
      className={CONTAINER[placement]}
      style={style}
      initial={{ opacity: 0, ...enter }}
      animate={{ opacity: 1, ...REST[placement] }}
      exit={{ opacity: 0, ...enter }}
      transition={{ type: "spring", ...SPRING[placement] }}
    >
      {/*
        The density a placement implies, offered to everything inside it. A
        panel written for a floating column keeps that scale wherever it is put
        unless its container says otherwise, and inline the container is 4rem
        narrower and sits beside rows of ten-pixel text.
      */}
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">{title}</h1>
        {/*
          Only where there is something to dismiss to, and only where something
          brings the column back: a fold with no restore is a column a reader
          can lose. Both of the energy screen's take `PanelTab` below; the map
          screen's restore from the tool tabs in its run bar.
        */}
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="text-muted-foreground hover:text-foreground"
            title="Hide panel"
          >
            {/*
              A chevron pointing left means "fold back against the left edge",
              which is what the docked column does and what a right-edge drawer
              cannot do. The drawer closes instead, so it says so.
            */}
            {placement === "docked" ? (
              <ChevronLeft className="size-4" />
            ) : (
              <X className="size-4" />
            )}
          </button>
        )}
      </div>
      {children}
    </motion.div>
  )
})

/**
 * What a folded column leaves behind.
 *
 * A column that can be dismissed and not brought back is a column that can be
 * lost, and neither of this screen's two has anywhere else to be reached from:
 * the map screen restores its panels from the tool tabs in the run bar, and
 * there is no such rail here. So the fold leaves one control, and it stands
 * where the head of the column it restores stands -- left for the parameters,
 * right for the reading -- because a control that appears somewhere other than
 * where its subject will appear has to be learnt rather than seen.
 *
 * DRAWN AT THE MAP TOOLBARS' FILL, NOT THE PANEL'S. `.panel` is 0.55 ink and
 * the blur behind it has a panel's area to average over; this is a single
 * control, and at 0.55 a bright field under a 32px box stays a bright field,
 * with the label sitting on it at about 1.5. index.css records the same
 * measurement for the zoom and draw bars, which is why those take 0.82.
 *
 * THE LABEL IS TEXT AND THE GLYPH IS THE ACCENT, which is the rule both
 * columns keep: AoiSection.tsx:65-72 sets an accent check beside a foreground
 * label, and lib/contrast.ts carries the accent for fills and glyphs and says
 * never small text. Both of these read in orange throughout, which is the one
 * thing in this chrome that the panels never do.
 */
export function PanelTab({
  placement,
  label,
  icon: Icon,
  title,
  onOpen,
}: {
  /** The column this brings back. Its edge is where the tab stands. */
  placement: Extract<PanelPlacement, "docked" | "reading">
  label: string
  icon: LucideIcon
  /** What the control does, in full. The label is a word, this is a sentence. */
  title: string
  onOpen: () => void
}) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      title={title}
      initial={{ opacity: 0, x: placement === "docked" ? -12 : 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: placement === "docked" ? -12 : 12 }}
      transition={{ type: "spring", stiffness: 360, damping: 34 }}
      className={cn(
        "app-no-drag absolute top-3 z-[1000] flex h-8 items-center gap-1.5",
        "rounded-md border border-[rgb(var(--p-line)/0.28)] bg-[rgb(var(--p-ink)/0.82)]",
        "px-3 text-body text-foreground backdrop-blur-[18px] transition-colors",
        "hover:bg-[rgb(var(--p-surface-raised)/0.92)]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        /* The same insets the columns take, so the tab stands exactly where the
           column's own top corner will be: the reading clears the zoom stack,
           the setup column meets the left gutter. */
        placement === "docked" ? "left-3" : "right-14"
      )}
    >
      <Icon className="size-3.5 text-primary" />
      {label}
    </motion.button>
  )
}
