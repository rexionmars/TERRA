/**
 * The control that opens the whiteboard.
 *
 * A SEPARATE FILE FROM THE BOARD ON PURPOSE. BoardSurface imports boardScene,
 * which imports `three`; anything that imports BoardSurface statically pulls
 * half a megabyte into the eager graph. Merging these two files would make
 * opening the map screen fetch a 3D library to draw a 28 px button, and the
 * cost would not show up anywhere except a slower cold start.
 *
 * It lives in the title bar, and used to live in two other places at once --
 * Leaflet's bottom-right stack in the dock layout, the workspace island in the
 * other. Each of those had a layout it could not serve. Leaflet's stack goes
 * UNDER the board, so its copy was an entry with no matching exit; the island's
 * copy only exists where the island does. The title bar is above the board in
 * both layouts, so one mount now does what two could not, and this component
 * needs only one dress instead of the two it carried to tell them apart.
 */
import { Layers3 } from "lucide-react"
import { cn } from "@/lib/utils"

export function BoardButton({
  active,
  disabled,
  onClick,
  onPrefetch,
}: {
  active: boolean
  /** No raster on screen: an empty board is a dead end, so it says so. */
  disabled?: boolean
  onClick: () => void
  /** Warms the board's chunk on hover, so the click does not wait on a fetch. */
  onPrefetch?: () => void
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
          : active
            ? "Close the whiteboard"
            : "Open the whiteboard for this area"
      }
      className={cn(
        // The bar's own vocabulary, matching the account and layout buttons it
        // sits between: 1.75rem square, borderless, painted on the bar itself.
        // The stack's buttons carry `.panel` and their own border to match the
        // zoom and draw controls; a button dressed for the wrong surface reads
        // as something that fell in from elsewhere.
        "app-no-drag flex h-7 w-7 items-center justify-center rounded-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "bg-surface-raised text-foreground"
          : "text-muted-foreground enabled:hover:bg-surface-raised/70 enabled:hover:text-foreground"
      )}
    >
      <Layers3 className="size-4" strokeWidth={1.75} />
    </button>
  )
}
