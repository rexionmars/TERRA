/**
 * The wind screening, as shown on screen.
 *
 * Lives outside AnalysisPage so the energy screen and the analysis screen render
 * it from one definition. Duplicating it would let the two drift.
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
import type { WindAnalysis } from "@/lib/types"
import { Chip, PowerProvenanceNote, WaterFigure } from "@/components/analysisPrimitives"
import { PALETTE_STOPS } from "@/lib/palettes"

/** A dense label/value pair for a figure that does not need its own tile. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="truncate text-[10px] text-muted-foreground">{label}</span>
      <span className="telemetry shrink-0 text-[11px] text-foreground">{value}</span>
    </div>
  )
}

export function WindScreening({ wind }: { wind: WindAnalysis }) {
  const m = wind.measured
  const h = wind.hub
  const q = wind.data_quality
  const shear = q.shear
  const fit = m.weibull_fit_check_50m
  const roseMax = Math.max(
    ...m.direction_energy_rose_50m.map((s) => Math.max(s.energy_pct, s.hours_pct)),
    0.001
  )
  const speedMax = Math.max(
    ...m.monthly_mean_speed_50m.map((r) => r.mean_speed_ms),
    0.001
  )

  return (
    <section className="rounded-sm border border-border bg-secondary/50 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="eyebrow">Wind screening</p>
          <Chip>separate product</Chip>
          <Chip>gross</Chip>
          <Chip>unvalidated</Chip>
        </div>
        {/*
          The grid cell, kept where the paragraph about it was removed. Two AOIs
          tens of kilometres apart fall in one MERRA-2 cell and return the same
          series, so without this the identical numbers have no explanation.
        */}
        <p className="telemetry text-[10px] text-muted-foreground">
          {wind.record_window} · {wind.record_years.toFixed(3)} years · one
          0.5×0.625° cell at {wind.grid_cell_centre[1]?.toFixed(3)},{" "}
          {wind.grid_cell_centre[0]?.toFixed(3)}
        </p>
      </div>

      <div
        className="mt-3 border-t pt-3"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          Carried by the reanalysis · no height extrapolation
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
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
        </div>
      </div>

      <div
        className="mt-3 border-t pt-3"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          At the {wind.hub_height_m.toFixed(0)} m hub · extrapolated
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <WaterFigure
            label="Hub speed"
            value={`${h.mean_speed_ms.toFixed(4)} m/s`}
            sub={`power law α ${wind.assumptions.shear_exponent.toFixed(4)}, ${h.extrapolation.height_ratio.toFixed(1)}× the top level`}
          />
          <WaterFigure
            label="Gross capacity factor"
            value={`${h.gross_capacity_factor_pct.toFixed(3)}%`}
            sub={`${h.gross_capacity_factor_no_density_correction_pct.toFixed(3)}% undensity-corrected`}
          />
          <WaterFigure
            label="Gross annual energy"
            value={`${h.gross_annual_energy_mwh_per_turbine.toFixed(1)} MWh`}
            sub={`per turbine · ${h.hours_per_year.toFixed(0)} h/yr`}
          />
          <WaterFigure
            label="Power density"
            value={`${h.wind_power_density_w_m2.toFixed(2)} W/m2`}
            sub={`k ${h.weibull_k.toFixed(4)}, c ${h.weibull_c_ms.toFixed(4)} m/s`}
          />
        </div>
        {/* The operating regime, which was a sentence. */}
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-3">
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
        </div>
      </div>

      <div
        className="mt-3 border-t pt-3"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">Field diagnostics</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-3">
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
        </div>
      </div>

      <div
        className="mt-3 border-t pt-3"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          Hub result across the shear exponent
        </p>
        <ul className="flex flex-col gap-1">
          {wind.shear_sensitivity.map((s) => (
            <li
              key={`${s.basis}-${s.shear_exponent}`}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <span className="telemetry w-16 shrink-0 text-[11px] text-foreground">
                {s.shear_exponent.toFixed(4)}
              </span>
              <span className="telemetry w-20 shrink-0 text-right text-[10px] text-muted-foreground">
                {s.roughness_length_m == null
                  ? "—"
                  : `${s.roughness_length_m.toFixed(2)} m`}
              </span>
              <span className="min-w-[10rem] flex-1 truncate text-[10px] text-muted-foreground">
                {s.basis}
              </span>
              <span className="telemetry w-20 shrink-0 text-right text-[11px]">
                {s.hub_speed_ms.toFixed(4)} m/s
              </span>
              <span className="telemetry w-16 shrink-0 text-right text-[11px]">
                {s.capacity_factor_pct.toFixed(3)}%
              </span>
              <span className="telemetry w-24 shrink-0 text-right text-[11px] text-muted-foreground">
                {s.annual_energy_mwh.toFixed(1)} MWh
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 border-t pt-3 lg:grid-cols-2"
           style={{ borderColor: "var(--border)" }}>
        <div>
          <p className="eyebrow !text-[9px] mb-2">
            Mean speed at 50 m by month, m/s
          </p>
          <ul className="flex flex-col gap-1">
            {m.monthly_mean_speed_50m.map((r) => (
              <li key={r.month} className="flex items-center gap-2 text-xs">
                <span className="telemetry w-6 shrink-0 text-[10px] text-muted-foreground">
                  {String(r.month).padStart(2, "0")}
                </span>
                <span className="bg-background relative h-1.5 min-w-[4rem] flex-1 overflow-hidden rounded-sm">
                  <span
                    className="absolute inset-y-0 left-0 rounded-sm"
                    style={{
                      width: `${(r.mean_speed_ms / speedMax) * 100}%`,
                      backgroundColor: PALETTE_STOPS.rdbu_r[3],
                    }}
                  />
                </span>
                <span className="telemetry w-16 shrink-0 text-right text-[11px]">
                  {r.mean_speed_ms.toFixed(3)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow !text-[9px] mb-2">
            Direction at 50 m · energy against hours
          </p>
          <ul className="flex flex-col gap-1">
            {m.direction_energy_rose_50m.map((s) => (
              <li key={s.sector} className="flex items-center gap-2 text-xs">
                <span className="telemetry w-10 shrink-0 text-[10px] text-muted-foreground">
                  {s.centre_deg.toFixed(1)}°
                </span>
                <span className="bg-background relative h-3 min-w-[4rem] flex-1 overflow-hidden rounded-sm">
                  <span
                    className="absolute inset-x-0 top-0 h-1.5"
                    style={{
                      width: `${(s.energy_pct / roseMax) * 100}%`,
                      backgroundColor: PALETTE_STOPS.rdbu_r[2],
                    }}
                  />
                  <span
                    className="absolute inset-x-0 bottom-0 h-1.5"
                    style={{
                      width: `${(s.hours_pct / roseMax) * 100}%`,
                      backgroundColor: PALETTE_STOPS.rdbu_r[6],
                    }}
                  />
                </span>
                <span className="telemetry w-14 shrink-0 text-right text-[10px]">
                  {s.energy_pct.toFixed(2)}%
                </span>
                <span className="telemetry w-14 shrink-0 text-right text-[10px] text-muted-foreground">
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

      {/*
        The reference curve, as its parameters. It was a paragraph ending in a
        citation, a drivetrain note and the name of the column the points were
        read from; the curve is identified by its name and its numbers.
      */}
      <div
        className="mt-3 border-t pt-3"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          Reference power curve · not a turbine selected for this site
        </p>
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
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
        </div>
        <div className="mt-2">
          <PowerProvenanceNote provenance={wind.power_provenance} />
        </div>
      </div>
    </section>
  )
}
