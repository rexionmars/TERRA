/**
 * Presentation primitives shared by the analysis screen and the energy screen.
 *
 * Extracted so the two surfaces render a figure, a raster tile or a colour ramp
 * the same way. They were private to AnalysisPage, which is why a second screen
 * could not show a result without re-implementing how a result looks.
 */
import type { PaletteName } from "@/lib/palettes"
import { paletteGradient } from "@/lib/palettes"
import type { PowerProvenance } from "@/lib/types"
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
   * The energy status panel carried a private copy of this component that
   * differed from it by two pixels of value type and one of sub type, which is
   * not a difference worth a second definition -- but it is a real one where
   * the figures are chrome above a scrolling reading rather than content
   * inside it.
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
 * A label and its value on one baseline, for a dense run of parameters.
 *
 * One definition. EnergyModelSection and WindScreening each held a private copy
 * of these eight lines, byte-identical and neither importing the other, so any
 * change to the type scale had to be made twice or the two drifted.
 */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    /*
      The label has a floor and the value wraps below it rather than beside it.
      With `truncate` on the label and `shrink-0` on the value, a column under
      about 200px destroyed the label and kept the number: "Degradation rate"
      rendered at a pixel of label next to "0.50% /yr over 25 yr". An
      unlabelled figure is worse than a wrapped one.
    */
    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
      <span className="min-w-[8rem] flex-1 text-meta text-muted-foreground">
        {label}
      </span>
      <span className="telemetry shrink-0 text-body text-foreground">
        {value}
      </span>
    </div>
  )
}

/**
 * The column rhythm a run of `Stat` rows sits in.
 *
 * Keyed rather than free, and measured against the CONTAINER rather than the
 * window. These grids used `sm:`/`lg:`, which read the viewport: on a wide
 * screen a 30rem panel still got the four-column layout its content needs
 * 45rem for, which is how the reading came out both cramped and sparse. Each
 * threshold below is the width at which that many columns of the widest label
 * at that site stop colliding.
 */
const STAT_GRID = {
  default: "@min-[36rem]:grid-cols-2",
  fit: "@min-[40rem]:grid-cols-2",
  pair: "@min-[25rem]:grid-cols-2",
  /* 42.75rem honest, set above both engines' content widths (43.31 on Firefox's
     15px scrollbar, 43.75 on Chromium's 8px) so the two never disagree. It is
     one column in this panel by decision, and restores in a wider host. */
  wide: "@min-[44.5rem]:grid-cols-2",
  three: "@min-[36rem]:grid-cols-2 @min-[42.5rem]:grid-cols-3",
  threeWide: "@min-[31rem]:grid-cols-2 @min-[47rem]:grid-cols-3",
  card: "@min-[26rem]/card:grid-cols-2",
  pr: "@min-[29rem]/pr:grid-cols-2",
} as const

export function StatGrid({
  children,
  at = "default",
}: {
  children: React.ReactNode
  at?: keyof typeof STAT_GRID
}) {
  /* A literal lookup, not interpolation: Tailwind scans source text, so a class
     assembled from a template string is never compiled. */
  return (
    <div className={cn("grid grid-cols-1 gap-x-6 gap-y-1", STAT_GRID[at])}>
      {children}
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
      <div className="flex justify-between text-meta text-muted-foreground">
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
   *
   * The bound reads --reading-h where the host declares one, because 45vh is
   * measured against the window and the tile is not: inside a panel whose
   * scroll viewport is 528px, 45vh reserved 360px and left the class list
   * below it off screen. Hosts that set no --reading-h keep 45vh exactly.
   */
  fullWidth?: boolean
}) {
  const preview = (
    <div
      className={cn(
        "rounded-sm border border-border bg-sunk relative overflow-hidden",
        fullWidth
          ? "h-[min(24rem,calc(var(--reading-h,45vh)*0.4))]"
          : "aspect-[4/3]"
      )}
    >
      {uri ? (
        <img src={uri} alt={title} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full items-center justify-center px-3 text-center text-meta text-muted-foreground">
          {empty}
        </div>
      )}
    </div>
  )

  if (onOpen && uri) {
    return (
      /*
        No ring of its own. `focus-visible:outline-none` cancelled the base
        rule at index.css:351, and the half-strength ring that replaced it is
        the exact defect index.css:206-211 records as fixed: at 0.55 the
        composited indicator fell under the 3.0 WCAG 1.4.11 floor, and it is
        worse again over a translucent panel. This is the only keyboard
        target in the solar sections.
      */
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full flex-col gap-1.5 text-left"
        title={`Open ${title}`}
      >
        {/* The hover was marked less important than the base colour it had to
            override, so it never painted. `.eyebrow` is unlayered and beats
            both, which is why the important belongs on the hover. */}
        <p className="eyebrow group-hover:!text-foreground">{title}</p>
        <div className="transition-opacity group-hover:opacity-90">{preview}</div>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="eyebrow">{title}</p>
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
    /* accentQuiet, not the accent. lib/contrast.ts:122-127 carries the accent
       at 3.0 for fills, rings and active states and says never small text;
       accentQuiet is the accent where it is read rather than filled, and is
       the one checked at 4.5. */
    <span
      className={cn(
        "telemetry shrink-0 rounded-[2px] border px-1 py-px text-micro uppercase tracking-wider",
        tone === "accent" ? "text-accent-quiet" : "text-muted-foreground"
      )}
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
    /*
      Carries its own size and colour. It was authored as the last child of a
      `text-[10px] text-muted-foreground` block, and three of its five call
      sites have since had that wrapper deleted with the prose around it -- so
      the line inherited nothing and rendered at the 16px user-agent default in
      full foreground, the largest and brightest thing in a panel whose next
      step down is 11px. Inheriting a size that no ancestor sets is not a
      default, it is an escape from the scale.
    */
    <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
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
