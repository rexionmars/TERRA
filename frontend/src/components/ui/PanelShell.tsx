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
import { cn } from "@/lib/utils"
import { motion } from "motion/react"
import { ChevronLeft, X } from "lucide-react"

/**
 * Which container the panel is drawn in.
 *
 * Named for what each one is rather than for the layout mode that uses it: a
 * placement is a fact about this box, and the modes are free to change which
 * placement they ask for.
 */
export type PanelPlacement = "docked" | "drawer" | "inline"

/**
 * Docked is the left column: full height between 0.75rem gutters, sliding in
 * from the left edge it is attached to.
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
  drawer:
    "panel app-no-drag panel-scroll absolute right-14 z-[1100] " +
    "bottom-[calc(var(--map-foot,0px)+0.625rem)] " +
    "flex max-h-[calc(100%-var(--map-foot,0px)-5rem)] w-[19rem] flex-col gap-4 " +
    "overflow-y-auto rounded-md p-4",
  /*
    Inline carries no chrome of its own: no plate, no border, no width, no
    position. It is placed INSIDE a column that already provides all four --
    the whiteboard's -- and a panel that brought its own would be a card inside
    a card, at a width the column does not have.

    That is the whole reason this placement exists. The parameters were left on
    the map to avoid a second place to set them, which was right about the
    danger and wrong about the fix: the answer is not to keep them away, it is
    to put the SAME panel in both containers, with one state behind it.
  */
  inline: "flex w-full flex-col gap-4",
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
  drawer: { x: 16, y: 8 },
  // Nothing: it is already inside the surface it belongs to, so there is no
  // edge for it to arrive from and a slide would only shift the column's
  // contents sideways under the reader.
  inline: { x: 0 },
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
  drawer: { x: 0, y: 0 },
  inline: { x: 0 },
}

/** The spring each placement's neighbours already use. */
const SPRING: Record<PanelPlacement, { stiffness: number; damping: number }> = {
  docked: { stiffness: 360, damping: 34 },
  drawer: { stiffness: 380, damping: 32 },
  inline: { stiffness: 380, damping: 32 },
}

export const PanelShell = forwardRef<
  HTMLDivElement,
  {
    title: string
    children: React.ReactNode
    placement?: PanelPlacement
    /**
     * Dismiss. Optional because one of the three panels has always treated it
     * so, and a shell that demanded it would be a change to that panel's
     * contract rather than to its container.
     */
    onCollapse?: () => void
  }
>(function PanelShell({ title, children, placement = "docked", onCollapse }, ref) {
  const enter = ENTER[placement]
  return (
    <motion.div
      ref={ref}
      className={CONTAINER[placement]}
      initial={{ opacity: 0, ...enter }}
      animate={{ opacity: 1, ...REST[placement] }}
      exit={{ opacity: 0, ...enter }}
      transition={{ type: "spring", ...SPRING[placement] }}
    >
      {/*
        Inline has no title of its own: the tab above it already names what is
        being run, and a heading under a heading is a heading repeated.
      */}
      <div
        className={cn(
          "flex items-center justify-between",
          placement === "inline" && "sr-only"
        )}
      >
        <h1 className="text-sm font-semibold">{title}</h1>
        {/*
          Only where there is something to dismiss to. The energy screen's
          column has never been collapsible -- it is the screen's only control
          surface -- and a button that renders without a handler is one that
          does nothing when pressed.
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
