/**
 * The surface, as a subject rather than as an input.
 *
 * Copernicus GLO-30 is already read twice in this application -- solar.py for
 * horizons, dem.py for the flood envelope -- and in neither is it shown. Every
 * terrain figure here rests on ground the reader cannot look at.
 *
 * A LAYER AND A CONTROL, NOT A PRODUCT. It is not in MAP_TOOLS and does not
 * record a run, and both of those are deliberate. mapTools.ts warns what a
 * fourth tool id costs -- the board band, a method brief and a run resolution
 * whose final branch is classification -- and none of that would be earned
 * here: GLO-30 is one static raster, reproducible from the polygon alone, with
 * no period to select and no result to compare against another. A run row would
 * record nothing the request does not already say.
 *
 * IT IS A SURFACE MODEL AND THE PANEL SAYS SO. GLO-30 is TanDEM-X: it measures
 * the first reflective surface, so closed forest reports canopy top and built
 * ground reports roofs. That is inherited by everything downstream -- HAND over
 * a DSM in forest carries canopy height into the height above drainage -- and
 * this is the first place in the interface a reader meets it.
 */
import { Loader2, TriangleAlert } from "lucide-react"

import { paletteColor } from "@/lib/palettes"
import type { GeoJSONGeometry } from "@/lib/types"
import { cn } from "@/lib/utils"

/** The reading, as the panel and the layer both need it. */
export interface SurfaceReading {
  model_kind: string
  source: string
  native_resolution_m: number
  floor_m: number
  ceiling_m: number
  relief_m: number
  mean_m: number
  value_full_scale: number
  measured_cells: number
  void_cells: number
  notes: string[]
  values_uri?: string
  extent: { lon_min: number; lat_min: number; lon_max: number; lat_max: number }
}

export type SurfaceState =
  | { at: "idle" }
  | { at: "reading" }
  | { at: "read"; reading: SurfaceReading }
  | { at: "failed"; reason: string }

/**
 * The hypsometric ramp, as `color-relief-color` takes one.
 *
 * `viridis` rather than a green-to-brown atlas ramp. An atlas ramp is a
 * convention about land cover -- green for lowland, brown for upland -- and
 * this is a height above the window's own floor, which says nothing about
 * cover. Viridis is perceptually uniform, so equal heights read as equal steps
 * and a slope does not appear to change gradient where the colours happen to
 * separate.
 *
 * An interpolation and not a step: elevation is continuous, and terracing it
 * would state a boundary the measurement does not have. `discretePalette` is
 * for the counts and classes that do.
 */
export function hypsometricRamp(fullScale: number): unknown[] {
  const out: unknown[] = ["interpolate", ["linear"], ["elevation"]]
  const steps = 12
  for (let i = 0; i <= steps; i++) {
    out.push((i / steps) * fullScale, paletteColor("viridis", i / steps))
  }
  return out
}

/** A decoded value back into metres. The three figures are all needed. */
export function metresFor(reading: SurfaceReading, value: number): number {
  return reading.floor_m + (value * reading.relief_m) / reading.value_full_scale
}

/**
 * What the surface says about this window, beside the ramp that draws it.
 *
 * The void count is reported rather than dropped: a window that is half void
 * has a mean describing half a place, and a figure whose coverage is unstated
 * invites the reader to attribute it to the whole polygon.
 */
export function ElevationPanel({
  state,
  onRead,
  canRead,
  className,
}: {
  state: SurfaceState
  onRead: () => void
  /** False with no area drawn: there is nothing to read the surface over. */
  canRead: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "panel app-no-drag w-[17rem] rounded-md p-3 text-body",
        className
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Elevation</h2>
        {state.at === "read" && (
          <span className="telemetry text-[10px] text-muted-foreground">
            {state.reading.model_kind}
          </span>
        )}
      </div>

      {state.at === "idle" && (
        <>
          <p className="mt-1 text-meta text-muted-foreground">
            {canRead
              ? "Reads the Copernicus surface over the area on the map."
              : "Draw an area first: the surface is read over the polygon."}
          </p>
          <button
            type="button"
            disabled={!canRead}
            onClick={onRead}
            className={cn(
              "mt-2 w-full rounded-sm px-2 py-1.5 text-meta transition-colors",
              canRead
                ? "bg-accent text-accent-foreground hover:opacity-90"
                : "cursor-not-allowed bg-surface-raised/40 text-muted-foreground"
            )}
          >
            Read the surface
          </button>
        </>
      )}

      {state.at === "reading" && (
        <p className="mt-2 flex items-center gap-2 text-meta text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin text-accent" strokeWidth={2} />
          Fetching Copernicus GLO-30
        </p>
      )}

      {state.at === "failed" && (
        <p className="mt-2 flex items-start gap-2 text-meta text-muted-foreground">
          <TriangleAlert
            className="mt-0.5 size-3.5 shrink-0 text-destructive-quiet"
            strokeWidth={1.5}
          />
          <span className="break-words">{state.reason}</span>
        </p>
      )}

      {state.at === "read" && <Reading reading={state.reading} onRead={onRead} />}
    </div>
  )
}

function Reading({
  reading,
  onRead,
}: {
  reading: SurfaceReading
  onRead: () => void
}) {
  const total = reading.measured_cells + reading.void_cells
  const voidPct = total > 0 ? (reading.void_cells / total) * 100 : 0
  return (
    <>
      {/*
        The ramp itself, labelled at its ends in metres. A legend for a
        continuous field is the scale, not a list: the reader needs to know what
        the top and bottom of the colour range are, and everything between is
        read off the ramp.
      */}
      <div
        className="mt-2 h-2 w-full rounded-[2px]"
        style={{
          background: `linear-gradient(to right, ${Array.from(
            { length: 13 },
            (_, i) => paletteColor("viridis", i / 12)
          ).join(", ")})`,
        }}
        aria-hidden
      />
      <div className="telemetry mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span className="tabular-nums">{reading.floor_m.toFixed(0)} m</span>
        <span className="tabular-nums">{reading.ceiling_m.toFixed(0)} m</span>
      </div>

      <dl className="mt-2 space-y-1 text-meta">
        <Row label="Relief" value={`${reading.relief_m.toFixed(0)} m`} />
        <Row label="Mean" value={`${reading.mean_m.toFixed(0)} m`} />
        <Row label="Cell" value={`${reading.native_resolution_m.toFixed(0)} m`} />
        <Row
          label="Void"
          value={
            reading.void_cells === 0
              ? "none"
              : `${voidPct.toFixed(1)}% of the window`
          }
        />
      </dl>

      {/*
        Carried from the sidecar rather than written here, so the statement and
        the computation cannot drift apart.
      */}
      {reading.notes.map((note) => (
        <p key={note} className="mt-2 text-meta text-muted-foreground">
          {note}
        </p>
      ))}

      <p className="telemetry mt-2 text-[10px] text-muted-foreground">
        {reading.source}
      </p>
      <button
        type="button"
        onClick={onRead}
        className="mt-2 w-full rounded-sm px-2 py-1 text-meta text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
      >
        Read again
      </button>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
