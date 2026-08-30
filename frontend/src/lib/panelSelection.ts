/**
 * Which map tool has its panel open, held outside React.
 *
 * WHY IT IS NOT STATE IN App. Two things wanted it there and neither wanted it
 * to be state: the navigation column and the map screen both read it, so it had
 * to live above both, and the map screen remounts on every return to it, so a
 * useState inside the screen forgot the choice each time.
 *
 * Lifting it to App answered both and charged for it every time: App holds the
 * whole application's tree, nothing on the path is memoised, and so collapsing a
 * panel reconciled every screen the application has in order to change which of
 * three panels was drawn.
 *
 * A module holds it instead. It outlives the screen's remount for the same
 * reason a module always does, and the two components that read it subscribe
 * for themselves -- so a collapse re-renders the navigation column and the map
 * screen, which are the two things a collapse changes.
 *
 * Shaped like lib/mapPose.ts and deliberately not shared with it. They hold
 * different things for different reasons, and a `createStore` covering both
 * would be an abstraction over two call sites.
 */
import type { MapToolId } from "@/lib/mapTools"

let selected: MapToolId | null = "classify"
const listeners = new Set<() => void>()

export function selectPanel(next: MapToolId | null): void {
  if (next === selected) return
  selected = next
  for (const fn of listeners) fn()
}

export function subscribePanelSelection(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** The open panel, or null where the column is collapsed. */
export function panelSelection(): MapToolId | null {
  return selected
}
