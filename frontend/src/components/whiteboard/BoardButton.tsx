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

/*
  IT COULD BE DISABLED, AND THAT WAS THE WRONG ANSWER. With no raster on screen
  and no AOI it greyed out, on the reasoning that an empty board is a dead end.
  It was, while the studio could only ARRANGE runs -- but it has a globe to draw
  on and a run graph to run from now, so an empty studio is where work starts.
  Greyed out, it meant the only way in was to do the work outside first, which
  is the opposite of what that surface is for.
*/
export function BoardButton({
  active,
  onClick,
  onPrefetch,
}: {
  active: boolean
  onClick: () => void
  /** Warms the board's chunk on hover, so the click does not wait on a fetch. */
  onPrefetch?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onPrefetch}
      aria-pressed={active}
      title={active ? "Close the studio" : "Open the studio"}
      className={cn(
        // The bar's own vocabulary, matching the account and layout buttons it
        // sits between: 1.75rem square, borderless, painted on the bar itself.
        // The stack's buttons carry `.panel` and their own border to match the
        // zoom and draw controls; a button dressed for the wrong surface reads
        // as something that fell in from elsewhere.
        "app-no-drag flex h-7 w-7 items-center justify-center rounded-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-surface-raised text-foreground"
          : "text-muted-foreground hover:bg-surface-raised/70 hover:text-foreground"
      )}
    >
      <Layers3 className="size-4" strokeWidth={1.75} />
    </button>
  )
}
