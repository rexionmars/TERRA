/**
 * Presentation primitives shared by the surfaces that show a result.
 *
 * Extracted so every surface renders a figure or a colour stop the same way.
 * They were private to AnalysisPage, which is why a second screen could not
 * show a result without re-implementing how a result looks.
 */
import { cn } from "@/lib/utils"

/** A label, the figure it names, and the assumption the figure was read under. */
export function WaterFigure({
  label,
  value,
  sub,
  dense = false,
}: {
  label: string
  value: string
  sub?: string
  /**
   * One step down on the value and the sub.
   *
   * A status panel once carried a private copy of this component that differed
   * from it by two pixels of value type and one of sub type, which is not a
   * difference worth a second definition -- but it is a real one where the
   * figures are chrome above a scrolling reading rather than content inside
   * it.
   */
  dense?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="eyebrow !text-micro">{label}</div>
      <div
        className={cn(
          "telemetry mt-0.5 truncate text-foreground",
          dense ? "text-emphasis" : "text-heading"
        )}
      >
        {value}
      </div>
      {sub && (
        <div
          className={cn(
            "telemetry truncate text-muted-foreground",
            dense ? "text-micro" : "text-meta"
          )}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

/**
 * Position on a palette ramp by nearest stop.
 *
 * The stops are the ones the renderer itself uses, so a swatch drawn here is a
 * colour sidecar/composite.py defines. Interpolating between them would put a
 * colour on screen that no palette file contains.
 */
export function rampStop(stops: string[], t: number): string {
  if (!Number.isFinite(t)) return stops[0]
  const clamped = Math.min(1, Math.max(0, t))
  return stops[Math.round(clamped * (stops.length - 1))]
}

/**
 * Where a status panel's left edge sits, which decides what it is centred in.
 *
 * The four panels are all `right-16 mx-auto` with a capped width, so the left
 * inset is the whole of the horizontal placement. Two cases, and they are not
 * the same rule:
 *
 * - The docked layout clears the 19rem column plus its gutters, which centres
 *   the panel in the map's free width. Centred on the window it would sit half
 *   under the column.
 * - The dock layout has no column, so the inset matches the right one and the
 *   panel centres on the window itself. `right-16` is there to clear Leaflet's
 *   zoom stack, and only a matching left inset makes mx-auto find the true
 *   centre rather than a point 2rem left of it.
 */
export function statusPanelInset(dock: boolean): string {
  return dock ? "left-16" : "left-[23.5rem]"
}
