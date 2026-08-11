/**
 * The control that opens the isolate board.
 *
 * A SEPARATE FILE FROM THE BOARD ON PURPOSE. IsolateBoard imports boardScene,
 * which imports `three`; anything that imports IsolateBoard statically pulls
 * half a megabyte into the eager graph. Merging these two files would make
 * opening the map screen fetch a 3D library to draw a 34 px button, and the
 * cost would not show up anywhere except a slower cold start.
 *
 * It joins Leaflet's bottom-right stack, which already means "things that
 * change how the map is presented".
 */
import { Layers3 } from "lucide-react"
import { cn } from "@/lib/utils"

export function IsolateBoardButton({
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
          ? "Nothing to isolate: no raster on the map"
          : "Isolate the analysis from the map"
      }
      className={cn(
        // Sized to the zoom and draw buttons it sits under. A narrower one
        // beside them reads as a different kind of control.
        "panel app-no-drag flex h-[2.125rem] w-[2.125rem] items-center justify-center rounded-sm text-muted-foreground transition-colors",
        "hover:bg-secondary hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
        active && "border-primary/50 bg-primary/15 text-foreground"
      )}
    >
      <Layers3 className="size-3.5" strokeWidth={1.75} />
    </button>
  )
}
