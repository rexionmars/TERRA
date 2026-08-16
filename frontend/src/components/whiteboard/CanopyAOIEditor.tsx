/**
 * What canopy an AOI's own index series implies.
 *
 * WHAT IS DIFFERENT ABOUT THIS EDITOR. Every other canopy surface takes its
 * subject from the reader: a species, an age, a sowing. This one takes the
 * ground. The vegetation-index series a run already measured is the only input
 * here that was observed rather than chosen, and everything on screen is either
 * derived from it or a statement about how far it can be trusted.
 *
 * THE SOWING STAYS THE READER'S, and that is not a gap to be closed. A satellite
 * at 10 m cannot see row spacing, and the unobservable half is the half that
 * moves the light: at matched LAI, measured in this repository's own studies, an
 * ellipsoid crown overstates absorbed light by 37% and a row slab by 60%, with a
 * clumping index of 0.40 to 0.56 behind the spread. So this editor does not
 * claim to reconstruct a field's canopy. It shows what the observation pins
 * down, what it leaves open, and what the difference costs.
 *
 * THREE PANES OF THE CANOPY EDITOR, not an editor of its own -- which is what
 * this was first, and the separation read as arbitrary because it is: a stand
 * the reader specifies and a stand an AOI implies share a species and a sowing
 * and answer the same question from two directions. One editor with four panes
 * says that; two editors said they were different subjects.
 *
 * They are panes and not one scrolling body for the reason the outliner has
 * three: the season is a curve, the light is a grid of scalars, the two ages
 * are a second curve on a different axis. Stacked, each gets a third of the
 * height and none can be read.
 *
 * WHERE THE CONTROLS ARE, AND WHY NONE OF THEM ARE HERE. This file draws the
 * readings. It holds no state, makes no request and offers no control.
 *
 * Which analysed area is read, and the species and sowing that turn its index
 * series into a canopy, belong to the simulation workflow rather than to a
 * panel of it: `canopyWorkflow` holds them for the whole board and
 * `CanopyRunBar` sets them, which is what the run band does for an area, a
 * period and a model. They were here once, in a control row of this file's own
 * under a second row belonging to the editor around it -- two rows of chrome in
 * one area, one of them a duplicate of the other, and a third and fourth copy
 * as soon as a second canopy area was opened.
 */
import { useMemo } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { WaterFigure } from "@/components/analysisPrimitives"
import {
  dateToMs,
  timeAxisProps,
  timeLabelFormatter,
  timeTickFormatter,
} from "@/lib/chartAxis"
import { isZeroExtent } from "@/lib/mapLayers"
import type { Bounds } from "@/lib/types"

/** Which of the three questions the area is showing. */
export type CanopyAOIMode = "season" | "light" | "ages"

/*
  The payload, typed locally and structurally.

  Written against the reply rather than imported from the generated bindings,
  because the generated classes carry every optional as `any` and the absences
  are the point: an age that does not exist past the plateau, a light block that
  is missing when no location was given. A local type makes those checkable.
*/
export interface AOIAgeCheck {
  comparable: boolean
  progress_helios?: number
  progress_field?: number
  delta_progress?: number
  agrees?: boolean
  why?: string
}

export interface AOIResolved {
  date: string
  lai: number
  state?: string
  day?: number
  day_at_least?: number
  height_m?: number
  at_plateau?: boolean
  declining?: boolean
  days_since_greenup?: number
  age_check: AOIAgeCheck
  why?: string
  error?: string
}

export interface AOILight {
  date?: string
  day?: number
  lai: number
  fapar: number
  beam_transmittance: number
  diffuse_transmittance?: number
  diffuse_share: number
  k_emergent?: number
  fapar_fixed_k?: number
  fixed_k?: number
  fixed_k_error_pct?: number
  beam_bins_marched?: number
  row_azimuth_deg?: number
  /**
   * The fraction of the module's ground with leaf above it.
   *
   * The one geometric number that tracks the answer: measured at fixed LAI,
   * sweeping the canopy's horizontal extent moves faPAR from 0.19 to 0.88 and
   * faPAR follows cover almost proportionally, while sweeping its HEIGHT over a
   * factor of 2.4 moves it 0.020.
   */
  cover?: number
  seed?: number
  /** The spread across the plants that were drawn. */
  ensemble?: {
    n: number
    fapar_min: number
    fapar_max: number
    fapar_spread: number
    cover_min: number
    cover_max: number
    seeds: number[]
  }
  error?: string
}

export interface AOICanopy {
  species: string
  density: number
  reachable_lai: number
  lai: {
    lai: number[]
    ndvi: number[]
    peak_lai: number
    n: number
    n_saturated: number
    saturation_lai: number
  }
  states: string[]
  phenology: Record<string, number>
  resolved: AOIResolved[]
  n_usable: number
  sun: {
    source: string
    cell?: number[]
    years?: number
    diffuse_share?: number
    /**
     * The beam-energy-weighted mean direction of the sun over the window read.
     *
     * NOT solar noon, and it must not be captioned as such: it leans toward the
     * hours that carried the energy. It is, though, the one direction that
     * represents what the march integrated, so a scene lit from it is lit by
     * the same sun the faPAR beside it came from.
     *
     * Azimuth is a compass bearing, clockwise from north. A viewer in the
     * stand's own frame has to convert -- `sceneAzimuthFromCompass` in
     * standScene does it, mirroring the sidecar's `_canopy_azimuth`.
     */
    direction?: {
      azimuth_deg: number
      elevation_deg: number
      /** Near 1 the beam came from one place; low means one direction is a
       *  poor summary of where the energy actually arrived from. */
      concentration: number
    }
    /** Global over clear-sky across the window: 1 is cloudless. */
    clearness?: number
    /** Half-width in days of the day-of-year window, and its centre. Absent
     *  when the whole record answered because no date resolved to an age. */
    window_days?: number
    window_centre?: string
    n_hours?: number
    /** One real day of the window, hour by hour. Hours are UTC. */
    track_date?: string
    track?: Array<{
      hour_utc: number
      azimuth_deg: number
      elevation_deg: number
      dni: number
      dhi: number
      ghi: number
      /**
       * Already divided and already clamped to [0, 1] by the sidecar.
       *
       * Use this rather than dividing dhi by ghi: that ratio is not bounded by
       * 1 in the POWER record -- it reaches 1.531 on this project's cell, at
       * grazing elevations where POWER's own components do not close -- and a
       * caption computed from it would read "120% diffuse".
       */
      diffuse_share?: number
      clearness?: number
    }>
    why?: string
  }
  light?: AOILight
}

export interface CanopyRun {
  id: string
  label: string
  // Nullable and not merely optional, because that is what the generated
  // binding carries: a run whose acquisitions yielded no index series has
  // `vi_series: null`.
  result: {
    vi_series?: Array<{ date: string; ndvi_mean: number }> | null
    /**
     * The same dates averaged over CROP PIXELS ONLY, which is the series a
     * canopy should be built from when the AOI has one.
     *
     * An area mean over mixed cover is not the crop's index. On the soybean AOI
     * this was built against the peak reads 0.314 as an area mean with a
     * standard deviation of 0.190, which for a roughly even two-population mix
     * puts the crop pixels near 0.50 and everything else near 0.12 -- so a leaf
     * area inverted from the AOI-wide mean is an average of canopy and bare
     * ground.
     *
     * Empty when the AOI carries no cropland, which is a statement and not a
     * failure; the AOI-wide series then answers. The two may differ in length,
     * since a date whose crop pixels were entirely cloud-obscured leaves this
     * one and stays in the other, so they must be read by date and never
     * zipped by index.
     */
    vi_series_crop?: Array<{ date: string; ndvi_mean: number }> | null
    /**
     * The classification's per-class shares, which is how the simulation learns
     * what grows here instead of taking whatever the species picker holds.
     */
    class_stats?: Array<{ class_id: number; name: string; pct: number }> | null
    /**
     * The AOI's own box, which is the whole of what the light pane needs.
     *
     * Without a location the sidecar lights nothing at all -- it says
     * `sun: reference` and omits the light block -- so a pane that was drawn
     * but could never be reached was the state this field ends.
     */
    extent?: Bounds
  }
}

/**
 * The fewest observations the phenology smoother can label a season from.
 *
 * A shorter run is not offered rather than offered and refused: the sidecar
 * states the same bound and would answer with it, but a picker that lists a
 * choice which cannot be taken teaches the reader nothing.
 */
export const MIN_AOI_OBSERVATIONS = 3

export function readableCanopyRuns(
  runs?: readonly CanopyRun[]
): readonly CanopyRun[] {
  return (runs ?? []).filter(
    (r) => (r.result?.vi_series?.length ?? 0) >= MIN_AOI_OBSERVATIONS
  )
}

/**
 * The centre of the AOI, which is the point the solar record is asked about.
 *
 * A box rather than a point because that is what a run carries, and POWER
 * resolves to a 1-degree cell anyway -- an AOI far smaller than the cell lands
 * in the same one wherever inside it the point is taken.
 *
 * `isZeroExtent` guards the case its own docblock names: the sidecar returns a
 * zero box when it resolved no window, and its centre is the null island.
 */
export function canopyAOICentre(
  run: CanopyRun | null | undefined
): { lat: number; lon: number } | null {
  const e = run?.result?.extent
  if (isZeroExtent(e)) return null
  const b = e as Bounds
  return {
    lat: (b.lat_min + b.lat_max) / 2,
    lon: (b.lon_min + b.lon_max) / 2,
  }
}

const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`

/**
 * The three readings, given a canopy the workflow already read.
 *
 * No state and no fetch: `canopyWorkflow` holds both, so one read fills every
 * Season, Light and Ages panel on the board at once, and a look at the stand
 * and back does not throw it away.
 */
export function CanopyAOIPanes({
  mode,
  data,
  busy,
  error,
  source,
  stale,
  hasBand,
}: {
  mode: CanopyAOIMode
  data: AOICanopy | null
  busy: boolean
  error: string | null
  /** What the band names, which is what the empty states talk about. */
  source: CanopyRun | null
  /** Whether the reading was made with a species or sowing since changed. */
  stale: boolean
  /** Whether the arrangement holds the band the empty states send them to. */
  hasBand: boolean
}) {
  return (
    <div className="h-full min-h-0 w-full overflow-auto">
      {error ? (
        <div
          className="m-2 flex items-start gap-2 rounded px-2 py-1.5 text-[11px]"
          style={{ background: "var(--p-surface-raised)", color: "var(--p-text)" }}
        >
          <AlertTriangle
            className="mt-px h-3 w-3 shrink-0"
            style={{ color: "var(--p-warning)" }}
          />
          <span className="leading-snug">{error}</span>
        </div>
      ) : null}

      {busy && !data ? (
        <Empty>
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Reading {source?.label ?? "the area"} as a canopy.
          </span>
        </Empty>
      ) : !data ? (
        <Empty>
          {!hasBand
            ? "The area read here is chosen in a Canopy run band, and this arrangement has none. Retype an area to it from its header, or open the Simulation workspace."
            : source
              ? `Press Read area in the canopy band. ${source.label}'s index series is read as a canopy at the species and sowing set there.`
              : "Choose an analysed area in the canopy band. Its index series is the only input here that was observed rather than chosen."}
        </Empty>
      ) : (
        <>
          {stale ? (
            <Note>
              These figures were read with {data.species} at{" "}
              {(1 / data.density).toFixed(2)} m² per plant. The species or the
              sowing in the band has changed since; read the area again to
              answer for it.
            </Note>
          ) : null}
          {mode === "light" ? (
            <LightPane data={data} />
          ) : mode === "ages" ? (
            <AgesPane data={data} />
          ) : (
            <SeasonPane data={data} />
          )}
        </>
      )}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex h-full items-center justify-center p-4 text-center text-[11px]"
      style={{ color: "var(--p-text-muted)" }}
    >
      <span className="max-w-[26rem] leading-relaxed">{children}</span>
    </div>
  )
}

/*
  The two warnings that decide whether the rest is worth reading, and so are
  stated above it rather than under it. A saturated series is extrapolation, and
  a season the ladder runs ahead of is a sowing whose plants compete in a way
  Helios does not model.
*/
function Caveats({ data }: { data: AOICanopy }) {
  const comparable = data.resolved.filter((r) => r.age_check.comparable).length
  const disagreeing = data.resolved.filter(
    (r) => r.age_check.comparable && r.age_check.agrees === false
  ).length
  return (
    <>
      {data.lai.n_saturated > 0 && (
        <Note>
          {data.lai.n_saturated} of {data.lai.n} observations sit above LAI{" "}
          {data.lai.saturation_lai}, where NDVI barely moves and the inversion is
          extrapolation.
        </Note>
      )}
      {comparable > 0 && disagreeing > comparable / 2 && (
        <Note>
          The two ages disagree on {disagreeing} of {comparable} comparable
          dates. Helios grows a plant with no neighbours, so in a dense sowing it
          reaches a given leaf area too early: the geometry carries the right
          leaf area with the architecture of a younger plant.
        </Note>
      )}
    </>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-1 text-[11px]" style={{ color: "var(--p-warning)" }}>
      {children}
    </div>
  )
}

function SeasonPane({ data }: { data: AOICanopy }) {
  const rows = useMemo(
    () => data.resolved.map((r) => ({ t: dateToMs(r.date), lai: r.lai })),
    [data.resolved]
  )
  const span = rows.length ? rows[rows.length - 1].t - rows[0].t : 0

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <WaterFigure label="Peak LAI" value={data.lai.peak_lai.toFixed(2)}
                     sub={`${data.lai.n} observations`} />
        <WaterFigure label="Readable as canopy"
                     value={`${data.n_usable} / ${data.resolved.length}`}
                     sub="dates with a resolved age" />
        <WaterFigure label="Reachable LAI" value={data.reachable_lai.toFixed(2)}
                     sub={`${data.species} at ${data.density.toFixed(1)} pl/m²`} />
        <WaterFigure label="Sun"
                     value={data.sun.source === "power" ? "NASA POWER" : "reference"}
                     sub={data.sun.source === "power"
                       ? `diffuse ${((data.sun.diffuse_share ?? 0) * 100).toFixed(0)}%`
                       : (data.sun.why ?? "the area resolved no window")} />
      </div>
      <Caveats data={data} />
      <div className="h-40 min-h-[9rem] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
            <XAxis {...timeAxisProps} dataKey="t"
                   tickFormatter={timeTickFormatter(span)}
                   tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                   stroke="var(--border)" />
            <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                   stroke="var(--border)" width={34}
                   label={{ value: "LAI (m² m⁻²)", angle: -90,
                            position: "insideLeft",
                            style: { fill: "var(--muted-foreground)", fontSize: 10 } }} />
            <Tooltip contentStyle={{ background: "var(--popover)",
                                     border: "1px solid var(--border)", fontSize: 11 }}
                     labelFormatter={timeLabelFormatter} />
            <Legend verticalAlign="top" align="right" iconType="plainline"
                    wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="lai" name="Observed LAI"
                  stroke="var(--series-ndvi)" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function LightPane({ data }: { data: AOICanopy }) {
  const light = data.light
  if (!light) {
    return (
      <Empty>
        {/*
          Two different absences, and a reader can act on only one of them.
          A run whose window never resolved carries a zero box and no location
          can be taken from it; a POWER request that failed says why it did.
        */}
        No canopy was lit
        {data.sun.why ? `: ${data.sun.why}` : ", because this area resolved no window and the sun record is asked for by location."}
      </Empty>
    )
  }
  if (light.error) {
    return <Empty>The canopy could not be lit: {light.error}</Empty>
  }
  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <WaterFigure label="faPAR under the real sun" value={light.fapar.toFixed(3)}
                     sub={light.date ? `on ${light.date}` : undefined} />
        <WaterFigure label="Emergent k"
                     value={light.k_emergent?.toFixed(3) ?? "—"}
                     sub={`crop model uses ${light.fixed_k ?? 0.7} fixed`} />
        {/*
          The number a crop-model reader has a question about: not a second
          faPAR beside the first, but how far the constant coefficient lands
          from what this canopy actually intercepted.
        */}
        <WaterFigure label="Fixed-k error"
                     value={light.fixed_k_error_pct != null
                       ? signed(light.fixed_k_error_pct) : "—"}
                     sub={light.fapar_fixed_k != null
                       ? `Beer would give ${light.fapar_fixed_k.toFixed(3)}` : undefined} />
        <WaterFigure label="LAI lit" value={light.lai.toFixed(2)}
                     sub={light.day != null ? `Helios day ${light.day.toFixed(0)}` : undefined} />
        <WaterFigure label="Diffuse share"
                     value={`${(light.diffuse_share * 100).toFixed(0)}%`}
                     sub={light.diffuse_transmittance != null
                       ? `τ ${light.diffuse_transmittance.toFixed(3)}` : undefined} />
        <WaterFigure label="Beam directions"
                     value={String(light.beam_bins_marched ?? 0)}
                     sub={`τ ${light.beam_transmittance.toFixed(3)}`} />
      </div>
      {data.sun.cell ? (
        <p className="px-1 text-[10px]" style={{ color: "var(--p-text-muted)" }}>
          NASA POWER cell {data.sun.cell[0].toFixed(1)}, {data.sun.cell[1].toFixed(1)}
          {data.sun.years ? ` over ${data.sun.years} years` : ""}. The record is
          a 1-degree cell, so an AOI smaller than that is lit by its region's
          sun rather than its own.
        </p>
      ) : null}
    </div>
  )
}

/*
  The two clocks, drawn as progress and not as days.

  They run at different rates -- Helios sorghum saturates at day 40 while a field
  season takes near a hundred to peak -- so subtracting one from the other mixes
  the rate difference with the competition it is meant to detect. As fractions of
  their own cycle the rate cancels and what is left is the shape.
*/
function AgesPane({ data }: { data: AOICanopy }) {
  const rows = useMemo(
    () =>
      data.resolved
        .filter((r) => r.age_check.comparable)
        .map((r) => ({
          t: dateToMs(r.date),
          helios: r.age_check.progress_helios,
          field: r.age_check.progress_field,
        })),
    [data.resolved]
  )
  if (!rows.length) {
    return (
      <Empty>
        No date in this season carries both ages. Before green-up there is no
        canopy, and past the peak the ladder only grows while the field is
        shedding, so the two stop measuring the same thing.
      </Empty>
    )
  }
  const span = rows[rows.length - 1].t - rows[0].t
  return (
    <div className="flex flex-col gap-2 p-2">
      <Caveats data={data} />
      <div className="h-44 min-h-[10rem] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
            <XAxis {...timeAxisProps} dataKey="t"
                   tickFormatter={timeTickFormatter(span)}
                   tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                   stroke="var(--border)" />
            <YAxis domain={[0, 1]}
                   tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                   stroke="var(--border)" width={34}
                   label={{ value: "cycle completed", angle: -90,
                            position: "insideLeft",
                            style: { fill: "var(--muted-foreground)", fontSize: 10 } }} />
            <Tooltip contentStyle={{ background: "var(--popover)",
                                     border: "1px solid var(--border)", fontSize: 11 }}
                     labelFormatter={timeLabelFormatter} />
            <Legend verticalAlign="top" align="right" iconType="plainline"
                    wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="helios" name="from leaf area"
                  stroke="var(--series-evi)" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="field" name="from phenology"
                  stroke="var(--series-ndvi)" strokeDasharray="4 3" dot={false}
                  isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
