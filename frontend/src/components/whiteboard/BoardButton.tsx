/**
 * The control that opens the whiteboard.
 *
 * A SEPARATE FILE FROM THE BOARD ON PURPOSE. BoardSurface imports boardScene,
 * which imports `three`; anything that imports BoardSurface statically pulls
 * half a megabyte into the eager graph. Merging these two files would make
 * opening the map screen fetch a 3D library to draw a 34 px button, and the
 * cost would not show up anywhere except a slower cold start.
 *
 * It joins Leaflet's bottom-right stack, which already means "things that
 * change how the map is presented".
 */
import { Layers3 } from "lucide-react"
import { cn } from "@/lib/utils"

export function BoardButton({
  active,
  disabled,
  onClick,
  onPrefetch,
  inBar,
}: {
  active: boolean
  /** No raster on screen: an empty board is a dead end, so it says so. */
  disabled?: boolean
  onClick: () => void
  /** Warms the board's chunk on hover, so the click does not wait on a fetch. */
  onPrefetch?: () => void
  /**
   * Drawn for the dock layout's island rather than for Leaflet's control stack.
   *
   * The two surfaces have different vocabularies and it is not a detail: the
   * stack's buttons carry `.panel`, their own border and 2.125rem to match the
   * zoom and draw controls beside them, while the island's are 2.25rem, borderless
   * and painted on the island's own plate. A button dressed for the wrong one
   * reads as something that fell in from elsewhere.
   */
  inBar?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onPrefetch}
      disabled={disabled}
      aria-pressed={active}
      title={
        disabled
          ? "Nothing to work on: draw an area or run something first"
          : "Open the whiteboard for this area"
      }
      className={cn(
        "flex items-center justify-center rounded-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-40",
        inBar
          ? [
              "size-9 text-muted-foreground",
              "enabled:hover:bg-surface-raised/70 enabled:hover:text-foreground",
              active && "bg-surface-raised text-foreground",
            ]
          : [
              // Sized to the zoom and draw buttons it sits under. A narrower
              // one beside them reads as a different kind of control.
              "panel app-no-drag h-[2.125rem] w-[2.125rem] text-muted-foreground",
              "enabled:hover:bg-secondary enabled:hover:text-foreground",
              active && "border-primary/50 bg-primary/15 text-foreground",
            ]
      )}
    >
      <Layers3 className="size-3.5" strokeWidth={1.75} />
    </button>
  )
}
