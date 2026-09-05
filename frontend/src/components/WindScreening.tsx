/**
 * The wind screening, as shown on screen.
 *
 * Exported as PAGES rather than as one section. The six blocks below were one
 * column several thousand pixels tall, read through a viewport holding a
 * fraction of it; each was already authored as a block with its own heading, so
 * `windScreeningSections` at the foot of this file states what the markup already
 * implied. Nothing measured changed.
 *
 * STATISTICS, NOT PROSE. This block used to carry nineteen explanatory passages
 * from the payload -- method, convention, citation, derivation -- several of
 * which restated what the headings already said: a paragraph opening "screening
 * indication, not a resource assessment" sat under a heading reading "Wind
 * screening" beside chips reading "gross" and "unvalidated". The qualifiers
 * that do work are structural and stay: the heading, the chips, and the word
 * Gross in the figure labels.
 *
 * The passages that carried numbers inside sentences -- the Weibull fit check,
 * the air density range, the operating regime -- are still here as figures.
 * Nothing measured was dropped; it stopped being written out longhand.
 */
import type { ReactNode } from "react"
import type { WindAnalysis } from "@/lib/types"
import {
  PowerProvenanceNote,
  Stat,
  StatGrid,
  WaterFigure,
} from "@/components/analysisPrimitives"
import type { ReadingSection } from "@/components/energy/readingSections"
import {
  capacityFactorPct,
  energyMwh,
  speedMs,
} from "@/lib/energyFormat"
import { PALETTE_STOPS } from "@/lib/palettes"

/** What the reanalysis carries at its own levels, with no extrapolation. */
function ReanalysisLevels({ wind }: { wind: WindAnalysis }) {
  const m = wind.measured
  const fit = m.weibull_fit_check_50m
  return (
    <>
      <p className="eyebrow !text-micro mb-2">
        Carried by the reanalysis · no height extrapolation
      </p>
      <div className="grid grid-cols-2 gap-3 @min-[35rem]:grid-cols-4">
        <WaterFigure
          label="Mean speed 10 m"
          value={`${m.mean_speed_10m_ms.toFixed(4)} m/s`}
        />
        <WaterFigure
          label="Mean speed 50 m"
          value={`${m.mean_speed_50m_ms.toFixed(4)} m/s`}
        />
        <WaterFigure
          label="Weibull 50 m"
          value={`k ${m.weibull_k_50m.toFixed(4)}`}
          sub={`c ${m.weibull_c_50m_ms.toFixed(4)} m/s`}
        />
        <WaterFigure
          label="Power density 50 m"
          value={`${m.wind_power_density_50m_w_m2.toFixed(2)} W/m2`}
          sub={`pattern factor ${m.energy_pattern_factor_50m.toFixed(4)}`}
        />
      </div>
      {/* The fit check and the density range, which were a paragraph. */}
      <div className="mt-3">
        <StatGrid at="fit">
          <Stat
            label="Weibull mean vs record"
            value={`${fit.weibull_mean_ms.toFixed(4)} / ${fit.empirical_mean_ms.toFixed(4)} m/s · ${fit.mean_error_pct.toFixed(3)}%`}
          />
          <Stat
            label="Weibull mean cube vs record"
            value={`${fit.weibull_mean_cube_m3s3.toFixed(3)} / ${fit.empirical_mean_cube_m3s3.toFixed(3)} m3/s3 · ${fit.mean_cube_error_pct.toFixed(3)}%`}
          />
          <Stat
            label="Air density mean"
            value={`${m.air_density_mean_kg_m3.toFixed(4)} kg/m3`}
          />
          <Stat
            label="Air density range"
            value={`${m.air_density_min_kg_m3.toFixed(4)} – ${m.air_density_max_kg_m3.toFixed(4)} kg/m3`}
          />
        </StatGrid>
      </div>
    </>
  )
}

/** The hub-height result, and the regime the turbine would operate in. */
function HubResult({ wind }: { wind: WindAnalysis }) {
  const h = wind.hub
  return (
    <>
      <p className="eyebrow !text-micro mb-2">
        At the {wind.hub_height_m.toFixed(0)} m hub · extrapolated
      </p>
      <div className="grid grid-cols-1 gap-3 @min-[30rem]:grid-cols-2 @min-[61rem]:grid-cols-4">
        <WaterFigure
          label="Hub speed"
          value={speedMs(h.mean_speed_ms)}
          sub={`power law α ${wind.assumptions.shear_exponent.toFixed(4)}, ${h.extrapolation.height_ratio.toFixed(1)}× the top level`}
        />
        <WaterFigure
          label="Gross capacity factor"
          value={capacityFactorPct(h.gross_capacity_factor_pct)}
          sub={`${h.gross_capacity_factor_no_density_correction_pct.toFixed(3)}% undensity-corrected`}
        />
        <WaterFigure
          label="Gross annual energy"
          value={energyMwh(h.gross_annual_energy_mwh_per_turbine)}
          sub={`per turbine · ${h.hours_per_year.toFixed(0)} h/yr`}
        />
        <WaterFigure
          label="Power density"
          value={`${h.wind_power_density_w_m2.toFixed(2)} W/m2`}
          sub={`k ${h.weibull_k.toFixed(4)}, c ${h.weibull_c_ms.toFixed(4)} m/s`}
        />
      </div>
      {/* The operating regime, which was a sentence. */}
      <div className="mt-3">
        <StatGrid at="three">
          <Stat
            label="Hours above cut-in"
            value={`${h.operating_regime.above_cut_in_pct.toFixed(3)}%`}
          />
          <Stat
            label="Hours at or above rated"
            value={`${h.operating_regime.at_or_above_rated_pct.toFixed(3)}%`}
          />
          <Stat
            label="Hours above cut-out"
            value={`${h.operating_regime.above_cut_out_pct.toFixed(3)}%`}
          />
          <Stat
            label="Cut-in / rated / cut-out"
            value={`${h.operating_regime.cut_in_ms.toFixed(1)} / ${h.operating_regime.rated_ms.toFixed(4)} / ${h.operating_regime.cut_out_ms.toFixed(1)} m/s`}
          />
        </StatGrid>
      </div>
    </>
  )
}

/** Whether the record supports the extrapolation the hub figures rest on. */
function FieldDiagnostics({ wind }: { wind: WindAnalysis }) {
  const q = wind.data_quality
  const shear = q.shear
  return (
    <>
      <p className="eyebrow !text-micro mb-2">Field diagnostics</p>
      <div className="grid grid-cols-1 gap-3 @min-[28rem]:grid-cols-2 @min-[56rem]:grid-cols-4">
        <WaterFigure
          label={`Hours below ${q.calm_threshold_ms} m/s`}
          value={`${(q.calm_fraction_pct["10m"] ?? 0).toFixed(3)}%`}
          sub={`50 m ${(q.calm_fraction_pct["50m"] ?? 0).toFixed(3)}%, 2 m ${(q.calm_fraction_pct["2m"] ?? 0).toFixed(3)}%`}
        />
        <WaterFigure
          label="Record maximum 10 m"
          value={`${(q.record_maximum_ms["10m"] ?? 0).toFixed(2)} m/s`}
          sub={`floor ${q.record_maximum_floor_ms.toFixed(1)} m/s · ${q.record_maximum_plausible ? "met" : "not met"}`}
        />
        <WaterFigure
          label="Shear exponent"
          value={shear.shear_exponent.toFixed(4)}
          sub={`day ${shear.shear_exponent_day.toFixed(4)}, night ${shear.shear_exponent_night.toFixed(4)}`}
        />
        {/* Null when the exponent lies outside what a neutral logarithmic
            profile between 10 m and 50 m can produce for any roughness
            length. Rendered as a number it printed "0.000 m", a physically
            meaningful-looking roughness that was never computed. */}
        <WaterFigure
          label="Implied roughness"
          value={
            shear.implied_roughness_length_m == null
              ? "—"
              : `${shear.implied_roughness_length_m.toFixed(3)} m`
          }
          sub={
            shear.implied_roughness_length_m == null
              ? `no inversion; assumed ${shear.assumed_roughness_band_m.join("–")} m`
              : `assumed ${shear.assumed_roughness_band_m.join("–")} m · ${shear.consistent_with_assumed_cover ? "consistent" : "not consistent"}`
          }
        />
      </div>
      {/*
        The checks as a count. Each flag was a multi-sentence string that
        restated a number already above it; the outcome is what the reader
        acts on, and every input to it is a figure in this block.
      */}
      <div className="mt-3">
        <StatGrid at="threeWide">
          <Stat
            label="Record checks"
            value={
              q.all_checks_passed
                ? "all passed"
                : `${q.flags.length} not passed`
            }
          />
          <Stat
            label="Record hours"
            value={`${q.record_hours} / ${q.expected_hours} expected`}
          />
          <Stat
            label="Shear band supported"
            value={shear.expected_shear_exponent_band
              .map((v) => v.toFixed(3))
              .join(" – ")}
          />
        </StatGrid>
      </div>
    </>
  )
}

/** How far the hub result moves with the exponent it was extrapolated on. */
function ShearSensitivity({ wind }: { wind: WindAnalysis }) {
  return (
    <>
      <p className="eyebrow !text-micro mb-2">
        Hub result across the shear exponent
      </p>
      <ul className="flex flex-col gap-1">
        {wind.shear_sensitivity.map((s) => (
          <li
            key={`${s.basis}-${s.shear_exponent}`}
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <span className="telemetry w-16 shrink-0 text-body text-foreground">
              {s.shear_exponent.toFixed(4)}
            </span>
            <span className="telemetry w-20 shrink-0 text-right text-meta text-muted-foreground">
              {s.roughness_length_m == null
                ? "—"
                : `${s.roughness_length_m.toFixed(2)} m`}
            </span>
            <span className="min-w-[4.5rem] flex-1 truncate text-meta text-muted-foreground">
              {s.basis}
            </span>
            <span className="telemetry w-20 shrink-0 text-right text-body">
              {s.hub_speed_ms.toFixed(4)} m/s
            </span>
            <span className="telemetry w-16 shrink-0 text-right text-body">
              {s.capacity_factor_pct.toFixed(3)}%
            </span>
            <span className="telemetry w-24 shrink-0 text-right text-body text-muted-foreground">
              {s.annual_energy_mwh.toFixed(1)} MWh
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

/** When the wind blows over the year, and from where. */
function SeasonAndDirection({ wind }: { wind: WindAnalysis }) {
  const m = wind.measured
  const roseMax = Math.max(
    ...m.direction_energy_rose_50m.map((s) => Math.max(s.energy_pct, s.hours_pct)),
    0.001
  )
  const speedMax = Math.max(
    ...m.monthly_mean_speed_50m.map((r) => r.mean_speed_ms),
    0.001
  )
  return (
    <div className="grid grid-cols-1 gap-3 @min-[29rem]:grid-cols-2">
      <div>
        <p className="eyebrow !text-micro mb-2">
          Mean speed at 50 m by month, m/s
        </p>
        <ul className="flex flex-col gap-1">
          {m.monthly_mean_speed_50m.map((r) => (
            <li key={r.month} className="flex items-center gap-2 text-xs">
              <span className="telemetry w-6 shrink-0 text-meta text-muted-foreground">
                {String(r.month).padStart(2, "0")}
              </span>
              <span className="bg-sunk relative h-1.5 min-w-[4rem] flex-1 overflow-hidden rounded-sm">
                <span
                  className="absolute inset-y-0 left-0 rounded-sm"
                  style={{
                    width: `${(r.mean_speed_ms / speedMax) * 100}%`,
                    backgroundColor: PALETTE_STOPS.rdbu_r[3],
                  }}
                />
              </span>
              <span className="telemetry w-16 shrink-0 text-right text-body">
                {r.mean_speed_ms.toFixed(3)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="eyebrow !text-micro mb-2">
          Direction at 50 m · energy against hours
        </p>
        <ul className="flex flex-col gap-1">
          {m.direction_energy_rose_50m.map((s) => (
            <li key={s.sector} className="flex items-center gap-2 text-xs">
              <span className="telemetry w-10 shrink-0 text-meta text-muted-foreground">
                {s.centre_deg.toFixed(1)}°
              </span>
              <span className="bg-sunk relative h-3 min-w-[4rem] flex-1 overflow-hidden rounded-sm">
                <span
                  className="absolute inset-x-0 top-0 h-1.5"
                  /* Energy and hours are two categories, so they take two
                     checked tokens rather than two stops of one diverging
                     ramp: rdbu_r[6] measured 1.25 against its own rail in
                     the light theme, which is a bar that is not on screen. */
                  style={{
                    width: `${(s.energy_pct / roseMax) * 100}%`,
                    backgroundColor: "rgb(var(--p-accent))",
                  }}
                />
                <span
                  className="absolute inset-x-0 bottom-0 h-1.5"
                  style={{
                    width: `${(s.hours_pct / roseMax) * 100}%`,
                    backgroundColor: "var(--muted-foreground)",
                  }}
                />
              </span>
              <span className="telemetry w-14 shrink-0 text-right text-meta">
                {s.energy_pct.toFixed(2)}%
              </span>
              <span className="telemetry w-14 shrink-0 text-right text-meta text-muted-foreground">
                {s.hours_pct.toFixed(2)}%
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1">
          <Stat
            label="Circular mean 50 m / 10 m"
            value={`${m.direction.circular_mean_deg_50m.toFixed(2)}° / ${m.direction.circular_mean_deg_10m.toFixed(2)}°`}
          />
          <Stat
            label="Median turning"
            value={`${m.direction.median_turning_deg.toFixed(1)}°`}
          />
        </div>
      </div>
    </div>
  )
}

/*
  The reference curve, as its parameters. It was a paragraph ending in a
  citation, a drivetrain note and the name of the column the points were
  read from; the curve is identified by its name and its numbers.
*/
function ReferenceCurve({ wind }: { wind: WindAnalysis }) {
  return (
    <>
      <p className="eyebrow !text-micro mb-2">
        Reference power curve · not a turbine selected for this site
      </p>
      <StatGrid at="pair">
        <Stat label="Model" value={wind.turbine.name} />
        <Stat
          label="Rated power"
          value={`${(wind.turbine.rated_power_w / 1e6).toFixed(3)} MW`}
        />
        <Stat
          label="Rotor / blades"
          value={`${wind.turbine.rotor_diameter_m.toFixed(0)} m · ${wind.turbine.blades}`}
        />
        <Stat
          label="Class"
          value={`${wind.turbine.iec_class} · turbulence ${wind.turbine.turbulence_class}`}
        />
        <Stat
          label="Curve hub height"
          value={`${wind.turbine.hub_height_m.toFixed(0)} m`}
        />
        <Stat
          label="Curve points"
          value={String(wind.turbine.power_curve_points)}
        />
      </StatGrid>
      <div className="mt-2">
        <PowerProvenanceNote provenance={wind.power_provenance} />
      </div>
    </>
  )
}

/**
 * The wind screening as sections of one reading.
 *
 * EACH SECTION IS NAMED FOR WHAT IS IN IT. All six used to open with the same
 * heading -- "Wind screening" and its three chips -- and the same record line,
 * because each was a page read alone. Six identical headings tell a reader
 * which product they are in and never which block. The product's name, its
 * chips, its record window and its four headline figures are stated once by
 * the host at the head of the group; these titles name the blocks.
 *
 * The chips travel with the group heading rather than being dropped: `gross`
 * and `unvalidated` are the reason these figures are never drawn in one
 * comparison with the photovoltaic ones, and a qualifier that only appears
 * next to some of the figures it qualifies is a qualifier that will be missed.
 */
export function windScreeningSections(wind: WindAnalysis): ReadingSection[] {
  const section = (
    id: string,
    title: string,
    short: string,
    node: ReactNode
  ): ReadingSection => ({ id: `wind-${id}`, title, short, node })

  return [
    section("levels", "Reanalysis levels", "Levels", <ReanalysisLevels wind={wind} />),
    section("hub", "Hub height result", "Hub", <HubResult wind={wind} />),
    section(
      "diagnostics",
      "Field diagnostics",
      "Diagnostics",
      <FieldDiagnostics wind={wind} />
    ),
    section("shear", "Shear sensitivity", "Shear", <ShearSensitivity wind={wind} />),
    section(
      "season",
      "Season and direction",
      "Season",
      <SeasonAndDirection wind={wind} />
    ),
    section(
      "turbine",
      "Reference power curve",
      "Curve",
      <ReferenceCurve wind={wind} />
    ),
  ]
}
