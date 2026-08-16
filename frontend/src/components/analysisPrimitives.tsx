/**
 * Presentation primitives shared by the analysis screen and the energy screen.
 *
 * Extracted so the two surfaces render a figure, a raster tile or a colour ramp
 * the same way. They were private to AnalysisPage, which is why a second screen
 * could not show a result without re-implementing how a result looks.
 */
import type { PaletteName } from "@/lib/palettes"
import { PALETTE_STOPS, paletteGradient } from "@/lib/palettes"
import type { PowerProvenance } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Display name for a model_kind enum. Shared so the run list and the detail
 * header cannot disagree; the list previously printed the raw enum.
 */
export function WaterFigure({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="min-w-0">
      <div className="eyebrow !text-[9px]">{label}</div>
      <div className="telemetry mt-0.5 truncate text-sm text-foreground">
        {value}
      </div>
      {sub && (
        <div className="telemetry truncate text-[10px] text-muted-foreground">
          {sub}
        </div>
      )}
    </div>
  )
}

/**
 * Colour ramp for a continuous raster, labelled with the domain endpoints.
 *
 * The caller passes the endpoints of the scale the raster was DRAWN on, not the
 * layer's own range. For a seasonal layer the two differ: the domain spans both
 * seasons, so a ramp labelled from this layer's own minimum and maximum would
 * assert a contrast the image does not carry.
 */
export function ContinuousRamp({
  palette,
  lowLabel,
  highLabel,
}: {
  palette: PaletteName
  lowLabel: string
  highLabel: string
}) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      <div
        className="h-2 w-full rounded-full"
        style={{ background: paletteGradient(palette) }}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  )
}

export function PanelTile({
  title,
  uri,
  empty,
  onOpen,
  fullWidth = false,
}: {
  title: string
  uri: string | undefined
  empty: string
  onOpen?: () => void
  /**
   * Set when the tile is not in a grid column.
   *
   * The preview is 4:3 of whatever width it is given, which is right in a
   * five-column grid and wrong across a whole panel: on a wide window the
   * water-occurrence tile came out around 1400 px tall, past the bottom of the
   * screen and past the height of a screenshot. Bounding the height instead
   * lets object-contain letterbox the raster, so the figure stays whole and
   * stays on screen.
   */
  fullWidth?: boolean
}) {
  const preview = (
    <div
      className={cn(
        "rounded-sm border border-border bg-background relative overflow-hidden",
        fullWidth ? "h-[min(24rem,45vh)]" : "aspect-[4/3]"
      )}
    >
      {uri ? (
        <img src={uri} alt={title} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full items-center justify-center px-3 text-center text-[10px] text-muted-foreground">
          {empty}
        </div>
      )}
    </div>
  )

  if (onOpen && uri) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full flex-col gap-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
        title={`Open ${title}`}
      >
        <p className="eyebrow !text-muted-foreground group-hover:text-foreground">
          {title}
        </p>
        <div className="transition-opacity group-hover:opacity-90">{preview}</div>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="eyebrow !text-muted-foreground">{title}</p>
      {preview}
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

/** Small caps tag for a row's kind or standing. */
export function Chip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode
  tone?: "muted" | "accent"
}) {
  return (
    <span
      className={cn(
        "telemetry shrink-0 rounded-[2px] border px-1 py-px text-[9px] uppercase tracking-wider",
        tone === "accent" ? "text-primary" : "text-muted-foreground"
      )}
      style={{ borderColor: "var(--border)" }}
    >
      {children}
    </span>
  )
}

/**
 * Which NASA POWER series the figures were read from, and when.
 *
 * POWER reprocesses historical data and the on-disk cache has no expiry, so a
 * run can be built on a superseded revision of the record. That is acceptable
 * only while the run says so: without this line a cached run and a fetched one
 * are indistinguishable on screen.
 */
export function PowerProvenanceNote({
  provenance,
}: {
  provenance?: PowerProvenance | null
}) {
  if (!provenance) return null
  const series = [
    ["Daily", provenance.daily],
    ["Hourly", provenance.hourly],
  ] as const
  const present = series.filter(([, s]) => !!s)
  if (!present.length) return null
  return (
    <p className="mt-1">
      {present.map(([label, s], i) => (
        <span key={label}>
          {i > 0 ? " " : ""}
          {label} series{" "}
          {s!.source === "cache"
            ? `read from cache${s!.fetched_utc ? `, fetched ${s!.fetched_utc}` : ", fetch date not recorded"}`
            : "fetched during this run"}
          .
        </span>
      ))}
    </p>
  )
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
